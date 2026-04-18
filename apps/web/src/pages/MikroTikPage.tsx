import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { isAdmin, useAuth } from "@/lib/auth";

type Server = {
  id: string;
  name: string;
  host: string;
  port: number;
  use_ssl: boolean;
  username: string;
  last_health: Record<string, unknown> | null;
  last_health_at: string | null;
};

export function MikroTikPage() {
  const { user } = useAuth();
  const q = useQuery({ queryKey: ["mt-servers"], queryFn: () => apiFetch<Server[]>("/api/mikrotik/servers") });

  async function addServer(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      const r = await apiFetch<{ id: string; port_validation: string | null }>("/api/mikrotik/servers", {
        method: "POST",
        body: JSON.stringify({
          name: fd.get("name"),
          host: fd.get("host"),
          port: Number(fd.get("port") || 8728),
          use_ssl: fd.get("ssl") === "on",
          username: fd.get("username"),
          password: fd.get("password"),
        }),
      });
      if (r.port_validation) toast.message(r.port_validation);
      toast.success("Server saved");
      void q.refetch();
      e.currentTarget.reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  async function test(id: string) {
    try {
      const r = await apiFetch<Record<string, unknown>>(`/api/mikrotik/servers/${id}/test`, { method: "POST" });
      if (r.ok) toast.success(`OK ${r.latencyMs ?? "?"}ms (${r.attempts ?? 1} attempts)`);
      else toast.error(String(r.error || "Failed"), { description: r.hint ? String(r.hint) : undefined });
      void q.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">MikroTik</h1>
        <p className="text-muted-foreground">TCP reachability test with retries, timeouts, and actionable hints.</p>
      </div>
      {isAdmin(user?.role) && (
        <Card>
          <CardHeader>
            <CardTitle>Add router</CardTitle>
            <CardDescription>Validate IP and ports 8728 (API) / 8729 (API-SSL). Ensure API service is enabled.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 md:grid-cols-2" onSubmit={(e) => void addServer(e)}>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input name="name" required />
              </div>
              <div className="space-y-2">
                <Label>Host</Label>
                <Input name="host" placeholder="192.168.88.1" required />
              </div>
              <div className="space-y-2">
                <Label>Port</Label>
                <Input name="port" type="number" defaultValue={8728} />
              </div>
              <div className="space-y-2">
                <Label>Username</Label>
                <Input name="username" defaultValue="admin" />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Password</Label>
                <Input name="password" type="password" required />
              </div>
              <label className="flex items-center gap-2 text-sm md:col-span-2">
                <input type="checkbox" name="ssl" className="h-4 w-4" />
                Use SSL (8729)
              </label>
              <Button type="submit" className="md:col-span-2 w-fit">
                Save
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Saved servers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {q.data?.map((s) => (
            <div key={s.id} className="rounded-md border border-border p-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="font-medium">
                  {s.name}{" "}
                  <span className="text-muted-foreground font-normal">
                    ({s.host}:{s.port} {s.use_ssl ? "SSL" : "plain"})
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Last check: {s.last_health_at ? new Date(s.last_health_at).toLocaleString() : "never"}
                  {s.last_health && (
                    <pre className="mt-2 text-[11px] bg-muted/40 p-2 rounded-md overflow-x-auto">
                      {JSON.stringify(s.last_health, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
              {isAdmin(user?.role) && (
                <Button variant="secondary" onClick={() => void test(s.id)}>
                  Test connection
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
