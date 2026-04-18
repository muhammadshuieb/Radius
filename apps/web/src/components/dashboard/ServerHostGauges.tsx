import { useQuery } from "@tanstack/react-query";
import { Cpu, HardDrive, MemoryStick, Server } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type HostMetrics = {
  hostname: string;
  platform: string;
  release: string;
  uptime_sec: number;
  cpu_percent: number;
  ram_percent: number;
  disk_percent: number | null;
  load_avg: number[];
  note: string;
};

function formatUptime(sec: number, t: (k: string) => string): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return t("dashboard.serverUptimeDHM").replace("{d}", String(d)).replace("{h}", String(h)).replace("{m}", String(m));
  if (h > 0) return t("dashboard.serverUptimeHM").replace("{h}", String(h)).replace("{m}", String(m));
  return t("dashboard.serverUptimeM").replace("{m}", String(m));
}

function gaugeColor(pct: number): string {
  if (pct >= 85) return "#f97316";
  if (pct >= 60) return "#eab308";
  return "#22c55e";
}

function SemiGauge({ value, fill }: { value: number; fill: string }) {
  const v = Math.min(100, Math.max(0, value));
  return (
    <div className="relative mx-auto w-full max-w-[200px] py-1">
      <svg viewBox="0 0 120 72" className="w-full max-h-[92px]" aria-hidden>
        <path
          d="M 12 60 A 48 48 0 0 1 108 60"
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth="9"
          strokeLinecap="round"
          opacity={0.4}
          pathLength={100}
        />
        <path
          d="M 12 60 A 48 48 0 0 1 108 60"
          fill="none"
          stroke={fill}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${v} ${100 - v}`}
          pathLength={100}
        />
      </svg>
      <div className="-mt-1 flex flex-col items-center">
        <span className="text-2xl font-bold tabular-nums text-sky-300 dark:text-sky-200">{v.toFixed(0)}%</span>
        <span className="text-[10px] text-muted-foreground tabular-nums">0 — 100</span>
      </div>
    </div>
  );
}

export function ServerHostGauges() {
  const { t } = useI18n();
  const q = useQuery({
    queryKey: ["system-host"],
    queryFn: () => apiFetch<HostMetrics>("/api/system/host"),
    refetchInterval: 30_000,
  });

  if (q.isLoading) {
    return (
      <Card className="rounded-3xl border-border/60 bg-card/80 shadow-card-erp">
        <CardHeader className="text-end">
          <CardTitle>{t("dashboard.serverHostTitle")}</CardTitle>
          <CardDescription>{t("dashboard.loading")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  if (q.isError || !q.data) {
    return (
      <Card className="rounded-3xl border-destructive/30 bg-destructive/5">
        <CardHeader className="text-end">
          <CardTitle>{t("dashboard.serverHostTitle")}</CardTitle>
          <CardDescription className="text-destructive">{(q.error as Error)?.message}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const h = q.data;
  const cpuFill = gaugeColor(h.cpu_percent);
  const ramFill = gaugeColor(h.ram_percent);
  const diskFill = h.disk_percent != null ? gaugeColor(h.disk_percent) : "#64748b";

  return (
    <Card className="overflow-hidden rounded-3xl border-border/60 bg-card/80 shadow-card-erp">
      <CardHeader className="flex flex-col gap-2 border-b border-border/50 text-end sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center justify-end gap-2">
          <Server className="h-5 w-5 text-orange-400" />
          <div>
            <CardTitle>{t("dashboard.serverHostTitle")}</CardTitle>
            <CardDescription>{t("dashboard.serverHostSubtitle")}</CardDescription>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          <span className="font-mono">{h.hostname}</span>
          <span className="mx-1">·</span>
          <span>
            {h.platform} {h.release}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <div
            className={cn(
              "relative rounded-2xl border p-4 text-end",
              "border-white/10 bg-gradient-to-b from-slate-900/80 to-slate-950/90 dark:from-slate-950/90 dark:to-black/80"
            )}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <Cpu className="h-8 w-8 text-muted-foreground/25" />
              <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <Cpu className="h-4 w-4 text-orange-400" />
                {t("dashboard.serverCpu")}
              </span>
            </div>
            <SemiGauge value={h.cpu_percent} fill={cpuFill} />
          </div>
          <div
            className={cn(
              "relative rounded-2xl border p-4 text-end",
              "border-white/10 bg-gradient-to-b from-slate-900/80 to-slate-950/90 dark:from-slate-950/90 dark:to-black/80"
            )}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <MemoryStick className="h-8 w-8 text-muted-foreground/25" />
              <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <MemoryStick className="h-4 w-4 text-violet-400" />
                {t("dashboard.serverRam")}
              </span>
            </div>
            <SemiGauge value={h.ram_percent} fill={ramFill} />
          </div>
          <div
            className={cn(
              "relative rounded-2xl border p-4 text-end",
              "border-white/10 bg-gradient-to-b from-slate-900/80 to-slate-950/90 dark:from-slate-950/90 dark:to-black/80"
            )}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <HardDrive className="h-8 w-8 text-muted-foreground/25" />
              <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <HardDrive className="h-4 w-4 text-emerald-400" />
                {t("dashboard.serverDisk")}
              </span>
            </div>
            {h.disk_percent != null ? (
              <SemiGauge value={h.disk_percent} fill={diskFill} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("dashboard.serverDiskNA")}</p>
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-muted/20 px-4 py-3 text-sm text-end">
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
            <span>
              <span className="text-muted-foreground">{t("dashboard.serverUptime")}: </span>
              <span className="font-mono font-medium tabular-nums">{formatUptime(h.uptime_sec, t)}</span>
            </span>
            <span className="text-muted-foreground">
              load: {h.load_avg.map((x) => x.toFixed(2)).join(" / ")}
            </span>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{h.note}</p>
        </div>
      </CardContent>
    </Card>
  );
}
