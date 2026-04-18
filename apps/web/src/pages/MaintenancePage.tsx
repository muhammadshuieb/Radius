import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cloud, Database, Download, FileJson, RefreshCw, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiFetch, apiFetchBlob, apiFetchMultipart } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type BackupRow = {
  id: string;
  filename: string;
  file_path: string;
  created_at: string;
  status: string;
  location: string;
  drive_file_id: string | null;
  size_bytes: string | null;
  error_message: string | null;
  deleted_at: string | null;
};

type DriveStatus = {
  mode: string;
  connected: boolean;
  email: string | null;
  folder_id: string | null;
  oauth_configured: boolean;
};

type MaintenanceSummary = {
  last_backup: {
    id: string;
    created_at: string;
    status: string;
    filename: string;
    location: string;
    drive_uploaded: boolean;
    error_message: string | null;
  } | null;
  drive: DriveStatus;
  tools?: { pg_dump: string; psql: string; pg_restore?: string };
};

function locLabel(t: (k: string) => string, location: string): string {
  if (location === "both") return t("maintenance.locBoth");
  if (location === "drive") return t("maintenance.locDrive");
  return t("maintenance.locLocal");
}

function statusLabel(t: (k: string) => string, status: string): string {
  if (status === "pending") return t("maintenance.statusPending");
  if (status === "failure") return t("maintenance.statusFailure");
  return t("maintenance.statusSuccess");
}

