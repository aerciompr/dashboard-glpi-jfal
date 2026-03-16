import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import "./App.css";
import jfLogo from "./assets/logo-justica-federal.png";

type GlpiStatus = 1 | 2 | 3 | 4 | 5 | 6;

type Ticket = {
  id: number;
  name: string;
  description: string;
  category: string;
  date: Date;
  closedDate: Date | null;
  type: number;
  status: GlpiStatus;
};

type TicketWithSchedule = Ticket & {
  serviceDate: Date | null;
};

const POLL_MS = 10000;
const NEW_STATUS: GlpiStatus = 1;
const ACTIVE_STATUSES: GlpiStatus[] = [1, 2, 3, 4];

const TYPE_LABEL: Record<number, string> = {
  1: "Incidente",
  2: "Requisição"
};

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? "";
const GLPI_TICKET_URL =
  import.meta.env.VITE_GLPI_TICKET_URL ?? "https://glpi.jfal.jus.br/front/ticket.form.php?id=";

const initialTickets: Ticket[] = [
  { id: 2197, name: "Usuário sem acesso ao ERP", description: "Usuário relata bloqueio no acesso ao sistema ERP desde 08:45.", category: "Acesso", date: new Date("2026-03-10T09:22:00"), closedDate: null, type: 2, status: 1 },
  { id: 2196, name: "Impressora do financeiro offline", description: "Equipamento do setor financeiro não responde em rede.", category: "Infraestrutura", date: new Date("2026-03-10T08:30:00"), closedDate: null, type: 1, status: 2 },
  { id: 2195, name: "Erro de login no e-mail", description: "Falha de autenticação ao acessar webmail institucional.", category: "Sistemas", date: new Date("2026-03-09T16:10:00"), closedDate: null, type: 1, status: 4 },
  { id: 2194, name: "Solicitação de novo ramal", description: "Pedido de criação de ramal para servidor recém lotado.", category: "Telefonia", date: new Date("2026-03-09T14:12:00"), closedDate: null, type: 2, status: 3 },
  { id: 2193, name: "Configuração de assinatura Outlook", description: "Ajustar assinatura padrão com dados da unidade.", category: "E-mail", date: new Date("2026-03-09T11:40:00"), closedDate: new Date("2026-03-09T12:20:00"), type: 2, status: 5 },
  { id: 2192, name: "Atualização de agente GLPI", description: "Atualização do agente de inventário em estações do setor.", category: "Inventário", date: new Date("2026-03-08T17:05:00"), closedDate: new Date("2026-03-08T18:00:00"), type: 2, status: 5 },
  { id: 2191, name: "VPN indisponível para comercial", description: "Usuários externos sem conexão por VPN corporativa.", category: "Rede", date: new Date("2026-03-08T10:08:00"), closedDate: null, type: 1, status: 2 },
  { id: 2190, name: "Conta de usuário bloqueada", description: "Desbloqueio de conta após tentativas inválidas.", category: "Acesso", date: new Date("2026-03-07T15:32:00"), closedDate: new Date("2026-03-07T16:02:00"), type: 2, status: 6 }
];

const incidentTemplates = [
  { name: "Sem conexão com Wi-Fi corporativo", category: "Rede" },
  { name: "Erro 500 ao abrir tela de pedidos", category: "Sistemas" },
  { name: "Solicitação de reset de senha", category: "Acesso" },
  { name: "Falha de impressão no RH", category: "Infraestrutura" }
];

const formatDate = (date: Date) =>
  new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);

const formatServiceDate = (date: Date | null) => {
  if (!date) return "Não identificada";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short"
  }).format(date);
};

const toPlainText = (value: unknown) => {
  const input = String(value ?? "");
  if (!input.trim()) return "";
  if (typeof window !== "undefined") {
    const doc = new DOMParser().parseFromString(input, "text/html");
    return doc.body.textContent?.replace(/\s+/g, " ").trim() ?? "";
  }
  return input.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
};

const buildDateFromParts = (
  dayRaw: string,
  monthRaw: string,
  yearRaw: string,
  hourRaw?: string,
  minuteRaw?: string
) => {
  const day = Number(dayRaw);
  const month = Number(monthRaw);
  const year = Number(yearRaw.length === 2 ? `20${yearRaw}` : yearRaw);
  const hour = hourRaw ? Number(hourRaw) : 8;
  const minute = minuteRaw ? Number(minuteRaw) : 0;

  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null;
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  if (year < 2000 || year > 2100) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
};

