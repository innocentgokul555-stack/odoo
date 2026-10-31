import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useFetch, useQueryState } from '../hooks';
import { fdate, PERIOD_LABEL, PERIOD_UNIT, todayStr } from '../format';
import InvoiceDocument from '../components/InvoiceDocument';
import { Button, Card, ErrorBox, Modal, Notice, Page, Pagination, Spinner, Stat, StatusBadge, Table, TextField, AreaField, useForm, useMoney, useToast } from '../ui';

const ACTIONS = {
  pause: { label: 'Pause', text: 'Pause this subscription? You will not be invoiced while it is paused, and your term is extended when you resume.' },
  resume: { label: 'Resume', primary: true },
  renew: { label: 'Renew', text: 'Renew this subscription for another term?' },
  close: { label: 'Close subscription', danger: true, text: 'Close this subscription? You will not be invoiced again after it closes.' },
};

function SubscriptionTable({ rows, onOpen }) {
  const m = useMoney();
  return (
    <Table
      rows={rows}
      empty="You do not have any subscriptions yet."
      onRowClick={onOpen}
      columns={[
        { key: 'number', label: 'Subscription', render: (r) => <b>{r.number}</b> },
        { key: 'plan_name', label: 'Plan', render: (r) => <>{r.plan_name}<br /><small>{PERIOD_LABEL[r.billing_period]}</small></> },
        { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} paused={r.is_paused} /> },
        { key: 'next', label: 'Next invoice', render: (r) => (r.status === 'active' && !r.is_paused ? fdate(r.next_invoice_date) : '-') },
        { key: 'expiry_date', label: 'Ends', render: (r) => fdate(r.expiry_date) },
        { key: 'recurring_total', label: `Per cycle`, align: 'right', render: (r) => <span className="num">{m(r.recurring_total)}</span> },
      ]}
    />
  );
}

function InvoiceTable({ rows, onOpen }) {
  const m = useMoney();
  return (
    <Table
      rows={rows}
      empty="No invoices to show."
      onRowClick={onOpen}
      columns={[
        { key: 'number', label: 'Invoice', render: (r) => <b>{r.number}</b> },
        { key: 'invoice_date', label: 'Date', render: (r) => fdate(r.invoice_date) },
        { key: 'due_date', label: 'Due', render: (r) => <>{fdate(r.due_date)}{r.overdue && <><br /><small className="tone-red">{r.days_overdue} days late</small></>}</> },
        { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status === 'confirmed' ? 'confirmed' : r.status} overdue={r.overdue} /> },
        { key: 'total', label: 'Total', align: 'right', render: (r) => <span className="num">{m(r.total)}</span> },
        { key: 'balance', label: 'To pay', align: 'right', render: (r) => <b className="num">{r.status === 'confirmed' ? m(r.balance) : '-'}</b> },
      ]}
    />
  );
}

export function PortalHome() {
  const m = useMoney();
  const navigate = useNavigate();
  const { user } = useAuth();
  const summary = useFetch(() => api('/portal/summary'), []);
  const subs = useFetch(() => api('/portal/subscriptions'), []);
  const invoices = useFetch(() => api('/portal/invoices', { params: { page_size: 6 } }), []);
  const s = summary.data;
  return (
    <Page title={`Hello, ${user.name.split(' ')[0]}`} subtitle="Your subscriptions and invoices.">
      <ErrorBox>{summary.error || subs.error || invoices.error}</ErrorBox>
      {s && (
        <div className="grid grid-4" style={{ marginBottom: 18 }}>
          <Stat label="Active subscriptions" value={s.active_subscriptions} sub={s.pending_subscriptions ? `${s.pending_subscriptions} waiting to start` : undefined} />
          <Stat label="To pay" value={m(s.outstanding)} tone={s.outstanding ? 'amber' : undefined} to="/portal/invoices" />
          <Stat label="Overdue invoices" value={s.overdue_count} tone={s.overdue_count ? 'red' : undefined} />
          <Stat label="Paid invoices" value={s.paid_invoices} tone="green" />
        </div>
      )}
      <Card title="Your subscriptions" pad={false}>
        {subs.loading && !subs.data ? <Spinner /> : <SubscriptionTable rows={subs.data && subs.data.data} onOpen={(r) => navigate(`/portal/subscriptions/${r.id}`)} />}
      </Card>
      <Card title="Recent invoices" pad={false} actions={<Link to="/portal/invoices">See all</Link>}>
        {invoices.loading && !invoices.data ? <Spinner /> : <InvoiceTable rows={invoices.data && invoices.data.data} onOpen={(r) => navigate(`/portal/invoices/${r.id}`)} />}
      </Card>
    </Page>
  );
}

