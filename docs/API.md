# HTTP API (Express)

Base URL: `/api` (when using the Vite dev proxy, call same-origin `/api/...`).

## Auth

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| POST | `/auth/login` | public | `{ email, password }` → `{ token, user }` |
| GET | `/auth/me` | staff | Current user |

## Dashboard

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| GET | `/dashboard/summary` | all | KPIs + charts + RADIUS fields + `bandwidth_by_day[]` (from `user_usage_daily`) + `radius_accounting_ready` |

## RADIUS accounting (radacct)

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| GET | `/accounting/usage/:username` | all | `{ usage_gb, input_gb, output_gb }` from `radacct` |
| GET | `/accounting/active-sessions` | all | Open accounting rows (`acctstoptime` null) |
| GET | `/accounting/summary-today` | all | Rough GB for sessions started today |
| POST | `/accounting/sync` | admin | Recompute `subscribers` from `radacct` only |
| POST | `/accounting/run-cycle` | admin | Sync + enforce (same as worker minute job) |
| POST | `/accounting/aggregate-yesterday` | admin | Fill `user_usage_daily` for UTC yesterday |

## Users (alias)

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| GET | `/users/:username/usage` | all | `{ usage }` string GB (Radius Manager style) |

## Packages

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| GET | `/packages` | all | Active packages; `?include_inactive=true` (**admin**) lists all |
| POST | `/packages` | admin | Create |
| PATCH | `/packages/:id` | admin | Update |

## Subscribers (RADIUS users)

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| GET | `/subscribers` | all | List + filters (`search`, `status`, `payment_status`, `speed`, `low_data_gb`, `expired_only`, `active_only`, `sort`, `order`, `limit`, `offset`) |
| GET | `/subscribers/:id` | all | Detail + joined profile |
| POST | `/subscribers` | admin, accountant | Create (default package if omitted) |
| PATCH | `/subscribers/:id` | admin, accountant | Update + nested `customer_profile` |
| PATCH | `/subscribers/:id/payment` | admin, accountant | `{ payment_status }` |
| POST | `/subscribers/bulk` | admin | `{ ids[], action: disable\|extend\|reset_data, extend_days? }` |
| DELETE | `/subscribers/:id` | admin | Delete |

## Invoices & payments

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| GET | `/invoices` | all | List (`?subscriber_id=`) |
| POST | `/invoices` | admin, accountant | Create |
| POST | `/invoices/auto` | admin | Generate per active subscriber |
| GET | `/invoices/:id/pdf` | all | PDF stream |
| PATCH | `/invoices/:id/mark-paid` | admin, accountant | Mark paid + payment row |
| GET | `/payments` | all | List |
| POST | `/payments` | admin, accountant | Record payment |

## Expenses

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| GET | `/expenses` | all | List |
| POST | `/expenses` | admin, accountant | Create |
| DELETE | `/expenses/:id` | admin | Delete |

## Inventory & sales

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| GET | `/products/categories` | all | Categories |
| POST | `/products/categories` | admin | Upsert by name |
| GET | `/products` | all | Products |
| POST | `/products` | admin | Create |
| PATCH | `/products/:id/stock` | admin | Stock delta |
| GET | `/sales` | all | Sales (flat rows) |
| POST | `/sales` | admin, accountant | Create sale + optional invoice |
| DELETE | `/sales/:id` | admin | Delete sale |

## MikroTik

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| GET | `/mikrotik/servers` | all | List targets |
| POST | `/mikrotik/servers` | admin | Save target |
| POST | `/mikrotik/servers/:id/test` | admin | TCP test + persist `last_health` |
| POST | `/mikrotik/test-body` | admin | Ad-hoc `{ host, port, use_ssl? }` |

## WebSocket

Connect to `/ws` on the API origin. Messages are JSON: `{ event, payload, t }`.

## Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | `{ ok: true, service }` |