async function downloadBackupFile(id: string, filename: string) {
  const blob = await apiFetchBlob(`/api/maintenance/backups/${id}/download`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function MaintenancePage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const [restoreAck, setRestoreAck] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importAck, setImportAck] = useState(false);

  const summaryQ = useQuery({
    queryKey: ["maintenance-summary"],
    queryFn: () => apiFetch<MaintenanceSummary>("/api/maintenance/summary"),
  });

  const listQ = useQuery({
    queryKey: ["maintenance-backups"],
    queryFn: () => apiFetch<{ items: BackupRow[] }>("/api/maintenance/backups"),
  });

  const driveQ = useQuery({
    queryKey: ["maintenance-drive"],
    queryFn: () => apiFetch<DriveStatus>("/api/maintenance/drive/status"),
  });

  useEffect(() => {
    const d = params.get("drive");
    if (d !== "connected" && d !== "error") return;
    void qc.invalidateQueries({ queryKey: ["maintenance-backups"] });
    void qc.invalidateQueries({ queryKey: ["maintenance-drive"] });
    void qc.invalidateQueries({ queryKey: ["maintenance-summary"] });
    setParams({}, { replace: true });
  }, [params, setParams, qc]);

  const backupMut = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>("/api/maintenance/backups/run", { method: "POST", body: "{}" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["maintenance-backups"] });
      void qc.invalidateQueries({ queryKey: ["maintenance-summary"] });
      void qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
    },
  });

  const authUrlMut = useMutation({
    mutationFn: () => apiFetch<{ url: string }>("/api/maintenance/drive/auth-url"),
    onSuccess: (data) => {
      window.location.href = data.url;
    },
  });

  const disconnectMut = useMutation({
    mutationFn: () => apiFetch("/api/maintenance/drive/oauth", { method: "DELETE" }),
    onSuccess: () => {
      void driveQ.refetch();
      void summaryQ.refetch();
    },
  });

  const restoreMut = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: boolean }>(`/api/maintenance/backups/${id}/restore`, {
        method: "POST",
        body: JSON.stringify({ confirm: true }),
      }),
    onSuccess: () => {
      setRestoreId(null);
      setRestoreAck(false);
      void qc.invalidateQueries({ queryKey: ["maintenance-backups"] });
      void qc.invalidateQueries({ queryKey: ["maintenance-summary"] });
      void qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
    },
  });

  const importMut = useMutation({
    mutationFn: async () => {
      if (!importFile) throw new Error(t("maintenance.importNeedFile"));
      const fd = new FormData();
      fd.append("file", importFile);
      fd.append("confirm", "true");
      return apiFetchMultipart<{ ok: boolean }>("/api/maintenance/restore/import", fd);
    },
    onSuccess: () => {
      setImportFile(null);
      setImportAck(false);
      void qc.invalidateQueries({ queryKey: ["maintenance-backups"] });
      void qc.invalidateQueries({ queryKey: ["maintenance-summary"] });
      void qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
    },
  });

  const [dmaJson, setDmaJson] = useState("");
  const [dmaGroupMapJson, setDmaGroupMapJson] = useState("");
  const [dmaDefaultPackageId, setDmaDefaultPackageId] = useState("");

  const packagesQ = useQuery({
    queryKey: ["packages", "admin"],
    queryFn: () => apiFetch<{ id: string; name: string }[]>(`/api/packages?include_inactive=true`),
  });

  const dmaStatsQ = useQuery({
    queryKey: ["dma-staging-stats"],
    queryFn: () => apiFetch<{ pending: number; total: number }>("/api/maintenance/dma/staging/stats"),
  });

  const dmaStagingMut = useMutation({
    mutationFn: async () => {
      const parsed = JSON.parse(dmaJson) as unknown;
      if (!Array.isArray(parsed)) throw new Error("JSON must be an array of objects");
      return apiFetch<{ inserted: number }>("/api/maintenance/dma/staging", {
        method: "POST",
        body: JSON.stringify({ rows: parsed }),
      });
    },
    onSuccess: () => {
      void dmaStatsQ.refetch();
      void qc.invalidateQueries({ queryKey: ["users"] });
    },
  });

  const dmaMigrateMut = useMutation({
    mutationFn: async () => {
      if (!dmaDefaultPackageId.trim()) throw new Error(t("maintenance.dmaNeedDefaultPackage"));
      let group_map: Record<string, string> | undefined;
      const g = dmaGroupMapJson.trim();
      if (g) {
        const o = JSON.parse(g) as unknown;
        if (typeof o !== "object" || o === null || Array.isArray(o)) throw new Error("group_map must be a JSON object");
        group_map = o as Record<string, string>;
      }
      return apiFetch<{ migrated: number; failed: number; errors: { id: number; error: string }[] }>(
        "/api/maintenance/dma/migrate",
        {
          method: "POST",
          body: JSON.stringify({
            default_package_id: dmaDefaultPackageId.trim(),
            group_map,
            limit: 500,
          }),
        }
      );
    },
    onSuccess: () => {
      void dmaStatsQ.refetch();
      void qc.invalidateQueries({ queryKey: ["users"] });
      void qc.invalidateQueries({ queryKey: ["maintenance-summary"] });
      void qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
    },
  });

  useEffect(() => {
    const list = packagesQ.data;
    if (list?.length && dmaDefaultPackageId === "") {
      setDmaDefaultPackageId(list[0].id);
    }
  }, [packagesQ.data, dmaDefaultPackageId]);

  const drive = driveQ.data ?? summaryQ.data?.drive;
  const last = summaryQ.data?.last_backup ?? null;
  const lastOk = last?.status === "success" ? last : null;
  const lastFailed = last && last.status === "failure";

  const showConnectOAuth =
    drive?.oauth_configured &&
    drive.mode !== "service_account" &&
    !(drive.mode === "oauth" && drive.connected);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <Database className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("maintenance.title")}</h1>
          <p className="text-muted-foreground">{t("maintenance.subtitle")}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={backupMut.isPending} onClick={() => backupMut.mutate()}>
          {backupMut.isPending ? t("common.loading") : t("maintenance.backupNow")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void listQ.refetch();
            void summaryQ.refetch();
            void driveQ.refetch();
            void dmaStatsQ.refetch();
            void packagesQ.refetch();
          }}
        >
          <RefreshCw className="me-2 h-4 w-4" />
          {t("maintenance.refresh")}
        </Button>
      </div>
      {backupMut.isSuccess ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{t("maintenance.backupQueued")}</p> : null}
      {backupMut.isError ? <p className="text-sm text-destructive">{(backupMut.error as Error).message}</p> : null}

      <Card className="border-sky-500/25 bg-sky-500/[0.04]">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Download className="h-5 w-5 text-sky-600 dark:text-sky-400" />
            <CardTitle className="text-lg">{t("maintenance.localSectionTitle")}</CardTitle>
          </div>
          <CardDescription>{t("maintenance.localSectionHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-start">
          <p className="text-xs text-muted-foreground leading-relaxed">{t("maintenance.downloadExplain")}</p>
          {summaryQ.isLoading ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : summaryQ.isError ? (
            <p className="text-sm text-destructive">{(summaryQ.error as Error).message}</p>
          ) : lastOk ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1 text-sm">
                <p>
                  <span className="text-muted-foreground">{t("dashboard.backupLastAt")}: </span>
                  <span className="font-medium">{new Date(lastOk.created_at).toLocaleString()}</span>
                </p>
                <p className="font-mono text-xs text-muted-foreground break-all">{lastOk.filename}</p>
              </div>
              <Button
                type="button"
                size="lg"
                className="shrink-0 gap-2"
                onClick={() => downloadBackupFile(lastOk.id, lastOk.filename)}
              >
                <Download className="h-4 w-4" />
                {t("maintenance.downloadLatestLocal")}
              </Button>
            </div>
          ) : last?.status === "pending" ? (
            <p className="text-sm text-amber-600 dark:text-amber-400">{t("maintenance.statusPending")}</p>
          ) : lastFailed && last ? (
            <div className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
              <p className="font-medium text-destructive">{t("maintenance.lastBackupFailedTitle")}</p>
              <p className="font-mono text-[11px] text-muted-foreground break-all">{last.error_message ?? "—"}</p>
              <p className="text-sm text-foreground/90 leading-relaxed">{t("maintenance.pgDumpFixHint")}</p>
              {summaryQ.data?.tools?.pg_dump ? (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{t("maintenance.toolsResolved")}: </span>
                  <code className="rounded bg-muted px-1 py-0.5 break-all">{summaryQ.data.tools.pg_dump}</code>
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("dashboard.backupNone")}</p>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-destructive" />
            <CardTitle className="text-lg">{t("maintenance.importSectionTitle")}</CardTitle>
          </div>
          <CardDescription>{t("maintenance.importSectionHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-start text-sm">
          <p className="text-xs text-muted-foreground leading-relaxed">{t("maintenance.importCompatibility")}</p>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <input
              type="file"
              accept=".sql,.dump,.backup,.SQL,.DUMP"
              className="max-w-full text-sm file:me-2 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5"
              onChange={(e) => {
                const f = e.target.files?.[0];
                setImportFile(f ?? null);
              }}
            />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={importAck} onChange={(e) => setImportAck(e.target.checked)} />
            <span>{t("maintenance.importConfirm")}</span>
          </label>
          <Button
            type="button"
            variant="destructive"
            disabled={!importFile || !importAck || importMut.isPending}
            className="gap-2"
            onClick={() => importMut.mutate()}
          >
            {importMut.isPending ? t("common.loading") : t("maintenance.importRun")}
          </Button>
          {importMut.isError ? <p className="text-sm text-destructive">{(importMut.error as Error).message}</p> : null}
          {importMut.isSuccess ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{t("maintenance.importSuccess")}</p> : null}
        </CardContent>
      </Card>

      <Card className="border-violet-500/25 bg-violet-500/[0.04]">
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileJson className="h-5 w-5 text-violet-600 dark:text-violet-400" />
            <CardTitle className="text-lg">{t("maintenance.dmaSectionTitle")}</CardTitle>
          </div>
          <CardDescription>{t("maintenance.dmaSectionHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-start">
          {dmaStatsQ.isLoading ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : dmaStatsQ.isError ? (
            <p className="text-sm text-destructive">{(dmaStatsQ.error as Error).message}</p>
          ) : dmaStatsQ.data ? (
            <p className="text-sm text-muted-foreground">
              {t("maintenance.dmaStats")
                .replace("{pending}", String(dmaStatsQ.data.pending))
                .replace("{total}", String(dmaStatsQ.data.total))}
            </p>
          ) : null}

          <div className="space-y-2">
            <label className="text-sm font-medium">{t("maintenance.dmaDefaultPackage")}</label>
            {packagesQ.isLoading ? (
              <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
            ) : packagesQ.isError ? (
              <p className="text-sm text-destructive">{(packagesQ.error as Error).message}</p>
            ) : (
              <select
                className="flex h-10 w-full max-w-md rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={dmaDefaultPackageId}
                onChange={(e) => setDmaDefaultPackageId(e.target.value)}
              >
                <option value="">{t("maintenance.dmaSelectPackage")}</option>
                {(packagesQ.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">{t("maintenance.dmaGroupMapHint")}</label>
            <textarea
              className="min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
              placeholder={t("maintenance.dmaGroupMapPlaceholder")}
              value={dmaGroupMapJson}
              onChange={(e) => setDmaGroupMapJson(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">JSON</label>
            <textarea
              className="min-h-[180px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
              placeholder={t("maintenance.dmaJsonPlaceholder")}
              value={dmaJson}
              onChange={(e) => setDmaJson(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={!dmaJson.trim() || dmaStagingMut.isPending}
              onClick={() => dmaStagingMut.mutate()}
            >
              {dmaStagingMut.isPending ? t("common.loading") : t("maintenance.dmaSendStaging")}
            </Button>
            <Button
              type="button"
              disabled={!dmaDefaultPackageId.trim() || dmaMigrateMut.isPending}
              onClick={() => dmaMigrateMut.mutate()}
            >
              {dmaMigrateMut.isPending ? t("common.loading") : t("maintenance.dmaRunMigrate")}
            </Button>
          </div>

          {dmaStagingMut.isError ? (
            <p className="text-sm text-destructive">{(dmaStagingMut.error as Error).message}</p>
          ) : null}
          {dmaStagingMut.isSuccess ? (
            <p className="text-sm text-emerald-600 dark:text-emerald-400">
              {t("maintenance.dmaStagingOk")} ({dmaStagingMut.data?.inserted ?? 0})
            </p>
          ) : null}

          {dmaMigrateMut.isError ? (
            <p className="text-sm text-destructive">{(dmaMigrateMut.error as Error).message}</p>
          ) : null}
          {dmaMigrateMut.isSuccess && dmaMigrateMut.data ? (
            <div className="space-y-1 text-sm">
              <p className="text-emerald-600 dark:text-emerald-400">
                {t("maintenance.dmaMigrateOk")} —{" "}
                {t("maintenance.dmaMigrateResult")
                  .replace("{migrated}", String(dmaMigrateMut.data.migrated))
                  .replace("{failed}", String(dmaMigrateMut.data.failed))}
              </p>
              {dmaMigrateMut.data.errors?.length ? (
                <ul className="list-disc ps-5 font-mono text-xs text-destructive">
                  {dmaMigrateMut.data.errors.slice(0, 10).map((e) => (
                    <li key={e.id}>
                      #{e.id}: {e.error}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Cloud className="h-5 w-5 text-muted-foreground" />
            <CardTitle>{t("maintenance.driveConnectIntro")}</CardTitle>
          </div>
          <CardDescription>{t("maintenance.driveCardSubtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-start">
          {driveQ.isLoading && !drive && summaryQ.isLoading ? (
            <p className="text-muted-foreground">{t("common.loading")}</p>
          ) : driveQ.isError && !drive ? (
            <p className="text-destructive">{(driveQ.error as Error).message}</p>
          ) : (
            <>
              <div className="rounded-lg border border-border/80 bg-muted/30 p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 text-muted-foreground leading-relaxed">
                  <li>{t("maintenance.driveStepEnv")}</li>
                  <li>{t("maintenance.driveStepEnvVars")}</li>
                  <li>{t("maintenance.driveStepRestart")}</li>
                </ol>
                <a
                  href="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  {t("maintenance.driveOpenConsole")} ↗
                </a>
                <p className="text-xs text-muted-foreground pt-1">{t("maintenance.driveServiceAccountHint")}</p>
              </div>

              {drive?.mode === "service_account" ? (
                <p className="text-emerald-700 dark:text-emerald-400 font-medium">{t("maintenance.driveModeSa")}</p>
              ) : null}

              <p>
                <span className="text-muted-foreground">{t("maintenance.modeLabel")}: </span>
                <span className="font-medium">
                  {drive?.mode === "service_account"
                    ? t("maintenance.driveModeSa")
                    : drive?.mode === "oauth"
                      ? t("maintenance.driveModeOAuth")
                      : t("maintenance.driveModeNone")}
                </span>
              </p>
              {drive?.email ? (
                <p>
                  <span className="text-muted-foreground">Google: </span>
                  <span className="font-mono text-xs">{drive.email}</span>
                </p>
              ) : null}
              {drive?.folder_id ? (
                <p>
                  <span className="text-muted-foreground">{t("maintenance.driveFolder")}: </span>
                  <code className="rounded bg-muted px-1 text-[11px]">{drive.folder_id}</code>
                </p>
              ) : null}

              {!drive?.oauth_configured && drive?.mode !== "service_account" ? (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-900 dark:text-amber-100">
                  {t("maintenance.driveOAuthMissing")}
                </div>
              ) : null}

              <p className="text-xs text-muted-foreground">{t("maintenance.driveAfterConnect")}</p>

              <div className="flex flex-wrap gap-2 pt-1">
                {showConnectOAuth ? (
                  <Button type="button" variant="default" size="default" onClick={() => authUrlMut.mutate()} disabled={authUrlMut.isPending}>
                    <Cloud className="me-2 h-4 w-4" />
                    {t("maintenance.driveConnect")}
                  </Button>
                ) : null}
                {drive?.mode === "oauth" && drive.connected ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => disconnectMut.mutate()} disabled={disconnectMut.isPending}>
                    {t("maintenance.driveDisconnect")}
                  </Button>
                ) : null}
              </div>
              {authUrlMut.isError ? <p className="text-destructive text-xs">{(authUrlMut.error as Error).message}</p> : null}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("maintenance.logTitle")}</CardTitle>
          <CardDescription>{t("maintenance.logHint")}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {listQ.isLoading && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
          {listQ.isError && <p className="text-sm text-destructive">{(listQ.error as Error).message}</p>}
          {listQ.data && (
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-end">
                  <th className="p-2">{t("maintenance.colDate")}</th>
                  <th className="p-2">{t("maintenance.colStatus")}</th>
                  <th className="p-2">{t("maintenance.colLocation")}</th>
                  <th className="p-2">{t("maintenance.colResult")}</th>
                  <th className="p-2">{t("maintenance.colFilename")}</th>
                  <th className="p-2">{t("maintenance.colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {listQ.data.items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-4 text-center text-muted-foreground">
                      {t("maintenance.empty")}
                    </td>
                  </tr>
                ) : (
                  listQ.data.items.map((r) => (
                    <tr key={r.id} className="border-b border-border/60">
                      <td className="p-2 whitespace-nowrap text-muted-foreground">{new Date(r.created_at).toLocaleString()}</td>
                      <td className="p-2">{statusLabel(t, r.status)}</td>
                      <td className="p-2">{locLabel(t, r.location)}</td>
                      <td className="p-2 max-w-[240px] truncate text-xs text-muted-foreground" title={r.error_message ?? ""}>
                        {r.status === "success" && r.error_message
                          ? r.error_message
                          : r.status === "failure"
                            ? r.error_message ?? "—"
                            : r.error_message
                              ? r.error_message
                              : "—"}
                      </td>
                      <td className="p-2 font-mono text-[11px]">{r.filename}</td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-1 justify-end">
                          {r.status === "success" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              type="button"
                              className="gap-1"
                              onClick={() => downloadBackupFile(r.id, r.filename)}
                            >
                              <Download className="h-3.5 w-3.5" />
                              {t("maintenance.downloadLocalCopy")}
                            </Button>
                          ) : r.status === "failure" ? (
                            <span className="text-xs text-muted-foreground">{t("maintenance.noFileToDownload")}</span>
                          ) : null}
                          {r.status === "success" ? (
                            <Button type="button" variant="destructive" size="sm" onClick={() => setRestoreId(r.id)}>
                              {t("maintenance.restore")}
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog open={restoreId !== null} onOpenChange={(o) => !o && setRestoreId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("maintenance.restoreConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("maintenance.restoreConfirmBody")}</DialogDescription>
          </DialogHeader>
          <label className="flex items-start gap-2 text-sm text-start">
            <input type="checkbox" checked={restoreAck} onChange={(e) => setRestoreAck(e.target.checked)} />
            <span>{t("maintenance.restoreConfirmCheckbox")}</span>
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRestoreId(null)}>
              {t("users.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!restoreAck || !restoreId || restoreMut.isPending}
              onClick={() => restoreId && restoreMut.mutate(restoreId)}
            >
              {t("maintenance.restoreRun")}
            </Button>
          </DialogFooter>
          {restoreMut.isError ? <p className="text-sm text-destructive">{(restoreMut.error as Error).message}</p> : null}
          {restoreMut.isSuccess ? <p className="text-sm text-emerald-600">{t("maintenance.restoreSuccess")}</p> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
