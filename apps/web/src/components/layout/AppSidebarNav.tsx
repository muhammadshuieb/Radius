import { NavLink } from "react-router-dom";
import {
  Activity,
  Boxes,
  Building2,
  ChevronDown,
  ChevronRight,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  Link2,
  CalendarClock,
  ListChecks,
  Megaphone,
  Network,
  Radio,
  Database,
  Receipt,
  Bell,
  Banknote,
  Settings2,
  Shield,
  Users,
  Warehouse,
  ScrollText,
} from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { useAuth, type Role } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useTheme, type ThemeMode } from "@/lib/theme";
import { cn } from "@/lib/utils";

export type NavChild = { to: string; labelKey: string; icon: typeof Receipt; roles?: Role[] };

export type NavGroup = {
  id: string;
  labelKey: string;
  icon: typeof Building2;
  roles?: Role[];
  children: NavChild[];
};

export const topLinks: { to: string; labelKey: string; icon: typeof LayoutDashboard; roles?: Role[] }[] = [
  { to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { to: "/users", labelKey: "nav.users", icon: Users },
  { to: "/packages", labelKey: "nav.packages", icon: Boxes },
  { to: "/notifications", labelKey: "nav.notifications", icon: Bell },
  { to: "/maintenance", labelKey: "nav.maintenance", icon: Database, roles: ["admin"] },
];

export const navGroups: NavGroup[] = [
  {
    id: "finance",
    labelKey: "nav.groupFinance",
    icon: Building2,
    roles: ["admin", "accountant", "viewer"],
    children: [
      { to: "/accounting", labelKey: "nav.accounting", icon: Receipt },
      { to: "/finance", labelKey: "nav.financeLedger", icon: Banknote },
      { to: "/inventory", labelKey: "nav.inventory", icon: Warehouse },
    ],
  },
  {
    id: "whatsapp",
    labelKey: "nav.whatsappGroup",
    icon: MessageCircle,
    roles: ["admin"],
    children: [
      { to: "/whatsapp/link", labelKey: "nav.whatsappLink", icon: Link2 },
      { to: "/whatsapp/messages", labelKey: "nav.whatsappMessages", icon: CalendarClock },
      { to: "/whatsapp/broadcast", labelKey: "nav.whatsappBroadcast", icon: Megaphone },
      { to: "/whatsapp/delivery", labelKey: "nav.whatsappDelivery", icon: ListChecks },
    ],
  },
  {
    id: "system",
    labelKey: "nav.groupSystem",
    icon: Settings2,
    children: [
      { to: "/mikrotik", labelKey: "nav.mikrotik", icon: Radio, roles: ["admin"] },
      { to: "/nas", labelKey: "nav.nas", icon: Network, roles: ["admin"] },
      { to: "/staff", labelKey: "nav.staff", icon: Shield, roles: ["admin"] },
      { to: "/audit", labelKey: "nav.auditLog", icon: ScrollText, roles: ["admin"] },
    ],
  },
];

function roleOk(role: Role | undefined, allowed?: Role[]): boolean {
  if (!allowed?.length) return true;
  return !!role && allowed.includes(role);
}

function childVisible(c: NavChild, role: Role | undefined): boolean {
  return roleOk(role, c.roles);
}

function groupVisible(g: NavGroup, role: Role | undefined): boolean {
  if (g.roles?.length && !roleOk(role, g.roles)) return false;
  return g.children.some((c) => childVisible(c, role));
}

type AppSidebarNavProps = {
  collapsed: boolean;
  sidebarDark: boolean;
  open: Record<string, boolean>;
  setOpen: Dispatch<SetStateAction<Record<string, boolean>>>;
  wsState: "off" | "live" | "err";
  onNavClick?: () => void;
};

export function AppSidebarNav({ collapsed, sidebarDark, open, setOpen, wsState, onNavClick }: AppSidebarNavProps) {
  const { user, logout } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const { mode, setMode } = useTheme();
  const role = user?.role;
  const visibleGroups = navGroups.filter((g) => groupVisible(g, role));

  const navLinkClass = (isActive: boolean) =>
    cn(
      "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
      collapsed && "justify-center px-2",
      isActive
        ? sidebarDark
          ? "bg-primary/20 text-white shadow-inner ring-1 ring-primary/40"
          : "bg-primary text-primary-foreground shadow-md shadow-primary/20"
        : sidebarDark
          ? "text-slate-400 hover:bg-white/[0.06] hover:text-white"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
    );

  const subNavLinkClass = (isActive: boolean) =>
    cn(
      "relative flex items-center gap-2 rounded-lg py-2 ps-3 pe-2 text-sm transition-colors",
      collapsed && "justify-center px-2",
      isActive
        ? sidebarDark
          ? "bg-white/10 text-white font-semibold ring-1 ring-white/10"
          : "bg-primary/12 text-primary font-semibold"
        : sidebarDark
          ? "text-slate-500 hover:bg-white/5 hover:text-slate-200"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className={cn("flex shrink-0 items-center gap-3 px-1 pb-4", collapsed && "flex-col justify-center gap-2")}>
        <div
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl",
            sidebarDark ? "bg-white/10 text-white" : "bg-primary/15 text-primary"
          )}
        >
          <Activity className="h-5 w-5" />
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1 text-start">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-bold leading-tight tracking-tight">
                <span className="text-orange-500">{t("nav.brandPrimary")}</span>{" "}
                <span className={sidebarDark ? "text-white" : "text-foreground"}>{t("nav.brandSecondary")}</span>
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                  sidebarDark ? "bg-primary/90 text-white" : "bg-primary/15 text-primary"
                )}
              >
                {t("nav.erpBadge")}
              </span>
            </div>
            <div className={cn("text-xs", sidebarDark ? "text-slate-400" : "text-muted-foreground")}>{t("nav.tagline")}</div>
          </div>
        )}
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain py-1">
        {topLinks
          .filter((n) => roleOk(role, n.roles))
          .map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              onClick={onNavClick}
              title={collapsed ? t(n.labelKey) : undefined}
              className={({ isActive }) => cn(navLinkClass(isActive), "text-start")}
            >
              <span
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/5 transition-colors group-hover:bg-white/10",
                  collapsed && "h-10 w-10"
                )}
              >
                <n.icon className="h-[18px] w-[18px] opacity-95" />
              </span>
              <span className={cn("min-w-0 flex-1 truncate", collapsed && "sr-only")}>{t(n.labelKey)}</span>
            </NavLink>
          ))}

        {visibleGroups.map((g) => {
          const expanded = open[g.id] ?? false;
          const Icon = g.icon;
          const visibleChildren = g.children.filter((c) => childVisible(c, role));
          if (!visibleChildren.length) return null;
          return (
            <div key={g.id} className="pt-2">
              {collapsed ? (
                <div className="flex flex-col gap-1 border-t border-white/5 pt-2 first:border-t-0 first:pt-0">
                  <div className="flex justify-center py-1" title={t(g.labelKey)}>
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-slate-500">
                      <Icon className="h-4 w-4" />
                    </span>
                  </div>
                  {visibleChildren.map((c) => {
                    const CIcon = c.icon;
                    return (
                      <NavLink
                        key={c.to}
                        to={c.to}
                        end
                        onClick={onNavClick}
                        title={t(c.labelKey)}
                        className={({ isActive }) =>
                          cn(
                            "flex items-center justify-center rounded-lg p-2.5 text-sm transition-colors",
                            isActive
                              ? sidebarDark
                                ? "bg-primary/25 text-white ring-1 ring-primary/40"
                                : "bg-primary text-primary-foreground shadow-sm"
                              : sidebarDark
                                ? "text-slate-400 hover:bg-white/5 hover:text-white"
                                : "text-muted-foreground hover:bg-accent hover:text-foreground"
                          )
                        }
                      >
                        <CIcon className="h-[18px] w-[18px]" />
                      </NavLink>
                    );
                  })}
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setOpen((s) => ({ ...s, [g.id]: !expanded }))}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors text-start",
                      sidebarDark ? "text-slate-300 hover:bg-white/5" : "text-foreground hover:bg-accent"
                    )}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/5">
                      <Icon className="h-[18px] w-[18px] opacity-90" />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{t(g.labelKey)}</span>
                    <span className="text-slate-500 dark:text-slate-500">
                      {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </span>
                  </button>
                  {expanded && (
                    <div className="mt-1 space-y-0.5 border-s-2 border-white/5 ps-2 ms-1">
                      {visibleChildren.map((c) => {
                        const CIcon = c.icon;
                        return (
                          <NavLink
                            key={c.to}
                            to={c.to}
                            end
                            onClick={onNavClick}
                            className={({ isActive }) => cn(subNavLinkClass(isActive), "text-start")}
                          >
                            <CIcon className="h-4 w-4 shrink-0 opacity-85" />
                            <span className="min-w-0 flex-1 truncate">{t(c.labelKey)}</span>
                          </NavLink>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </nav>

      <div className="mt-auto shrink-0 space-y-3 border-t border-white/5 pt-3 text-sm dark:border-white/5">
        {!collapsed && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="flex flex-col gap-1 text-start">
              <span className={cn("text-[11px]", sidebarDark ? "text-slate-400" : "text-muted-foreground")}>{t("nav.theme")}</span>
              <select
                className={cn(
                  "w-full rounded-lg px-2 py-1.5 text-xs",
                  sidebarDark ? "border border-white/10 bg-black/30 text-slate-100" : "border border-input bg-background"
                )}
                value={mode}
                onChange={(e) => setMode(e.target.value as ThemeMode)}
              >
                <option value="light">{t("nav.themeLight")}</option>
                <option value="dark">{t("nav.themeDark")}</option>
                <option value="system">{t("nav.themeSystem")}</option>
              </select>
            </div>
            <div className="flex flex-col gap-1 text-start">
              <span className={cn("text-[11px]", sidebarDark ? "text-slate-400" : "text-muted-foreground")}>{t("nav.locale")}</span>
              <div className="flex gap-1">
                <Button type="button" size="sm" variant={locale === "ar" ? "default" : "outline"} className="flex-1 text-xs" onClick={() => setLocale("ar")}>
                  عربي
                </Button>
                <Button type="button" size="sm" variant={locale === "en" ? "default" : "outline"} className="flex-1 text-xs" onClick={() => setLocale("en")}>
                  EN
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className={cn("rounded-xl border px-3 py-2", sidebarDark ? "border-white/10 bg-black/15" : "border-border bg-muted/20")}>
          {!collapsed ? (
            <>
              <div className="truncate text-start text-sm font-medium">{user?.full_name || user?.email}</div>
              <div className={cn("text-[11px] capitalize text-start", sidebarDark ? "text-slate-400" : "text-muted-foreground")}>{user?.role}</div>
              {user?.role === "manager" && user.scope_city ? (
                <div className={cn("mt-0.5 text-[11px] text-start", sidebarDark ? "text-slate-500" : "text-muted-foreground")}>{user.scope_city}</div>
              ) : null}
              <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    wsState === "live" && "bg-emerald-500",
                    wsState === "err" && "bg-red-500",
                    wsState === "off" && "bg-muted-foreground"
                  )}
                />
                <span className="truncate">
                  {t("nav.realtime")} {wsState}
                </span>
              </div>
            </>
          ) : (
            <div className="flex justify-center" title={user?.full_name || user?.email}>
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  wsState === "live" && "bg-emerald-500",
                  wsState === "err" && "bg-red-500",
                  wsState === "off" && "bg-muted-foreground"
                )}
              />
            </div>
          )}
        </div>

        <Button
          variant="outline"
          size="sm"
          className={cn(
            "w-full gap-2 rounded-xl",
            collapsed && "justify-center px-0",
            sidebarDark && "border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white"
          )}
          onClick={logout}
          title={collapsed ? t("nav.signOut") : undefined}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && <span>{t("nav.signOut")}</span>}
        </Button>
      </div>
    </div>
  );
}
