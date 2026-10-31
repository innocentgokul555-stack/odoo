import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from '../src/App';
import { AuthProvider, ConfigProvider } from '../src/auth';
import { ToastProvider } from '../src/ui';
import { resetLookups } from '../src/lookups';

configure({ asyncUtilTimeout: 10000 });
const API = import.meta.env.VITE_API_URL;

async function tokenFor(email, password) {
  const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  return (await r.json()).token;
}
const tokens = {};
beforeAll(async () => {
  tokens.admin = await tokenFor('admin@brightloop.test', 'Admin@12345');
  tokens.staff = await tokenFor('staff@brightloop.test', 'Staff@12345');
  tokens.customer = await tokenFor('customer@brightloop.test', 'Customer@123');
});
afterEach(() => { cleanup(); localStorage.clear(); resetLookups(); });

function renderAt(path, role) {
  if (role) localStorage.setItem('odoo_token', tokens[role]);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ConfigProvider><AuthProvider><ToastProvider><App /></ToastProvider></AuthProvider></ConfigProvider>
    </MemoryRouter>
  );
}
const noErrors = () => expect(screen.queryByRole('alert')).toBeNull();

describe('every team page loads with real data', () => {
  const pages = [
    ['/', /Dashboard/, 'Revenue by month'],
    ['/subscriptions', /Subscriptions/, 'SUB-000001'],
    ['/subscriptions/new', /New subscription/, 'Product lines'],
    ['/subscriptions/1', /SUB-000001/, 'History'],
    ['/invoices', /Invoices/, /INV-0000\d\d/],
    ['/invoices/1', /INV-000001/, 'Billed to'],
    ['/payments', /Payments/, /Bank transfer|Card|Online|Cheque|Cash/],
    ['/customers', /Customers/, 'Acme Retail'],
    ['/products', /Products/, 'Business Suite'],
    ['/plans', /Plans/, 'Starter Monthly'],
    ['/templates', /Quotation templates/, 'Small Shop Starter'],
    ['/discounts', /Discounts/, /Volume seats/],
    ['/taxes', /Taxes/, 'Standard Tax 10%'],
    ['/payment-terms', /Payment terms/, 'Net 30 days'],
    ['/staff', /Staff/, 'Sam Sales'],
    ['/outbox', /Email outbox/, /Invoice INV-/],
  ];
  it.each(pages)('%s', async (path, heading, text) => {
    renderAt(path, 'admin');
    await screen.findByRole('heading', { level: 1, name: heading });
    const found = await screen.findAllByText(text);
    expect(found.length).toBeGreaterThan(0);
    noErrors();
  });
});

describe('dashboard answers the finance lead\'s questions', () => {
  it('shows active subscriptions, revenue, what is owed and overdue invoices', async () => {
    renderAt('/', 'admin');
    await screen.findByText('Active subscriptions');
    for (const label of ['Recurring revenue / month', 'Revenue collected', 'Still owed', 'Overdue']) expect(await screen.findByText(label)).toBeTruthy();
    expect(await screen.findByText('Overdue invoices')).toBeTruthy();
    expect(await screen.findByText(/Renewals in the next 30 days/)).toBeTruthy();
    // filters
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));
    await screen.findByText('Revenue by month');
    noErrors();
  });
});

describe('roles', () => {
  it('staff cannot open the admin-only Staff page and have no "New product" button', async () => {
    renderAt('/staff', 'staff');
    await screen.findByRole('heading', { level: 1, name: /Dashboard/ });
    cleanup();
    renderAt('/products', 'staff');
    await screen.findByText('Business Suite');
    expect(screen.queryByRole('button', { name: 'New product' })).toBeNull();
    expect(screen.getByText(/Only the admin can change products/)).toBeTruthy();
  });
  it('a customer is sent to the portal and cannot see team pages', async () => {
    renderAt('/subscriptions', 'customer');
    await screen.findByRole('heading', { level: 1, name: /Hello, Carla/ });
    expect(screen.getByText('Your subscriptions')).toBeTruthy();
    expect(screen.queryByText('Customers')).toBeNull();
  });
  it('visiting a page when signed out goes to sign in', async () => {
    renderAt('/invoices');
    await screen.findByRole('heading', { name: 'Sign in' });
  });
});