const inferServiceDateFromDescription = (description: string): Date | null => {
  const text = toPlainText(description).toLowerCase();
  if (!text) return null;

  const matches: Date[] = [];
  const monthMap: Record<string, number> = {
    janeiro: 1,
    fevereiro: 2,
    marco: 3,
    março: 3,
    abril: 4,
    maio: 5,
    junho: 6,
    julho: 7,
    agosto: 8,
    setembro: 9,
    outubro: 10,
    novembro: 11,
    dezembro: 12
  };

  const textDateRegex =
    /\b(?:dia\s+)?(\d{1,2})\s+de\s+(janeiro|fevereiro|marco|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})(?:\s*(?:,|-|às|as)?\s*(\d{1,2})(?:[:h](\d{2}))?)?/gi;

  let textMatch: RegExpExecArray | null = null;
  while ((textMatch = textDateRegex.exec(text)) !== null) {
    const month = monthMap[textMatch[2]];
    const parsed = buildDateFromParts(textMatch[1], String(month), textMatch[3], textMatch[4], textMatch[5]);
    if (parsed) matches.push(parsed);
  }

  const dateTimeRegex =
    /(?<!\d)(?:dia\s+)?(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:\s*(?:,|-|às|as|a partir de)?\s*(\d{1,2})(?:[:h](\d{2}))?)?(?!\d)/gi;

  let match: RegExpExecArray | null = null;
  while ((match = dateTimeRegex.exec(text)) !== null) {
    const parsed = buildDateFromParts(match[1], match[2], match[3], match[4], match[5]);
    if (parsed) matches.push(parsed);
  }

  if (matches.length === 0) return null;

  const now = Date.now();
  const futureDates = matches.filter((value) => value.getTime() >= now - 1000 * 60 * 60 * 24);
  if (futureDates.length > 0) {
    return futureDates.sort((a, b) => a.getTime() - b.getTime())[0];
  }

  return matches.sort((a, b) => b.getTime() - a.getTime())[0];
};

const getOpenDays = (date: Date) => {
  const diffMs = Date.now() - date.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
};

const getReferenceDateForAging = (ticket: TicketWithSchedule) => ticket.serviceDate ?? ticket.date;

const playFallbackSound = () => {
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(880, context.currentTime);
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.22, context.currentTime + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.42);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.42);
};

const notifyNewTicket = (ticket: Ticket, voiceEnabled: boolean) => {
  if (voiceEnabled && "speechSynthesis" in window) {
    const message = `Novo chamado aberto. ${ticket.name}.`;
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = "pt-BR";
    utterance.rate = 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    return;
  }
  playFallbackSound();
};

