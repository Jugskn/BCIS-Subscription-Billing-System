import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { useAuth } from "@/lib/auth";
import { LoginPage } from "@/pages/LoginPage";
import { LockScreen } from "@/pages/LockScreen";
import { PlaceholderPage } from "@/pages/PlaceholderPage";
import { AdministrationPage } from "@/pages/admin/AdministrationPage";
import { UsersPage } from "@/pages/admin/UsersPage";

function Placeholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return <PlaceholderPage title={title} description={description} />;
}

function ProtectedRoutes() {
  const { user, locked, can } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (locked) return <LockScreen />;

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route
          index
          element={
            <Placeholder
              title="Dashboard"
              description="Operational overview will appear here."
            />
          }
        />

        <Route
          path="subscribers"
          element={
            <Placeholder
              title="Subscribers"
              description="All subscribers."
            />
          }
        />
        <Route
          path="subscribers/new"
          element={
            <Placeholder
              title="New Subscriber"
              description="Create a subscriber record."
            />
          }
        />
        <Route
          path="subscribers/service-accounts"
          element={
            <Placeholder
              title="Service Accounts"
              description="Service accounts across subscribers."
            />
          }
        />

        <Route
          path="billing"
          element={
            <Placeholder
              title="Current Billing"
              description="Current billing cycle overview."
            />
          }
        />
        <Route
          path="billing/generate"
          element={
            <Placeholder
              title="Generate Billing"
              description="Generate monthly invoices."
            />
          }
        />
        <Route
          path="billing/invoices"
          element={
            <Placeholder
              title="Invoices"
              description="Invoice list and void workflows."
            />
          }
        />

        <Route path="payments" element={<Navigate to="/payments/receive" replace />} />
        <Route
          path="payments/receive"
          element={
            <Placeholder
              title="Receive Payment"
              description="Cashier payment posting."
            />
          }
        />
        <Route
          path="payments/history"
          element={
            <Placeholder
              title="Payment History"
              description="Posted payment history."
            />
          }
        />
        <Route
          path="payments/gcash"
          element={
            <Placeholder
              title="GCash Verification"
              description="Verify or reject GCash proofs."
            />
          }
        />

        <Route
          path="collections"
          element={<Navigate to="/collections/collectors" replace />}
        />
        <Route
          path="collections/collectors"
          element={
            <Placeholder
              title="Collectors"
              description="Collector assignments."
            />
          }
        />
        <Route
          path="collections/areas"
          element={
            <Placeholder
              title="Areas & Routes"
              description="Collection areas and routes."
            />
          }
        />
        <Route
          path="collections/batches"
          element={
            <Placeholder
              title="Collection Batches"
              description="House-to-house collection batches."
            />
          }
        />
        <Route
          path="collections/remittance"
          element={
            <Placeholder
              title="Remittance"
              description="Collector remittance and reconciliation."
            />
          }
        />

        <Route
          path="receivables"
          element={<Navigate to="/receivables/outstanding" replace />}
        />
        <Route
          path="receivables/outstanding"
          element={
            <Placeholder
              title="Outstanding Receivables"
              description="Open balances."
            />
          }
        />
        <Route
          path="receivables/overdue"
          element={
            <Placeholder
              title="Overdue"
              description="Overdue accounts and follow-up."
            />
          }
        />
        <Route
          path="receivables/aging"
          element={
            <Placeholder
              title="AR Aging"
              description="Aging buckets by days past due."
            />
          }
        />
        <Route
          path="receivables/suspension-candidates"
          element={
            <Placeholder
              title="Suspension Candidates"
              description="Accounts approaching suspension."
            />
          }
        />

        <Route
          path="services"
          element={
            <Placeholder
              title="Services"
              description="Plans and technician service work."
            />
          }
        />
        <Route
          path="reports"
          element={
            <Placeholder
              title="Reports"
              description="Operational and financial reports."
            />
          }
        />

        <Route
          path="administration"
          element={
            can("user.manage") ? (
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
      </Route>
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
