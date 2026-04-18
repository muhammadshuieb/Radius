import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { isValidSubscriberUsername } from "@/lib/subscriberUsername";
import { cn } from "@/lib/utils";

type Pkg = {
  id: string;
  name: string;
  speed_up: string;
  speed_down: string;
  data_limit_gb: string | null;
  price: string;
  duration_days: number;
  is_default: boolean;
};

function optionalProfilePayload(
  displayName: string,
  nickname: string,
  city: string,
  phone: string,
  lat: string,
  lng: string
): Record<string, unknown> | undefined {
  const prof: Record<string, unknown> = {};
  if (displayName.trim()) prof.display_name = displayName.trim();
  if (nickname.trim()) prof.nickname = nickname.trim();
  if (city.trim()) prof.city = city.trim();
  if (phone.trim()) prof.phone = phone.trim();
  const latN = lat.trim() ? Number(lat) : NaN;
  const lngN = lng.trim() ? Number(lng) : NaN;
  if (Number.isFinite(latN) && Number.isFinite(lngN)) {
    prof.location_lat = latN;
    prof.location_lng = lngN;
  }
  return Object.keys(prof).length ? prof : undefined;
}

export function CreateUserDialog() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [nickname, setNickname] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [packageId, setPackageId] = useState<string | null>(null);
  const [connectionType, setConnectionType] = useState<"pppoe" | "hotspot">("pppoe");
  const [createDisabled, setCreateDisabled] = useState(false);
  const [macLock, setMacLock] = useState("");
  const [ipLock, setIpLock] = useState("");
  const [ipPool, setIpPool] = useState("");
  const [busy, setBusy] = useState(false);

  const pq = useQuery({
    queryKey: ["packages"],
    queryFn: () => apiFetch<Pkg[]>("/api/packages"),
    enabled: open,
  });

  const packages = pq.data ?? [];
  const effectivePackageId =
    packageId ?? packages.find((p) => p.is_default)?.id ?? packages[0]?.id ?? null;

  function mapsHref() {
    const a = Number(lat);
    const b = Number(lng);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return `https://www.google.com/maps?q=${a},${b}`;
  }

  async function submit() {
    const u = username.trim();
    if (!u) return toast.error(t("createUser.usernameRequired"));
    if (!isValidSubscriberUsername(u)) return toast.error(t("createUser.usernameInvalid"));
    if (!password.trim()) return toast.error(t("createUser.passwordRequired"));
    if (!effectivePackageId) return toast.error(t("createUser.packageRequired"));
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        username: u,
        password: password,
        package_id: effectivePackageId,
        connection_type: connectionType,
      };
      if (createDisabled) body.status = "disabled";
      const prof = optionalProfilePayload(displayName, nickname, city, phone, lat, lng);
      if (prof) body.customer_profile = prof;
      if (macLock.trim()) body.mac_lock = macLock.trim();
      if (ipLock.trim()) body.ip_lock = ipLock.trim();
      if (ipPool.trim()) body.ip_pool = ipPool.trim();

      await apiFetch("/api/subscribers", {
        method: "POST",
        body: JSON.stringify(body),
      });
      toast.success(t("createUser.success"));
      setOpen(false);
      setUsername("");
      setPassword("");
      setDisplayName("");
      setNickname("");
      setCity("");
      setPhone("");
      setLat("");
      setLng("");
      setPackageId(null);
      setConnectionType("pppoe");
      setCreateDisabled(false);
      setMacLock("");
      setIpLock("");
      setIpPool("");
      void qc.invalidateQueries({ queryKey: ["subscribers"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const href = mapsHref();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>{t("users.createUser")}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("createUser.title")}</DialogTitle>
          <DialogDescription>{t("createUser.subtitle")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("createUser.username")}</Label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="pppoe-user-01" autoComplete="off" />
              <p className="text-[11px] text-muted-foreground leading-relaxed">{t("createUser.usernameRules")}</p>
            </div>
            <div className="space-y-2">
              <Label>{t("createUser.password")}</Label>
              <div className="flex gap-2">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="flex-1"
                  autoComplete="new-password"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? t("createUser.hidePassword") : t("createUser.showPassword")}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">{t("createUser.passwordRequiredHint")}</p>
            </div>
            <div className="space-y-2">
              <Label>
                {t("createUser.displayName")}{" "}
                <span className="font-normal text-muted-foreground text-xs">({t("createUser.optionalMark")})</span>
              </Label>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>
                {t("createUser.nickname")}{" "}
                <span className="font-normal text-muted-foreground text-xs">({t("createUser.optionalMark")})</span>
              </Label>
              <Input value={nickname} onChange={(e) => setNickname(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>
                {t("createUser.city")}{" "}
                <span className="font-normal text-muted-foreground text-xs">({t("createUser.optionalMark")})</span>
              </Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>
                {t("createUser.phone")}{" "}
                <span className="font-normal text-muted-foreground text-xs">({t("createUser.optionalMark")})</span>
              </Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>
                {t("createUser.location")}{" "}
                <span className="font-normal text-muted-foreground text-xs">({t("createUser.optionalMark")})</span>
              </Label>
              <div className="flex flex-wrap gap-2">
                <Input className="w-32" placeholder="lat" value={lat} onChange={(e) => setLat(e.target.value)} />
                <Input className="w-32" placeholder="lng" value={lng} onChange={(e) => setLng(e.target.value)} />
                {href ? (
                  <Button variant="outline" size="sm" asChild>
                    <a href={href} target="_blank" rel="noreferrer">
                      {t("createUser.openMaps")}
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>
                {t("createUser.macLock")}{" "}
                <span className="font-normal text-muted-foreground text-xs">({t("createUser.optionalMark")})</span>
              </Label>
              <Input value={macLock} onChange={(e) => setMacLock(e.target.value)} placeholder="AA:BB:CC:DD:EE:FF" autoComplete="off" />
            </div>
            <div className="space-y-2">
              <Label>
                {t("createUser.ipLock")}{" "}
                <span className="font-normal text-muted-foreground text-xs">({t("createUser.optionalMark")})</span>
              </Label>
              <Input value={ipLock} onChange={(e) => setIpLock(e.target.value)} placeholder="10.0.0.5" autoComplete="off" />
            </div>
            <div className="space-y-2">
              <Label>
                {t("createUser.ipPool")}{" "}
                <span className="font-normal text-muted-foreground text-xs">({t("createUser.optionalMark")})</span>
              </Label>
              <Input value={ipPool} onChange={(e) => setIpPool(e.target.value)} placeholder="pool-name" autoComplete="off" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t("createUser.connectionType")}</Label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={connectionType === "pppoe" ? "default" : "outline"}
                onClick={() => setConnectionType("pppoe")}
              >
                {t("createUser.pppoe")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={connectionType === "hotspot" ? "default" : "outline"}
                onClick={() => setConnectionType("hotspot")}
              >
                {t("createUser.hotspot")}
              </Button>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-md border border-border p-3">
            <Checkbox
              id="create-disabled"
              checked={createDisabled}
              onCheckedChange={(v) => setCreateDisabled(v === true)}
            />
            <label htmlFor="create-disabled" className="text-sm leading-snug cursor-pointer select-none">
              {t("createUser.createDisabled")}
            </label>
          </div>
          <div className="space-y-2">
            <Label>{t("createUser.package")}</Label>
            {pq.isLoading && <p className="text-sm text-muted-foreground">{t("createUser.loadingPackages")}</p>}
            {!pq.isLoading && packages.length === 0 && (
              <p className="text-sm text-destructive">{t("createUser.noPackages")}</p>
            )}
            <div className="grid gap-2 sm:grid-cols-2 max-h-56 overflow-y-auto pr-1">
              {packages.map((p) => {
                const selected = effectivePackageId === p.id;
                return (
                  <Card
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setPackageId(p.id)}
                    onKeyDown={(e) => e.key === "Enter" && setPackageId(p.id)}
                    className={cn(
                      "cursor-pointer border-2 p-3 transition-colors",
                      selected ? "border-primary bg-primary/10" : "border-border hover:bg-accent/50"
                    )}
                  >
                    <div className="font-medium text-sm">{p.name}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {p.speed_down}↓ {p.speed_up}↑ · {p.duration_days}d
                    </div>
                    <div className="text-xs mt-1">{p.data_limit_gb != null ? `${p.data_limit_gb} GB` : "∞"}</div>
                  </Card>
                );
              })}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {t("createUser.cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !username.trim() || !password.trim() || !effectivePackageId || packages.length === 0}
          >
            {busy ? t("createUser.creating") : t("createUser.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
