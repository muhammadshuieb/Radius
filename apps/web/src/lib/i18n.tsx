import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Locale } from "./messages";
import { translate } from "./messages";

const STORAGE_KEY = "prince_locale";

type I18nCtx = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (path: string) => string;
  dir: "rtl" | "ltr";
};

const Ctx = createContext<I18nCtx | null>(null);

function readStoredLocale(): Locale {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "ar" || v === "en") return v;
  } catch {
    /* ignore */
  }
  return "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() =>
    typeof window !== "undefined" ? readStoredLocale() : "en"
  );

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === "ar" ? "ar" : "en";
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  }, [locale]);

  const dir = locale === "ar" ? "rtl" : "ltr";
  const t = useCallback((path: string) => translate(locale, path), [locale]);

  const value = useMemo(() => ({ locale, setLocale, t, dir }), [locale, setLocale, t, dir]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const x = useContext(Ctx);
  if (!x) throw new Error("useI18n outside I18nProvider");
  return x;
}

export function getStoredLocale(): Locale {
  if (typeof window === "undefined") return "en";
  return readStoredLocale();
}
