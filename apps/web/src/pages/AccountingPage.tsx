import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch, API_BASE, getToken } from "@/lib/api";
import { isAdmin, useAuth } from "@/lib/auth";

type Inv = { id: string; title: string; amount: string; status: string; issued_at: string };
type Pay = { id: string; amount: string; paid_at: string; username: string | null };
type Exp = { id: string; title: string; amount: string; incurred_at: string };

export function AccountingPage() {
  const { user } = useAuth();
  const inv = useQuery({ queryKey: ["invoices"], queryFn: () => apiFetch<Inv[]>("/api/invoices") });
  const pay = useQuery({ queryKey: ["payments"], queryFn: () => apiFetch<Pay[]>("/api/payments") });
  const exp = useQuery({ queryKey: ["expenses"], queryFn: () => apiFetch<Exp[]>("/api/expenses") });

  async function autoInvoices(period: "monthly" | "yearly") {
    try {
      const r = await apiFetch<{ created: number }>("/api/invoices/auto", {
        method: "POST",
        body: JSON.stringify({ period }),
      });
      toast.success(`Generated ${r.created} invoices`);
      void inv.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Accounting</h1>
          <p className="text-muted-foreground">Payments, renewals, expenses, invoices.</p>
        </div>
        {isAdmin(user?.role) && (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => void autoInvoices("monthly")}>
              Auto monthly invoices
            </Button>
            <Button size="sm" variant="outline" onClick={() => void autoInvoices("yearly")}>
              Auto yearly invoices
            </Button>
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
          <CardDescription>PDF export uses Bearer auth from this app session.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto text-sm">
          {inv.isLoading && <div className="text-muted-foreground">Loading…</div>}
          <table className="w-full">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="p-2">Title</th>
                <th className="p-2">Amount</th>
                <th className="p-2">Status</th>
                <th className="p-2">Issued</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {inv.data?.map((i) => (
                <tr key={i.id} className="border-b border-border/60">
                  <td className="p-2">{i.title}</td>
                  <td className="p-2">${Number(i.amount).toFixed(2)}</td>
                  <td className="p-2">{i.status}</td>
                  <td className="p-2 text-muted-foreground">{new Date(i.issued_at).toLocaleString()}</td>
                  <td className="p-2 text-right">
                    <button
                      type="button"
                      className="text-primary underline"
                      onClick={() => {
                        const t = getToken();
                        void fetch(`${API_BASE}/api/invoices/${i.id}/pdf`, { headers: { Authorization: `Bearer ${t}` } })
                          .then(async (r) => {
                            if (!r.ok) throw new Error(await r.text());
                            const blob = await r.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = `invoice-${i.id}.pdf`;
                            a.click();
                            URL.revokeObjectURL(url);
                          })
                          .catch((err: Error) => toast.error(err.message));
                      }}
                    >
                      PDF
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Payments</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2 max-h-80 overflow-auto">
            {pay.data?.map((p) => (
              <div key={p.id} className="flex justify-between border-b border-border/40 py-2">
                <span>{p.username ?? "—"}</span>
                <span className="text-muted-foreground">{new Date(p.paid_at).toLocaleDateString()}</span>
                <span className="font-medium">${Number(p.amount).toFixed(2)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Expenses</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2 max-h-80 overflow-auto">
            {exp.data?.map((x) => (
              <div key={x.id} className="flex justify-between border-b border-border/40 py-2">
                <span>{x.title}</span>
                <span className="text-muted-foreground">{new Date(x.incurred_at).toLocaleDateString()}</span>
                <span className="font-medium">${Number(x.amount).toFixed(2)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