describe('customer portal', () => {
  it('shows only the customer\'s own subscriptions and invoices, and a subscription page', async () => {
    const user = userEvent.setup();
    renderAt('/portal', 'customer');
    await screen.findByText('Active subscriptions');
    const subs = await screen.findAllByText(/^SUB-\d{6}$/);
    expect(subs.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Bluebird Cafe')).toBeNull();
    await user.click(subs[0]);
    await screen.findByText('What is included');
    expect(screen.getByText('Details')).toBeTruthy();
    noErrors();
  });
  it('an invoice page shows the printable document', async () => {
    const user = userEvent.setup();
    renderAt('/portal/invoices', 'customer');
    const rows = await screen.findAllByText(/^INV-\d{6}$/);
    await user.click(rows[0]);
    await screen.findByText('Billed to');
    expect(screen.getByRole('button', { name: /Print/ })).toBeTruthy();
  });
  it('customer can pause a subscription whose plan allows it', async () => {
    const user = userEvent.setup();
    renderAt('/portal', 'customer');
    await screen.findByText('Active subscriptions');
    const sub = (await screen.findAllByRole('row')).find((r) => within(r).queryByText('Starter Monthly'));
    await user.click(within(sub).getByText(/^SUB-/));
    await user.click(await screen.findByRole('button', { name: 'Pause' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Pause' }));
    await screen.findByText(/This subscription is paused/);
    await user.click(await screen.findByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(screen.queryByText(/This subscription is paused/)).toBeNull());
  });
});

describe('sign up and forgot password', () => {
  it('shows the password rules and the server error for a weak password', async () => {
    const user = userEvent.setup();
    renderAt('/signup');
    await screen.findByRole('heading', { name: 'Create your account' });
    await user.type(screen.getByLabelText(/Full name/), 'Test Person');
    await user.type(screen.getByLabelText(/^Email/), 'weak@example.test');
    await user.type(screen.getByLabelText(/^Password/, { selector: 'input' }), 'abcdefghi');
    expect(screen.getByText(/An uppercase letter/).className).not.toContain('ok');
    expect(screen.getByText(/More than 8 characters/).className).toContain('ok');
    await user.type(screen.getByLabelText(/Confirm password/), 'abcdefghi');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await screen.findByText(/Password must contain an uppercase letter/);
  });
  it('creates an account with a strong password and lands in the portal', async () => {
    const user = userEvent.setup();
    renderAt('/signup');
    await screen.findByRole('heading', { name: 'Create your account' });
    await user.type(screen.getByLabelText(/Full name/), 'Nora New');
    await user.type(screen.getByLabelText(/^Email/), `nora${Date.now()}@example.test`);
    await user.type(screen.getByLabelText(/^Password/, { selector: 'input' }), 'Strong#Pass1');
    await user.type(screen.getByLabelText(/Confirm password/), 'Strong#Pass1');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await screen.findByRole('heading', { level: 1, name: /Hello, Nora/ });
  });
  it('rejects an email that is already registered', async () => {
    const user = userEvent.setup();
    renderAt('/signup');
    await user.type(await screen.findByLabelText(/Full name/), 'Dup');
    await user.type(screen.getByLabelText(/^Email/), 'customer@brightloop.test');
    await user.type(screen.getByLabelText(/^Password/, { selector: 'input' }), 'Strong#Pass1');
    await user.type(screen.getByLabelText(/Confirm password/), 'Strong#Pass1');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect((await screen.findAllByText(/already registered|already exists/)).length).toBeGreaterThanOrEqual(1);
  });
  it('forgot password sends a reset link', async () => {
    const user = userEvent.setup();
    renderAt('/forgot-password');
    await user.type(await screen.findByLabelText(/^Email/), 'customer@brightloop.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    await screen.findByText(/password reset link has been sent/);
    expect(await screen.findByText('Open the reset link')).toBeTruthy();
  });
  it('wrong password shows an error, demo buttons fill in the form', async () => {
    const user = userEvent.setup();
    renderAt('/login');
    await user.click(await screen.findByRole('button', { name: 'Fill in Admin' }));
    expect(screen.getByLabelText(/Email/).value).toBe('admin@brightloop.test');
    await user.clear(screen.getByLabelText(/Password/));
    await user.type(screen.getByLabelText(/Password/), 'WrongPass!1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('Incorrect email or password');
  });
});

describe('working through a real flow in the browser', () => {
  it('quotation template -> draft -> quotation -> confirmed -> active -> bill now creates an invoice', async () => {
    const user = userEvent.setup();
    renderAt('/subscriptions/new', 'admin');
    await screen.findByRole('heading', { name: 'New subscription' });
    await user.click(screen.getByLabelText('Customer'));
    await user.type(screen.getByLabelText('Customer'), 'Greenleaf');
    await user.click(await screen.findByRole('button', { name: /Grace Okafor/ }));
    const tpl = screen.getByLabelText(/Quotation template/);
    await user.selectOptions(tpl, screen.getByRole('option', { name: /Small Shop Starter/ }));
    await waitFor(() => expect(screen.getAllByLabelText('Product').length).toBe(2));
    await user.click(screen.getByRole('button', { name: 'Create draft' }));
    await screen.findByRole('heading', { level: 1, name: /SUB-\d{6}.*Draft/ });
    await user.click(screen.getByRole('button', { name: 'Send quotation' }));
    await screen.findByRole('heading', { level: 1, name: /Quotation/ });
    await user.click(screen.getByRole('button', { name: /Confirm \(customer accepted\)/ }));
    await screen.findByRole('heading', { level: 1, name: /Confirmed/ });
    await user.click(screen.getByRole('button', { name: 'Activate' }));
    await screen.findByRole('heading', { level: 1, name: /Active/ });
    await user.click(await screen.findByRole('button', { name: 'Create invoice now' }));
    const invoiceCells = await screen.findAllByText(/^INV-\d{6}$/);
    expect(invoiceCells.length).toBeGreaterThan(0);
    noErrors();
  });

  it('confirm an invoice, then record a part payment and the rest', async () => {
    const user = userEvent.setup();
    const list = await fetch(`${API}/api/invoices?status=draft&page_size=1`, { headers: { Authorization: `Bearer ${tokens.admin}` } }).then((r) => r.json());
    const draft = list.data[0];
    renderAt(`/invoices/${draft.id}`, 'admin');
    await screen.findByText('Billed to');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await user.click(await screen.findByRole('button', { name: 'Record payment' }));
    const dialog = await screen.findByRole('dialog');
    const amount = within(dialog).getByLabelText(/Amount/);
    await user.clear(amount);
    await user.type(amount, '1');
    await user.click(within(dialog).getByRole('button', { name: 'Save payment' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await screen.findByText('Payments received');
    await user.click(await screen.findByRole('button', { name: 'Record payment' }));
    const dialog2 = await screen.findByRole('dialog');
    await user.click(within(dialog2).getByRole('button', { name: 'Save payment' })); // default = remaining balance
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getAllByText('Paid').length).toBeGreaterThan(0));
  });

  it('admin can open the new product form and add a variant', async () => {
    const user = userEvent.setup();
    renderAt('/products', 'admin');
    await user.click(await screen.findByRole('button', { name: 'New product' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Name/), 'UI Test Product');
    await user.type(within(dialog).getByLabelText(/Sales price/), '100');
    await user.type(within(dialog).getByLabelText(/Cost price/), '40');
    await user.click(within(dialog).getByRole('button', { name: '+ Add a variant' }));
    await user.type(within(dialog).getByLabelText('Attribute'), 'Brand');
    await user.type(within(dialog).getByLabelText('Value'), 'Odoo');
    await user.clear(within(dialog).getByLabelText('Extra price'));
    await user.type(within(dialog).getByLabelText('Extra price'), '560');
    await user.click(within(dialog).getByRole('button', { name: 'Save product' }));
    await screen.findByText('UI Test Product');
    expect((await screen.findAllByText(/Odoo/)).length).toBeGreaterThanOrEqual(2);
  });

  it('run billing dialog reports what it did, and a second run creates nothing', async () => {
    const user = userEvent.setup();
    renderAt('/invoices', 'admin');
    await user.click(await screen.findByRole('button', { name: 'Run billing' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Create invoices now' }));
    await within(dialog).findByText(/invoice\(s\) created for/);
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await user.click(await screen.findByRole('button', { name: 'Run billing' }));
    const again = await screen.findByRole('dialog');
    await user.click(within(again).getByRole('button', { name: 'Create invoices now' }));
    const summary = await within(again).findByText(/invoice\(s\) created for/);
    expect(summary.textContent).toMatch(/^0 invoice\(s\) created for 0 subscription/);
  });
});
