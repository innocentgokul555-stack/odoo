import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { Spinner } from './ui';
import Layout from './components/Layout';
import { ForgotPassword, Login, ResetPassword, Signup, homeFor } from './pages/Auth';
import Dashboard from './pages/Dashboard';
import Subscriptions from './pages/Subscriptions';
import SubscriptionForm from './pages/SubscriptionForm';
import SubscriptionDetail from './pages/SubscriptionDetail';
import Invoices from './pages/Invoices';
import InvoiceDetail from './pages/InvoiceDetail';
import Payments from './pages/Payments';
import Customers from './pages/Customers';
import Products from './pages/Products';
import Plans from './pages/Plans';
import Templates from './pages/Templates';
import Discounts from './pages/Discounts';
import { Taxes, PaymentTerms } from './pages/Simple';
import Staff from './pages/Staff';
import Outbox from './pages/Outbox';
import { PortalHome, PortalInvoice, PortalInvoices, PortalProfile, PortalSubscription } from './pages/Portal';

function Guard({ roles, children }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (!roles.includes(user.role)) return <Navigate to={homeFor(user)} replace />;
  return children;
}

function NotFound() {
  const { user } = useAuth();
  return (
    <div className="auth-panel" style={{ minHeight: '100vh' }}>
      <div className="auth-card">
        <h2>Page not found</h2>
        <p className="muted">The page you are looking for does not exist.</p>
        <Link to={user ? homeFor(user) : '/login'}>Go to the start page</Link>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      <Route element={<Guard roles={['admin', 'staff']}><Layout /></Guard>}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/subscriptions" element={<Subscriptions />} />
        <Route path="/subscriptions/new" element={<SubscriptionForm />} />
        <Route path="/subscriptions/:id" element={<SubscriptionDetail />} />
        <Route path="/subscriptions/:id/edit" element={<SubscriptionForm />} />
        <Route path="/invoices" element={<Invoices />} />
        <Route path="/invoices/:id" element={<InvoiceDetail />} />
        <Route path="/payments" element={<Payments />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/products" element={<Products />} />
        <Route path="/plans" element={<Plans />} />
        <Route path="/templates" element={<Templates />} />
        <Route path="/discounts" element={<Discounts />} />
        <Route path="/taxes" element={<Taxes />} />
        <Route path="/payment-terms" element={<PaymentTerms />} />
        <Route path="/staff" element={<Guard roles={['admin']}><Staff /></Guard>} />
        <Route path="/outbox" element={<Guard roles={['admin']}><Outbox /></Guard>} />
      </Route>

      <Route element={<Guard roles={['customer']}><Layout portal /></Guard>}>
        <Route path="/portal" element={<PortalHome />} />
        <Route path="/portal/subscriptions/:id" element={<PortalSubscription />} />
        <Route path="/portal/invoices" element={<PortalInvoices />} />
        <Route path="/portal/invoices/:id" element={<PortalInvoice />} />
        <Route path="/portal/profile" element={<PortalProfile />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
