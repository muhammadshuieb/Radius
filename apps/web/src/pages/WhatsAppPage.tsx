import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { apiFetch, apiFetchBlob } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type StatusResponse = {
  configured: boolean;
  reachable: boolean;
  sessionName: string;
  session:
    | null
    | { exists: false }
    | ({ exists: true } & { status?: string; me?: { id?: string; pushName?: string } | null; name?: string });
};

type WaSettings = {
  company_name: string;
  template_renewal: string;
  template_new_user: string;
  template_expiry: string;
  template_credit: string;
  template_debt: string;
  expiry_days_before: number;
  send_hour: number;
  send_minute: number;
  timezone: string;
  delay_between_ms: number;
  notify_renewal: boolean;
  notify_new_user: boolean;
  notify_expiry: boolean;
  placeholders?: string[];
};

const SECTIONS = ["link", "messages", "broadcast", "delivery"] as const;
type Section = (typeof SECTIONS)[number];

const DELIVERY_PAGE = 50;

type DeliveryStatusFilter = "" | "queued" | "sent" | "failed";

type DeliveryRow = {
  id: string;
  batch_id: string;
  subscriber_id: string | null;
  chat_id: string;
  message_preview: string | null;
  kind: string;
  status: string;
  error: string | null;
  created_at: string;
  sent_at: string | null;
  subscriber_username: string | null;
};