export function PortalSubscription() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const m = useMoney();
  const { data: sub, loading, error, reload } = useFetch(() => api(`/portal/subscriptions/${id}`), [id]);
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  if (loading && !sub) return <Spinner />;
  if (error) return <ErrorBox onRetry={reload}>{error}</ErrorBox>;

  const act = async (action) => {
    setBusy(action); setConfirming(null); setActionError('');
    try { await api(`/portal/subscriptions/${id}/${action}`, { method: 'POST', body: {} }); toast.success('Done'); reload(); } catch (e) { setActionError(e.message); } finally { setBusy(''); }
  };
  const available = sub.allowed_actions.filter((a) => ACTIONS[a]);

  return (
    <Page
      title={<>{sub.number} <StatusBadge status={sub.status} paused={sub.is_paused} /></>}
      subtitle={`${sub.plan_name} - billed ${PERIOD_LABEL[sub.billing_period].toLowerCase()}`}
      actions={available.map((a) => (
        <Button key={a} variant={ACTIONS[a].primary ? 'primary' : ACTIONS[a].danger ? 'danger' : 'secondary'} loading={busy === a} onClick={() => (ACTIONS[a].text ? setConfirming(a) : act(a))}>{ACTIONS[a].label}</Button>
      ))}
    >
      <ErrorBox>{actionError}</ErrorBox>
      {sub.is_paused && <Notice tone="warn">This subscription is paused. You will not be invoiced until you resume it.</Notice>}
      {sub.status === 'active' && available.length === 0 && <Notice>This plan cannot be paused, closed early or renewed online. Please contact us if you need a change.</Notice>}
      <Card title="Details">
        <dl className="kv">
          <div><dt>Started</dt><dd>{fdate(sub.start_date)}</dd></div>
          <div><dt>Ends</dt><dd>{fdate(sub.expiry_date)}<br /><small>{sub.auto_close ? 'Closes automatically' : 'Renews itself'}</small></dd></div>
          <div><dt>Next invoice</dt><dd>{sub.status === 'active' && !sub.is_paused ? fdate(sub.next_invoice_date) : '-'}</dd></div>
          <div><dt>Payment terms</dt><dd>{sub.payment_term_name || 'Immediate payment'}</dd></div>
          <div><dt>Cost per {PERIOD_UNIT[sub.billing_period]}</dt><dd><b>{m(sub.totals.total)}</b> <small>incl. tax</small></dd></div>
        </dl>
      </Card>
      <Card title="What is included" pad={false}>
        <Table
          rows={sub.lines}
          empty="Only the plan fee."
          columns={[
            { key: 'description', label: 'Product' },
            { key: 'quantity', label: 'Qty', align: 'right' },
            { key: 'unit_price', label: 'Unit price', align: 'right', render: (r) => <span className="num">{m(r.unit_price)}</span> },
            { key: 'amount', label: 'Amount', align: 'right', render: (r) => <span className="num">{m(r.amount)}</span> },
          ]}
        />
      </Card>
      <Card title="Invoices" pad={false}>
        <Table
          rows={sub.invoices}
          empty="No invoices yet."
          onRowClick={(r) => navigate(`/portal/invoices/${r.id}`)}
          columns={[
            { key: 'number', label: 'Invoice', render: (r) => <b>{r.number}</b> },
            { key: 'period', label: 'Period', render: (r) => `${fdate(r.period_start)} - ${fdate(r.period_end)}` },
            { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} overdue={r.status === 'confirmed' && r.due_date < todayStr()} /> },
            { key: 'total', label: 'Total', align: 'right', render: (r) => <span className="num">{m(r.total)}</span> },
          ]}
        />
      </Card>
      {confirming && (
        <Modal title={ACTIONS[confirming].label} onClose={() => setConfirming(null)}
          footer={<><Button onClick={() => setConfirming(null)}>Not now</Button><Button variant={ACTIONS[confirming].danger ? 'danger' : 'primary'} onClick={() => act(confirming)}>{ACTIONS[confirming].label}</Button></>}>
          <p style={{ margin: 0 }}>{ACTIONS[confirming].text}</p>
        </Modal>
      )}
    </Page>
  );
}

