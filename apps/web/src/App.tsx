import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth, type Role } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { AccountingPage } from "@/pages/AccountingPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { InventoryPage } from "@/pages/InventoryPage";
import { LoginPage } from "@/pages/LoginPage";
import { MikroTikPage } from "@/pages/MikroTikPage";
import { NasPage } from "@/pages/NasPage";
import { PackagesPage } from "@/pages/PackagesPage";
import { StaffPage } from "@/pages/StaffPage";
import { UserDetailPage } from "@/pages/UserDetailPage";
import { UsersPage } from "@/pages/UsersPage";
import { FinanceTransactionsPage } from "@/pages/FinanceTransactionsPage";
import { NotificationsPage } from "@/pages/NotificationsPage";
import { WhatsAppPage } from "@/pages/WhatsAppPage";
import { AuditLogPage } from "@/pages/AuditLogPage";
import { MaintenancePage } from "@/pages/MaintenancePage";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const { t } = useI18n();
  if (loading) return <div className="p-8 text-muted-foreground">{t("common.loading")}</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  const { t } = useI18n();
  if (!user || !roles.includes(user.role)) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold">{t("common.forbidden")}</h1>
        <p className="text-muted-foreground">{t("common.forbiddenDesc")}</p>
      </div>
    );
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="users/:id" element={<UserDetailPage />} />
        <Route path="packages" element={<PackagesPage />} />
        <Route
          path="accounting"
          element={
            <RequireRole roles={["admin", "accountant", "viewer"]}>
              <AccountingPage />
            </RequireRole>
          }
        />
        <Route
          path="finance"
          element={
            <RequireRole roles={["admin", "accountant", "viewer"]}>
              <FinanceTransactionsPage />
            </RequireRole>
          }
        />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route
          path="inventory"
          element={
            <RequireRole roles={["admin", "accountant", "viewer"]}>
              <InventoryPage />
            </RequireRole>
          }
        />
        <Route
          path="staff"
          element={
            <RequireRole roles={["admin"]}>
              <StaffPage />
            </RequireRole>
          }
        />
        <Route
          path="audit"
          element={
            <RequireRole roles={["admin"]}>
              <AuditLogPage />
            </RequireRole>
          }
        />
        <Route
          path="maintenance"
          element={
            <RequireRole roles={["admin"]}>
              <MaintenancePage />
            </RequireRole>
          }
        />
        <Route
          path="mikrotik"
          element={
            <RequireRole roles={["admin"]}>
              <MikroTikPage />
            </RequireRole>
          }
        />
        <Route
          path="nas"
          element={
            <RequireRole roles={["admin"]}>
              <NasPage />
            </RequireRole>
          }
        />
        <Route path="whatsapp" element={<Navigate to="/whatsapp/link" replace />} />
        <Route
          path="whatsapp/:section"
          element={
            <RequireRole roles={["admin"]}>
              <WhatsAppPage />
            </RequireRole>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
