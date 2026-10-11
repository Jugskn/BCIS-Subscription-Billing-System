import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { useAuth } from "@/lib/auth";
import { LoginPage } from "@/pages/LoginPage";
import { LockScreen } from "@/pages/LockScreen";
import { AdministrationPage } from "@/pages/admin/AdministrationPage";
import { AuditLogPage } from "@/pages/admin/AuditLogPage";
import { BackupsPage } from "@/pages/admin/BackupsPage";
import { RolesPage } from "@/pages/admin/RolesPage";
import { SettingsPage } from "@/pages/admin/SettingsPage";
import { UsersPage } from "@/pages/admin/UsersPage";
import { AreasPage } from "@/pages/collections/AreasPage";
import { BatchDetailPage } from "@/pages/collections/BatchDetailPage";
import { BatchesPage } from "@/pages/collections/BatchesPage";
import { CollectorsPage } from "@/pages/collections/CollectorsPage";
import { RemittancePage } from "@/pages/collections/RemittancePage";
import { PlansPage } from "@/pages/services/PlansPage";
import { NewSubscriberPage } from "@/pages/subscribers/NewSubscriberPage";
import { ServiceAccountsPage } from "@/pages/subscribers/ServiceAccountsPage";
import { SubscriberProfilePage } from "@/pages/subscribers/SubscriberProfilePage";
import { SubscribersPage } from "@/pages/subscribers/SubscribersPage";
import { CurrentBillingPage } from "@/pages/billing/CurrentBillingPage";
import { GenerateBillingPage } from "@/pages/billing/GenerateBillingPage";
import { InvoiceDetailPage } from "@/pages/billing/InvoiceDetailPage";
import { InvoicesPage } from "@/pages/billing/InvoicesPage";
import { ReceivePaymentPage } from "@/pages/payments/ReceivePaymentPage";
import { PaymentHistoryPage } from "@/pages/payments/PaymentHistoryPage";
import { GCashVerificationPage } from "@/pages/payments/GCashVerificationPage";
import { ReceiptPrintPage } from "@/pages/payments/ReceiptPrintPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { ReportsHubPage } from "@/pages/reports/ReportsHubPage";
import {
  ArAgingReportPage,
  AuditReportPage,
  BillingVsCollectionReportPage,
  CollectionsReportPage,
  CollectorReportPage,
  LedgerReportPage,
  PaymentMethodsReportPage,
  ReversalsReportPage,
  RevenueReportPage,
  SubscriberMasterReportPage,
} from "@/pages/reports/report-pages";
import { SoaPrintPage } from "@/pages/print/SoaPrintPage";
import { RouteSheetPrintPage } from "@/pages/print/RouteSheetPrintPage";
import { AgingPage } from "@/pages/receivables/AgingPage";
import { OutstandingPage } from "@/pages/receivables/OutstandingPage";
import { OverduePage } from "@/pages/receivables/OverduePage";
import { SuspensionCandidatesPage } from "@/pages/receivables/SuspensionCandidatesPage";