export function PortalInvoices() {
  const navigate = useNavigate();
  const [q, setQ] = useQueryState({ status: '', page: '1' });
  const { data, loading, error, reload } = useFetch(() => api('/portal/invoices', { params: { status: q.status, page: q.page, page_size: 15 } }), [q.status, q.page]);
  const tabs = [['', 'All'], ['outstanding', 'To pay'], ['overdue', 'Overdue'], ['paid', 'Paid']];
  return (
    <Page title="Your invoices">
      <div className="tabs">{tabs.map(([v, l]) => <button key={v} className={`tab ${q.status === v ? 'active' : ''}`} onClick={() => setQ({ status: v })}>{l}</button>)}</div>
      <Card pad={false}>
        <ErrorBox onRetry={reload}>{error}</ErrorBox>
        {loading && !data ? <Spinner /> : <InvoiceTable rows={data && data.data} onOpen={(r) => navigate(`/portal/invoices/${r.id}`)} />}
      </Card>
      <Pagination meta={data && data.meta} onPage={(p) => setQ({ page: String(p) })} />
    </Page>
  );
}

export function PortalInvoice() {
  const { id } = useParams();
  const { data: inv, loading, error, reload } = useFetch(() => api(`/portal/invoices/${id}`), [id]);
  if (loading && !inv) return <Spinner />;
  if (error) return <ErrorBox onRetry={reload}>{error}</ErrorBox>;
  return (
    <Page title={inv.number} subtitle={<Link to="/portal/invoices">Back to invoices</Link>} actions={<Button variant="primary" onClick={() => window.print()}>Print / save as PDF</Button>}>
      <InvoiceDocument invoice={inv} />
    </Page>
  );
}

export function PortalProfile() {
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const form = useForm({ name: user.name, company: user.company || '', phone: user.phone || '', address: user.address || '' });
  const pw = useForm({ current_password: '', new_password: '' });
  return (
    <Page title="Your profile" subtitle={user.email}>
      <Card title="Contact details">
        <form noValidate onSubmit={(e) => { e.preventDefault(); form.submit(async (v) => { const u = await api('/portal/profile', { method: 'PUT', body: v }); updateUser(u); toast.success('Profile saved'); }); }}>
          <ErrorBox>{form.formError}</ErrorBox>
          <div className="form-grid">
            <TextField label="Full name" required {...form.bind('name')} />
            <TextField label="Company" {...form.bind('company')} />
            <TextField label="Phone" {...form.bind('phone')} />
          </div>
          <AreaField label="Billing address (shown on invoices)" {...form.bind('address')} />
          <Button variant="primary" type="submit" loading={form.saving}>Save</Button>
        </form>
      </Card>
      <Card title="Change password">
        <form noValidate onSubmit={(e) => { e.preventDefault(); pw.submit(async (v) => { await api('/auth/change-password', { method: 'POST', body: v }); pw.setValues({ current_password: '', new_password: '' }); toast.success('Password updated'); }); }}>
          <ErrorBox>{pw.formError}</ErrorBox>
          <div className="form-grid">
            <TextField label="Current password" type="password" autoComplete="current-password" {...pw.bind('current_password')} />
            <TextField label="New password" type="password" autoComplete="new-password" {...pw.bind('new_password')} hint="More than 8 characters, with an uppercase letter, a lowercase letter and a special character" />
          </div>
          <Button type="submit" loading={pw.saving}>Update password</Button>
        </form>
      </Card>
    </Page>
  );
}
