import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageUpsertDialog, type PkgRow } from "@/components/packages/PackageUpsertDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { isAdmin, useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export function PackagesPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const admin = isAdmin(user?.role);
  const [createOpen, setCreateOpen] = useState(false);
  const [editPkg, setEditPkg] = useState<PkgRow | null>(null);

  const q = useQuery({
    queryKey: ["packages", admin],
    queryFn: () =>
      apiFetch<PkgRow[]>(admin ? "/api/packages?include_inactive=true" : "/api/packages"),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">الباقات · Packages</h1>
          <p className="text-muted-foreground">
            عرض الباقات كبطاقات. إنشاء وتعديل وتعطيل الباقات يظهر فقط لحساب <strong className="text-foreground">Admin</strong> — إن لم ترَ الأزرار، سجّل
            دخولاً كمشرف أو أعد بناء Docker.
          </p>
        </div>
        {admin && (
          <Button onClick={() => setCreateOpen(true)}>+ باقة جديدة / New package</Button>
        )}
      </div>

      {q.isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-40 rounded-lg bg-muted/40 animate-pulse" />
          ))}
        </div>
      )}
      {q.isError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {(q.error as Error).message}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {q.data?.map((p) => (
          <Card
            key={p.id}
            className={cn("border-primary/20", p.is_active === false && "opacity-60 border-dashed")}
          >
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-lg">{p.name}</CardTitle>
                <div className="flex flex-wrap gap-1 justify-end">
                  {p.is_default && <Badge>Default</Badge>}
                  {p.is_active === false && <Badge variant="outline">Inactive</Badge>}
                </div>
              </div>
              <CardDescription>
                {p.speed_down} ↓ / {p.speed_up} ↑ · {p.duration_days} days
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Data</span>
                <span>{p.data_limit_gb != null ? `${p.data_limit_gb} GB` : "Unlimited"}</span>
              </div>
              <div className="flex justify-between text-lg font-semibold">
                <span className="text-muted-foreground text-sm font-normal">Price</span>
                <span>
                  {(p.currency ?? "USD").toUpperCase()} {Number(p.price).toFixed(2)}
                </span>
              </div>
              {admin && (
                <Button variant="secondary" size="sm" className="w-full" onClick={() => setEditPkg(p)}>
                  تعديل / Edit
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {admin && (
        <>
          <PackageUpsertDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            initial={null}
            onSaved={() => void qc.invalidateQueries({ queryKey: ["packages"] })}
          />
          <PackageUpsertDialog
            open={!!editPkg}
            onOpenChange={(o) => !o && setEditPkg(null)}
            initial={editPkg}
            onSaved={() => {
              setEditPkg(null);
              void qc.invalidateQueries({ queryKey: ["packages"] });
            }}
          />
        </>
      )}
    </div>
  );
}