function ProtectedRoutes() {
  const { user, locked, can } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (locked) return <LockScreen />;

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />

        <Route
          path="subscribers"
          element={
            can("subscriber.view") ? (
              <SubscribersPage />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="subscribers/new"
          element={
            can("subscriber.create") ? (
              <NewSubscriberPage />
            ) : (
              <Navigate to="/subscribers" replace />
            )
          }
        />
        <Route
          path="subscribers/:id"
          element={
            can("subscriber.view") ? (
              <SubscriberProfilePage />
            ) : (
              <Navigate to="/subscribers" replace />
            )
          }
        />
        <Route
          path="subscribers/service-accounts"
          element={
            can("subscriber.view") ? (
              <ServiceAccountsPage />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />

        <Route
          path="billing"
          element={
            can("billing.generate") ? (
              <CurrentBillingPage />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="billing/generate"
          element={
            can("billing.generate") ? (
              <GenerateBillingPage />
            ) : (
              <Navigate to="/billing" replace />
            )
          }
        />
        <Route
          path="billing/invoices"
          element={
            can("receivable.view") ? (
              <InvoicesPage />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="billing/invoices/:id"
          element={
            can("receivable.view") ? (
              <InvoiceDetailPage />
            ) : (
              <Navigate to="/billing/invoices" replace />
            )
          }
        />

        <Route path="payments" element={<Navigate to="/payments/receive" replace />} />
        <Route
          path="payments/receive"
          element={
            can("payment.create") ? (
              <ReceivePaymentPage />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="payments/history"
          element={
            can("receivable.view") ? (
              <PaymentHistoryPage />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="payments/gcash"
          element={
            can("gcash.verify") || can("payment.create") ? (
              <GCashVerificationPage />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="collections"
          element={<Navigate to="/collections/collectors" replace />}
        />
        <Route
          path="collections/collectors"
          element={
            can("collection.create") ? <CollectorsPage /> : <Navigate to="/" replace />
          }
        />
        <Route
          path="collections/areas"
          element={
            can("subscriber.view") ? (
              <AreasPage />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="collections/batches"
          element={
            can("collection.create") ? <BatchesPage /> : <Navigate to="/" replace />
          }
        />
        <Route
          path="collections/batches/:id"
          element={
            can("collection.create") ? <BatchDetailPage /> : <Navigate to="/" replace />
          }
        />
        <Route
          path="collections/remittance"
          element={
            can("collection.reconcile") ? <RemittancePage /> : <Navigate to="/" replace />
          }
        />

        <Route
          path="receivables"
          element={<Navigate to="/receivables/outstanding" replace />}
        />
        <Route
          path="receivables/outstanding"
          element={
            can("receivable.view") ? (
              <OutstandingPage />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="receivables/overdue"
          element={
            can("receivable.view") ? (
              <OverduePage />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="receivables/aging"
          element={
            can("receivable.view") ? (
              <AgingPage />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="receivables/suspension-candidates"
          element={
            can("receivable.view") ? (
              <SuspensionCandidatesPage />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />

        <Route
          path="services"
          element={
            can("service.manage") ? (
              <PlansPage />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="reports"
          element={
            can("report.view") ? (
              <ReportsHubPage />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="reports/collections"
          element={
            can("report.view") ? (
              <CollectionsReportPage />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="reports/payment-methods"
          element={
            can("report.view") ? (
              <PaymentMethodsReportPage />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="reports/billing-vs-collection"
          element={
            can("report.view") ? (
              <BillingVsCollectionReportPage />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="reports/revenue"
          element={
            can("report.view") ? (
              <RevenueReportPage />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="reports/ar-aging"
          element={
            can("report.view") ? (
              <ArAgingReportPage />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="reports/subscribers"
          element={
            can("report.view") ? (
              <SubscriberMasterReportPage />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="reports/ledger"
          element={
            can("report.view") ? (
              <LedgerReportPage />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="reports/collectors"
          element={
            can("report.view") ? (
              <CollectorReportPage />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="reports/reversals"
          element={
            can("report.view") ? (
              <ReversalsReportPage />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="reports/audit"
          element={
            can("audit.view") ? (
              <AuditReportPage />
            ) : (
              <Navigate to="/reports" replace />
            )
          }
        />

        <Route
          path="administration"
          element={
            can("user.manage") ||
            can("backup.create") ||
            can("settings.view") ||
            can("audit.view") ? (
              <AdministrationPage />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="administration/users"
          element={
            can("user.manage") ? <UsersPage /> : <Navigate to="/" replace />
          }
        />
        <Route
          path="administration/roles"
          element={
            can("user.manage") ||
            can("role.manage") ||
            can("settings.view") ? (
              <RolesPage />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="administration/settings"
          element={
            can("settings.view") ? (
              <SettingsPage />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="administration/audit"
          element={
            can("audit.view") ? <AuditLogPage /> : <Navigate to="/" replace />
          }
        />
        <Route
          path="administration/backups"
          element={
            can("backup.create") ? (
              <BackupsPage />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
      </Route>
      <Route
        path="payments/receipts/:id"
        element={
          can("receivable.view") ? (
            <ReceiptPrintPage />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route
        path="print/soa/:subscriberId"
        element={
          can("receivable.view") ? (
            <SoaPrintPage />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route
        path="print/route-sheet"
        element={
          can("report.view") ? (
            <RouteSheetPrintPage />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  const { ready, user } = useAuth();
  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        Loading…
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/" replace /> : <LoginPage />}
      />
      <Route path="/*" element={<ProtectedRoutes />} />
    </Routes>
  );
}
