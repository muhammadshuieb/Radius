import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiFetch, getToken } from "./api";

export type Role = "admin" | "accountant" | "viewer" | "manager";

type User = { id: string; email: string; full_name: string | null; role: Role; scope_city?: string | null };

type AuthState = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const t = getToken();
    if (!t) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await apiFetch<User>("/api/auth/me");
      setUser(me);
    } catch {
      localStorage.removeItem("token");
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await apiFetch<{ token: string; user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    localStorage.setItem("token", r.token);
    setUser(r.user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("token");
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, logout, refresh }),
    [user, loading, login, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside provider");
  return ctx;
}

export function canWriteBilling(role: Role | undefined) {
  return role === "admin" || role === "accountant";
}

export function isAdmin(role: Role | undefined) {
  return role === "admin";
}

export function isViewer(role: Role | undefined) {
  return role === "viewer";
}

/** MikroTik servers & tests — admins only (ops / infra). */
export function canManageMikroTik(role: Role | undefined) {
  return role === "admin";
}

/** Create subscribers, payments, invoices — admin + accountant. */
export function canCreateSubscribers(role: Role | undefined) {
  return role === "admin" || role === "accountant";
}

/** City-scoped manager: subscribers list only, no finance modules. */
export function isManager(role: Role | undefined) {
  return role === "manager";
}
