import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { PACKAGE_CURRENCIES } from "@/lib/isoCurrencies";
import { cn } from "@/lib/utils";

export type PkgRow = {
  id: string;
  name: string;
  speed_up: string;
  speed_down: string;
  data_limit_gb: string | null;
  price: string;
  currency?: string;
  duration_days: number;
  is_default: boolean;
  is_active?: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create mode */
  initial: PkgRow | null;
  onSaved: () => void;
};

export function PackageUpsertDialog({ open, onOpenChange, initial, onSaved }: Props) {
  const edit = !!initial;
  const [name, setName] = useState("");
  const [speedUp, setSpeedUp] = useState("10M");
  const [speedDown, setSpeedDown] = useState("10M");
  const [dataLimit, setDataLimit] = useState(""); // empty = unlimited
  const [price, setPrice] = useState("0");
  const [currency, setCurrency] = useState("USD");
  const [durationDays, setDurationDays] = useState("30");
  const [isDefault, setIsDefault] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setName(initial.name);
      setSpeedUp(initial.speed_up);
      setSpeedDown(initial.speed_down);
      setDataLimit(initial.data_limit_gb != null ? String(initial.data_limit_gb) : "");
      setPrice(String(initial.price));
      setCurrency((initial.currency ?? "USD").toUpperCase());
      setDurationDays(String(initial.duration_days));
      setIsDefault(initial.is_default);
      setIsActive(initial.is_active !== false);
    } else {
      setName("");
      setSpeedUp("10M");
      setSpeedDown("10M");
      setDataLimit("");
      setPrice("0");
      setCurrency("USD");
      setDurationDays("30");
      setIsDefault(false);
      setIsActive(true);
    }
  }, [open, initial]);

  async function save() {
    if (!name.trim()) return toast.error("Name required");
    const body: Record<string, unknown> = {
      name: name.trim(),
      speed_up: speedUp || "10M",
      speed_down: speedDown || "10M",
      data_limit_gb: dataLimit.trim() === "" ? null : Number(dataLimit),
      price: Number(price) || 0,
      currency: currency.trim().toUpperCase() || "USD",
      duration_days: Math.max(1, parseInt(durationDays, 10) || 30),
      is_default: isDefault,
    };
    if (edit) body.is_active = isActive;

    setBusy(true);
    try {
      if (edit && initial) {
        await apiFetch(`/api/packages/${initial.id}`, { method: "PATCH", body: JSON.stringify(body) });
        toast.success("Package updated");
      } else {
        await apiFetch("/api/packages", { method: "POST", body: JSON.stringify(body) });
        toast.success("Package created");
      }
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{edit ? "تعديل باقة · Edit package" : "باقة جديدة · New package"}</DialogTitle>
          <DialogDescription>
            السرعة بصيغة MikroTik (مثل 10M). اترك حد البيانات فارغاً = غير محدود. Speed suffixes like 10M; empty data = unlimited.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Speed down</Label>
            <Input value={speedDown} onChange={(e) => setSpeedDown(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Speed up</Label>
            <Input value={speedUp} onChange={(e) => setSpeedUp(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Data limit (GB)</Label>
            <Input value={dataLimit} onChange={(e) => setDataLimit(e.target.value)} placeholder="empty = unlimited" />
          </div>
          <div className="space-y-2">
            <Label>Duration (days)</Label>
            <Input type="number" min={1} value={durationDays} onChange={(e) => setDurationDays(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Price</Label>
            <Input type="number" step="0.01" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Currency (ISO 4217)</Label>
            <select
              className={cn(
                "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {PACKAGE_CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Checkbox checked={isDefault} onCheckedChange={(c) => setIsDefault(!!c)} />
            Default package (for new subscribers)
          </label>
          {edit && (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Checkbox checked={isActive} onCheckedChange={(c) => setIsActive(!!c)} />
              Active (shown in subscriber flows)
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء / Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? "جاري الحفظ…" : edit ? "حفظ / Save" : "إنشاء / Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
