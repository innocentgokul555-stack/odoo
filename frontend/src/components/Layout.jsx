import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth, useConfig } from '../auth';
import { Badge } from '../ui';

const Logo = () => (
  <svg width="20" height="20" viewBox="0 0 64 64" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" aria-hidden>
    <path d="M18 40a14 14 0 1 1 28 0" /><path d="M46 40l-6-6m6 6l6-6" />
  </svg>
);

const TEAM_NAV = [
  ['Overview', [['/', 'Dashboard']]],
  ['Sales', [['/subscriptions', 'Subscriptions'], ['/customers', 'Customers'], ['/templates', 'Quotation templates']]],
  ['Billing', [['/invoices', 'Invoices'], ['/payments', 'Payments']]],
  ['Catalogue', [['/products', 'Products'], ['/plans', 'Plans'], ['/discounts', 'Discounts'], ['/taxes', 'Taxes'], ['/payment-terms', 'Payment terms']]],
];
const ADMIN_NAV = ['Administration', [['/staff', 'Staff'], ['/outbox', 'Email outbox']]];
const PORTAL_NAV = [['Your account', [['/portal', 'Overview'], ['/portal/invoices', 'Invoices'], ['/portal/profile', 'Profile']]]];

export default function Layout({ portal }) {
  const { user, logout } = useAuth();
  const { company } = useConfig();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const nav = portal ? PORTAL_NAV : [...TEAM_NAV, ...(user.role === 'admin' ? [ADMIN_NAV] : [])];
  const initials = user.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="app" key={portal ? 'portal' : 'team'}>
      <aside className={`sidebar no-print ${open ? 'open' : ''}`} onClick={() => setOpen(false)}>
        <div className="brand"><span className="brand-logo"><Logo /></span>{company}</div>
        <nav className="nav">
          {nav.map(([section, items]) => (
            <div key={section}>
              <div className="nav-section">{section}</div>
              {items.map(([to, label]) => (
                <NavLink key={to} to={to} end={to === '/' || to === '/portal'} className={({ isActive }) => (isActive ? 'active' : '')}>{label}</NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-foot">Subscription management</div>
      </aside>
      <div className="main">
        <header className="topbar no-print">
          <button className="icon-btn menu-btn" onClick={() => setOpen((o) => !o)} aria-label="Menu">=</button>
          <span className="muted">{location.pathname === '/' ? 'Dashboard' : ''}</span>
          <div className="who">
            <Badge tone={user.role === 'admin' ? 'indigo' : user.role === 'staff' ? 'blue' : 'green'}>{user.role === 'customer' ? 'Customer' : user.role === 'admin' ? 'Admin' : 'Staff'}</Badge>
            <span className="avatar" aria-hidden>{initials}</span>
            <div><b>{user.name}</b><br /><small>{user.email}</small></div>
            <button className="btn btn-sm" onClick={logout}>Sign out</button>
          </div>
        </header>
        <main className="content"><Outlet /></main>
      </div>
    </div>
  );
}
