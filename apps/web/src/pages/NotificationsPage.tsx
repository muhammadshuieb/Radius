import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type Item = {
  id: string;
  severity: string;
  title: string;
  body: string;
  ref?: { type: string; id: string };
};

type NotifResp = {
  items: Item[];
  counts: { expiring: number; unpaid_invoices: number };
  expiring_days: number;
  unpaid_days: number;
};

export function NotificationsPage() {
  const { t } = useI18n();
  const [expiringDays, setExpiringDays] = useState(7);
  const [unpaidDays, setUnpaidDays] = useState(30);

  const q = useQuery({
    queryKey: ["notifications", expiringDays, unpaidDays],
    queryFn: () =>
      apiFetch<NotifResp>(
        `/api/notifications?expiring_days=${expiringDays}&unpaid_days=${unpaidDays}`
      ),
  });

  const expiringItems = q.data?.items.filter((i) => i.id.startsWith("exp-")) ?? [];
  const unpaidItems = q.data?.items.filter((i) => i.id.startsWith("inv-")) ?? [];

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("notifications.title")}</h1>
        <p className="text-muted-foreground">{t("notifications.subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("users.filtersTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>{t("notifications.expiringWindow")}</Label>
            <Input
              type="number"
              min={1}
              max={90}
              value={expiringDays}
              onChange={(e) => setExpiringDays(Number(e.target.value) || 7)}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("notifications.unpaidWindow")}</Label>
            <Input
              type="number"
              min={1}
              max={365}
              value={unpaidDays}
              onChange={(e) => setUnpaidDays(Number(e.target.value) || 30)}
            />
          </div>
        </CardContent>
      </Card>

      {q.isLoading && <div className="text-muted-foreground">{t("common.loading")}</div>}

      <Card>
        <CardHeader>
          <CardTitle>{t("notifications.expiring")}</CardTitle>
          <CardDescription>
            {q.data?.counts.expiring ?? 0} · {q.data?.expiring_days ?? expiringDays}d
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {expiringItems.map((i) => (
            <div
              key={i.id}
              className="rounded-lg border border-border p-3 text-sm flex flex-col gap-1 md:flex-row md:items-center md:justify-between"
            >
              <div>
                <div className="font-medium">{i.title}</div>
                <div className="text-muted-foreground">{i.body}</div>
              </div>
              {i.ref?.type === "subscriber" && (
                <Link className="text-primary shrink-0 underline" to={`/users/${i.ref.id}`}>
                  {t("notifications.openUser")}
                </Link>
              )}
            </div>
          ))}
          {q.isSuccess && expiringItems.length === 0 && (
            <p className="text-muted-foreground">{t("notifications.empty")}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("notifications.unpaid")}</CardTitle>
          <CardDescription>
            {q.data?.counts.unpaid_invoices ?? 0} · &gt; {q.data?.unpaid_days ?? unpaidDays}d
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {unpaidItems.map((i) => (
            <div key={i.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="font-medium">{i.title}</div>
              <div className="text-muted-foreground">{i.body}</div>
            </div>
          ))}
          {q.isSuccess && unpaidItems.length === 0 && (
            <p className="text-muted-foreground">{t("notifications.empty")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
