import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type Tx = {
  id: string;
  type: string;
  amount: string;
  currency: string;
  created_at: string;
  notes: string | null;
  subscriber_username: string | null;
  staff_email: string | null;
};

type TxResp = { items: Tx[]; total: number };

type DaySummary = {
  granularity: string;
  period: string;
  totals: { deposits: number; withdraws: number; invoices: number; adjustments: number; net: number };
};

type MonthSummary = { granularity: string; year: number; month: number; totals: { deposits: number; withdraws: number; net: number } };

type YearSummary = { granularity: string; year: number; months: { month: number; net: number }[] };

type Unpaid = { id: string; title: string; amount: string; username: string | null; subscriber_id: string | null };

export function FinanceTransactionsPage() {
  const { t } = useI18n();
  const [type, setType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set("limit", "200");
    if (type) p.set("type", type);
    if (from) p.set("from", new Date(from).toISOString());
    if (to) p.set("to", new Date(to).toISOString());
    return p.toString();
  }, [type, from, to]);

  const txQ = useQuery({
    queryKey: ["finance-tx", qs],
    queryFn: () => apiFetch<TxResp>(`/api/finance/transactions?${qs}`),
  });

  const today = new Date().toISOString().slice(0, 10);
  const dayQ = useQuery({
    queryKey: ["finance-day", today],
    queryFn: () => apiFetch<DaySummary>(`/api/finance/reports/summary?granularity=day&date=${today}`),
  });

  const y = new Date().getFullYear();
  const m = new Date().getMonth() + 1;
  const monthQ = useQuery({
    queryKey: ["finance-month", y, m],
    queryFn: () => apiFetch<MonthSummary>(`/api/finance/reports/summary?granularity=month&year=${y}&month=${m}`),
  });

  const yearQ = useQuery({
    queryKey: ["finance-year", y],
    queryFn: () => apiFetch<YearSummary>(`/api/finance/reports/summary?granularity=year&year=${y}`),
  });

  const unpaidQ = useQuery({
    queryKey: ["finance-unpaid"],
    queryFn: () => apiFetch<{ items: Unpaid[] }>("/api/finance/reports/unpaid-invoices"),
  });

  const chartData = yearQ.data?.months?.map((row) => ({ name: String(row.month), net: row.net })) ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("finance.title")}</h1>
        <p className="text-muted-foreground">{t("finance.subtitle")}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("finance.daily")}</CardTitle>
            <CardDescription>{dayQ.data?.period ?? today}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            {dayQ.data && (
              <>
                <div>
                  {t("finance.deposit")}: ${dayQ.data.totals.deposits.toFixed(2)}
                </div>
                <div>
                  {t("finance.withdraw")}: ${dayQ.data.totals.withdraws.toFixed(2)}
                </div>
                <div>
                  {t("finance.invoice")}: ${dayQ.data.totals.invoices.toFixed(2)}
                </div>
                <div className="font-semibold pt-2">
                  {t("finance.dayNet")}: ${dayQ.data.totals.net.toFixed(2)}
                </div>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("finance.monthly")}</CardTitle>
            <CardDescription>
              {y}-{m}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            {monthQ.data && (
              <>
                <div>
                  {t("finance.deposit")}: ${monthQ.data.totals.deposits.toFixed(2)}
                </div>
                <div>
                  {t("finance.withdraw")}: ${monthQ.data.totals.withdraws.toFixed(2)}
                </div>
                <div className="font-semibold pt-2">
                  {t("finance.net")}: ${monthQ.data.totals.net.toFixed(2)}
                </div>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("finance.yearly")}</CardTitle>
            <CardDescription>{y}</CardDescription>
          </CardHeader>
          <CardContent className="h-40">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="net" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-muted-foreground">{t("dashboard.chartBandwidthEmpty")}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("finance.filters")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label>{t("finance.type")}</Label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="">{t("finance.allTypes")}</option>
              <option value="deposit">{t("finance.deposit")}</option>
              <option value="withdraw">{t("finance.withdraw")}</option>
              <option value="invoice">{t("finance.invoice")}</option>
              <option value="adjustment">{t("finance.adjustment")}</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label>{t("finance.from")}</Label>
            <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t("finance.to")}</Label>
            <Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("finance.title")}</CardTitle>
          <CardDescription>{txQ.data?.total ?? 0} rows</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {txQ.isLoading && <div className="text-muted-foreground">{t("common.loading")}</div>}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground text-start">
                <th className="p-2">{t("finance.colDate")}</th>
                <th className="p-2">{t("finance.colType")}</th>
                <th className="p-2">{t("finance.colAmount")}</th>
                <th className="p-2">{t("finance.colUser")}</th>
                <th className="p-2">{t("finance.colStaff")}</th>
                <th className="p-2">{t("finance.colNotes")}</th>
              </tr>
            </thead>
            <tbody>
              {txQ.data?.items.map((row) => (
                <tr key={row.id} className="border-b border-border/60">
                  <td className="p-2 whitespace-nowrap">{new Date(row.created_at).toLocaleString()}</td>
                  <td className="p-2">{row.type}</td>
                  <td className="p-2 font-mono">
                    ${Number(row.amount).toFixed(2)} {row.currency}
                  </td>
                  <td className="p-2">{row.subscriber_username ?? "—"}</td>
                  <td className="p-2">{row.staff_email ?? "—"}</td>
                  <td className="p-2 max-w-[200px] truncate">{row.notes ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("finance.unpaidTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground text-start">
                <th className="p-2">{t("finance.colTitle")}</th>
                <th className="p-2">{t("finance.colAmount")}</th>
                <th className="p-2">{t("finance.colUser")}</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {unpaidQ.data?.items.map((row) => (
                <tr key={row.id} className="border-b border-border/60">
                  <td className="p-2">{row.title}</td>
                  <td className="p-2">${Number(row.amount).toFixed(2)}</td>
                  <td className="p-2">{row.username ?? "—"}</td>
                  <td className="p-2 text-end">
                    {row.subscriber_id && (
                      <Link className="text-primary underline" to={`/users/${row.subscriber_id}`}>
                        {t("notifications.openUser")}
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!unpaidQ.data?.items?.length && <p className="text-muted-foreground py-4">{t("finance.unpaidEmpty")}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
