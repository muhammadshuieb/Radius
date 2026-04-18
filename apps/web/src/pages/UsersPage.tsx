import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Columns2, MoreHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import { CreateUserDialog } from "@/components/users/CreateUserDialog";
import { canCreateSubscribers, canWriteBilling, isAdmin, useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";

type Row = {
  id: string;
  username: string;
  package_name: string | null;
  pkg_speed_down: string | null;
  pkg_speed_up: string | null;
  speed_down_override: string | null;
  speed_up_override: string | null;
  data_remaining_gb: string | null;
  data_used_gb: string | null;
  expires_at: string | null;
  status: string;
  payment_status: string;
  profile_display_name: string | null;
  profile_phone: string | null;
  last_accounting_at: string | null;
  account_balance: string | null;
  radacct_in_gb: string | null;
  radacct_out_gb: string | null;
  /** Live from radacct when accounting enabled */
  subscriber_current_ip?: string | null;
  subscriber_is_online?: boolean;
  subscriber_nas_name?: string | null;
  subscriber_last_logout?: string | null;
  subscriber_session_start?: string | null;
  created_by_name?: string | null;
  created_at?: string;
};

type ListResp = { items: Row[]; total: number };
type Pkg = { id: string; name: string };

type ColKey =
  | "username"
  | "fullName"
  | "status"
  | "session"
  | "ip"
  | "nas"
  | "lastLogout"
  | "package"
  | "balance"
  | "expires"
  | "createdAt"
  | "createdBy"
  | "lastConn"
  | "usage"
  | "payment";

const ALL_COL_KEYS: ColKey[] = [
  "username",
  "fullName",
  "status",
  "session",
  "ip",
  "nas",
  "lastLogout",
  "package",
  "balance",
  "expires",
  "createdAt",
  "createdBy",
  "lastConn",
  "usage",
  "payment",
];

const COL_LABEL_KEYS: Record<ColKey, string> = {
  username: "users.list.colUsername",
  fullName: "users.list.colFullName",
  status: "users.columns.status",
  session: "users.list.colSessionStatus",
  ip: "users.list.colCurrentIp",
  nas: "users.list.colNas",
  lastLogout: "users.list.colLastLogout",
  package: "users.columns.package",
  balance: "users.list.colBalance",
  expires: "users.columns.expires",
  createdAt: "users.list.colCreatedAt",
  createdBy: "users.list.colCreatedBy",
  lastConn: "users.list.colLastConn",
  usage: "users.list.colUsage",
  payment: "users.columns.payment",
};

/** Matches GET /api/subscribers?sort= — only for columns we can sort server-side */
type SortField =
  | "username"
  | "expires_at"
  | "data_remaining_gb"
  | "created_at"
  | "status"
  | "payment_status"
  | "package_name"
  | "profile_display_name"
  | "last_accounting_at"
  | "created_by_name"
  | "account_balance";

const COL_SORT: Partial<Record<ColKey, SortField>> = {
  username: "username",
  fullName: "profile_display_name",
  status: "status",
  package: "package_name",
  balance: "account_balance",
  expires: "expires_at",
  createdAt: "created_at",
  createdBy: "created_by_name",
  lastConn: "last_accounting_at",
  usage: "data_remaining_gb",
  payment: "payment_status",
};

function defaultCols(): Record<ColKey, boolean> {
  return Object.fromEntries(ALL_COL_KEYS.map((k) => [k, true])) as Record<ColKey, boolean>;
}

function readCols(): Record<ColKey, boolean> {
  try {
    const raw = localStorage.getItem("users_table_columns");
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Record<ColKey, boolean>>;
      return { ...defaultCols(), ...parsed };
    }
    if (localStorage.getItem("users_table_compact") === "1") {
      return {
        ...defaultCols(),
        session: false,
        ip: false,
        nas: false,
        lastLogout: false,
        createdAt: false,
        createdBy: false,
        lastConn: false,
        usage: false,
      };
    }
  } catch {
    /* ignore */
  }
  return defaultCols();
}

const PAGE_SIZE_OPTIONS = [20, 50, 100, 250, 500] as const;

function statusVariant(s: string) {
  if (s === "active") return "success" as const;
  if (s === "expired") return "warn" as const;
  return "danger" as const;
}

function fmtNum(v: string | null | undefined, digits = 2) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

