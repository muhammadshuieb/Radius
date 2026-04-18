import { Outlet, useLocation } from "react-router-dom";
import { Menu, PanelLeftClose, PanelLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { useTheme, type ThemeMode } from "@/lib/theme";
import { wsUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AppSidebarNav } from "./AppSidebarNav";

const SIDEBAR_COLLAPSED_KEY = "layout_sidebar_collapsed";

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function AppLayout() {
  const location = useLocation();
  const { t, dir } = useI18n();
  const { resolved } = useTheme();
  const [wsState, setWsState] = useState<"off" | "live" | "err">("off");
  const [open, setOpen] = useState<Record<string, boolean>>({ finance: true, whatsapp: false, system: false });
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() =>
    typeof window !== "undefined" ? readSidebarCollapsed() : false
  );
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  useEffect(() => {
    const path = location.pathname;
    setOpen((s) => {
      const next = { ...s };
      if (path.startsWith("/accounting") || path.startsWith("/finance") || path.startsWith("/inventory")) next.finance = true;
      if (path.startsWith("/whatsapp")) next.whatsapp = true;
      if (path.startsWith("/mikrotik") || path.startsWith("/nas") || path.startsWith("/staff") || path.startsWith("/audit"))
        next.system = true;
      return next;
    });
  }, [location.pathname]);

  useEffect(() => {
    setMobileDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    const url = wsUrl("/ws");
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      setWsState("err");
      return;
    }
    ws.onopen = () => setWsState("live");
    ws.onerror = () => setWsState("err");
    ws.onclose = () => setWsState("off");
    return () => ws.close();
  }, []);

  const sidebarDark = resolved === "dark";
  const sidebarW = sidebarCollapsed ? "4.5rem" : "15rem";

  const asideShell = cn(
    "flex flex-col overflow-hidden border-e md:sticky md:top-0 md:h-[100dvh] md:max-h-[100dvh] md:self-start",
    "transition-[width] duration-300 ease-out",
    sidebarDark
      ? "border-white/[0.06] bg-[hsl(222_47%_8%)] text-slate-100"
      : "border-border bg-card text-card-foreground shadow-sm"
  );

  return (
    <div className="min-h-screen md:min-h-0 md:grid md:h-[100dvh] md:max-h-[100dvh] md:grid-cols-[minmax(0,auto)_1fr]" dir={dir}>
      {/* Mobile drawer backdrop */}
      {mobileDrawerOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
          aria-label={t("nav.closeMenu")}
          onClick={() => setMobileDrawerOpen(false)}
        />
      ) : null}

      {/* Mobile drawer (240px) */}
      <aside
        className={cn(
          asideShell,
          "fixed inset-y-0 z-50 flex h-[100dvh] w-[240px] flex-col p-4 transition-transform duration-300 ease-out md:hidden",
          "inset-inline-start-0 border-e",
          mobileDrawerOpen
            ? "translate-x-0 rtl:translate-x-0"
            : "pointer-events-none -translate-x-full rtl:translate-x-full"
        )}
        aria-hidden={!mobileDrawerOpen}
      >
        <AppSidebarNav
          collapsed={false}
          sidebarDark={sidebarDark}
          open={open}
          setOpen={setOpen}
          wsState={wsState}
          onNavClick={() => setMobileDrawerOpen(false)}
        />
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={cn(asideShell, "hidden min-h-0 flex-col p-4 md:flex")}
        style={{ width: sidebarW, minWidth: sidebarW }}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div
            className={cn(
              "mb-2 flex shrink-0 items-center pb-1",
              sidebarCollapsed ? "justify-center" : "justify-end"
            )}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "h-9 w-9 shrink-0 rounded-xl",
                sidebarDark ? "text-slate-400 hover:bg-white/10 hover:text-white" : "text-muted-foreground hover:bg-accent"
              )}
              onClick={() => setSidebarCollapsed((c) => !c)}
              title={sidebarCollapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
              aria-expanded={!sidebarCollapsed}
            >
              {sidebarCollapsed ? (
                <PanelLeft className={cn("h-4 w-4", dir === "rtl" && "rotate-180")} />
              ) : (
                <PanelLeftClose className={cn("h-4 w-4", dir === "rtl" && "rotate-180")} />
              )}
            </Button>
          </div>
          <AppSidebarNav
            collapsed={sidebarCollapsed}
            sidebarDark={sidebarDark}
            open={open}
            setOpen={setOpen}
            wsState={wsState}
          />
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-app-main md:max-h-[100dvh]">
        <header className="sticky top-0 z-30 flex shrink-0 items-center gap-3 border-b border-border/50 bg-app-main/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-app-main/90 md:hidden">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="shrink-0"
            onClick={() => setMobileDrawerOpen(true)}
            aria-label={t("nav.openMenu")}
            aria-expanded={mobileDrawerOpen}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1 text-start">
            <p className="truncate text-sm font-semibold text-foreground">
              <span className="text-orange-500">{t("nav.brandPrimary")}</span>{" "}
              <span className="text-muted-foreground">{t("nav.brandSecondary")}</span>
            </p>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-8 pt-4 md:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[min(1280px,100%)]">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
