# Painel de Chamados GLPI (JFAL)

Aplicação web em React + Vite + TypeScript com backend Node/Express para integração com a API do GLPI.

## Requisitos

- Node.js 20+
- npm 10+
- Acesso de rede ao GLPI

## Configuração de ambiente (.env)

1. Copie o exemplo:

```bash
cp .env.example .env
```

2. Preencha os campos no arquivo `.env`:

- `GLPI_API_BASE`: URL da API GLPI (ex.: `https://seu-glpi/api.php/v1`)
- `GLPI_APP_TOKEN`: App-Token da API
- `GLPI_USER_TOKEN`: token de usuário (preferencial)  
  ou
- `GLPI_LOGIN` + `GLPI_PASSWORD`: credenciais de login
- `GLPI_INSECURE_TLS`: `false` em produção com certificado válido
- `API_PORT`: porta da aplicação (ex.: `8787`)
- `VITE_BACKEND_URL`: deixar vazio quando frontend e backend sobem juntos
- `VITE_GLPI_TICKET_URL`: URL base para abrir chamado no GLPI

## Desenvolvimento

```bash
npm install
npm run dev:full
```

- Frontend Vite: `http://localhost:5173`
- API/Proxy GLPI: `http://localhost:8787`

## Build e produção

1. Instalar dependências:

```bash
npm ci
```

2. Gerar build:

```bash
npm run build
```

3. Subir em produção:

```bash
npm run start
```

A aplicação ficará disponível em `http://SEU_SERVIDOR:API_PORT`.

## Docker (porta 7020)

Build da imagem:

```bash
docker build -t painel-glpi:latest .
```

Execução do container:

```bash
docker run -d --name painel-glpi --env-file .env -e API_PORT=7020 -p 7020:7020 painel-glpi:latest
```

Com Docker Compose:

```bash
docker compose up -d --build
```

URL: `http://SEU_SERVIDOR:7020`

## Execução com PM2 (recomendado)

```bash
npm install -g pm2
pm2 start npm --name painel-glpi -- run start
pm2 save
pm2 startup
```

Comandos úteis:

```bash
pm2 status
pm2 logs painel-glpi
pm2 restart painel-glpi
pm2 stop painel-glpi
```

## Nginx reverse proxy (opcional)

Exemplo de bloco:

```nginx
server {
  listen 80;
  server_name painel-glpi.seudominio.local;

  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

## Checklist de produção

- `GLPI_INSECURE_TLS=false` (com certificado válido)
- `.env` fora de versionamento
- portas liberadas no firewall
- processo gerenciado com PM2/serviço do sistema
- monitoramento de logs ativo
