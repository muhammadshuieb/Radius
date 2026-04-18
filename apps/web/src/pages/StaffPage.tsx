import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type StaffRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  scope_city: string | null;
};

export const STAFF_ROLES = ["admin", "accountant", "viewer", "manager"] as const;

export function StaffPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["staff"],
    queryFn: () => apiFetch<StaffRow[]>("/api/staff"),
  });

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<(typeof STAFF_ROLES)[number]>("viewer");
  const [scopeCity, setScopeCity] = useState("");

  const createM = useMutation({
    mutationFn: () =>
      apiFetch("/api/staff", {
        method: "POST",
        body: JSON.stringify({
          email: email.trim(),
          password,
          full_name: fullName.trim() || undefined,
          role,
          scope_city: role === "manager" ? scopeCity.trim() : null,
        }),
      }),
    onSuccess: () => {
      toast.success("OK");
      setEmail("");
      setPassword("");
      setFullName("");
      setRole("viewer");
      setScopeCity("");
      void qc.invalidateQueries({ queryKey: ["staff"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const patchM = useMutation({
    mutationFn: (p: { id: string; body: Record<string, unknown> }) =>
      apiFetch(`/api/staff/${p.id}`, { method: "PATCH", body: JSON.stringify(p.body) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["staff"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = q.data ?? [];

  const roleLabel = useMemo(
    () =>
      ({
        admin: t("staff.roles.admin"),
        accountant: t("staff.roles.accountant"),
        viewer: t("staff.roles.viewer"),
        manager: t("staff.roles.manager"),
      }) as Record<string, string>,
    [t]
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("staff.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("staff.subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("staff.add")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2 sm:col-span-2">
            <Label>{t("staff.email")}</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          </div>
          <div className="space-y-2">
            <Label>{t("staff.password")}</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t("staff.fullName")}</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t("staff.role")}</Label>
            <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={role} onChange={(e) => setRole(e.target.value as (typeof STAFF_ROLES)[number])}>
              {STAFF_ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel[r]}
                </option>
              ))}
            </select>
          </div>
          {role === "manager" ? (
            <div className="space-y-2 sm:col-span-2">
              <Label>{t("staff.scopeCity")}</Label>
              <Input value={scopeCity} onChange={(e) => setScopeCity(e.target.value)} placeholder="e.g. Riyadh" />
            </div>
          ) : null}
          <div className="sm:col-span-2 lg:col-span-3">
            <Button disabled={createM.isPending || !email.trim() || password.length < 6 || (role === "manager" && !scopeCity.trim())} onClick={() => createM.mutate()}>
              {t("staff.add")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("staff.title")}</CardTitle>
          <CardDescription>{rows.length} users</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-2">{t("staff.email")}</th>
                <th className="p-2">{t("staff.fullName")}</th>
                <th className="p-2">{t("staff.role")}</th>
                <th className="p-2">{t("staff.scopeCity")}</th>
                <th className="p-2">{t("staff.active")}</th>
                <th className="p-2">{t("staff.save")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <StaffEditRow key={r.id} row={r} roleLabel={roleLabel} onPatch={(body) => patchM.mutate({ id: r.id, body })} busy={patchM.isPending} t={t} />
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function StaffEditRow({
  row,
  roleLabel,
  onPatch,
  busy,
  t,
}: {
  row: StaffRow;
  roleLabel: Record<string, string>;
  onPatch: (body: Record<string, unknown>) => void;
  busy: boolean;
  t: (k: string) => string;
}) {
  const [role, setRole] = useState(row.role);
  const [scopeCity, setScopeCity] = useState(row.scope_city ?? "");
  const [isActive, setIsActive] = useState(row.is_active);
  const [pwd, setPwd] = useState("");

  return (
    <tr className="border-b border-border/60">
      <td className="p-2 font-mono text-xs">{row.email}</td>
      <td className="p-2">{row.full_name ?? "—"}</td>
      <td className="p-2">
        <select className="rounded-md border border-input bg-background px-2 py-1 text-xs" value={role} onChange={(e) => setRole(e.target.value)}>
          {STAFF_ROLES.map((x) => (
            <option key={x} value={x}>
              {roleLabel[x]}
            </option>
          ))}
        </select>
      </td>
      <td className="p-2">
        <Input className="h-8 text-xs" value={scopeCity} onChange={(e) => setScopeCity(e.target.value)} disabled={role !== "manager"} />
      </td>
      <td className="p-2">
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          {isActive ? t("staff.active") : t("staff.inactive")}
        </label>
      </td>
      <td className="p-2 space-y-1">
        <Input className="h-8 text-xs" type="password" placeholder={t("staff.password")} value={pwd} onChange={(e) => setPwd(e.target.value)} />
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => {
            const body: Record<string, unknown> = { role, is_active: isActive, scope_city: role === "manager" ? scopeCity.trim() || null : null };
            if (pwd.length >= 6) body.password = pwd;
            onPatch(body);
            setPwd("");
          }}
        >
          {t("staff.save")}
        </Button>
      </td>
    </tr>
  );
}
