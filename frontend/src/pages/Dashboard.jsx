import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useFetch } from '../hooks';
import { useLookups } from '../lookups';
import { fdate, methodLabel, num } from '../format';
import BillingModal from '../components/BillingModal';
import { Button, Card, CustomerPicker, ErrorBox, Page, SelectField, Spinner, Stat, StatusBadge, Table, TextField, useMoney } from '../ui';

function RevenueChart({ rows }) {
  const m = useMoney();
  const max = Math.max(1, ...rows.flatMap((r) => [r.invoiced, r.collected]));
  const label = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' });
  return (
    <>
      <div className="legend" style={{ marginBottom: 8 }}><span><i style={{ background: '#c7cbf5' }} />Invoiced</span><span><i style={{ background: 'var(--primary)' }} />Collected</span></div>
      <div className="chart" role="img" aria-label="Invoiced and collected revenue by month">
        {rows.map((r) => (
          <div className="chart-col" key={r.month} title={`${r.month}: invoiced ${m(r.invoiced)}, collected ${m(r.collected)}`}>
            <div className="bars">
              <div className="bar inv" style={{ height: `${(r.invoiced / max) * 100}%` }} />
              <div className="bar col" style={{ height: `${(r.collected / max) * 100}%` }} />
            </div>
            <span className="chart-label">{label(r.month)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

export default function Dashboard() {
  const m = useMoney();
  const navigate = useNavigate();
  const lookups = useLookups();
  const empty = { from: '', to: '', customer_id: '', plan_id: '' };
  const [applied, setApplied] = useState(empty);
  const [draft, setDraft] = useState(empty);
  const [billing, setBilling] = useState(false);
  const { data, loading, error, reload } = useFetch(() => api('/reports/summary', { params: applied }), [applied]);

  const apply = (e) => { e.preventDefault(); setApplied(draft); };
  const reset = () => { setDraft(empty); setApplied(empty); };
  const filtered = Object.values(applied).some(Boolean);
  const s = data && data.subscriptions;
  const inv = data && data.invoices;

  return (
    <Page
      title="Dashboard"
      subtitle="Active subscriptions, recurring revenue, payments and overdue invoices in one place."
      actions={<><Button onClick={() => setBilling(true)}>Run billing</Button><Button variant="primary" onClick={() => navigate('/subscriptions/new')}>New subscription</Button></>}
    >
      <Card>
        <form className="filters" onSubmit={apply}>
          <TextField label="From" type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          <TextField label="To" type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          <div style={{ minWidth: 240 }}><CustomerPicker label="Customer" allowEmpty value={draft.customer_id} onChange={(id) => setDraft({ ...draft, customer_id: id })} /></div>
          <SelectField label="Plan" value={draft.plan_id} onChange={(e) => setDraft({ ...draft, plan_id: e.target.value })}>
            <option value="">All plans</option>
            {lookups && lookups.plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </SelectField>
          <Button variant="primary" type="submit">Apply filters</Button>
          {filtered && <Button type="button" onClick={reset}>Clear</Button>}
        </form>
        <small className="muted">Dates filter invoices (by invoice date) and payments (by payment date). Subscription counts always show the current position.</small>
      </Card>

      <ErrorBox onRetry={reload}>{error}</ErrorBox>
      {loading && !data && <Spinner />}
      {data && (
        <>
          <div className="grid grid-5" style={{ marginBottom: 18 }}>
            <Stat label="Active subscriptions" value={num(s.active)} sub={`${s.paused} paused - ${num(s.total)} in total`} to="/subscriptions?status=active" />
            <Stat label="Recurring revenue / month" value={m(data.recurring.mrr)} sub={`${m(data.recurring.arr)} per year`} tone="primary" />
            <Stat label="Revenue collected" value={m(data.payments.collected_total)} sub={`${num(data.payments.count)} payments`} tone="green" to="/payments" />
            <Stat label="Still owed" value={m(inv.outstanding_total)} sub={`${num(inv.confirmed_count)} unpaid invoices`} to="/invoices?status=outstanding" />
            <Stat label="Overdue" value={m(inv.overdue_total)} sub={`${num(inv.overdue_count)} invoices`} tone={inv.overdue_count ? 'red' : undefined} to="/invoices?status=overdue" />
          </div>

          <div className="grid grid-2" style={{ gridTemplateColumns: '2fr 1fr', marginBottom: 18 }}>
            <Card title="Revenue by month" actions={<small>Invoiced total: <b>{m(inv.invoiced_total)}</b></small>}>
              <RevenueChart rows={data.revenue_by_month} />
            </Card>
            <Card title="Overdue by age">
              {[['1-30 days', inv.aging.d1_30], ['31-60 days', inv.aging.d31_60], ['Over 60 days', inv.aging.d60_plus]].map(([label, v]) => (
                <div key={label} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{label}</span><b className="num">{m(v)}</b></div>
                  <div className="meter"><span style={{ width: `${inv.overdue_total ? (v / inv.overdue_total) * 100 : 0}%`, background: 'var(--red)' }} /></div>
                </div>
              ))}
              <h3 style={{ margin: '18px 0 8px' }}>Payments by method</h3>
              {data.payments.by_method.length === 0 && <span className="muted">No payments in this range</span>}
              {data.payments.by_method.map((b) => (
                <div key={b.method} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}><span>{methodLabel(b.method)} <small>({b.count})</small></span><span className="num">{m(b.total)}</span></div>
              ))}
            </Card>
          </div>

          <div className="grid grid-2" style={{ marginBottom: 18 }}>
            <Card title="Subscriptions by status">
              <div className="chips">
                {[['draft', 'Draft'], ['quotation', 'Quotation'], ['confirmed', 'Confirmed'], ['active', 'Active'], ['paused', 'Paused'], ['closed', 'Closed']].map(([k, label]) => (
                  <Link key={k} className="chip" to={`/subscriptions?status=${k}`}>{label}<b>{num(s[k])}</b></Link>
                ))}
              </div>
            </Card>
            <Card title="Invoices by status">
              <div className="chips">
                <Link className="chip" to="/invoices?status=draft">Draft<b>{num(inv.draft_count)}</b></Link>
                <Link className="chip" to="/invoices?status=outstanding">Confirmed (unpaid)<b>{num(inv.confirmed_count)}</b></Link>
                <Link className="chip" to="/invoices?status=paid">Paid<b>{num(inv.paid_count)}</b></Link>
                <Link className="chip" to="/invoices?status=cancelled">Cancelled<b>{num(inv.cancelled_count)}</b></Link>
              </div>
              {inv.draft_count > 0 && <p className="muted" style={{ marginBottom: 0 }}>{num(inv.draft_count)} draft invoice(s) worth {m(inv.draft_total)} are waiting to be confirmed.</p>}
            </Card>
          </div>

          <div className="grid grid-2">
            <Card title="Overdue invoices" actions={<Link to="/invoices?status=overdue">View all</Link>} pad={false}>
              <Table
                rows={data.top_overdue}
                empty="No overdue invoices. Nice work!"
                onRowClick={(r) => navigate(`/invoices/${r.id}`)}
                columns={[
                  { key: 'number', label: 'Invoice' },
                  { key: 'customer_name', label: 'Customer' },
                  { key: 'age', label: 'Late by', render: (r) => <span className="tone-red">{r.days_overdue} days</span> },
                  { key: 'balance', label: 'Owed', align: 'right', render: (r) => <span className="num">{m(r.balance)}</span> },
                ]}
              />
            </Card>
            <Card title="Renewals in the next 30 days" actions={<Link to="/subscriptions?status=expiring">View all</Link>} pad={false}>
              <Table
                rows={data.upcoming_renewals}
                empty="Nothing is due to renew soon."
                onRowClick={(r) => navigate(`/subscriptions/${r.id}`)}
                columns={[
                  { key: 'number', label: 'Subscription' },
                  { key: 'customer_name', label: 'Customer' },
                  { key: 'expiry_date', label: 'Ends', render: (r) => fdate(r.expiry_date) },
                  { key: 'what', label: 'At the end', render: (r) => (r.auto_close ? <StatusBadge status="closed" /> : <span className="muted">Renews itself</span>) },
                ]}
              />
            </Card>
          </div>
          <p className="muted" style={{ fontSize: 12.5 }}>Recurring revenue is what one billing cycle (before tax) of every active, unpaused subscription adds up to, converted to a monthly figure.</p>
        </>
      )}
      {billing && <BillingModal onClose={() => setBilling(false)} onDone={reload} />}
    </Page>
  );
}
