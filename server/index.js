import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, "../dist");

const PORT = Number(process.env.API_PORT || 8787);
const GLPI_API_BASE = process.env.GLPI_API_BASE || process.env.VITE_GLPI_API_BASE || "https://glpi.jfal.jus.br/api.php/v1";
const GLPI_APP_TOKEN = process.env.GLPI_APP_TOKEN || process.env.VITE_GLPI_APP_TOKEN || "";
const GLPI_USER_TOKEN = process.env.GLPI_USER_TOKEN || process.env.VITE_GLPI_USER_TOKEN || "";
const GLPI_LOGIN = process.env.GLPI_LOGIN || process.env.VITE_GLPI_LOGIN || "";
const GLPI_PASSWORD = process.env.GLPI_PASSWORD || process.env.VITE_GLPI_PASSWORD || "";
const GLPI_INSECURE_TLS = String(process.env.GLPI_INSECURE_TLS || "true").toLowerCase() === "true";

if (GLPI_INSECURE_TLS) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const requestJson = async (url) => {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    const detail =
      error && typeof error === "object" && "cause" in error && error.cause
        ? ` cause=${error.cause.code || ""} ${error.cause.message || ""}`.trim()
        : "";
    throw new Error(`Falha de rede no fetch: ${url}${detail}`);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GLPI HTTP ${response.status}: ${text || "sem resposta"}`);
  }
  return text ? JSON.parse(text) : {};
};

const parseStatus = (value) => {
  const numeric = Number(value);
  if ([1, 2, 3, 4, 5, 6].includes(numeric)) return numeric;
  return 1;
};

const parseUserId = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
};

const formatUserName = (user, fallbackId) => {
  const firstName = String(user?.firstname ?? "").trim();
  const lastName = String(user?.realname ?? "").trim();
  const fullName = `${firstName} ${lastName}`.trim();
  const login = String(user?.name ?? "").trim();
  if (fullName) return fullName;
  if (login) return login;
  return `Usuário #${fallbackId}`;
};

const fetchUserNamesByIds = async (sessionToken, userIds) => {
  if (userIds.length === 0) return new Map();
  const usersMap = new Map();

  await Promise.all(
    userIds.map(async (userId) => {
      try {
        const params = new URLSearchParams({
          app_token: GLPI_APP_TOKEN,
          session_token: sessionToken
        });
        const user = await requestJson(`${GLPI_API_BASE}/User/${userId}?${params.toString()}`);
        usersMap.set(userId, formatUserName(user, userId));
      } catch (_error) {
        // keep fallback when user endpoint is unavailable for some IDs
      }
    })
  );

  return usersMap;
};

const fetchRequesterByTicketIds = async (sessionToken, ticketIds) => {
  if (ticketIds.length === 0) return new Map();

  const requesterUserIdByTicketId = new Map();

  await Promise.all(
    ticketIds.map(async (ticketId) => {
      try {
        const params = new URLSearchParams({
          app_token: GLPI_APP_TOKEN,
          session_token: sessionToken
        });
        const ticketUsers = await requestJson(`${GLPI_API_BASE}/Ticket/${ticketId}/Ticket_User?${params.toString()}`);
        const list = Array.isArray(ticketUsers) ? ticketUsers : [];
        const requester = list.find((item) => Number(item.type) === 1);
        const userId = parseUserId(requester?.users_id);
        if (userId) requesterUserIdByTicketId.set(ticketId, userId);
      } catch (_error) {
        // keep fallback when endpoint is unavailable for some tickets
      }
    })
  );

  const requesterUserIds = [...new Set([...requesterUserIdByTicketId.values()])];
  const requesterNamesByUserId = await fetchUserNamesByIds(sessionToken, requesterUserIds);

  const requesterByTicketId = new Map();
  requesterUserIdByTicketId.forEach((userId, ticketId) => {
    const requesterName = requesterNamesByUserId.get(userId);
    if (requesterName) requesterByTicketId.set(ticketId, requesterName);
  });

  return requesterByTicketId;
};

const mapTicket = (raw, categoryById) => {
  const id = Number(raw.id);
  if (!Number.isFinite(id)) return null;
  const categoryId = Number(raw.itilcategories_id);
  const categoryName =
    raw.category ??
    raw.category_name ??
    (Number.isFinite(categoryId) ? categoryById.get(categoryId) : null) ??
    (Number.isFinite(categoryId) && categoryId > 0 ? `Categoria #${categoryId}` : "Sem categoria");
  return {
    id,
    name: String(raw.name ?? raw.title ?? `Chamado #${id}`),
    description: String(raw.content ?? raw.description ?? "Sem descrição informada."),
    requester: String(raw.requester ?? raw.author ?? raw.users_id_recipient ?? ""),
    location: String(raw.location ?? raw.location_name ?? ""),
    category: String(categoryName),
    date: raw.date ? new Date(String(raw.date)).toISOString() : new Date().toISOString(),
    closedDate: raw.closedate
      ? new Date(String(raw.closedate)).toISOString()
      : raw.solvedate
        ? new Date(String(raw.solvedate)).toISOString()
        : null,
    type: Number(raw.type || 1),
    status: parseStatus(raw.status)
  };
};

