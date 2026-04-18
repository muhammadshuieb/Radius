import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useParams, useSearchParams, Link, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiFetch } from "@/lib/api";
import { canWriteBilling, isAdmin, useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";

type Sub = Record<string, unknown> & {
  id: string;
  username: string;
  package_id: string | null;
  display_name: string | null;
  nickname: string | null;
  profile_city: string | null;
  phone: string | null;
  notes: string | null;
  location_lat: string | null;
  location_lng: string | null;
  linked_devices: unknown;
  status: string;
  expires_at: string | null;
  data_remaining_gb: string | null;
  data_used_gb: string | null;
  package_name: string | null;
  last_accounting_at: string | null;
  account_balance: string | null;
};

type Pkg = { id: string; name: string };
type Inv = { id: string; title: string; amount: string; status: string; issued_at: string; subscriber_id?: string | null };
type Pay = { id: string; amount: string; paid_at: string; subscriber_id: string | null };

export function UserDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { t } = useI18n();

  const tab = searchParams.get("tab") ?? "basic";
  const setTab = (v: string) => {
    setSearchParams({ tab: v }, { replace: true });
  };

  const q = useQuery({
    queryKey: ["subscriber", id],
    queryFn: () => apiFetch<Sub>(`/api/subscribers/${id}`),
    enabled: !!id,
  });

  const pkgs = useQuery({
    queryKey: ["packages-list"],
    queryFn: () => apiFetch<Pkg[]>("/api/packages"),
  });

  const financeRoutesOk = user?.role === "admin" || user?.role === "accountant" || user?.role === "viewer";

  const usageQ = useQuery({
    queryKey: ["usage", q.data?.username],
    queryFn: () =>
      apiFetch<{ input_gb: string; output_gb: string; usage_gb: string }>(
        `/api/accounting/usage/${encodeURIComponent(q.data!.username)}`
      ),
    enabled: financeRoutesOk && !!q.data?.username,
  });

  const sessionsQ = useQuery({
    queryKey: ["radacct-sessions"],
    queryFn: () => apiFetch<{ sessions: { username: string; acctstarttime: string; framedipaddress: string | null }[] }>(
      "/api/accounting/active-sessions"
    ),
    enabled: financeRoutesOk && !!q.data?.username,
  });

  const invQ = useQuery({
    queryKey: ["invoices", id],
    queryFn: () => apiFetch<Inv[]>(`/api/invoices?subscriber_id=${encodeURIComponent(id!)}`),
    enabled: financeRoutesOk && !!id,
  });

  const payQ = useQuery({
    queryKey: ["payments", id],
    queryFn: () => apiFetch<Pay[]>(`/api/payments?subscriber_id=${encodeURIComponent(id!)}`),
    enabled: financeRoutesOk && !!id,
  });

  const patchSubscriber = (body: Record<string, unknown>) =>
    apiFetch(`/api/subscribers/${id}`, { method: "PATCH", body: JSON.stringify(body) });

  const mProfile = useMutation({
    mutationFn: (body: Record<string, unknown>) => patchSubscriber(body),
    onSuccess: () => {
      toast.success(t("userDetail.saved"));
      void qc.invalidateQueries({ queryKey: ["subscriber", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mSubscription = useMutation({
    mutationFn: (body: Record<string, unknown>) => patchSubscriber(body),
    onSuccess: () => {
      setSubDirty(false);
      toast.success(t("userDetail.saved"));
      void qc.invalidateQueries({ queryKey: ["subscriber", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Controlled subscription fields — sync from server unless user has unsaved edits (refetch used to wipe selection). */
  const [subPackageId, setSubPackageId] = useState("");
  const [subExpiresLocal, setSubExpiresLocal] = useState("");
  const [subDirty, setSubDirty] = useState(false);

  const [profileDirty, setProfileDirty] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [nickname, setNickname] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [devicesJson, setDevicesJson] = useState("[]");

  useEffect(() => {
    setSubDirty(false);
    setProfileDirty(false);
  }, [id]);

  useEffect(() => {
    if (!q.data || subDirty) return;
    setSubPackageId(q.data.package_id ?? "");
    setSubExpiresLocal(
      q.data.expires_at ? new Date(q.data.expires_at).toISOString().slice(0, 16) : ""
    );
  }, [q.data?.id, q.data?.package_id, q.data?.expires_at, subDirty]);

  useEffect(() => {
    if (!q.data || profileDirty) return;
    setDisplayName(q.data.display_name ?? "");
    setNickname(q.data.nickname ?? "");
    setCity(q.data.profile_city ?? "");
    setPhone(q.data.phone ?? "");
    setNotes(q.data.notes ?? "");
    setLat(q.data.location_lat ?? "");
    setLng(q.data.location_lng ?? "");
    setDevicesJson(JSON.stringify(q.data.linked_devices ?? [], null, 2));
  }, [
    q.data?.id,
    q.data?.display_name,
    q.data?.nickname,
    q.data?.profile_city,
    q.data?.phone,
    q.data?.notes,
    q.data?.location_lat,
    q.data?.location_lng,
    q.data?.linked_devices,
    profileDirty,
  ]);

  const invoices = useMemo(() => invQ.data ?? [], [invQ.data]);
  const paymentsList = useMemo(() => payQ.data ?? [], [payQ.data]);

  if (!id) return null;
  if (q.isLoading) return <div className="text-muted-foreground">{t("common.loading")}</div>;
  if (q.isError) return <div className="text-destructive">{(q.error as Error).message}</div>;

  const s = q.data!;

  function subscriptionPatchFields(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const pid = subPackageId.trim();
    if (pid) out.package_id = pid;
    if (subExpiresLocal.trim()) out.expires_at = new Date(subExpiresLocal).toISOString();
    return out;
  }

  function resetSubscriptionFromServer() {
    if (!q.data) return;
    setSubPackageId(q.data.package_id ?? "");
    setSubExpiresLocal(
      q.data.expires_at ? new Date(q.data.expires_at).toISOString().slice(0, 16) : ""
    );
    setSubDirty(false);
  }

  function resetProfileFromServer() {
    if (!q.data) return;
    setDisplayName(q.data.display_name ?? "");
    setNickname(q.data.nickname ?? "");
    setCity(q.data.profile_city ?? "");
    setPhone(q.data.phone ?? "");
    setNotes(q.data.notes ?? "");
    setLat(q.data.location_lat ?? "");
    setLng(q.data.location_lng ?? "");
    setDevicesJson(JSON.stringify(q.data.linked_devices ?? [], null, 2));
    setProfileDirty(false);
  }

  function exitSubscriberPage() {
    if (subDirty || profileDirty) {
      if (!window.confirm(t("userDetail.exitUnsavedConfirm"))) return;
      resetSubscriptionFromServer();
      resetProfileFromServer();
    }
    navigate("/users");
  }

  function saveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    let devices: unknown[] = [];
    try {
      devices = JSON.parse(devicesJson || "[]") as unknown[];
    } catch {
      toast.error(t("userDetail.invalidDevicesJson"));
      return;
    }
    const body: Record<string, unknown> = {
      customer_profile: {
        display_name: displayName.trim() || null,
        nickname: nickname.trim() || null,
        city: city.trim() || null,
        phone: phone.trim() || null,
        notes: notes.trim() || null,
        location_lat: lat.trim() ? Number(lat) : null,
        location_lng: lng.trim() ? Number(lng) : null,
        linked_devices: devices,
      },
    };
    const mergeSub = subDirty;
    if (mergeSub) {
      Object.assign(body, subscriptionPatchFields());
    }
    mProfile.mutate(body, {
      onSuccess: () => {
        if (mergeSub) setSubDirty(false);
        setProfileDirty(false);
        navigate("/users");
      },
    });
  }

  function saveSubscription(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = subscriptionPatchFields();
    if (Object.keys(body).length === 0) {
      toast.message(t("userDetail.nothingToSave"));
      return;
    }
    mSubscription.mutate(body, {
      onSuccess: () => {
        navigate("/users");
      },
    });
  }

  const mapsUrl =
    s.location_lat && s.location_lng
      ? `https://www.google.com/maps?q=${encodeURIComponent(`${s.location_lat},${s.location_lng}`)}`
      : null;

  const balance = s.account_balance != null ? Number(s.account_balance) : 0;
  const userSessions =
    sessionsQ.data?.sessions?.filter((x) => x.username?.toLowerCase() === s.username.toLowerCase()) ?? [];

  async function postFinance(type: "deposit" | "withdraw") {
    const amt = window.prompt(t("userDetail.amountPrompt"));
    if (amt == null) return;
    const n = Number(amt);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error(t("userDetail.amountInvalid"));
      return;
    }
    try {
      await apiFetch("/api/finance/transactions", {
        method: "POST",
        body: JSON.stringify({
          subscriber_id: id,
          type,
          amount: n,
          currency: "USD",
          notes: type === "deposit" ? t("userDetail.depositNote") : t("userDetail.withdrawNote"),
        }),
      });
      toast.success(t("userDetail.financeRecorded"));
      void qc.invalidateQueries({ queryKey: ["subscriber", id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{s.username}</h1>
          <p className="text-muted-foreground">{t("userDetail.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="shrink-0"
            aria-label={t("userDetail.closePage")}
            title={t("userDetail.backToList")}
            onClick={exitSubscriberPage}
          >
            <X className="h-5 w-5" />
          </Button>
          <Badge variant={s.status === "active" ? "success" : s.status === "expired" ? "warn" : "danger"}>
            {s.status === "active"
              ? t("users.list.statusActive")
              : s.status === "expired"
                ? t("users.list.statusExpired")
                : t("users.list.statusDisabled")}
          </Badge>
          <span className="text-sm text-muted-foreground">
            {t("userDetail.balance")}: <span className="font-mono text-foreground">${balance.toFixed(2)}</span>
          </span>
        </div>
      </div>

      {canWriteBilling(user?.role) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("userDetail.quickActions")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  const r = await apiFetch<{ closed_sessions?: number }>(`/api/subscribers/${id}/disconnect`, { method: "POST" });
                  toast.success(`${t("userDetail.disconnectOk")} (${String(r.closed_sessions ?? 0)})`);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed");
                }
              }}
            >
              {t("userDetail.disconnect")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                mProfile.mutate({ status: s.status === "active" ? "disabled" : "active" })
              }
            >
              {s.status === "active" ? t("users.list.actionDisable") : t("users.list.actionActivate")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void postFinance("deposit")}>
              {t("userDetail.deposit")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void postFinance("withdraw")}>
              {t("userDetail.withdraw")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  await apiFetch(`/api/subscribers/${id}/reactivate`, { method: "POST" });
                  toast.success(t("userDetail.reactivateOk"));
                  void qc.invalidateQueries({ queryKey: ["subscriber", id] });
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed");
                }
              }}
            >
              {t("userDetail.reactivate")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const gb = window.prompt(t("userDetail.addGbPrompt"));
                if (gb == null) return;
                const n = Number(gb);
                if (!Number.isFinite(n)) return toast.error(t("userDetail.amountInvalid"));
                try {
                  await apiFetch(`/api/subscribers/${id}/adjust-data`, {
                    method: "POST",
                    body: JSON.stringify({ delta_gb: n }),
                  });
                  toast.success(t("userDetail.adjustGbOk"));
                  void qc.invalidateQueries({ queryKey: ["subscriber", id] });
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed");
                }
              }}
            >
              {t("userDetail.addGb")}
            </Button>
            {isAdmin(user?.role) && (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await apiFetch("/api/subscribers/bulk", {
                      method: "POST",
                      body: JSON.stringify({ ids: [id], action: "reset_data" }),
                    });
                    toast.success(t("users.list.resetOk"));
                    void qc.invalidateQueries({ queryKey: ["subscriber", id] });
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Failed");
                  }
                }}
              >
                {t("users.list.actionResetTraffic")}
              </Button>
            )}
            {isAdmin(user?.role) && (
              <Button
                size="sm"
                variant="destructive"
                onClick={async () => {
                  if (!window.confirm(t("userDetail.deleteConfirm"))) return;
                  try {
                    await apiFetch(`/api/subscribers/${id}`, { method: "DELETE" });
                    toast.success(t("userDetail.deleted"));
                    window.location.href = "/users";
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Failed");
                  }
                }}
              >
                {t("userDetail.delete")}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <Tabs value={tab === "subscription" ? "basic" : tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="basic">{t("userDetail.tabBasic")}</TabsTrigger>
          <TabsTrigger value="sessions">{t("userDetail.tabSessions")}</TabsTrigger>
          <TabsTrigger value="billing">{t("userDetail.tabBilling")}</TabsTrigger>
          <TabsTrigger value="notes">{t("userDetail.tabNotes")}</TabsTrigger>
        </TabsList>

        <TabsContent value="basic" className="space-y-6">
          <Card id="subscription">
            <CardHeader>
              <CardTitle>{t("userDetail.subscriptionTitle")}</CardTitle>
              <CardDescription>{t("userDetail.subscriptionHint")}</CardDescription>
            </CardHeader>
            <CardContent>
              {canWriteBilling(user?.role) && subDirty && (
                <div
                  role="status"
                  className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100"
                >
                  {t("userDetail.unsavedSubscriptionBanner")}
                </div>
              )}
              {canWriteBilling(user?.role) ? (
                <form className="grid gap-4 md:grid-cols-2" onSubmit={saveSubscription}>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="package_id">{t("createUser.package")}</Label>
                    <select
                      id="package_id"
                      name="package_id"
                      className="h-10 w-full max-w-md rounded-md border border-input bg-background px-2 text-sm"
                      value={subPackageId}
                      onChange={(e) => {
                        setSubDirty(true);
                        setSubPackageId(e.target.value);
                      }}
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
                    <Label htmlFor="expires_at">{t("users.columns.expires")}</Label>
                    <Input
                      id="expires_at"
                      name="expires_at"
                      type="datetime-local"
                      value={subExpiresLocal}
                      onChange={(e) => {
                        setSubDirty(true);
                        setSubExpiresLocal(e.target.value);
                      }}
                    />
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <Button type="submit" disabled={mProfile.isPending || mSubscription.isPending}>
                      {t("userDetail.saveSubscription")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={mSubscription.isPending}
                      onClick={exitSubscriberPage}
                    >
                      {t("userDetail.backToList")}
                    </Button>
                  </div>
                  <div className="md:col-span-2 text-sm text-muted-foreground">
                    <p>
                      {t("userDetail.packageLabel")}: <strong>{s.package_name ?? "—"}</strong>
                    </p>
                    <p>
                      {t("users.columns.expires")}:{" "}
                      {s.expires_at ? new Date(s.expires_at).toLocaleString() : "—"}
                    </p>
                    <p>
                      {t("userDetail.lastConn")}:{" "}
                      {s.last_accounting_at ? new Date(s.last_accounting_at).toLocaleString() : "—"}
                    </p>
                  </div>
                </form>
              ) : (
                <div className="text-sm text-muted-foreground">{t("common.forbiddenDesc")}</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("userDetail.profileTitle")}</CardTitle>
              <CardDescription>{t("userDetail.profileHint")}</CardDescription>
            </CardHeader>
            <CardContent>
              {canWriteBilling(user?.role) && subDirty && (
                <div
                  role="status"
                  className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100"
                >
                  {t("userDetail.profileSaveMergesSubscription")}
                </div>
              )}
              {canWriteBilling(user?.role) ? (
                <form className="space-y-4" onSubmit={saveProfile}>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="display_name">{t("createUser.displayName")}</Label>
                      <Input
                        id="display_name"
                        name="display_name"
                        value={displayName}
                        onChange={(e) => {
                          setProfileDirty(true);
                          setDisplayName(e.target.value);
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="nickname">{t("createUser.nickname")}</Label>
                      <Input
                        id="nickname"
                        name="nickname"
                        value={nickname}
                        onChange={(e) => {
                          setProfileDirty(true);
                          setNickname(e.target.value);
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="city">{t("createUser.city")}</Label>
                      <Input
                        id="city"
                        name="city"
                        value={city}
                        onChange={(e) => {
                          setProfileDirty(true);
                          setCity(e.target.value);
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="phone">{t("createUser.phone")}</Label>
                      <Input
                        id="phone"
                        name="phone"
                        value={phone}
                        onChange={(e) => {
                          setProfileDirty(true);
                          setPhone(e.target.value);
                        }}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="notes">{t("userDetail.notesField")}</Label>
                    <Input
                      id="notes"
                      name="notes"
                      value={notes}
                      onChange={(e) => {
                        setProfileDirty(true);
                        setNotes(e.target.value);
                      }}
                    />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="lat">{t("userDetail.lat")}</Label>
                      <Input
                        id="lat"
                        name="lat"
                        value={lat}
                        onChange={(e) => {
                          setProfileDirty(true);
                          setLat(e.target.value);
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lng">{t("userDetail.lng")}</Label>
                      <Input
                        id="lng"
                        name="lng"
                        value={lng}
                        onChange={(e) => {
                          setProfileDirty(true);
                          setLng(e.target.value);
                        }}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="devices_json">{t("userDetail.devicesJson")}</Label>
                    <textarea
                      id="devices_json"
                      name="devices_json"
                      className="w-full min-h-[120px] rounded-md border border-input bg-background p-3 text-sm font-mono"
                      value={devicesJson}
                      onChange={(e) => {
                        setProfileDirty(true);
                        setDevicesJson(e.target.value);
                      }}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={mProfile.isPending || mSubscription.isPending}>
                      {t("staff.save")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={mProfile.isPending}
                      onClick={exitSubscriberPage}
                    >
                      {t("userDetail.backToList")}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="text-sm text-muted-foreground">{t("userDetail.readOnly")}</div>
              )}
              {s.location_lat && s.location_lng && (
                <div className="mt-6 space-y-2">
                  <Label>{t("userDetail.mapPreview")}</Label>
                  <div className="aspect-video w-full max-w-xl overflow-hidden rounded-md border border-border">
                    <iframe
                      title="Location map"
                      className="h-full w-full border-0"
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                      src={`https://www.google.com/maps?q=${encodeURIComponent(`${s.location_lat},${s.location_lng}`)}&z=15&output=embed`}
                    />
                  </div>
                  {mapsUrl && (
                    <a className="text-primary underline text-sm" href={mapsUrl} target="_blank" rel="noreferrer">
                      {t("createUser.openMaps")}
                    </a>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sessions">
          <Card>
            <CardHeader>
              <CardTitle>{t("userDetail.sessionsTitle")}</CardTitle>
              <CardDescription>{t("userDetail.sessionsHint")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {usageQ.isLoading && <div className="text-muted-foreground">{t("common.loading")}</div>}
              {usageQ.data && (
                <div className="grid gap-2 md:grid-cols-3">
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-muted-foreground">{t("userDetail.dl")}</div>
                    <div className="text-lg font-semibold">{usageQ.data.input_gb} GiB</div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-muted-foreground">{t("userDetail.ul")}</div>
                    <div className="text-lg font-semibold">{usageQ.data.output_gb} GiB</div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-muted-foreground">{t("userDetail.total")}</div>
                    <div className="text-lg font-semibold">{usageQ.data.usage_gb} GiB</div>
                  </div>
                </div>
              )}
              <div>
                <div className="font-medium mb-2">{t("userDetail.openSessions")}</div>
                {userSessions.length === 0 ? (
                  <p className="text-muted-foreground">{t("userDetail.noOpenSessions")}</p>
                ) : (
                  <ul className="list-disc ps-5 space-y-1">
                    {userSessions.map((sess, i) => (
                      <li key={i}>
                        {sess.acctstarttime} — IP {sess.framedipaddress ?? "—"}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="billing">
          <Card>
            <CardHeader>
              <CardTitle>{t("userDetail.invoicesTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-start">
                    <th className="p-2">{t("finance.colTitle")}</th>
                    <th className="p-2">{t("finance.colAmount")}</th>
                    <th className="p-2">{t("finance.colStatus")}</th>
                    <th className="p-2">{t("finance.colDate")}</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((i) => (
                    <tr key={i.id} className="border-b border-border/60">
                      <td className="p-2">{i.title}</td>
                      <td className="p-2">${Number(i.amount).toFixed(2)}</td>
                      <td className="p-2">{i.status}</td>
                      <td className="p-2 text-muted-foreground">{new Date(i.issued_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {invoices.length === 0 && <p className="text-muted-foreground py-4">{t("userDetail.noInvoices")}</p>}
            </CardContent>
          </Card>
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>{t("userDetail.paymentsTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-start">
                    <th className="p-2">{t("finance.colAmount")}</th>
                    <th className="p-2">{t("finance.colDate")}</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentsList.map((p) => (
                    <tr key={p.id} className="border-b border-border/60">
                      <td className="p-2">${Number(p.amount).toFixed(2)}</td>
                      <td className="p-2 text-muted-foreground">{new Date(p.paid_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {paymentsList.length === 0 && <p className="text-muted-foreground py-4">{t("userDetail.noPayments")}</p>}
            </CardContent>
          </Card>
          {canWriteBilling(user?.role) && (
            <div className="mt-4">
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    await apiFetch("/api/invoices", {
                      method: "POST",
                      body: JSON.stringify({
                        subscriber_id: id,
                        title: `${t("users.list.invoicePrefix")} ${s.username}`,
                        amount: Number(window.prompt(t("userDetail.invoiceAmountPrompt")) ?? "0") || 0,
                        period: "one_time",
                      }),
                    });
                    toast.success(t("users.list.invoiceCreated"));
                    void invQ.refetch();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Failed");
                  }
                }}
              >
                {t("users.list.actionInvoice")}
              </Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="notes">
          <Card>
            <CardHeader>
              <CardTitle>{t("userDetail.tabNotes")}</CardTitle>
              <CardDescription>{t("userDetail.notesTabHint")}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap">{s.notes || t("userDetail.noNotes")}</p>
              <p className="mt-4 text-xs text-muted-foreground">{t("userDetail.notesEditHint")}</p>
              <Button asChild variant="link" className="px-0">
                <Link to="#" onClick={(e) => { e.preventDefault(); setTab("basic"); }}>
                  {t("userDetail.goToProfile")}
                </Link>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
