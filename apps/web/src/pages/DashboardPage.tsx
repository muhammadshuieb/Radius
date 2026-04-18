import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, Banknote, Bell, Database, MessageCircle, Radio, TrendingUp, Users as UsersIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { ServerHostGauges } from "@/components/dashboard/ServerHostGauges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch, apiFetchBlob } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

type Summary = {
  total_users: number;
  active_users: number;
  expired_users: number;
  revenue_30d: number;
  revenue_month_growth_pct: number;
  payments_by_day: { date: string; amount: number }[];
  subscribers_by_day: { date: string; count: number }[];
  active_radius_sessions?: number;
  usage_today_gb?: number;
  top_users_radacct_total_gb?: { username: string; gb: number }[];
  top_users_last_7d_rollup_gb?: { username: string; gb: number }[];
  usage_rollup_utc_today_gb?: number;
  bandwidth_by_day?: { date: string; gb: number }[];
  radius_accounting_ready?: boolean;
  last_backup?: {
    id: string;
    created_at: string;
    status: string;
    drive_uploaded: boolean;
    filename: string | null;
  } | null;
};

type RangeKey = "today" | "d7" | "d30" | "month" | "year";

type WhatsAppStatus = {
  configured: boolean;
  reachable: boolean;
  sessionName: string;
  session:
    | null
    | { exists: false }
    | ({ exists: true } & { status?: string; me?: { id?: string; pushName?: string } | null });
};

function daysForRange(k: RangeKey): number {
  switch (k) {
    case "today":
      return 1;
    case "d7":
      return 7;
    case "d30":
      return 30;
    case "month":
      return 30;
    case "year":
      return 365;
    default:
      return 30;
  }
}

function pill(active: boolean, onClick: () => void, label: string, disabled?: boolean): ReactNode {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-full px-4 py-2 text-sm font-medium transition-all",
        active
          ? "bg-primary text-primary-foreground shadow-md shadow-primary/25"
          : "bg-card/80 text-muted-foreground hover:bg-accent hover:text-foreground border border-border/60",
        disabled && "opacity-40 pointer-events-none"
      )}
    >
      {label}
    </button>
  );
}

function MiniBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
      <div
        className="h-full rounded-full bg-gradient-to-l from-emerald-500 to-emerald-400 dark:from-emerald-400 dark:to-emerald-600"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function DashboardPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [range, setRange] = useState<RangeKey>("d30");
  const revenueDays = daysForRange(range);

  const q = useQuery({
    queryKey: ["dashboard-summary", revenueDays],
    queryFn: () => apiFetch<Summary>(`/api/dashboard/summary?revenue_days=${revenueDays}`),
  });

  const financeStaff = user?.role === "admin" || user?.role === "accountant" || user?.role === "viewer";
  const todayIso = new Date().toISOString().slice(0, 10);
  const yNow = new Date().getFullYear();
  const mNow = new Date().getMonth() + 1;

  const finDayQ = useQuery({
    queryKey: ["dash-fin-day", todayIso],
    queryFn: () =>
      apiFetch<{ totals: { net: number } }>(`/api/finance/reports/summary?granularity=day&date=${todayIso}`),
    enabled: financeStaff,
  });
  const finMonthQ = useQuery({
    queryKey: ["dash-fin-month", yNow, mNow],
    queryFn: () =>
      apiFetch<{ totals: { net: number } }>(
        `/api/finance/reports/summary?granularity=month&year=${yNow}&month=${mNow}`
      ),
    enabled: financeStaff,
  });
  const notifQ = useQuery({
    queryKey: ["dash-notifications"],
    queryFn: () =>
      apiFetch<{ counts: { expiring: number; unpaid_invoices: number } }>(
        "/api/notifications?expiring_days=7&unpaid_days=30"
      ),
  });

  const waQ = useQuery({
    queryKey: ["whatsapp-status-dash"],
    queryFn: () => apiFetch<WhatsAppStatus>("/api/whatsapp/status"),
    enabled: user?.role === "admin",
    refetchInterval: 60_000,
  });

  const s = q.data;

  const periodPayments = useMemo(() => (s?.payments_by_day ?? []).reduce((a, x) => a + x.amount, 0), [s]);
  const newSubsWindow = useMemo(() => (s?.subscribers_by_day ?? []).reduce((a, x) => a + x.count, 0), [s]);

  const plData = useMemo(
    () =>
      (s?.payments_by_day ?? []).map((d) => ({
        date: d.date.length > 5 ? d.date.slice(5) : d.date,
        revenue: d.amount,
        expense: 0,
        profit: d.amount,
      })),
    [s]
  );

  const activeShare = s && s.total_users > 0 ? (s.active_users / s.total_users) * 100 : 0;
  const radiusHealth = s?.radius_accounting_ready ? 100 : 35;

  if (q.isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground animate-pulse rounded-2xl border border-border/60 bg-card/40">
        {t("dashboard.loading")}
      </div>
    );
  }
  if (q.isError || !s) {
    return <div className="rounded-2xl border border-destructive/40 bg-destructive/10 px-6 py-8 text-destructive">{(q.error as Error)?.message}</div>;
  }

  const rangeLabel =
    range === "today"
      ? t("dashboard.rangeToday")
      : range === "d7"
        ? t("dashboard.range7")
        : range === "d30"
          ? t("dashboard.range30")
          : range === "month"
            ? t("dashboard.rangeMonth")
            : range === "year"
              ? t("dashboard.rangeYear")
              : "…";

  return (
    <div className="space-y-8">
      <header className="sticky top-0 z-20 -mx-4 mb-2 flex flex-col gap-4 border-b border-border/50 bg-app-main/90 px-4 py-4 backdrop-blur-md supports-[backdrop-filter]:bg-app-main/75 md:-mx-6 md:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-col gap-1 text-start">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{t("dashboard.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("dashboard.filtersHint")}</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="text-start">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("dashboard.filtersTitle")}</div>
            <div className="text-sm font-semibold text-foreground">{rangeLabel}</div>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("dashboard.filtersTitle")}>
            {pill(range === "today", () => setRange("today"), t("dashboard.rangeToday"))}
            {pill(range === "d7", () => setRange("d7"), t("dashboard.range7"))}
            {pill(range === "d30", () => setRange("d30"), t("dashboard.range30"))}
            {pill(range === "month", () => setRange("month"), t("dashboard.rangeMonth"))}
            {pill(range === "year", () => setRange("year"), t("dashboard.rangeYear"))}
            {pill(false, () => {}, t("dashboard.rangeCustom"), true)}
          </div>
        </div>
      </header>

      <ServerHostGauges />

      {user?.role === "admin" && (
        <Card className="rounded-3xl border-border/60 bg-card/80 shadow-card-erp">
          <CardHeader className="flex flex-col gap-2 text-start sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 text-start">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                <MessageCircle className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-base">{t("dashboard.whatsappCardTitle")}</CardTitle>
                <CardDescription>{t("dashboard.whatsappCardHint")}</CardDescription>
              </div>
            </div>
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <Link to="/whatsapp/link">{t("dashboard.whatsappOpenLink")}</Link>
            </Button>
          </CardHeader>
          <CardContent className="text-sm text-start">
            {waQ.isLoading ? (
              <p className="text-muted-foreground">{t("common.loading")}</p>
            ) : waQ.isError ? (
              <p className="text-destructive">{(waQ.error as Error).message}</p>
            ) : !waQ.data?.configured ? (
              <p className="text-muted-foreground">{t("whatsapp.notConfigured")}</p>
            ) : !waQ.data?.reachable ? (
              <p className="text-amber-600 dark:text-amber-400">{t("whatsapp.unreachable")}</p>
            ) : (
              <div className="space-y-1">
                <p>
                  <span className="text-muted-foreground">{t("dashboard.whatsappState")} </span>
                  <span className="font-medium">
                    {(() => {
                      const sess = waQ.data.session;
                      if (!sess || !("exists" in sess) || !sess.exists) return t("dashboard.whatsappDisconnected");
                      if (sess.status === "WORKING") return t("dashboard.whatsappConnected");
                      return sess.status ?? "—";
                    })()}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("whatsapp.sessionLabel")}{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{waQ.data.sessionName}</code>
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {user?.role === "admin" && (
        <Card className="rounded-3xl border-border/60 bg-card/80 shadow-card-erp">
          <CardHeader className="flex flex-col gap-2 text-start sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 text-start">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-600 dark:text-sky-400">
                <Database className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-base">{t("dashboard.backupCardTitle")}</CardTitle>
                <CardDescription>{t("dashboard.backupCardHint")}</CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm" className="shrink-0">
                <Link to="/maintenance">{t("dashboard.backupOpenMaintenance")}</Link>
              </Button>
              {s.last_backup?.id && s.last_backup.status === "success" ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="shrink-0"
                  onClick={async () => {
                    const id = s.last_backup?.id;
                    const fn = s.last_backup?.filename ?? "backup.sql";
                    if (!id) return;
                    const blob = await apiFetchBlob(`/api/maintenance/backups/${id}/download`);
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = fn;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  {t("dashboard.backupDownloadLatest")}
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="text-sm text-start space-y-2">
            {!s.last_backup ? (
              <p className="text-muted-foreground">{t("dashboard.backupNone")}</p>
            ) : (
              <>
                <p>
                  <span className="text-muted-foreground">{t("dashboard.backupLastAt")}: </span>
                  <span className="font-medium">{new Date(s.last_backup.created_at).toLocaleString()}</span>
                </p>
                <p>
                  <span className="text-muted-foreground">{t("dashboard.backupStatus")}: </span>
                  <span className="font-medium">{s.last_backup.status}</span>
                </p>
                <p className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">{t("dashboard.backupDriveOk")}: </span>
                  <span className="text-lg" aria-hidden>
                    {s.last_backup.drive_uploaded ? "✅" : "❌"}
                  </span>
                  <span className="sr-only">{s.last_backup.drive_uploaded ? "OK" : "Not uploaded"}</span>
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="overflow-hidden rounded-3xl border-border/60 bg-card/80 shadow-card-erp">
        <CardContent className="grid gap-6 p-6 md:grid-cols-[1fr_auto] md:items-center">
          <div className="space-y-2 text-start">
            <p className="text-sm font-medium text-muted-foreground">{t("dashboard.heroTitle")}</p>
            <p className="text-4xl font-bold tabular-nums tracking-tight md:text-5xl">{periodPayments.toFixed(2)}</p>
            <p className="max-w-xl text-sm text-muted-foreground leading-relaxed">{t("dashboard.heroSubtitle")}</p>
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-3 sm:flex sm:flex-wrap">
            <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4 min-w-[140px]">
              <div className="flex items-center justify-between gap-2 text-emerald-600 dark:text-emerald-400">
                <UsersIcon className="h-5 w-5" />
                <span className="text-2xl font-bold tabular-nums">{s.active_users}</span>
              </div>
              <p className="mt-2 text-xs font-medium text-muted-foreground">{t("dashboard.activeSubs")}</p>
            </div>
            <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 p-4 min-w-[140px]">
              <div className="flex items-center justify-between gap-2 text-rose-600 dark:text-rose-400">
                <Banknote className="h-5 w-5" />
                <span className="text-2xl font-bold tabular-nums">0</span>
              </div>
              <p className="mt-2 text-xs font-medium text-muted-foreground">{t("dashboard.openInvoices")}</p>
              <p className="mt-1 text-[10px] text-muted-foreground/80">{t("dashboard.openInvoicesHint")}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div>
        <div className="mb-4 flex flex-col gap-1 text-start md:flex-row md:items-end md:justify-between">
          <div className="flex items-center gap-3 text-start">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <TrendingUp className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">{t("dashboard.kpiTitle")}</h2>
              <p className="text-xs text-muted-foreground">{t("dashboard.kpiSubtitle")}</p>
            </div>
          </div>
        </div>
        <div className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <KpiCard
            accent="emerald"
            title={t("dashboard.kpiPayments")}
            sub={t("dashboard.kpiPaymentsSub")}
            value={periodPayments.toFixed(2)}
            icon={<Banknote className="h-5 w-5" />}
          />
          <KpiCard
            accent="emerald"
            title={t("dashboard.kpiSubs")}
            sub={t("dashboard.kpiSubsSub")}
            value={String(newSubsWindow)}
            icon={<Activity className="h-5 w-5" />}
          />
          <KpiCard
            accent="sky"
            title={t("dashboard.kpiRadius")}
            sub={t("dashboard.kpiRadiusSub")}
            value={String(s.active_radius_sessions ?? 0)}
            icon={<Radio className="h-5 w-5" />}
          />
          <KpiCard
            accent="rose"
            title={t("dashboard.kpiUsage")}
            sub={t("dashboard.kpiUsageSub")}
            value={(s.usage_today_gb ?? 0).toFixed(2)}
            icon={<TrendingUp className="h-5 w-5" />}
          />
          {financeStaff && (
            <KpiCard
              accent="emerald"
              title={t("dashboard.kpiLedgerToday")}
              sub={t("dashboard.kpiLedgerTodaySub")}
              value={finDayQ.data ? finDayQ.data.totals.net.toFixed(2) : "—"}
              icon={<Banknote className="h-5 w-5" />}
            />
          )}
          {financeStaff && (
            <KpiCard
              accent="emerald"
              title={t("dashboard.kpiLedgerMonth")}
              sub={t("dashboard.kpiLedgerMonthSub")}
              value={finMonthQ.data ? finMonthQ.data.totals.net.toFixed(2) : "—"}
              icon={<Banknote className="h-5 w-5" />}
            />
          )}
          <KpiCard
            accent="sky"
            title={t("dashboard.kpiAlertsExpiring")}
            sub={t("notifications.expiring")}
            value={String(notifQ.data?.counts.expiring ?? 0)}
            icon={<Bell className="h-5 w-5" />}
          />
          <KpiCard
            accent="rose"
            title={t("dashboard.kpiAlertsUnpaid")}
            sub={t("notifications.unpaid")}
            value={String(notifQ.data?.counts.unpaid_invoices ?? 0)}
            icon={<Bell className="h-5 w-5" />}
          />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="rounded-3xl border-border/60 bg-card/80 shadow-card-erp xl:col-span-1">
          <CardHeader className="text-start">
            <CardTitle className="text-base">{t("dashboard.healthTitle")}</CardTitle>
            <CardDescription>{t("dashboard.healthSubtitle")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 text-start">
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-medium">
                <span>{activeShare.toFixed(0)}%</span>
                <span className="text-muted-foreground">{t("dashboard.healthActiveRatio")}</span>
              </div>
              <MiniBar value={activeShare} />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-medium">
                <span>—</span>
                <span className="text-muted-foreground">{t("dashboard.healthPaymentRatio")}</span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted" />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-medium">
                <span>{radiusHealth}%</span>
                <span className="text-muted-foreground">{t("dashboard.healthRadius")}</span>
              </div>
              <MiniBar value={radiusHealth} />
              <p className="text-[11px] text-muted-foreground">
                {s.radius_accounting_ready ? t("dashboard.healthRadiusOk") : t("dashboard.healthRadiusOff")}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-border/60 bg-card/80 shadow-card-erp xl:col-span-2">
          <CardHeader className="flex flex-col gap-2 text-start sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>{t("dashboard.financeTitle")}</CardTitle>
              <CardDescription>{t("dashboard.financeSubtitle")}</CardDescription>
            </div>
            <div className="inline-flex items-center gap-2 rounded-xl bg-emerald-500/15 px-3 py-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
              <TrendingUp className="h-4 w-4" />
              {t("dashboard.netFlow")}: {periodPayments.toFixed(2)}
            </div>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={s.payments_by_day}>
                <defs>
                  <linearGradient id="payFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "12px",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="amount"
                  name={t("dashboard.chartPayments")}
                  stroke="hsl(var(--chart-1))"
                  fill="url(#payFill)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="rounded-3xl border-border/60 bg-card/80 shadow-card-erp">
          <CardHeader className="text-start">
            <CardTitle>{t("dashboard.plTitle")}</CardTitle>
            <CardDescription>{t("dashboard.plSubtitle")}</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={plData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.45} />
                <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "12px",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="revenue" name={t("dashboard.plRevenue")} stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="expense" name={t("dashboard.plExpense")} stroke="hsl(0 84% 60%)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="profit" name={t("dashboard.plResult")} stroke="hsl(var(--chart-5))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-border/60 bg-card/80 shadow-card-erp">
          <CardHeader className="text-start">
            <CardTitle>{t("dashboard.chartSubs")}</CardTitle>
            <CardDescription>{t("dashboard.kpiSubsSub")}</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={s.subscribers_by_day}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.45} />
                <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "12px",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="hsl(var(--chart-3))"
                  fill="hsl(var(--chart-3) / 0.12)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="rounded-3xl border-border/60 bg-card/80 shadow-card-erp">
          <CardHeader className="text-start">
            <div className="flex items-center justify-start gap-2">
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">0</span>
              <CardTitle>{t("dashboard.activityTitle")}</CardTitle>
            </div>
            <CardDescription>{t("dashboard.activitySubtitle")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <ActivityTile label={t("dashboard.activityInvoices")} value={0} />
              <ActivityTile label={t("dashboard.activityCollections")} value={Math.round(periodPayments)} />
              <ActivityTile label={t("dashboard.activityExpenses")} value={0} />
              <ActivityTile label={t("dashboard.activityTotal")} value={s.total_users} />
            </div>
            <p className="mt-4 text-center text-xs text-muted-foreground">{t("dashboard.activityEmpty")}</p>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-border/60 bg-card/80 shadow-card-erp">
          <CardHeader className="text-start">
            <span className="mb-1 inline-block rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">{t("dashboard.growthTitle")}</span>
            <CardTitle className="text-2xl tabular-nums">{s.revenue_month_growth_pct.toFixed(1)}%</CardTitle>
            <CardDescription>{t("dashboard.growthSubtitle")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 py-4">
                <p className="text-xs text-emerald-700 dark:text-emerald-400">{t("dashboard.plRevenue")}</p>
                <p className="text-xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{periodPayments.toFixed(0)}</p>
              </div>
              <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 py-4">
                <p className="text-xs text-rose-700 dark:text-rose-400">{t("dashboard.plExpense")}</p>
                <p className="text-xl font-bold tabular-nums text-rose-700 dark:text-rose-300">0</p>
              </div>
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 py-4">
                <p className="text-xs text-amber-800 dark:text-amber-200">{t("dashboard.plResult")}</p>
                <p className="text-xl font-bold tabular-nums text-amber-900 dark:text-amber-100">{periodPayments.toFixed(0)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-3xl border-border/60 bg-card/80 shadow-card-erp">
        <CardHeader className="text-start">
          <CardTitle>{t("dashboard.chartBandwidth")}</CardTitle>
          <CardDescription>RADIUS · user_usage_daily</CardDescription>
        </CardHeader>
        <CardContent className="h-72">
          {(s.bandwidth_by_day ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">{t("dashboard.chartBandwidthEmpty")}</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={s.bandwidth_by_day}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.45} />
                <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "12px",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="gb"
                  name="GB"
                  stroke="hsl(var(--chart-4))"
                  fill="hsl(var(--chart-4) / 0.15)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <TopList
          title={t("dashboard.topRadacct")}
          empty={t("dashboard.topRadacctEmpty")}
          rows={s.top_users_radacct_total_gb ?? []}
        />
        <TopList
          title={t("dashboard.topRollup")}
          empty={t("dashboard.topRollupEmpty")}
          rows={s.top_users_last_7d_rollup_gb ?? []}
        />
      </div>
    </div>
  );
}

function KpiCard({
  title,
  sub,
  value,
  icon,
  accent,
}: {
  title: string;
  sub: string;
  value: string;
  icon: ReactNode;
  accent: "emerald" | "sky" | "rose";
}) {
  const dot =
    accent === "emerald"
      ? "bg-emerald-500"
      : accent === "sky"
        ? "bg-sky-500"
        : "bg-rose-500";
  return (
    <Card className="flex h-full min-h-[132px] flex-col rounded-3xl border-border/60 bg-card/90 shadow-card-erp transition-transform hover:-translate-y-0.5">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
        <div className="flex min-w-0 flex-1 items-start gap-3 text-start">
          <div className="rounded-xl bg-muted/50 p-2 text-muted-foreground">{icon}</div>
          <div className="min-w-0 flex-1 space-y-1">
            <CardDescription className="text-xs font-medium leading-snug">{title}</CardDescription>
            <CardTitle className="text-2xl font-bold tabular-nums">{value}</CardTitle>
            <p className="text-[11px] text-muted-foreground leading-snug">{sub}</p>
          </div>
        </div>
        <div className={cn("mt-2 h-2 w-2 shrink-0 rounded-full", dot)} />
      </CardHeader>
    </Card>
  );
}

function ActivityTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/40 p-3 text-center">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function TopList({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: { username: string; gb: number }[];
}) {
  return (
    <Card className="rounded-3xl border-border/60 bg-card/80 shadow-card-erp">
      <CardHeader className="text-start">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {rows.length === 0 && <p className="text-muted-foreground text-center py-4">{empty}</p>}
        {rows.map((r, i) => (
          <div key={r.username} className="flex justify-between gap-2 border-b border-border/40 py-2 last:border-0">
            <span className="font-mono text-muted-foreground">{r.gb.toFixed(2)} GB</span>
            <span className="text-start">
              {i + 1}. {r.username}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