export function WhatsAppPage() {
  const { section } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  const [form, setForm] = useState<Partial<WaSettings>>({});
  const [bcMessage, setBcMessage] = useState("");
  const [bcIds, setBcIds] = useState("");
  const [bcMode, setBcMode] = useState<"filters" | "manual">("filters");
  const [bcPackageId, setBcPackageId] = useState("");
  const [bcCity, setBcCity] = useState("");
  const [bcStatus, setBcStatus] = useState("");
  const [bcSearch, setBcSearch] = useState("");
  const [bcPayment, setBcPayment] = useState("");
  const [bcActiveOnly, setBcActiveOnly] = useState(false);
  const [bcExpiredOnly, setBcExpiredOnly] = useState(false);
  const [bcPreviewCount, setBcPreviewCount] = useState<number | null>(null);
  const [bcPreviewLoading, setBcPreviewLoading] = useState(false);
  const [deliveryOffset, setDeliveryOffset] = useState(0);
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState<DeliveryStatusFilter>("");
  const [selectedDeliveryIds, setSelectedDeliveryIds] = useState<Set<string>>(() => new Set());

  const pkgs = useQuery({
    queryKey: ["packages-list"],
    queryFn: () => apiFetch<{ id: string; name: string }[]>("/api/packages"),
  });

  const statusQ = useQuery({
    queryKey: ["whatsapp-status"],
    queryFn: () => apiFetch<StatusResponse>("/api/whatsapp/status"),
    refetchInterval: (q) => {
      const s = q.state.data?.session;
      if (s && "exists" in s && s.exists && s.status === "SCAN_QR_CODE") return 4000;
      return false;
    },
  });

  const settingsQ = useQuery({
    queryKey: ["whatsapp-settings"],
    queryFn: () => apiFetch<WaSettings>("/api/whatsapp/settings"),
  });

  useEffect(() => {
    if (settingsQ.data) {
      setForm(settingsQ.data);
    }
  }, [settingsQ.data]);

  const saveSettings = useMutation({
    mutationFn: (body: Partial<WaSettings>) => apiFetch<WaSettings>("/api/whatsapp/settings", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => {
      toast.success(t("whatsapp.settingsSaved"));
      void qc.invalidateQueries({ queryKey: ["whatsapp-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const broadcastMut = useMutation({
    mutationFn: (body: { message: string; subscriber_ids?: string[]; filters?: Record<string, unknown> }) =>
      apiFetch<{ ok: boolean; queued: number; skipped: number }>("/api/whatsapp/broadcast", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (r) => {
      toast.success(`${t("whatsapp.broadcastQueued")}: ${r.queued} (${t("whatsapp.broadcastSkipped")}: ${r.skipped})`);
      setBcMessage("");
      setBcIds("");
      setBcPreviewCount(null);
      void qc.invalidateQueries({ queryKey: ["whatsapp-deliveries"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deliveriesQ = useQuery({
    queryKey: ["whatsapp-deliveries", deliveryOffset, deliveryStatusFilter],
    queryFn: () => {
      const qs = new URLSearchParams({
        limit: String(DELIVERY_PAGE),
        offset: String(deliveryOffset),
      });
      if (deliveryStatusFilter) qs.set("status", deliveryStatusFilter);
      return apiFetch<{ items: DeliveryRow[]; total: number; failed_count: number }>(
        `/api/whatsapp/deliveries?${qs.toString()}`
      );
    },
    enabled: section === "delivery",
    refetchInterval: section === "delivery" ? 5000 : false,
  });

  useEffect(() => {
    setDeliveryOffset(0);
    setSelectedDeliveryIds(new Set());
  }, [deliveryStatusFilter]);

  useEffect(() => {
    setSelectedDeliveryIds(new Set());
  }, [deliveryOffset]);

  const retryDelivery = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: boolean }>(`/api/whatsapp/deliveries/${encodeURIComponent(id)}/retry`, { method: "POST" }),
    onSuccess: () => {
      toast.success(t("whatsapp.deliveryRetryOk"));
      void qc.invalidateQueries({ queryKey: ["whatsapp-deliveries"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteDelivery = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: boolean }>(`/api/whatsapp/deliveries/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: (_, id) => {
      toast.success(t("whatsapp.deliveryDeleted"));
      setSelectedDeliveryIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      void qc.invalidateQueries({ queryKey: ["whatsapp-deliveries"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const retryAllFailedDeliveries = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean; retried: number }>("/api/whatsapp/deliveries/retry-failed", { method: "POST" }),
    onSuccess: (data) => {
      if (data.retried === 0) {
        toast.message(t("whatsapp.deliveryRetryAllNone"));
      } else {
        toast.success(t("whatsapp.deliveryRetryAllOk").replace("{count}", String(data.retried)));
      }
      void qc.invalidateQueries({ queryKey: ["whatsapp-deliveries"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkDeleteDeliveries = useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch<{ ok: boolean; deleted: number }>("/api/whatsapp/deliveries/bulk-delete", {
        method: "POST",
        body: JSON.stringify({ ids }),
      }),
    onSuccess: (data) => {
      toast.success(t("whatsapp.deliveryBulkDeleted").replace("{count}", String(data.deleted)));
      setSelectedDeliveryIds(new Set());
      void qc.invalidateQueries({ queryKey: ["whatsapp-deliveries"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const purgeStaleDeliveries = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean; deleted: number }>("/api/whatsapp/deliveries/purge-stale", { method: "POST" }),
    onSuccess: (data) => {
      if (data.deleted === 0) {
        toast.message(t("whatsapp.deliveryPurgeStaleOk").replace("{count}", "0"));
      } else {
        toast.success(t("whatsapp.deliveryPurgeStaleOk").replace("{count}", String(data.deleted)));
      }
      setSelectedDeliveryIds(new Set());
      void qc.invalidateQueries({ queryKey: ["whatsapp-deliveries"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ensureMut = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>("/api/whatsapp/session/ensure", { method: "POST" }),
    onSuccess: () => {
      toast.success(t("whatsapp.ensureOk"));
      void qc.invalidateQueries({ queryKey: ["whatsapp-status"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const restartMut = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>("/api/whatsapp/session/restart", { method: "POST" }),
    onSuccess: () => {
      toast.success(t("whatsapp.restartOk"));
      void qc.invalidateQueries({ queryKey: ["whatsapp-status"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const logoutMut = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>("/api/whatsapp/session/logout", { method: "POST" }),
    onSuccess: () => {
      toast.success(t("whatsapp.logoutOk"));
      setQrUrl(null);
      void qc.invalidateQueries({ queryKey: ["whatsapp-status"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function loadQr() {
    try {
      const blob = await apiFetchBlob("/api/whatsapp/qr");
      setQrUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "QR");
      setQrUrl(null);
    }
  }

  const sess = statusQ.data?.session;
  const needQr =
    statusQ.data?.configured &&
    statusQ.data?.reachable &&
    sess &&
    "exists" in sess &&
    sess.exists &&
    (sess.status === "SCAN_QR_CODE" || sess.status === "STARTING");

  const connected =
    statusQ.data?.configured &&
    statusQ.data?.reachable &&
    sess &&
    "exists" in sess &&
    sess.exists &&
    sess.status === "WORKING";

  const sessStatus =
    sess && "exists" in sess && sess.exists && "status" in sess ? sess.status : undefined;

  useEffect(() => {
    if (needQr) void loadQr();
    else {
      setQrUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh QR when SCAN_QR_CODE / STARTING toggles
  }, [needQr, sessStatus]);

  function buildBroadcastFilters(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (bcSearch.trim()) out.search = bcSearch.trim();
    if (bcPackageId) out.package_id = bcPackageId;
    if (bcCity.trim()) out.city = bcCity.trim();
    if (bcStatus) out.status = bcStatus;
    if (bcPayment) out.payment_status = bcPayment;
    if (bcActiveOnly) out.active_only = true;
    if (bcExpiredOnly) out.expired_only = true;
    return out;
  }

  function broadcastFiltersMeaningful(): boolean {
    return !!(
      bcSearch.trim() ||
      bcCity.trim() ||
      bcPackageId ||
      bcStatus ||
      bcPayment ||
      bcActiveOnly ||
      bcExpiredOnly
    );
  }

  async function loadBroadcastPreview() {
    if (!broadcastFiltersMeaningful()) {
      toast.error(t("whatsapp.broadcastNeedFilter"));
      return;
    }
    const p = new URLSearchParams();
    if (bcSearch.trim()) p.set("search", bcSearch.trim());
    if (bcPackageId) p.set("package_id", bcPackageId);
    if (bcCity.trim()) p.set("city", bcCity.trim());
    if (bcStatus) p.set("status", bcStatus);
    if (bcPayment) p.set("payment_status", bcPayment);
    if (bcActiveOnly) p.set("active_only", "true");
    if (bcExpiredOnly) p.set("expired_only", "true");
    setBcPreviewLoading(true);
    try {
      const r = await apiFetch<{ count: number }>(`/api/whatsapp/broadcast-targets?${p.toString()}`);
      setBcPreviewCount(r.count);
      toast.success(t("whatsapp.broadcastPreviewOk").replace("{count}", String(r.count)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBcPreviewLoading(false);
    }
  }

  function submitBroadcast() {
    if (!bcMessage.trim()) {
      toast.error(t("whatsapp.broadcastNeedMsg"));
      return;
    }
    if (bcMode === "manual") {
      const ids = bcIds
        .split(/[\s,]+/)
        .map((x) => x.trim())
        .filter(Boolean);
      const uuids = ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x));
      if (!uuids.length) {
        toast.error(t("whatsapp.broadcastNeedIds"));
        return;
      }
      broadcastMut.mutate({ subscriber_ids: uuids, message: bcMessage.trim() });
    } else {
      if (!broadcastFiltersMeaningful()) {
        toast.error(t("whatsapp.broadcastNeedFilter"));
        return;
      }
      broadcastMut.mutate({ message: bcMessage.trim(), filters: buildBroadcastFilters() });
    }
  }

  if (!section || !SECTIONS.includes(section as Section)) {
    return <Navigate to="/whatsapp/link" replace />;
  }
  const activeSection = section as Section;

  const deliveryTotal = deliveriesQ.data?.total ?? 0;
  const deliveryHasPrev = deliveryOffset > 0;
  const deliveryHasNext = deliveryOffset + DELIVERY_PAGE < deliveryTotal;
  const deliveryPageItems = deliveriesQ.data?.items ?? [];
  const allDeliveryPageSelected =
    deliveryPageItems.length > 0 && deliveryPageItems.every((r) => selectedDeliveryIds.has(r.id));

  function toggleDeliverySelectAllOnPage() {
    setSelectedDeliveryIds((prev) => {
      const next = new Set(prev);
      const pageIds = deliveryPageItems.map((r) => r.id);
      const all = pageIds.length > 0 && pageIds.every((id) => next.has(id));
      if (all) {
        pageIds.forEach((id) => next.delete(id));
      } else {
        pageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function toggleDeliveryRowSelected(id: string, checked: boolean) {
    setSelectedDeliveryIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function deliveryStatusLabel(s: string) {
    if (s === "sent") return t("whatsapp.statusSent");
    if (s === "failed") return t("whatsapp.statusFailed");
    if (s === "queued") return t("whatsapp.statusQueued");
    return s;
  }

  return (
    <div className="mx-auto w-full max-w-[min(56rem,100%)] space-y-6">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <MessageCircle className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("whatsapp.title")}</h1>
          <p className="text-muted-foreground">{t("whatsapp.subtitle")}</p>
        </div>
      </div>

      <Tabs
        value={activeSection}
        onValueChange={(v) => navigate(`/whatsapp/${v}`)}
        className="w-full"
      >
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="link">{t("whatsapp.tabLink")}</TabsTrigger>
          <TabsTrigger value="messages">{t("whatsapp.tabMessages")}</TabsTrigger>
          <TabsTrigger value="broadcast">{t("whatsapp.tabBroadcast")}</TabsTrigger>
          <TabsTrigger value="delivery">{t("whatsapp.tabDelivery")}</TabsTrigger>
        </TabsList>

        <TabsContent value="link" className="space-y-6 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("whatsapp.statusTitle")}</CardTitle>
              <CardDescription>{t("whatsapp.statusHint")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {statusQ.isLoading ? (
                <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
              ) : statusQ.isError ? (
                <p className="text-sm text-destructive">{(statusQ.error as Error).message}</p>
              ) : (
                <>
                  {!statusQ.data?.configured ? (
                    <p className="text-sm text-muted-foreground">{t("whatsapp.notConfigured")}</p>
                  ) : !statusQ.data?.reachable ? (
                    <p className="text-sm text-amber-600 dark:text-amber-400">{t("whatsapp.unreachable")}</p>
                  ) : (
                    <div className="space-y-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">{t("whatsapp.sessionLabel")} </span>
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{statusQ.data.sessionName}</code>
                      </div>
                      {sess && "exists" in sess && !sess.exists ? (
                        <p>{t("whatsapp.noSession")}</p>
                      ) : sess && "exists" in sess && sess.exists ? (
                        <>
                          <div>
                            <span className="text-muted-foreground">{t("whatsapp.stateLabel")} </span>
                            <span className="font-medium">{sess.status ?? "—"}</span>
                          </div>
                          {sess.status === "WORKING" && sess.me ? (
                            <div className="text-muted-foreground">{sess.me.pushName ?? sess.me.id ?? "—"}</div>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" size="sm" onClick={() => void statusQ.refetch()}>
                      <RefreshCw className="me-2 h-4 w-4" />
                      {t("whatsapp.refresh")}
                    </Button>
                    <Button type="button" size="sm" onClick={() => ensureMut.mutate()} disabled={!statusQ.data?.configured || ensureMut.isPending}>
                      {t("whatsapp.ensureSession")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => restartMut.mutate()}
                      disabled={!statusQ.data?.reachable || restartMut.isPending}
                    >
                      {t("whatsapp.restart")}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => logoutMut.mutate()}
                      disabled={!statusQ.data?.reachable || logoutMut.isPending}
                    >
                      {t("whatsapp.logout")}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {statusQ.data?.configured && statusQ.data?.reachable ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("whatsapp.qrTitle")}</CardTitle>
                <CardDescription>{t("whatsapp.qrHint")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {connected ? (
                  <p className="text-sm text-emerald-600 dark:text-emerald-400">{t("whatsapp.connected")}</p>
                ) : needQr ? (
                  <>
                    {qrUrl ? (
                      <div className="flex flex-col items-center gap-3">
                        <img src={qrUrl} alt="WhatsApp QR" className="max-w-[280px] rounded-lg border bg-white p-2" />
                        <Button type="button" variant="outline" size="sm" onClick={() => void loadQr()}>
                          {t("whatsapp.refreshQr")}
                        </Button>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">{t("whatsapp.qrLoading")}</p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("whatsapp.qrWait")}</p>
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="text-base">{t("whatsapp.dockerTitle")}</CardTitle>
              <CardDescription className="text-xs leading-relaxed">{t("whatsapp.dockerHint")}</CardDescription>
            </CardHeader>
          </Card>
        </TabsContent>

        <TabsContent value="messages" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("whatsapp.msgSettingsTitle")}</CardTitle>
              <CardDescription>{t("whatsapp.msgSettingsHint")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {settingsQ.isLoading ? (
                <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={!!form.notify_renewal}
                        onChange={(e) => setForm((f) => ({ ...f, notify_renewal: e.target.checked }))}
                      />
                      {t("whatsapp.notifyRenewal")}
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={!!form.notify_new_user}
                        onChange={(e) => setForm((f) => ({ ...f, notify_new_user: e.target.checked }))}
                      />
                      {t("whatsapp.notifyNewUser")}
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={!!form.notify_expiry}
                        onChange={(e) => setForm((f) => ({ ...f, notify_expiry: e.target.checked }))}
                      />
                      {t("whatsapp.notifyExpiry")}
                    </label>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="space-y-2">
                      <Label>{t("whatsapp.companyName")}</Label>
                      <Input
                        value={form.company_name ?? ""}
                        onChange={(e) => setForm((f) => ({ ...f, company_name: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t("whatsapp.expiryDays")}</Label>
                      <Input
                        type="number"
                        min={1}
                        max={90}
                        value={form.expiry_days_before ?? 7}
                        onChange={(e) => setForm((f) => ({ ...f, expiry_days_before: Number(e.target.value) }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t("whatsapp.sendTime")}</Label>
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          min={0}
                          max={23}
                          className="w-20"
                          value={form.send_hour ?? 12}
                          onChange={(e) => setForm((f) => ({ ...f, send_hour: Number(e.target.value) }))}
                        />
                        <span className="self-center">:</span>
                        <Input
                          type="number"
                          min={0}
                          max={59}
                          className="w-20"
                          value={form.send_minute ?? 0}
                          onChange={(e) => setForm((f) => ({ ...f, send_minute: Number(e.target.value) }))}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>{t("whatsapp.timezone")}</Label>
                      <Input
                        value={form.timezone ?? "Asia/Riyadh"}
                        onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
                        placeholder="Asia/Riyadh"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t("whatsapp.delayMs")}</Label>
                      <Input
                        type="number"
                        min={500}
                        max={120000}
                        step={500}
                        value={form.delay_between_ms ?? 8000}
                        onChange={(e) => setForm((f) => ({ ...f, delay_between_ms: Number(e.target.value) }))}
                      />
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground">{t("whatsapp.placeholdersHint")}: {settingsQ.data?.placeholders?.join(" ")}</p>

                  {(
                    [
                      ["template_renewal", t("whatsapp.tplRenewal")],
                      ["template_new_user", t("whatsapp.tplNewUser")],
                      ["template_expiry", t("whatsapp.tplExpiry")],
                      ["template_credit", t("whatsapp.tplCredit")],
                      ["template_debt", t("whatsapp.tplDebt")],
                    ] as const
                  ).map(([key, label]) => (
                    <div key={key} className="space-y-2">
                      <Label>{label}</Label>
                      <textarea
                        rows={3}
                        value={(form[key] as string) ?? ""}
                        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                        className={cn(
                          "flex min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        )}
                      />
                    </div>
                  ))}

                  <Button type="button" onClick={() => saveSettings.mutate(form)} disabled={saveSettings.isPending}>
                    {t("whatsapp.saveSettings")}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="broadcast" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("whatsapp.broadcastTitle")}</CardTitle>
              <CardDescription>{t("whatsapp.broadcastHint")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={bcMode === "filters" ? "default" : "outline"}
                  onClick={() => setBcMode("filters")}
                >
                  {t("whatsapp.broadcastModeFilters")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={bcMode === "manual" ? "default" : "outline"}
                  onClick={() => setBcMode("manual")}
                >
                  {t("whatsapp.broadcastModeManual")}
                </Button>
              </div>

              {bcMode === "filters" ? (
                <div className="space-y-4 rounded-xl border border-border/60 bg-muted/20 p-4">
                  <p className="text-sm text-muted-foreground">{t("whatsapp.broadcastFiltersHint")}</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>{t("users.list.searchLabel")}</Label>
                      <Input value={bcSearch} onChange={(e) => setBcSearch(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>{t("users.list.cityFilter")}</Label>
                      <Input
                        placeholder={t("users.list.cityPlaceholder")}
                        value={bcCity}
                        onChange={(e) => setBcCity(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t("users.columns.package")}</Label>
                      <select
                        className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                        value={bcPackageId}
                        onChange={(e) => setBcPackageId(e.target.value)}
                        disabled={pkgs.isLoading}
                      >
                        <option value="">{t("users.list.any")}</option>
                        {pkgs.data?.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>{t("users.columns.status")}</Label>
                      <select
                        className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                        value={bcStatus}
                        onChange={(e) => setBcStatus(e.target.value)}
                      >
                        <option value="">{t("users.list.any")}</option>
                        <option value="active">{t("users.list.statusActive")}</option>
                        <option value="expired">{t("users.list.statusExpired")}</option>
                        <option value="disabled">{t("users.list.statusDisabled")}</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>{t("users.columns.payment")}</Label>
                      <select
                        className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                        value={bcPayment}
                        onChange={(e) => setBcPayment(e.target.value)}
                      >
                        <option value="">{t("users.list.any")}</option>
                        <option value="paid">{t("users.list.payPaid")}</option>
                        <option value="unpaid">{t("users.list.payUnpaid")}</option>
                        <option value="partial">{t("users.list.payPartial")}</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={bcActiveOnly} onCheckedChange={(c) => setBcActiveOnly(!!c)} />
                      {t("users.list.activeOnly")}
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={bcExpiredOnly} onCheckedChange={(c) => setBcExpiredOnly(!!c)} />
                      {t("users.list.expiredOnly")}
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button type="button" variant="secondary" size="sm" onClick={() => void loadBroadcastPreview()} disabled={bcPreviewLoading}>
                      {t("whatsapp.broadcastLoadPreview")}
                    </Button>
                    {bcPreviewCount != null ? (
                      <span className="text-sm text-muted-foreground">
                        {t("whatsapp.broadcastPreviewCount").replace("{count}", String(bcPreviewCount))}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>{t("whatsapp.broadcastIds")}</Label>
                  <textarea
                    rows={4}
                    value={bcIds}
                    onChange={(e) => setBcIds(e.target.value)}
                    placeholder="uuid ..."
                    className={cn(
                      "flex min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    )}
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label>{t("whatsapp.broadcastMsg")}</Label>
                <textarea
                  rows={4}
                  value={bcMessage}
                  onChange={(e) => setBcMessage(e.target.value)}
                  className={cn(
                    "flex min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  )}
                />
              </div>
              <Button type="button" onClick={submitBroadcast} disabled={broadcastMut.isPending}>
                {t("whatsapp.broadcastSend")}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="delivery" className="mt-4 space-y-4">
          <Card className="overflow-hidden">
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0 pb-3">
              <div className="min-w-0 flex-1">
                <CardTitle className="text-lg">{t("whatsapp.deliveryTitle")}</CardTitle>
                <CardDescription className="text-xs leading-relaxed">{t("whatsapp.deliveryHint")}</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1 shrink-0"
                  onClick={() => void qc.invalidateQueries({ queryKey: ["whatsapp-deliveries"] })}
                >
                  <RefreshCw className="h-4 w-4" />
                  {t("whatsapp.deliveryRefresh")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="gap-1 shrink-0"
                  disabled={
                    retryAllFailedDeliveries.isPending ||
                    (!deliveriesQ.isLoading && (deliveriesQ.data?.failed_count ?? 0) === 0)
                  }
                  title={t("whatsapp.deliveryRetryAllFailed")}
                  onClick={() => retryAllFailedDeliveries.mutate()}
                >
                  <RotateCcw className="h-4 w-4" />
                  {t("whatsapp.deliveryRetryAllFailed")}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 px-3 sm:px-6">
              {deliveriesQ.isLoading ? (
                <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
              ) : deliveriesQ.isError ? (
                <p className="text-sm text-destructive">{(deliveriesQ.error as Error).message}</p>
              ) : (
                <>
                  <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end lg:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      <Label htmlFor="wa-delivery-status-filter" className="shrink-0 text-muted-foreground">
                        {t("whatsapp.deliveryFilterLabel")}
                      </Label>
                      <select
                        id="wa-delivery-status-filter"
                        value={deliveryStatusFilter}
                        onChange={(e) => setDeliveryStatusFilter((e.target.value || "") as DeliveryStatusFilter)}
                        className="h-9 min-w-[10rem] rounded-md border border-input bg-background px-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="">{t("whatsapp.deliveryFilterAll")}</option>
                        <option value="queued">{t("whatsapp.deliveryFilterQueued")}</option>
                        <option value="sent">{t("whatsapp.deliveryFilterSent")}</option>
                        <option value="failed">{t("whatsapp.deliveryFilterFailed")}</option>
                      </select>
                    </div>
                    <p className="max-w-md text-xs text-muted-foreground leading-relaxed">{t("whatsapp.deliveryAutoPurgeNote")}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={
                        bulkDeleteDeliveries.isPending ||
                        purgeStaleDeliveries.isPending ||
                        selectedDeliveryIds.size === 0
                      }
                      onClick={() => {
                        const ids = Array.from(selectedDeliveryIds);
                        if (!ids.length) return;
                        if (
                          !window.confirm(
                            t("whatsapp.deliveryBulkDeleteConfirm").replace("{count}", String(ids.length))
                          )
                        )
                          return;
                        bulkDeleteDeliveries.mutate(ids);
                      }}
                    >
                      {t("whatsapp.deliveryDeleteSelected")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-destructive/50 text-destructive hover:bg-destructive/10"
                      disabled={bulkDeleteDeliveries.isPending || purgeStaleDeliveries.isPending}
                      onClick={() => {
                        if (!window.confirm(t("whatsapp.deliveryPurgeStaleConfirm"))) return;
                        purgeStaleDeliveries.mutate();
                      }}
                    >
                      {t("whatsapp.deliveryPurgeStale")}
                    </Button>
                  </div>
                  {!deliveriesQ.data?.items.length ? (
                    <p className="text-sm text-muted-foreground">
                      {deliveryStatusFilter ? t("whatsapp.deliveryEmptyFiltered") : t("whatsapp.deliveryEmpty")}
                    </p>
                  ) : (
                    <>
                      <div className="w-full overflow-x-auto rounded-md border bg-card">
                        <table className="w-full table-fixed text-sm">
                          <thead className="border-b bg-muted/40 text-start text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            <tr>
                              <th className="w-10 px-1 py-2 text-center">
                                <span className="sr-only">{t("whatsapp.deliverySelectColumn")}</span>
                                <Checkbox
                                  checked={allDeliveryPageSelected}
                                  onCheckedChange={() => toggleDeliverySelectAllOnPage()}
                                  disabled={bulkDeleteDeliveries.isPending || deleteDelivery.isPending}
                                  aria-label={t("whatsapp.deliverySelectColumn")}
                                />
                              </th>
                              <th className="w-[12%] px-2 py-2">{t("whatsapp.colUsername")}</th>
                              <th className="w-[15%] px-2 py-2">{t("whatsapp.colRecipient")}</th>
                              <th className="w-[20%] px-2 py-2">{t("whatsapp.colPreview")}</th>
                              <th className="w-[10%] px-2 py-2">{t("whatsapp.colStatus")}</th>
                              <th className="w-[14%] px-2 py-2">{t("whatsapp.colTime")}</th>
                              <th className="w-[11%] px-2 py-2">{t("whatsapp.colError")}</th>
                              <th className="w-[10%] px-1 py-2 text-center">{t("whatsapp.deliveryActions")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {deliveriesQ.data.items.map((row) => (
                              <tr key={row.id} className="border-t border-border/60">
                                <td className="px-1 py-2 align-top text-center">
                                  <Checkbox
                                    checked={selectedDeliveryIds.has(row.id)}
                                    onCheckedChange={(c) => toggleDeliveryRowSelected(row.id, c === true)}
                                    disabled={bulkDeleteDeliveries.isPending}
                                    aria-label={t("whatsapp.deliverySelectColumn")}
                                  />
                                </td>
                            <td className="px-2 py-2 align-top">
                              <div className="truncate font-medium" title={row.subscriber_username ?? ""}>
                                {row.subscriber_username ?? "—"}
                              </div>
                              {row.subscriber_id ? (
                                <div className="truncate text-[11px] text-muted-foreground" title={row.subscriber_id}>
                                  {row.subscriber_id.slice(0, 8)}…
                                </div>
                              ) : null}
                            </td>
                            <td className="px-2 py-2 align-top">
                              <span className="block truncate font-mono text-[11px]" title={row.chat_id}>
                                {row.chat_id}
                              </span>
                            </td>
                            <td className="px-2 py-2 align-top text-muted-foreground">
                              <span className="line-clamp-2 break-words text-xs" title={row.message_preview ?? ""}>
                                {row.message_preview ?? "—"}
                              </span>
                            </td>
                            <td className="px-2 py-2 align-top">
                              <span
                                className={cn(
                                  "inline-flex max-w-full truncate rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                                  row.status === "sent" && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
                                  row.status === "failed" && "bg-destructive/15 text-destructive",
                                  row.status === "queued" && "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                                )}
                              >
                                {deliveryStatusLabel(row.status)}
                              </span>
                            </td>
                            <td className="px-2 py-2 align-top text-[11px] text-muted-foreground leading-tight">
                              {row.sent_at
                                ? new Date(row.sent_at).toLocaleString()
                                : new Date(row.created_at).toLocaleString()}
                            </td>
                            <td className="px-2 py-2 align-top text-[11px] text-destructive">
                              <span className="line-clamp-2 break-words" title={row.error ?? ""}>
                                {row.error ?? "—"}
                              </span>
                            </td>
                            <td className="px-1 py-2 align-top text-center">
                              <div className="flex flex-wrap items-center justify-center gap-1">
                                {row.status === "failed" ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-8 gap-1 px-2"
                                    disabled={retryDelivery.isPending || deleteDelivery.isPending}
                                    title={t("whatsapp.deliveryRetry")}
                                    aria-label={t("whatsapp.deliveryRetry")}
                                    onClick={() => retryDelivery.mutate(row.id)}
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                    <span className="hidden sm:inline">{t("whatsapp.deliveryRetry")}</span>
                                  </Button>
                                ) : null}
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 w-8 shrink-0 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                  disabled={deleteDelivery.isPending}
                                  title={t("whatsapp.deliveryDelete")}
                                  aria-label={t("whatsapp.deliveryDelete")}
                                  onClick={() => {
                                    if (!window.confirm(t("whatsapp.deliveryDeleteConfirm"))) return;
                                    deleteDelivery.mutate(row.id);
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      {deliveryOffset + 1}–{Math.min(deliveryOffset + DELIVERY_PAGE, deliveryTotal)} / {deliveryTotal}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!deliveryHasPrev || deliveriesQ.isFetching}
                        onClick={() => setDeliveryOffset((o) => Math.max(0, o - DELIVERY_PAGE))}
                      >
                        {t("whatsapp.deliveryPrev")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!deliveryHasNext || deliveriesQ.isFetching}
                        onClick={() => setDeliveryOffset((o) => o + DELIVERY_PAGE)}
                      >
                        {t("whatsapp.deliveryNext")}
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
