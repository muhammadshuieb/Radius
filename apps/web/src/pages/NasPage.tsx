import { type FormEvent, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch, wsUrl } from "@/lib/api";
import { isAdmin, useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";

type NasRow = {
  id: string;
  name: string;
  ip_address: string;
  coa_port: number;
  api_port: number | null;
  location: string | null;
  status: string;
  last_seen: string | null;
  active_sessions_count: number;
};

type SessionRow = Record<string, unknown>;

function statusEmoji(status: string) {
  if (status === "online") return "🟢";
  if (status === "degraded") return "🟡";
  if (status === "offline") return "🔴";
  return "⚪";
}

export function NasPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["nas"],
    queryFn: () => apiFetch<NasRow[]>("/api/nas"),
  });

  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [sessionsNasId, setSessionsNasId] = useState<string | null>(null);
  const sessionsQ = useQuery({
    queryKey: ["nas-sessions", sessionsNasId],
    queryFn: () =>
      apiFetch<{ sessions: SessionRow[] }>(`/api/nas/${sessionsNasId}/sessions`),
    enabled: !!sessionsNasId && sessionsOpen,
  });

  useEffect(() => {
    const ws = new WebSocket(wsUrl("/ws"));
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as {
          event?: string;
          payload?: { message?: string; kind?: string };
        };
        if (msg.event === "nas.updated" || msg.event === "nas.alert") {
          void qc.invalidateQueries({ queryKey: ["nas"] });
        }
        if (msg.event === "nas.alert" && msg.payload?.message) {
          toast.error(msg.payload.message, { duration: 8000 });
        }
      } catch {
        /* ignore */
      }
    };
    return () => ws.close();
  }, [qc]);

  async function addNas(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      await apiFetch("/api/nas", {
        method: "POST",
        body: JSON.stringify({
          name: String(fd.get("name") || "").trim(),
          ip_address: String(fd.get("ip_address") || "").trim(),
          radius_secret: String(fd.get("radius_secret") || ""),
          coa_port: Number(fd.get("coa_port") || 3799),
          api_port: fd.get("api_port") ? Number(fd.get("api_port")) : null,
          location: fd.get("location") ? String(fd.get("location")) : null,
        }),
      });
      toast.success(t("nas.saved"));
      void q.refetch();
      e.currentTarget.reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  async function testNas(id: string) {
    try {
      const r = await apiFetch<{
        status: string;
        ping: { ok: boolean; detail?: string };
        radius_ok: boolean;
        coa_ok: boolean;
      }>(`/api/nas/${id}/test`, { method: "POST" });
      toast.message(
        `${t("nas.testResult")}: ${r.status} — ping ${r.ping.ok ? "OK" : "fail"} · RADIUS ${r.radius_ok ? "OK" : "fail"} · CoA ${r.coa_ok ? "OK" : "fail"}`
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  async function deleteNas(id: string) {
    if (!confirm(t("nas.confirmDelete"))) return;
    try {
      await apiFetch(`/api/nas/${id}`, { method: "DELETE" });
      toast.success(t("nas.deleted"));
      void q.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  function openSessions(id: string) {
    setSessionsNasId(id);
    setSessionsOpen(true);
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Server className="h-7 w-7 text-muted-foreground" />
          {t("nas.title")}
        </h1>
        <p className="text-muted-foreground">{t("nas.subtitle")}</p>
      </div>

      {isAdmin(user?.role) && (
        <Card>
          <CardHeader>
            <CardTitle>{t("nas.addTitle")}</CardTitle>
            <CardDescription>{t("nas.addHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 md:grid-cols-2" onSubmit={(e) => void addNas(e)}>
              <div className="space-y-2">
                <Label>{t("nas.name")}</Label>
                <Input name="name" required />
              </div>
              <div className="space-y-2">
                <Label>{t("nas.ip")}</Label>
                <Input name="ip_address" placeholder="10.0.0.1" required />
              </div>
              <div className="space-y-2">
                <Label>{t("nas.radiusSecret")}</Label>
                <Input name="radius_secret" type="password" required autoComplete="new-password" />
              </div>
              <div className="space-y-2">
                <Label>{t("nas.coaPort")}</Label>
                <Input name="coa_port" type="number" defaultValue={3799} />
              </div>
              <div className="space-y-2">
                <Label>{t("nas.apiPort")}</Label>
                <Input name="api_port" type="number" placeholder="8728" />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>{t("nas.location")}</Label>
                <Input name="location" placeholder={t("nas.locationPh")} />
              </div>
              <Button type="submit" className="md:col-span-2 w-fit">
                {t("nas.save")}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("nas.tableTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-2">{t("nas.name")}</th>
                <th className="p-2">{t("nas.ip")}</th>
                <th className="p-2">{t("nas.status")}</th>
                <th className="p-2">{t("nas.sessions")}</th>
                <th className="p-2">{t("nas.lastSeen")}</th>
                <th className="p-2">{t("nas.location")}</th>
                <th className="p-2">{t("nas.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {q.data?.map((n) => (
                <tr key={n.id} className="border-b border-border/60">
                  <td className="p-2 font-medium">{n.name}</td>
                  <td className="p-2 font-mono text-xs">{n.ip_address}</td>
                  <td className="p-2 whitespace-nowrap">
                    <span className="mr-1">{statusEmoji(n.status)}</span>
                    {n.status}
                  </td>
                  <td className="p-2">{n.active_sessions_count}</td>
                  <td className="p-2 text-xs text-muted-foreground whitespace-nowrap">
                    {n.last_seen ? new Date(n.last_seen).toLocaleString() : "—"}
                  </td>
                  <td className="p-2 max-w-[140px] truncate" title={n.location ?? ""}>
                    {n.location ?? "—"}
                  </td>
                  <td className="p-2 flex flex-wrap gap-1">
                    {isAdmin(user?.role) && (
                      <>
                        <Button type="button" variant="outline" size="sm" onClick={() => void testNas(n.id)}>
                          {t("nas.test")}
                        </Button>
                        <Button type="button" variant="secondary" size="sm" onClick={() => openSessions(n.id)}>
                          {t("nas.viewSessions")}
                        </Button>
                        <Button type="button" variant="destructive" size="sm" onClick={() => void deleteNas(n.id)}>
                          {t("nas.delete")}
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!q.data?.length && !q.isLoading ? (
            <p className="text-muted-foreground py-6 text-center">{t("nas.empty")}</p>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={sessionsOpen} onOpenChange={setSessionsOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("nas.sessionsTitle")}</DialogTitle>
            <DialogDescription>{t("nas.sessionsHint")}</DialogDescription>
          </DialogHeader>
          <pre className="text-xs bg-muted/50 rounded-md p-3 overflow-auto">
            {sessionsQ.isLoading ? "…" : JSON.stringify(sessionsQ.data?.sessions ?? [], null, 2)}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