const initSessionParams = () => {
  const params = new URLSearchParams({ app_token: GLPI_APP_TOKEN });

  if (GLPI_LOGIN && GLPI_PASSWORD) {
    params.set("login", GLPI_LOGIN);
    params.set("password", GLPI_PASSWORD);
    return params;
  }

  if (GLPI_USER_TOKEN) {
    params.set("user_token", GLPI_USER_TOKEN);
    return params;
  }

  throw new Error("Configuração incompleta: defina GLPI_USER_TOKEN ou GLPI_LOGIN + GLPI_PASSWORD.");
};

const fetchTickets = async (sessionToken) => {
  if (!GLPI_APP_TOKEN) {
    throw new Error("Configuração incompleta: GLPI_APP_TOKEN não definido.");
  }

  const categoriesParams = new URLSearchParams({
    app_token: GLPI_APP_TOKEN,
    session_token: sessionToken,
    range: "0-5000",
    sort: "id",
    order: "ASC"
  });

  const categoryById = new Map();
  try {
    const categoriesResponse = await requestJson(`${GLPI_API_BASE}/ITILCategory?${categoriesParams.toString()}`);
    const categoriesList = Array.isArray(categoriesResponse) ? categoriesResponse : categoriesResponse.data;
    if (Array.isArray(categoriesList)) {
      categoriesList.forEach((item) => {
        const id = Number(item.id);
        if (Number.isFinite(id)) categoryById.set(id, String(item.name ?? "Sem categoria"));
      });
    }
  } catch (_error) {
    // Some GLPI instances block this endpoint; keep ticket loading with fallback category fields.
  }

  const params = new URLSearchParams({
    app_token: GLPI_APP_TOKEN,
    session_token: sessionToken,
    range: "0-999",
    sort: "id",
    order: "DESC"
  });

  const response = await requestJson(`${GLPI_API_BASE}/Ticket?${params.toString()}`);
  const list = Array.isArray(response) ? response : response.data;

  if (!Array.isArray(list)) {
    throw new Error("Resposta inesperada da API Ticket.");
  }

  return list.map((item) => mapTicket(item, categoryById)).filter(Boolean).sort((a, b) => b.id - a.id);
};

const fetchNewTicketsBySearch = async (sessionToken) => {
  const query = new URLSearchParams({
    app_token: GLPI_APP_TOKEN,
    session_token: sessionToken,
    "criteria[0][field]": "12",
    "criteria[0][searchtype]": "equals",
    "criteria[0][value]": "1",
    "forcedisplay[0]": "1",
    "forcedisplay[1]": "2",
    "forcedisplay[2]": "7",
    "forcedisplay[3]": "12",
    "forcedisplay[4]": "14",
    "forcedisplay[5]": "15",
    "forcedisplay[6]": "21",
    "forcedisplay[7]": "22",
    "forcedisplay[8]": "83",
    range: "0-999",
    sort: "15",
    order: "ASC"
  });

  const result = await requestJson(`${GLPI_API_BASE}/search/Ticket?${query.toString()}`);
  const list = Array.isArray(result.data) ? result.data : [];
  const ticketIds = [...new Set(list.map((item) => Number(item["2"])).filter((value) => Number.isFinite(value)))];
  const requesterByTicketId = await fetchRequesterByTicketIds(sessionToken, ticketIds);
  const requesterIds = [...new Set(list.map((item) => parseUserId(item["4"])).filter((value) => value !== null))];
  const requesterById = await fetchUserNamesByIds(sessionToken, requesterIds);

  return list
    .map((item) => {
      const ticketId = Number(item["2"]);
      const requesterId = parseUserId(item["4"]);
      const requesterByTicket = requesterByTicketId.get(ticketId);
      const requesterName = requesterId ? requesterById.get(requesterId) : null;
      return {
        id: ticketId,
        name: String(item["1"] ?? ""),
        description: String(item["21"] ?? ""),
        requester: String(requesterByTicket ?? requesterName ?? ""),
        location: String(item["83"] ?? ""),
        category: String(item["7"] ?? "Sem categoria"),
        date: item["15"] ? new Date(String(item["15"])).toISOString() : new Date().toISOString(),
        closedDate: null,
        type: Number(item["14"] || 1),
        status: parseStatus(item["12"])
      };
    })
    .filter((item) => Number.isFinite(item.id));
};

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, apiBase: GLPI_API_BASE });
});

app.get("/api/dashboard", async (_req, res) => {
  try {
    const session = await requestJson(`${GLPI_API_BASE}/initSession?${initSessionParams().toString()}`);
    const sessionToken = session.session_token;
    if (!sessionToken) throw new Error("initSession não retornou session_token.");

    const tickets = await fetchTickets(sessionToken);
    const newTickets = await fetchNewTicketsBySearch(sessionToken);

    await fetch(
      `${GLPI_API_BASE}/killSession?app_token=${encodeURIComponent(GLPI_APP_TOKEN)}&session_token=${encodeURIComponent(
        sessionToken
      )}`
    ).catch(() => null);

    res.json({ source: "glpi-v1", tickets, newTickets, fetchedAt: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({
      source: "error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.use(express.static(distDir));
app.get("*", (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

app.listen(PORT, () => {
  console.log(`GLPI proxy em http://localhost:${PORT}`);
});
