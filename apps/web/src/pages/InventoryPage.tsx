import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { isAdmin, useAuth } from "@/lib/auth";

type Product = { id: string; name: string; category_name: string | null; price: string; stock_qty: number; sku: string | null };

export function InventoryPage() {
  const { user } = useAuth();
  const q = useQuery({ queryKey: ["products"], queryFn: () => apiFetch<Product[]>("/api/products") });

  async function createProduct(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!isAdmin(user?.role)) return;
    const fd = new FormData(e.currentTarget);
    try {
      await apiFetch("/api/products", {
        method: "POST",
        body: JSON.stringify({
          name: fd.get("name")?.toString(),
          price: Number(fd.get("price")),
          stock_qty: Number(fd.get("stock") || 0),
          sku: fd.get("sku")?.toString() || undefined,
        }),
      });
      toast.success("Product created");
      void q.refetch();
      e.currentTarget.reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Inventory & sales</h1>
        <p className="text-muted-foreground">Hardware catalog with stock. Sales API links line items to invoices.</p>
      </div>
      {isAdmin(user?.role) && (
        <Card>
          <CardHeader>
            <CardTitle>Add product</CardTitle>
            <CardDescription>Admin only — categories can be seeded via API.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 md:grid-cols-4 items-end" onSubmit={(e) => void createProduct(e)}>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input name="name" required />
              </div>
              <div className="space-y-2">
                <Label>SKU</Label>
                <Input name="sku" />
              </div>
              <div className="space-y-2">
                <Label>Price</Label>
                <Input name="price" type="number" step="0.01" required />
              </div>
              <div className="space-y-2">
                <Label>Stock</Label>
                <Input name="stock" type="number" defaultValue={0} />
              </div>
              <Button type="submit">Create</Button>
            </form>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Products</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto text-sm">
          {q.isLoading && <div className="text-muted-foreground">Loading…</div>}
          <table className="w-full">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="p-2">Name</th>
                <th className="p-2">Category</th>
                <th className="p-2">SKU</th>
                <th className="p-2">Price</th>
                <th className="p-2">Stock</th>
              </tr>
            </thead>
            <tbody>
              {q.data?.map((p) => (
                <tr key={p.id} className="border-b border-border/60">
                  <td className="p-2 font-medium">{p.name}</td>
                  <td className="p-2">{p.category_name ?? "—"}</td>
                  <td className="p-2">{p.sku ?? "—"}</td>
                  <td className="p-2">${Number(p.price).toFixed(2)}</td>
                  <td className="p-2">{p.stock_qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
