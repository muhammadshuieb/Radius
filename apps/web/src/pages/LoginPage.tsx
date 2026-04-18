import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Globe, Lock, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import type { Locale } from "@/lib/messages";
import { cn } from "@/lib/utils";

export function LoginPage() {
  const { login } = useAuth();
  const { t, locale, setLocale, dir } = useI18n();
  const nav = useNavigate();
  const [email, setEmail] = useState("admin@local.test");
  const [password, setPassword] = useState("Admin123!");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await login(email, password);
      toast.success(locale === "ar" ? "تم تسجيل الدخول" : "Signed in");
      nav("/");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : locale === "ar" ? "فشل الدخول" : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  function LangChip(l: Locale, label: string) {
    return (
      <button
        type="button"
        onClick={() => setLocale(l)}
        className={cn(
          "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
          locale === l
            ? "border-cyan-400/80 bg-cyan-500/20 text-cyan-100"
            : "border-white/20 bg-white/5 text-slate-300 hover:bg-white/10"
        )}
      >
        {label}
      </button>
    );
  }

  return (
    <div
      className="relative min-h-screen flex flex-col items-center justify-center p-6 overflow-hidden"
      dir={dir}
    >
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_hsl(210_80%_18%),_hsl(222_47%_8%)_55%,_hsl(222_50%_5%))]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M30 0L60 30L30 60L0 30z' fill='none' stroke='%23fff' stroke-width='0.5'/%3E%3C/svg%3E")`,
          backgroundSize: "48px 48px",
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 30%, rgba(56, 189, 248, 0.15) 0%, transparent 45%), radial-gradient(circle at 80% 70%, rgba(249, 115, 22, 0.12) 0%, transparent 40%)",
        }}
        aria-hidden
      />

      <div className="relative z-10 w-full max-w-md space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="text-orange-500">{t("nav.brandPrimary")}</span>{" "}
            <span className="text-white drop-shadow-sm">{t("nav.brandSecondary")}</span>
          </h1>
          <p className="text-sm text-slate-400">{t("nav.tagline")}</p>
        </div>

        <Card className="border border-white/15 bg-white/10 shadow-2xl shadow-black/40 backdrop-blur-xl">
          <CardHeader className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                <Globe className="h-3.5 w-3.5 opacity-80" />
                {t("login.langLabel")}
              </span>
              <div className="flex gap-2">
                {LangChip("ar", "العربية")}
                {LangChip("en", "English")}
              </div>
            </div>
            <div>
              <CardTitle className="text-2xl text-white">{t("login.title")}</CardTitle>
              <CardDescription className="mt-1.5 text-slate-400">{t("login.subtitle")}</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={onSubmit}>
              <div className="space-y-2">
                <Label htmlFor="email" className="text-slate-200">
                  {t("login.email")}
                </Label>
                <div className="relative">
                  <User className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <Input
                    id="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    className="border-white/15 bg-black/25 ps-10 text-white placeholder:text-slate-500"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-slate-200">
                  {t("login.password")}
                </Label>
                <div className="relative">
                  <Lock className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    className="border-white/15 bg-black/25 ps-10 text-white placeholder:text-slate-500"
                  />
                </div>
              </div>
              <Button
                type="submit"
                disabled={busy}
                className="w-full border-0 bg-cyan-500 text-white shadow-lg shadow-cyan-500/25 hover:bg-cyan-400 hover:text-white"
              >
                {busy ? t("login.signingIn") : t("login.submit")}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
