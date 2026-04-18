# PrincE RADIUS SaaS (PostgreSQL + Express + React)

This folder is a **new** SaaS-oriented stack alongside the legacy `docker-compose` RADIUS project.

## Stack

- **API**: Node 20 + Express + TypeScript (`apps/api`)
- **Worker**: BullMQ consumer (`apps/api/src/worker.ts`)
- **DB**: PostgreSQL 16 (`db/init.sql`)
- **Queue**: Redis 7 + BullMQ
- **Web**: Vite + React + Tailwind + shadcn-style UI (`apps/web`)
- **Realtime**: WebSocket on `/ws`

## Quick start

```bash
cd saas-platform
docker compose up --build
```

### Docker build: `TLS handshake timeout` / cannot pull `node:20-alpine`

- **Retry** later or switch network (mobile hotspot, VPN on/off, different DNS e.g. `8.8.8.8`).
- **Pre-pull** when the connection is stable: `docker pull public.ecr.aws/docker/library/node:20-alpine`
- Dockerfiles in this repo use **`public.ecr.aws/docker/library/node`** (AWS public mirror of the official Node image) to reduce reliance on `registry-1.docker.io`.
- If **Postgres/Redis** pulls also fail, run **infra only** (small images) then run API + web on your machine with Node:

```bash
docker compose -f docker-compose.infra.yml up -d
```

Then in two terminals, with `DATABASE_URL=postgresql://prince:prince_dev_pass@127.0.0.1:5432/radius_saas` and `REDIS_URL=redis://127.0.0.1:6379`:

```bash
cd apps/api && npm install && npm run dev
cd apps/web && npm install && npm run dev
```

(Web dev server proxies `/api` to `http://127.0.0.1:4000` by default in `vite.config.ts`.)

On every `up`, the **`db-migrate`** service runs `db/migrations/002_radius_accounting.sql` against Postgres (idempotent), then **API** and **worker** start. The API also runs **`ensureRadiusAccountingSchema()`** on boot using `apps/api/sql/radius_accounting.sql` if tables are still missing.

Optional: seed extra data (categories, etc.):

```bash
docker compose exec api npm run db:seed
```

If **`staff_users` is empty**, the API creates the default admin on startup (no manual seed required for login).

Local DB without Docker: `cd apps/api && npm run db:migrate` then `npm run db:seed` if you want categories seeded.

Default staff login (unless overridden by `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`):

- **Email**: `admin@local.test`
- **Password**: `Admin123!`

Open **http://localhost:5174** (web) and **http://localhost:4000/api/health** (API).

## Environment

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis for BullMQ |
| `JWT_SECRET` | HS256 secret for staff JWT |
| `MIKROTIK_TIMEOUT_MS` | TCP test timeout (default 8000) |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | Optional overrides for `npm run db:seed` |
| `PG_BIN_DIR` | (Optional) Directory containing `psql`, `pg_dump`, `pg_restore` — use on Windows if tools are not on `PATH` |
| `PSQL_PATH` / `PG_DUMP_PATH` / `PG_RESTORE_PATH` | (Optional) Full path to a single binary when you prefer explicit paths |

Web (Docker): `VITE_PROXY_TARGET` points Vite’s dev proxy at the `api` service so the browser can call `/api` same-origin.

### Backup & restore (`psql` / `pg_dump`)

The maintenance UI does **not** replay SQL only through the Node `pg` driver. It runs the official CLI tools as subprocesses: **`pg_dump`** for backups, **`psql`** for plain `.sql` files, **`pg_restore`** for custom-format dumps. That matches how DBAs operate and handles large dumps reliably.

- **API in Docker** (`docker compose`): The API image includes **`postgresql-client`** (`apk`), so backup/restore from the UI works without extra host setup.
- **API on Windows (e.g. `npm run dev`)**: Install [PostgreSQL for Windows](https://www.postgresql.org/download/windows/) (client tools in `bin`) **or** set `PG_BIN_DIR` to that `bin` folder (e.g. `C:\Program Files\PostgreSQL\16\bin`). Otherwise you will see `spawn psql ENOENT`.
- **Ubuntu / Debian VPS**: `sudo apt install postgresql-client` — then `psql` is on `PATH` for a bare-metal Node process.

## HTTP API overview

See `docs/API.md` for route-level documentation. All business routes (except `/api/health` and `/api/auth/login`) require `Authorization: Bearer <jwt>`.

## RADIUS accounting (radacct → subscribers → enforce)

Fresh installs include `radacct`, `radcheck`, `radreply`, and `user_usage_daily` in `db/init.sql`.

**Existing Postgres volume** (already initialized): run `db/migrations/002_radius_accounting.sql` once against `radius_saas` (e.g. from host in `saas-platform`: `Get-Content db/migrations/002_radius_accounting.sql | docker compose exec -T postgres psql -U prince -d radius_saas`).

Point **FreeRADIUS** `sql` accounting at the same database so `radacct` fills. In `sites-enabled/default`, ensure `accounting { sql }` (and `sql` module `dialect = postgresql` with correct `read_clients` / connection).

**MikroTik** (PPP example):

```text
/radius add service=ppp address=<RADIUS_IP> secret=<SECRET> accounting-port=1813
/ppp aaa set use-radius=yes accounting=yes interim-update=1m
```

**Worker (BullMQ)** every **60s**: `radius_accounting_cycle` — syncs octets from `radacct` into `subscribers.data_used_gb` / `data_remaining_gb`, then removes `radcheck`/`radreply` and sets `subscribers.status = 'disabled'` when **quota ≤ 0** or **expires_at &lt; now()**. Existing PPP sessions may stay up until disconnect; add **CoA** or `/ppp active remove` later.

Daily job `aggregate_user_usage_daily` fills `user_usage_daily` (UTC yesterday) for lighter dashboards.

## Notes

- MikroTik **test** endpoints perform **TCP reachability** to the API port; full RouterOS login/sync can be added with a RouterOS client library.
- Repeatable BullMQ jobs are registered from the **API** process (requires Redis); the **worker** executes them.
- Invoice PDFs use **pdfkit** (minimal layout); swap for HTML templates + headless Chrome if you need branded PDFs.