const requestJson = async (url: string) => {
  const response = await fetch(url, { cache: "no-store" });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text || "sem resposta"}`);
  }
  return text ? JSON.parse(text) : {};
};

const apiUrl = (path: string) => {
  if (!BACKEND_URL) return path;
  return `${BACKEND_URL}${path}`;
};

const fetchBackendTickets = async (): Promise<Ticket[]> => {
  const payload = await requestJson(apiUrl("/api/dashboard"));
  const rawList = Array.isArray(payload.tickets) ? payload.tickets : [];
  const rawNewList = Array.isArray(payload.newTickets) ? payload.newTickets : [];

  const normalizedAll = rawList.map((item: Record<string, unknown>) => ({
    id: Number(item.id),
    name: String(item.name ?? ""),
    description: toPlainText(item.description ?? "") || "Sem descrição informada.",
    category: String(item.category ?? "Sem categoria"),
    date: item.date ? new Date(String(item.date)) : new Date(),
    closedDate: item.closedDate ? new Date(String(item.closedDate)) : null,
    type: Number(item.type || 1),
    status: Number(item.status) as GlpiStatus
  }));

  const normalizedNew = rawNewList.map((item: Record<string, unknown>) => ({
    id: Number(item.id),
    name: String(item.name ?? ""),
    description: toPlainText(item.description ?? ""),
    category: String(item.category ?? "Sem categoria"),
    date: item.date ? new Date(String(item.date)) : new Date(),
    closedDate: null,
    type: Number(item.type || 1),
    status: Number(item.status) as GlpiStatus
  }));

  const newById = new Map<number, Ticket>(normalizedNew.map((item: Ticket) => [item.id, item]));
  return normalizedAll.map((item: Ticket) => {
    if (!newById.has(item.id)) return item;
    const newTicket = newById.get(item.id)!;
    return {
      ...item,
      ...newTicket,
      description: newTicket.description.trim() || item.description
    };
  });
};

const nextStatus = (status: GlpiStatus): GlpiStatus => {
  if (status === 1) return 2;
  if (status === 2 || status === 3) return 4;
  if (status === 4) return 5;
  return status;
};

const simulateUpdate = (current: Ticket[], autoAdd: boolean): Ticket[] => {
  let updated = [...current];

  updated = updated.map((ticket) => {
    if ([1, 2, 3, 4].includes(ticket.status) && Math.random() < 0.1) {
      return { ...ticket, status: nextStatus(ticket.status) };
    }
    return ticket;
  });

  if (autoAdd && Math.random() < 0.45) {
    const highestId = Math.max(...updated.map((ticket) => ticket.id));
    const sample = incidentTemplates[Math.floor(Math.random() * incidentTemplates.length)];
    updated.unshift({
      id: highestId + 1,
      name: sample.name,
      description: "Novo chamado detectado automaticamente no modo de simulação.",
      category: sample.category,
      date: new Date(),
      closedDate: null,
      type: 2,
      status: 1
    });
  }

  return updated.sort((a, b) => b.id - a.id);
};

function App() {
  const [tickets, setTickets] = useState<Ticket[]>(initialTickets.sort((a, b) => b.id - a.id));
  const [monitorActive, setMonitorActive] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [lastSync, setLastSync] = useState(new Date());
  const [integrationError, setIntegrationError] = useState("");
  const [sourceMode, setSourceMode] = useState<"api" | "simulado">("simulado");
  const [newPage, setNewPage] = useState(1);
  const [hoveredTicket, setHoveredTicket] = useState<Ticket | null>(null);
  const [popupPosition, setPopupPosition] = useState({ x: 0, y: 0 });
  const hoverTimeoutRef = useRef<number | null>(null);
  const hideTimeoutRef = useRef<number | null>(null);
  const announcedRef = useRef(new Set(initialTickets.filter((t) => t.status === 1).map((t) => t.id)));

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!monitorActive) return;
      try {
        const fromApi = await fetchBackendTickets();
        if (cancelled) return;
        setTickets(fromApi);
        setSourceMode("api");
        setIntegrationError("");
      } catch (error) {
        if (cancelled) return;
        setSourceMode("simulado");
        setTickets((prev) => simulateUpdate(prev, true));
        setIntegrationError(`Backend/GLPI indisponível: ${String(error)}`);
      } finally {
        if (!cancelled) setLastSync(new Date());
      }
    };

    void load();

    const interval = setInterval(() => {
      void load();
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [monitorActive]);

  const allTickets = useMemo(() => [...tickets].sort((a, b) => b.id - a.id), [tickets]);
  const newTickets = useMemo(() => allTickets.filter((ticket) => ticket.status === NEW_STATUS), [allTickets]);
  const oldestNewTickets = useMemo(
    () => [...newTickets].sort((a, b) => a.date.getTime() - b.date.getTime()),
    [newTickets]
  );
  const oldestNewTicketsWithAiDate = useMemo<TicketWithSchedule[]>(
    () =>
      oldestNewTickets.map((ticket) => ({
        ...ticket,
        serviceDate: inferServiceDateFromDescription(ticket.description)
      })),
    [oldestNewTickets]
  );
  const rangeUpTo3 = oldestNewTicketsWithAiDate.filter(
    (ticket) => getOpenDays(getReferenceDateForAging(ticket)) <= 3
  ).length;
  const range4To5 = oldestNewTicketsWithAiDate.filter((ticket) => {
    const days = getOpenDays(getReferenceDateForAging(ticket));
    return days > 3 && days <= 5;
  }).length;
  const rangeOver5 = oldestNewTicketsWithAiDate.filter(
    (ticket) => getOpenDays(getReferenceDateForAging(ticket)) > 5
  ).length;
  const pageSize = 10;
  const totalNewPages = Math.max(1, Math.ceil(oldestNewTicketsWithAiDate.length / pageSize));
  const pagedOldestNewTickets = oldestNewTicketsWithAiDate.slice((newPage - 1) * pageSize, newPage * pageSize);

  useEffect(() => {
    newTickets
      .filter((ticket) => ticket.status === NEW_STATUS)
      .forEach((ticket) => {
        if (announcedRef.current.has(ticket.id)) return;
        announcedRef.current.add(ticket.id);
        notifyNewTicket(ticket, voiceEnabled);
      });
  }, [newTickets, voiceEnabled]);

  useEffect(() => {
    setNewPage((current) => Math.min(current, totalNewPages));
  }, [totalNewPages]);

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current !== null) {
        window.clearTimeout(hoverTimeoutRef.current);
      }
      if (hideTimeoutRef.current !== null) {
        window.clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);

  const sameDay = (left: Date, right: Date) =>
    left.getDate() === right.getDate() &&
    left.getMonth() === right.getMonth() &&
    left.getFullYear() === right.getFullYear();

  const monthlyCreated = useMemo(() => {
    const now = new Date();
    return tickets.filter(
      (ticket) => ticket.date.getMonth() === now.getMonth() && ticket.date.getFullYear() === now.getFullYear()
    );
  }, [tickets]);

  const monthlyClosed = monthlyCreated.filter((ticket) => ticket.status === 5 || ticket.status === 6);
  const monthlyOpen = monthlyCreated.filter((ticket) => ACTIVE_STATUSES.includes(ticket.status));
  const monthlyResolutionRate = monthlyCreated.length
    ? (monthlyClosed.length / monthlyCreated.length) * 100
    : 0;

  const dailyCreated = useMemo(() => {
    const now = new Date();
    return tickets.filter((ticket) => sameDay(ticket.date, now));
  }, [tickets]);

  const dailyClosed = useMemo(() => {
    const now = new Date();
    return tickets.filter((ticket) => ticket.closedDate && sameDay(ticket.closedDate, now));
  }, [tickets]);

  const dailyOpen = dailyCreated.filter((ticket) => ACTIVE_STATUSES.includes(ticket.status));
  const dailyResolutionRate = dailyCreated.length ? (dailyClosed.length / dailyCreated.length) * 100 : 0;

  const forceNewTicket = async () => {
    try {
      const fromApi = await fetchBackendTickets();
      setTickets(fromApi);
      setSourceMode("api");
      setIntegrationError("");
    } catch (error) {
      setIntegrationError(`Backend/GLPI indisponível: ${String(error)}`);
      setTickets((prev) => simulateUpdate(prev, true));
      setSourceMode("simulado");
    } finally {
      setLastSync(new Date());
    }
  };

  const handleRowMouseEnter = (ticket: Ticket, event: MouseEvent<HTMLTableRowElement>) => {
    if (hideTimeoutRef.current !== null) {
      window.clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    if (hoverTimeoutRef.current !== null) {
      window.clearTimeout(hoverTimeoutRef.current);
    }
    setPopupPosition({ x: event.clientX, y: event.clientY });
    hoverTimeoutRef.current = window.setTimeout(() => {
      setHoveredTicket(ticket);
    }, 2000);
  };

  const handleRowMouseMove = (event: MouseEvent<HTMLTableRowElement>) => {
    setPopupPosition({ x: event.clientX, y: event.clientY });
  };

  const handleRowMouseLeave = () => {
    if (hoverTimeoutRef.current !== null) {
      window.clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    if (hideTimeoutRef.current !== null) {
      window.clearTimeout(hideTimeoutRef.current);
    }
    hideTimeoutRef.current = window.setTimeout(() => {
      setHoveredTicket(null);
    }, 200);
  };

  const handlePopupMouseEnter = () => {
    if (hideTimeoutRef.current !== null) {
      window.clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  };

  const handlePopupMouseLeave = () => {
    setHoveredTicket(null);
  };

  return (
    <main className="dashboard">
      <header className="hero">
        <div className="hero-main">
          <img src={jfLogo} alt="Marca Justiça Federal" className="hero-logo" />
          <p className="hero-brand-location">Justiça Federal em Alagoas</p>
          <h1>Central de Chamados</h1>
          {integrationError ? <p className="hero-subtitle">Aviso integração: {integrationError}</p> : null}
        </div>
        <div className="hero-actions">
          <button onClick={forceNewTicket}>Atualizar agora</button>
          <button onClick={() => setMonitorActive((value) => !value)}>
            {monitorActive ? "Pausar atualização" : "Ativar atualização"}
          </button>
          <button onClick={() => setVoiceEnabled((value) => !value)}>
            Voz: {voiceEnabled ? "ON" : "OFF"}
          </button>
        </div>
      </header>

      <section className="cards-grid">
        <article className="status-card card-open">
          <h2>Chamados Novos Abertos</h2>
          <strong>{newTickets.length}</strong>
        </article>
        <article className="status-card card-assigned">
          <h2>Novos até 3 dias</h2>
          <strong>{rangeUpTo3}</strong>
        </article>
        <article className="status-card card-pending">
          <h2>Novos com 4 a 5 dias</h2>
          <strong>{range4To5}</strong>
        </article>
        <article className="status-card card-finished">
          <h2>Novos acima de 5 dias</h2>
          <strong>{rangeOver5}</strong>
        </article>
      </section>

      <section className="compact-metrics">
        <article>
          <span>Criados hoje</span>
          <strong>{dailyCreated.length}</strong>
        </article>
        <article>
          <span>Abertos hoje</span>
          <strong>{dailyOpen.length}</strong>
        </article>
        <article>
          <span>Encerrados hoje</span>
          <strong>{dailyClosed.length}</strong>
        </article>
        <article>
          <span>Resolução dia</span>
          <strong>{dailyResolutionRate.toFixed(0)}%</strong>
        </article>
        <article>
          <span>Criados mês</span>
          <strong>{monthlyCreated.length}</strong>
        </article>
        <article>
          <span>Abertos mês</span>
          <strong>{monthlyOpen.length}</strong>
        </article>
        <article>
          <span>Encerrados mês</span>
          <strong>{monthlyClosed.length}</strong>
        </article>
        <article>
          <span>Resolução mês</span>
          <strong>{monthlyResolutionRate.toFixed(0)}%</strong>
        </article>
      </section>

      <section className="table-panel">
        <div className="panel-head">
          <h2>Chamados Novos</h2>
          <small>Ordenado do mais antigo para o mais recente • atualizado em {formatDate(lastSync)}</small>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Título</th>
                <th>Categoria</th>
                <th>Tipo</th>
                <th>Aberto em</th>
                <th>Data do Agendamento</th>
                <th>Dias em aberto</th>
                <th>Visualizar Chamado</th>
              </tr>
            </thead>
            <tbody>
              {pagedOldestNewTickets.map((ticket) => (
                <tr
                  key={`old-${ticket.id}`}
                  onMouseEnter={(event) => handleRowMouseEnter(ticket, event)}
                  onMouseMove={handleRowMouseMove}
                  onMouseLeave={handleRowMouseLeave}
                >
                  <td>{ticket.id}</td>
                  <td>{ticket.name}</td>
                  <td>{ticket.category}</td>
                  <td>{TYPE_LABEL[ticket.type] ?? `Tipo ${ticket.type}`}</td>
                  <td>{formatDate(ticket.date)}</td>
                  <td>{formatServiceDate(ticket.serviceDate)}</td>
                  <td>{getOpenDays(ticket.date)}</td>
                  <td>
                    <a href={`${GLPI_TICKET_URL}${ticket.id}`} target="_blank" rel="noreferrer">
                      Visualizar
                    </a>
                  </td>
                </tr>
              ))}
              {pagedOldestNewTickets.length === 0 ? (
                <tr>
                  <td colSpan={8}>Nenhum chamado novo pendente no momento.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="pagination-row">
          <button
            type="button"
            onClick={() => setNewPage((page) => Math.max(1, page - 1))}
            disabled={newPage === 1}
          >
            Anterior
          </button>
          <span>
            Página {newPage} de {totalNewPages}
          </span>
          <button
            type="button"
            onClick={() => setNewPage((page) => Math.min(totalNewPages, page + 1))}
            disabled={newPage === totalNewPages}
          >
            Próxima
          </button>
        </div>
      </section>

      {hoveredTicket ? (
        <aside
          className="ticket-hover-popup"
          onMouseEnter={handlePopupMouseEnter}
          onMouseLeave={handlePopupMouseLeave}
          style={{
            top: Math.min(window.innerHeight - 180, popupPosition.y + 16),
            left: Math.min(window.innerWidth - 360, popupPosition.x + 16)
          }}
        >
          <strong>Descrição do chamado #{hoveredTicket.id}</strong>
          <p>{hoveredTicket.description || "Sem descrição informada."}</p>
        </aside>
      ) : null}

      <footer className="app-footer">Desenvolvido por Justiça Federal em Alagoas - DTI</footer>
    </main>
  );
}

export default App;
