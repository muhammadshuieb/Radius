import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type Row = {
  id: string;
  created_at: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: unknown;
  ip: string | null;
  staff_email: string | null;
};

type ListResp = { items: Row[]; total: number; limit: number; offset: number };

export function AuditLogPage() {
  const { t } = useI18n();
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const q = useQuery({
    queryKey: ["audit-logs", offset],
    queryFn: () => apiFetch<ListResp>(`/api/audit/logs?limit=${limit}&offset=${offset}`),
  });

  const total = q.data?.total ?? 0;
  const maxOffset = Math.max(0, total - limit);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-500/15 text-slate-700 dark:text-slate-300">
          <ScrollText className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("audit.title")}</h1>
          <p className="text-muted-foreground">{t("audit.subtitle")}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("audit.tableTitle")}</CardTitle>
          <CardDescription>
            {t("audit.total")}: {total}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {q.isLoading && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
          {q.isError && <p className="text-sm text-destructive">{(q.error as Error).message}</p>}
          {q.data && (
            <>
              <table className="w-full min-w-[800px] text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-end">
                    <th className="p-2">{t("audit.colTime")}</th>
                    <th className="p-2">{t("audit.colUser")}</th>
                    <th className="p-2">{t("audit.colAction")}</th>
                    <th className="p-2">{t("audit.colEntity")}</th>
                    <th className="p-2">{t("audit.colDetails")}</th>
                    <th className="p-2">{t("audit.colIp")}</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.items.map((r) => (
                    <tr key={r.id} className="border-b border-border/60">
                      <td className="p-2 whitespace-nowrap text-muted-foreground">
                        {new Date(r.created_at).toLocaleString()}
                      </td>
                      <td className="p-2 font-mono text-xs">{r.staff_email ?? "—"}</td>
                      <td className="p-2">{r.action}</td>
                      <td className="p-2">
                        <span className="text-muted-foreground">{r.entity_type}</span>
                        {r.entity_id ? (
                          <code className="ms-1 rounded bg-muted px-1 text-[11px]">{r.entity_id.slice(0, 8)}…</code>
                        ) : null}
                      </td>
                      <td className="p-2 max-w-[280px] truncate font-mono text-[11px] text-muted-foreground" title={JSON.stringify(r.details)}>
                        {JSON.stringify(r.details)}
                      </td>
                      <td className="p-2 font-mono text-xs">{r.ip ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                <Button type="button" variant="outline" size="sm" disabled={offset <= 0} onClick={() => setOffset((o) => Math.max(0, o - limit))}>
                  {t("users.pagePrev")}
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {offset + 1}–{Math.min(offset + limit, total)} / {total}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={offset >= maxOffset}
                  onClick={() => setOffset((o) => Math.min(maxOffset, o + limit))}
                >
                  {t("users.pageNext")}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