export function UsersPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [packageId, setPackageId] = useState("");
  const [negativeBalance, setNegativeBalance] = useState(false);
  const [expiresFrom, setExpiresFrom] = useState("");
  const [expiresTo, setExpiresTo] = useState("");
  const [payment, setPayment] = useState("");
  const [speed, setSpeed] = useState("");
  const [lowData, setLowData] = useState("");
  const [expiredOnly, setExpiredOnly] = useState(false);
  const [activeOnly, setActiveOnly] = useState(false);
  const [city, setCity] = useState("");
  const [sort, setSort] = useState<SortField>("username");
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoiceSubId, setInvoiceSubId] = useState<string | null>(null);
  const [invoiceTitle, setInvoiceTitle] = useState("");
  const [invoiceAmount, setInvoiceAmount] = useState("");
  const [waOpen, setWaOpen] = useState(false);
  const [waMsg, setWaMsg] = useState("");
  const [cols, setCols] = useState<Record<ColKey, boolean>>(readCols);
  const [colsDialogOpen, setColsDialogOpen] = useState(false);
  const [colsDraft, setColsDraft] = useState<Record<ColKey, boolean>>(readCols);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(() => {
    try {
      const v = Number(localStorage.getItem("users_page_size"));
      if (PAGE_SIZE_OPTIONS.includes(v as (typeof PAGE_SIZE_OPTIONS)[number])) return v as (typeof PAGE_SIZE_OPTIONS)[number];
    } catch {
      /* ignore */
    }
    return 50;
  });
  const [page, setPage] = useState(1);

  useEffect(() => {
    try {
      localStorage.setItem("users_table_columns", JSON.stringify(cols));
    } catch {
      /* ignore */
    }
  }, [cols]);

  useEffect(() => {
    try {
      localStorage.setItem("users_page_size", String(pageSize));
    } catch {
      /* ignore */
    }
  }, [pageSize]);

  function showCol(k: ColKey) {
    return cols[k] !== false;
  }

  function onHeaderSort(col: ColKey) {
    const field = COL_SORT[col];
    if (!field) {
      toast.message(t("users.list.sortNotAvailable"));
      return;
    }
    setSort((prevSort) => {
      if (prevSort === field) {
        setOrder((o) => (o === "asc" ? "desc" : "asc"));
        return prevSort;
      }
      setOrder("asc");
      return field;
    });
  }

  function openColumnsDialog() {
    setColsDraft({ ...cols });
    setColsDialogOpen(true);
  }

  function applyColumns() {
    setCols({ ...colsDraft });
    setColsDialogOpen(false);
  }

  const pkgs = useQuery({
    queryKey: ["packages-list"],
    queryFn: () => apiFetch<Pkg[]>("/api/packages"),
  });

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (search) p.set("search", search);
    if (status) p.set("status", status);
    if (packageId) p.set("package_id", packageId);
    if (negativeBalance) p.set("negative_balance", "true");
    if (expiresFrom) p.set("expires_from", new Date(expiresFrom).toISOString());
    if (expiresTo) p.set("expires_to", new Date(expiresTo).toISOString());
    if (payment) p.set("payment_status", payment);
    if (speed) p.set("speed", speed);
    if (lowData) p.set("low_data_gb", lowData);
    if (expiredOnly) p.set("expired_only", "true");
    if (activeOnly) p.set("active_only", "true");
    if (city.trim()) p.set("city", city.trim());
    p.set("sort", sort);
    p.set("order", order);
    p.set("limit", String(pageSize));
    p.set("offset", String((page - 1) * pageSize));
    return p.toString();
  }, [
    search,
    status,
    packageId,
    negativeBalance,
    expiresFrom,
    expiresTo,
    payment,
    speed,
    lowData,
    expiredOnly,
    activeOnly,
    city,
    sort,
    order,
    page,
    pageSize,
  ]);

  useEffect(() => {
    setPage(1);
  }, [
    search,
    status,
    packageId,
    negativeBalance,
    expiresFrom,
    expiresTo,
    payment,
    speed,
    lowData,
    expiredOnly,
    activeOnly,
    city,
    sort,
    order,
  ]);

  useEffect(() => {
    setPage(1);
  }, [pageSize]);

  const q = useQuery({
    queryKey: ["subscribers", qs],
    queryFn: () => apiFetch<ListResp>(`/api/subscribers?${qs}`),
  });

  const ids = Object.entries(selected)
    .filter(([, v]) => v)
    .map(([k]) => k);

  async function bulk(action: "disable" | "extend" | "reset_data") {
    if (!ids.length) return toast.message(t("users.list.selectOne"));
    try {
      await apiFetch("/api/subscribers/bulk", {
        method: "POST",
        body: JSON.stringify({ ids, action, extend_days: action === "extend" ? 30 : undefined }),
      });
      toast.success(t("users.list.bulkQueued"));
      setSelected({});
      void qc.invalidateQueries({ queryKey: ["subscribers"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  function openInvoice(subId: string, username: string) {
    setInvoiceSubId(subId);
    setInvoiceTitle(`${t("users.list.invoicePrefix")} ${username}`);
    setInvoiceAmount("");
    setInvoiceOpen(true);
  }

  async function submitInvoice() {
    if (!invoiceSubId) return;
    const amt = Number(invoiceAmount);
    if (!Number.isFinite(amt) || amt < 0) {
      toast.error(t("users.list.invoiceAmountInvalid"));
      return;
    }
    try {
      await apiFetch("/api/invoices", {
        method: "POST",
        body: JSON.stringify({
          subscriber_id: invoiceSubId,
          title: invoiceTitle || "Invoice",
          amount: amt,
          period: "one_time",
        }),
      });
      toast.success(t("users.list.invoiceCreated"));
      setInvoiceOpen(false);
      void qc.invalidateQueries({ queryKey: ["invoices"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  async function setSubscriberStatus(id: string, next: "active" | "disabled") {
    try {
      await apiFetch(`/api/subscribers/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      toast.success(next === "active" ? t("users.list.activated") : t("users.list.disabled"));
      void qc.invalidateQueries({ queryKey: ["subscribers"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  async function payRenew(id: string) {
    try {
      await apiFetch(`/api/subscribers/${id}/renew`, { method: "POST", body: JSON.stringify({}) });
      toast.success(t("users.list.payRenewOk"));
      void qc.invalidateQueries({ queryKey: ["subscribers"] });
      void qc.invalidateQueries({ queryKey: ["invoices"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("users.list.payRenewErr"));
    }
  }

  async function sendWaBroadcast() {
    if (!ids.length) {
      toast.message(t("users.list.selectOne"));
      return;
    }
    if (!waMsg.trim()) {
      toast.error(t("whatsapp.broadcastNeedMsg"));
      return;
    }
    try {
      await apiFetch("/api/whatsapp/broadcast", {
        method: "POST",
        body: JSON.stringify({ subscriber_ids: ids, message: waMsg.trim() }),
      });
      toast.success(t("users.waBroadcastOk"));
      setWaOpen(false);
      setWaMsg("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  function toggleSelectAllOnPage(checked: boolean) {
    if (!q.data?.items.length) return;
    setSelected((prev) => {
      const next = { ...prev };
      for (const r of q.data!.items) {
        next[r.id] = checked;
      }
      return next;
    });
  }

  async function resetTraffic(id: string) {
    try {
      await apiFetch("/api/subscribers/bulk", {
        method: "POST",
        body: JSON.stringify({ ids: [id], action: "reset_data" }),
      });
      toast.success(t("users.list.resetOk"));
      void qc.invalidateQueries({ queryKey: ["subscribers"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  const totalSubs = q.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalSubs / pageSize));
  const pageItems = q.data?.items ?? [];
  const allPageSelected =
    isAdmin(user?.role) && pageItems.length > 0 && pageItems.every((r) => selected[r.id]);
  const somePageSelected =
    isAdmin(user?.role) && pageItems.some((r) => selected[r.id]) && !allPageSelected;

  function SortTh({ colKey, children }: { colKey: ColKey; children: ReactNode }) {
    const sf = COL_SORT[colKey];
    const active = !!sf && sort === sf;
    return (
      <th
        className={cn(
          "p-2 text-start cursor-pointer select-none hover:bg-muted/60",
          !showCol(colKey) && "hidden",
          active && "text-primary font-medium"
        )}
        onClick={() => onHeaderSort(colKey)}
        scope="col"
      >
        <span className="inline-flex items-center gap-1">
          {children}
          {active ? (
            order === "asc" ? (
              <ArrowUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
            ) : (
              <ArrowDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
            )
          ) : null}
        </span>
      </th>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("users.title")}</h1>
          <p className="text-muted-foreground">{t("users.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canCreateSubscribers(user?.role) && <CreateUserDialog />}
          {isAdmin(user?.role) && (
            <>
              <Button variant="destructive" size="sm" onClick={() => void bulk("disable")}>
                {t("users.bulkDisable")}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => void bulk("extend")}>
                {t("users.bulkExtend")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void bulk("reset_data")}>
                {t("users.bulkReset")}
              </Button>
              <Button variant="default" size="sm" onClick={() => setWaOpen(true)} disabled={!ids.length}>
                {t("users.waBroadcastBtn")}
              </Button>
            </>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("users.filtersTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <div className="space-y-2">
            <Label>{t("users.list.searchLabel")}</Label>
            <Input
              placeholder={t("users.list.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("users.columns.status")}</Label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">{t("users.list.any")}</option>
              <option value="active">{t("users.list.statusActive")}</option>
              <option value="expired">{t("users.list.statusExpired")}</option>
              <option value="disabled">{t("users.list.statusDisabled")}</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label>{t("users.list.cityFilter")}</Label>
            <Input placeholder={t("users.list.cityPlaceholder")} value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t("users.columns.package")}</Label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={packageId}
              onChange={(e) => setPackageId(e.target.value)}
              disabled={pkgs.isLoading}
            >
              <option value="">{t("users.list.any")}</option>
              {pkgs.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label>{t("users.columns.payment")}</Label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={payment}
              onChange={(e) => setPayment(e.target.value)}
            >
              <option value="">{t("users.list.any")}</option>
              <option value="paid">{t("users.list.payPaid")}</option>
              <option value="unpaid">{t("users.list.payUnpaid")}</option>
              <option value="partial">{t("users.list.payPartial")}</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label>{t("users.list.expiresFrom")}</Label>
            <Input type="datetime-local" value={expiresFrom} onChange={(e) => setExpiresFrom(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t("users.list.expiresTo")}</Label>
            <Input type="datetime-local" value={expiresTo} onChange={(e) => setExpiresTo(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t("users.list.speed")}</Label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={speed}
              onChange={(e) => setSpeed(e.target.value)}
            >
              <option value="">{t("users.list.any")}</option>
              <option value="10M">10M</option>
              <option value="20M">20M</option>
              <option value="50M">50M</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label>{t("users.list.lowData")}</Label>
            <Input placeholder="5" value={lowData} onChange={(e) => setLowData(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t("users.list.sortBy")}</Label>
            <div className="flex flex-wrap gap-2">
              <select
                className="h-10 flex-1 min-w-[120px] rounded-md border border-input bg-background px-2 text-sm"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortField)}
              >
                <option value="username">{t("users.list.sortUser")}</option>
                <option value="profile_display_name">{t("users.list.sortFullName")}</option>
                <option value="status">{t("users.list.sortStatus")}</option>
                <option value="payment_status">{t("users.list.sortPayment")}</option>
                <option value="package_name">{t("users.list.sortPackage")}</option>
                <option value="account_balance">{t("users.list.sortBalance")}</option>
                <option value="expires_at">{t("users.list.sortExpires")}</option>
                <option value="data_remaining_gb">{t("users.list.sortData")}</option>
                <option value="created_at">{t("users.list.sortCreated")}</option>
                <option value="created_by_name">{t("users.list.sortCreatedBy")}</option>
                <option value="last_accounting_at">{t("users.list.sortLastConn")}</option>
              </select>
              <select
                className="h-10 w-24 rounded-md border border-input bg-background px-2 text-sm"
                value={order}
                onChange={(e) => setOrder(e.target.value as typeof order)}
              >
                <option value="asc">{t("users.list.asc")}</option>
                <option value="desc">{t("users.list.desc")}</option>
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-3 md:col-span-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={negativeBalance} onCheckedChange={(c) => setNegativeBalance(!!c)} />
              {t("users.list.filterNegativeBalance")}
            </label>
            <div className="flex flex-wrap items-end gap-4">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={expiredOnly} onCheckedChange={(c) => setExpiredOnly(!!c)} />
                {t("users.list.expiredOnly")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={activeOnly} onCheckedChange={(c) => setActiveOnly(!!c)} />
                {t("users.list.activeOnly")}
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>
              {t("users.directory")} ({totalSubs})
            </CardTitle>
            <Button type="button" variant="outline" size="sm" className="gap-2 shrink-0" onClick={openColumnsDialog}>
              <Columns2 className="h-4 w-4" />
              {t("users.columnsOpenBtn")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Label className="text-muted-foreground">{t("users.pageSizeLabel")}</Label>
                  <select
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value) as (typeof PAGE_SIZE_OPTIONS)[number])}
                  >
                    {PAGE_SIZE_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    {t("users.pagePrev")}
                  </Button>
                  <span className="text-muted-foreground tabular-nums">
                    {t("users.pageInfo")
                      .replace("{page}", String(page))
                      .replace("{totalPages}", String(totalPages))
                      .replace("{total}", String(totalSubs))}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    {t("users.pageNext")}
                  </Button>
                </div>
              </div>
              <div className="overflow-x-auto">
                {q.isLoading && (
                  <div className="space-y-2 py-4" aria-busy="true">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div key={i} className="h-10 rounded-md bg-muted/40 animate-pulse" />
                    ))}
                  </div>
                )}
                {q.isError && (
                  <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {(q.error as Error).message}
                  </div>
                )}
                {q.data && (
                  <table className="w-full min-w-[1500px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        {isAdmin(user?.role) && (
                          <th className="p-2 w-10">
                            <Checkbox
                              checked={allPageSelected ? true : somePageSelected ? "indeterminate" : false}
                              onCheckedChange={(c) => toggleSelectAllOnPage(c === true)}
                              aria-label={t("users.selectAllPage")}
                            />
                          </th>
                        )}
                        <th className="p-2 w-12 text-center tabular-nums font-medium text-muted-foreground" scope="col">
                          {t("users.list.colIndex")}
                        </th>
                        <SortTh colKey="username">{t("users.list.colUsername")}</SortTh>
                        <SortTh colKey="fullName">{t("users.list.colFullName")}</SortTh>
                        <SortTh colKey="status">{t("users.columns.status")}</SortTh>
                        <SortTh colKey="session">{t("users.list.colSessionStatus")}</SortTh>
                        <SortTh colKey="ip">{t("users.list.colCurrentIp")}</SortTh>
                        <SortTh colKey="nas">{t("users.list.colNas")}</SortTh>
                        <SortTh colKey="lastLogout">{t("users.list.colLastLogout")}</SortTh>
                        <SortTh colKey="package">{t("users.columns.package")}</SortTh>
                        <SortTh colKey="balance">{t("users.list.colBalance")}</SortTh>
                        <SortTh colKey="expires">{t("users.columns.expires")}</SortTh>
                        <SortTh colKey="createdAt">{t("users.list.colCreatedAt")}</SortTh>
                        <SortTh colKey="createdBy">{t("users.list.colCreatedBy")}</SortTh>
                        <SortTh colKey="lastConn">{t("users.list.colLastConn")}</SortTh>
                        <SortTh colKey="usage">{t("users.list.colUsage")}</SortTh>
                        <SortTh colKey="payment">{t("users.columns.payment")}</SortTh>
                        <th className="p-2 w-12" />
                      </tr>
                    </thead>
                    <tbody>
                      {q.data.items.map((r, rowIdx) => {
                  const rowNum = (page - 1) * pageSize + rowIdx + 1;
                  const down = r.speed_down_override || r.pkg_speed_down || "—";
                  const up = r.speed_up_override || r.pkg_speed_up || "—";
                  const bal = r.account_balance != null ? Number(r.account_balance) : 0;
                  const inG = r.radacct_in_gb != null ? Number(r.radacct_in_gb) : null;
                  const outG = r.radacct_out_gb != null ? Number(r.radacct_out_gb) : null;
                  const totalRad = inG != null && outG != null ? inG + outG : Number(r.data_used_gb ?? 0);
                  const usageLabel =
                    inG != null && outG != null
                      ? `↓${inG.toFixed(2)} ↑${outG.toFixed(2)} Σ${totalRad.toFixed(2)}`
                      : `Σ ${fmtNum(r.data_used_gb)}`;
                  return (
                    <tr key={r.id} className="border-b border-border/60 hover:bg-accent/40">
                      {isAdmin(user?.role) && (
                        <td className="p-2">
                          <Checkbox
                            checked={!!selected[r.id]}
                            onCheckedChange={(c) => setSelected((s) => ({ ...s, [r.id]: !!c }))}
                          />
                        </td>
                      )}
                      <td className="p-2 text-center tabular-nums text-muted-foreground">{rowNum}</td>
                      <td className={cn("p-2 font-medium", !showCol("username") && "hidden")}>
                        <Link className="text-primary hover:underline" to={`/users/${r.id}`}>
                          {r.username}
                        </Link>
                      </td>
                      <td className={cn("p-2 max-w-[140px] truncate", !showCol("fullName") && "hidden")} title={r.profile_display_name ?? ""}>
                        {r.profile_display_name ?? "—"}
                      </td>
                      <td className={cn("p-2", !showCol("status") && "hidden")}>
                        <Badge variant={statusVariant(r.status)}>
                          {r.status === "active"
                            ? t("users.list.statusActive")
                            : r.status === "expired"
                              ? t("users.list.statusExpired")
                              : t("users.list.statusDisabled")}
                        </Badge>
                      </td>
                      <td className={cn("p-2 whitespace-nowrap", !showCol("session") && "hidden")}>
                        <div className="flex flex-col gap-0.5">
                          <Badge variant={r.subscriber_is_online ? "success" : "secondary"} className="gap-1 w-fit font-normal">
                            <span aria-hidden>{r.subscriber_is_online ? "🟢" : "🔴"}</span>
                            {r.subscriber_is_online ? t("users.list.sessionOnline") : t("users.list.sessionOffline")}
                          </Badge>
                          {r.subscriber_is_online && r.subscriber_session_start ? (
                            <span className="text-[10px] text-muted-foreground font-mono">
                              {new Date(r.subscriber_session_start).toLocaleString()}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className={cn("p-2 font-mono text-xs", !showCol("ip") && "hidden")}>{r.subscriber_current_ip ?? "—"}</td>
                      <td className={cn("p-2 max-w-[120px] truncate", !showCol("nas") && "hidden")} title={r.subscriber_nas_name ?? ""}>
                        {r.subscriber_nas_name ?? "—"}
                      </td>
                      <td className={cn("p-2 text-muted-foreground whitespace-nowrap text-xs", !showCol("lastLogout") && "hidden")}>
                        {r.subscriber_last_logout ? new Date(r.subscriber_last_logout).toLocaleString() : "—"}
                      </td>
                      <td className={cn("p-2 max-w-[160px] truncate", !showCol("package") && "hidden")} title={r.package_name ?? ""}>
                        {r.package_name ?? "—"}
                      </td>
                      <td className={cn("p-2 font-mono text-xs", !showCol("balance") && "hidden")}>${bal.toFixed(2)}</td>
                      <td className={cn("p-2 text-muted-foreground whitespace-nowrap", !showCol("expires") && "hidden")}>
                        {r.expires_at ? new Date(r.expires_at).toLocaleString() : "—"}
                      </td>
                      <td className={cn("p-2 text-muted-foreground whitespace-nowrap text-xs", !showCol("createdAt") && "hidden")}>
                        {r.created_at ? new Date(r.created_at).toLocaleString() : "—"}
                      </td>
                      <td className={cn("p-2 max-w-[110px] truncate text-xs", !showCol("createdBy") && "hidden")} title={r.created_by_name ?? ""}>
                        {r.created_by_name ?? "—"}
                      </td>
                      <td className={cn("p-2 text-muted-foreground whitespace-nowrap text-xs", !showCol("lastConn") && "hidden")}>
                        {r.last_accounting_at ? new Date(r.last_accounting_at).toLocaleString() : "—"}
                      </td>
                      <td className={cn("p-2 text-xs text-muted-foreground", !showCol("usage") && "hidden")} title={`${down}/${up}`}>
                        {usageLabel}
                      </td>
                      <td className={cn("p-2", !showCol("payment") && "hidden")}>
                        <Badge variant={r.payment_status === "paid" ? "success" : "warn"}>
                          {r.payment_status === "paid"
                            ? t("users.list.payPaid")
                            : r.payment_status === "partial"
                              ? t("users.list.payPartial")
                              : t("users.list.payUnpaid")}
                        </Badge>
                      </td>
                      <td className="p-2 text-end">
                        <div className="flex items-center justify-end gap-1">
                          {canWriteBilling(user?.role) && (
                            <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={() => void payRenew(r.id)}>
                              {t("users.list.payRenew")}
                            </Button>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Actions">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-[12rem]">
                              <DropdownMenuItem asChild>
                                <Link to={`/users/${r.id}`}>{t("users.list.actionDetails")}</Link>
                              </DropdownMenuItem>
                              {canWriteBilling(user?.role) && (
                                <>
                                  <DropdownMenuItem
                                    onClick={() => void setSubscriberStatus(r.id, r.status === "active" ? "disabled" : "active")}
                                  >
                                    {r.status === "active" ? t("users.list.actionDisable") : t("users.list.actionActivate")}
                                  </DropdownMenuItem>
                                <DropdownMenuItem asChild>
                                  <Link to={`/users/${r.id}?tab=basic`}>{t("users.list.actionChangePackage")}</Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => openInvoice(r.id, r.username)}>
                                  {t("users.list.actionInvoice")}
                                </DropdownMenuItem>
                                {isAdmin(user?.role) && (
                                  <DropdownMenuItem onClick={() => void resetTraffic(r.id)}>
                                    {t("users.list.actionResetTraffic")}
                                  </DropdownMenuItem>
                                )}
                              </>
                            )}
                            {canWriteBilling(user?.role) && (
                              <DropdownMenuItem
                                onClick={async () => {
                                  try {
                                    const next = r.payment_status === "paid" ? "unpaid" : "paid";
                                    await apiFetch(`/api/subscribers/${r.id}/payment`, {
                                      method: "PATCH",
                                      body: JSON.stringify({ payment_status: next }),
                                    });
                                    toast.success(t("users.list.paymentToggled"));
                                    void qc.invalidateQueries({ queryKey: ["subscribers"] });
                                  } catch (e) {
                                    toast.error(e instanceof Error ? e.message : "Failed");
                                  }
                                }}
                              >
                                {t("users.togglePay")}
                              </DropdownMenuItem>
                            )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
              </div>
          </CardContent>
      </Card>

      <Dialog open={colsDialogOpen} onOpenChange={setColsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("users.columnsDialogTitle")}</DialogTitle>
            <DialogDescription>{t("users.columnsDialogHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ALL_COL_KEYS.map((key) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={colsDraft[key] !== false}
                  onCheckedChange={(c) => setColsDraft((prev) => ({ ...prev, [key]: c === true }))}
                />
                {t(COL_LABEL_KEYS[key])}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <button
              type="button"
              className="text-primary underline underline-offset-2 hover:text-primary/80"
              onClick={() => setColsDraft(defaultCols())}
            >
              {t("users.columnsSelectAll")}
            </button>
            <span className="text-muted-foreground">·</span>
            <button
              type="button"
              className="text-primary underline underline-offset-2 hover:text-primary/80"
              onClick={() =>
                setColsDraft(Object.fromEntries(ALL_COL_KEYS.map((k) => [k, false])) as Record<ColKey, boolean>)
              }
            >
              {t("users.columnsDeselectAll")}
            </button>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="outline" onClick={() => setColsDialogOpen(false)}>
              {t("users.columnsCancel")}
            </Button>
            <Button type="button" onClick={applyColumns}>
              {t("users.columnsApply")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={waOpen} onOpenChange={setWaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("users.waBroadcastTitle")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <p className="text-sm text-muted-foreground">
              {t("users.list.selectOne")} ({ids.length})
            </p>
            <div className="space-y-2">
              <Label>{t("users.waBroadcastMsg")}</Label>
              <textarea
                className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={waMsg}
                onChange={(e) => setWaMsg(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setWaOpen(false)}>
              {t("createUser.cancel")}
            </Button>
            <Button type="button" onClick={() => void sendWaBroadcast()}>{t("users.waBroadcastSend")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={invoiceOpen} onOpenChange={setInvoiceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("users.list.invoiceDialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-2">
              <Label>{t("users.list.invoiceTitle")}</Label>
              <Input value={invoiceTitle} onChange={(e) => setInvoiceTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t("users.list.invoiceAmount")}</Label>
              <Input type="number" min={0} step="0.01" value={invoiceAmount} onChange={(e) => setInvoiceAmount(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setInvoiceOpen(false)}>
              {t("createUser.cancel")}
            </Button>
            <Button type="button" onClick={() => void submitInvoice()}>{t("users.list.invoiceCreate")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
