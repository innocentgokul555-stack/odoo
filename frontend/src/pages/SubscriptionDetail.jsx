import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../hooks';
import { fdate, fdatetime, PERIOD_LABEL, PERIOD_UNIT, todayStr } from '../format';
import Stepper from '../components/Stepper';
import { Button, Card, ErrorBox, Modal, Notice, Page, Spinner, StatusBadge, Table, useMoney, useToast } from '../ui';

const ACTIONS = {
  quote: { label: 'Send quotation', primary: true },
  confirm: { label: 'Confirm (customer accepted)', primary: true },
  activate: { label: 'Activate', primary: true },
  to_draft: { label: 'Back to draft' },
  pause: { label: 'Pause' },
  resume: { label: 'Resume', primary: true },
  renew: { label: 'Renew' },
  close: { label: 'Close', danger: true },
};
const CONFIRM_TEXT = {
  close: 'Close this subscription? No more invoices will be created for it.',
  pause: 'Pause this subscription? No invoices are created while it is paused, and the term is extended when it resumes.',
  renew: 'Renew this subscription for another term?',
};

export default function SubscriptionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const m = useMoney();
  const { user } = useAuth();
  const { data: sub, loading, error, reload } = useFetch(() => api(`/subscriptions/${id}`), [id]);
  const [busy, setBusy] = useState('');
  const [confirming, setConfirming] = useState(null);
  const [actionError, setActionError] = useState('');

  if (loading && !sub) return <Spinner />;
  if (error) return <ErrorBox onRetry={reload}>{error}</ErrorBox>;

  const act = async (action) => {
    setBusy(action); setActionError(''); setConfirming(null);
    try {
      await api(`/subscriptions/${id}/${action}`, { method: 'POST', body: {} });
      toast.success(`${ACTIONS[action].label}: done`);
      reload();
    } catch (e) { setActionError(e.message); } finally { setBusy(''); }
  };
  const bill = async () => {
    setBusy('bill'); setActionError('');
    try {
      const r = await api(`/subscriptions/${id}/bill`, { method: 'POST', body: {} });
      toast.success(`${r.invoices_created} invoice(s) created`);
      reload();
    } catch (e) { setActionError(e.message); } finally { setBusy(''); }
  };
  const remove = async () => {
    if (!window.confirm('Delete this draft permanently?')) return;
    try { await api(`/subscriptions/${id}`, { method: 'DELETE' }); toast.success('Draft deleted'); navigate('/subscriptions'); } catch (e) { setActionError(e.message); }
  };

  const canBill = sub.status === 'active' && !sub.is_paused && sub.next_invoice_date <= todayStr();
  const editable = ['draft', 'quotation'].includes(sub.status);

  return (
    <Page
      title={<>{sub.number} <StatusBadge status={sub.status} paused={sub.is_paused} /></>}
      subtitle={<>{sub.customer_name}{sub.customer_company ? ` - ${sub.customer_company}` : ''} - {sub.plan_name} ({PERIOD_LABEL[sub.billing_period]})</>}
      actions={
        <>
          {editable && <Button onClick={() => navigate(`/subscriptions/${id}/edit`)}>Edit</Button>}
          {canBill && <Button loading={busy === 'bill'} onClick={bill}>Create invoice now</Button>}
          {sub.allowed_actions.map((a) => (
            <Button
              key={a}
              variant={ACTIONS[a].primary ? 'primary' : ACTIONS[a].danger ? 'danger' : 'secondary'}
              loading={busy === a}
              onClick={() => (CONFIRM_TEXT[a] ? setConfirming(a) : act(a))}
            >{ACTIONS[a].label}</Button>
          ))}
          {sub.status === 'draft' && <Button variant="danger" onClick={remove}>Delete</Button>}
        </>
      }
    >
      <ErrorBox>{actionError}</ErrorBox>
      <Card><Stepper status={sub.status} /></Card>
      {sub.is_paused && <Notice tone="warn">Paused since {fdate(sub.paused_at)}. No invoices are created until it is resumed.</Notice>}
      {sub.status === 'quotation' && sub.quote_valid_until && (
        <Notice tone={sub.quote_valid_until < todayStr() ? 'error' : 'info'}>
          {sub.quote_valid_until < todayStr() ? 'This quotation expired on' : 'This quotation is valid until'} <b>{fdate(sub.quote_valid_until)}</b>.
        </Notice>
      )}

      <Card title="Details">
        <dl className="kv">
          <div><dt>Customer</dt><dd><Link to={`/subscriptions?customer_id=${sub.customer_id}`}>{sub.customer_name}</Link><br /><small>{sub.customer_email}</small></dd></div>
          <div><dt>Plan</dt><dd>{sub.plan_name}<br /><small>Plan fee {m(sub.plan_price)} per {PERIOD_UNIT[sub.billing_period]}</small></dd></div>
          <div><dt>Start date</dt><dd>{fdate(sub.start_date)}</dd></div>
          <div><dt>Expiry date</dt><dd>{fdate(sub.expiry_date)}<br /><small>{sub.auto_close ? 'Closes automatically' : 'Renews itself'}</small></dd></div>
          <div><dt>Next invoice</dt><dd>{sub.status === 'active' && !sub.is_paused ? fdate(sub.next_invoice_date) : '-'}</dd></div>
          <div><dt>Payment terms</dt><dd>{sub.payment_term_name || 'Immediate payment'}</dd></div>
          <div><dt>Invoices created</dt><dd>{sub.periods_billed}</dd></div>
          {sub.template_name && <div><dt>Started from template</dt><dd>{sub.template_name}</dd></div>}
          {sub.closed_at && <div><dt>Closed</dt><dd>{fdate(sub.closed_at)}<br /><small>{sub.close_reason}</small></dd></div>}
        </dl>
        {sub.notes && <p style={{ marginBottom: 0 }}><b>Notes:</b> {sub.notes}</p>}
        <p className="muted" style={{ marginBottom: 0 }}>
          This plan: {sub.closable ? 'can be closed early' : 'cannot be closed early'}, {sub.pausable ? 'can be paused' : 'cannot be paused'}, {sub.renewable ? 'can be renewed' : 'cannot be renewed'}.
        </p>
      </Card>

      <Card title="Product lines" pad={false}>
        <Table
          rows={sub.lines}
          empty="No product lines - only the plan fee is billed."
          columns={[
            { key: 'description', label: 'Product' },
            { key: 'quantity', label: 'Qty', align: 'right' },
            { key: 'unit_price', label: 'Unit price', align: 'right', render: (r) => <span className="num">{m(r.unit_price)}</span> },
            { key: 'tax', label: 'Taxes', align: 'right', render: (r) => (r.tax_rate ? `${r.tax_name}` : '-') },
            { key: 'amount', label: 'Amount', align: 'right', render: (r) => <span className="num">{m(r.amount)}</span> },
          ]}
        />
        <div className="card-body">
          <div className="totals">
            {sub.plan_price > 0 && <div><span>Plan fee</span><span className="num">{m(sub.plan_price)}</span></div>}
            <div><span>Subtotal per cycle</span><span className="num">{m(sub.totals.subtotal)}</span></div>
            <div><span>Tax</span><span className="num">{m(sub.totals.tax_total)}</span></div>
            <div className="grand"><span>Total per cycle</span><span className="num">{m(sub.totals.total)}</span></div>
          </div>
        </div>
      </Card>

      <Card title="Invoices" pad={false} actions={<Link to={`/invoices?subscription_id=${sub.id}`}>Open in invoices</Link>}>
        <Table
          rows={sub.invoices}
          empty="No invoices yet."
          onRowClick={(r) => navigate(`/invoices/${r.id}`)}
          columns={[
            { key: 'number', label: 'Invoice', render: (r) => <b>{r.number}</b> },
            { key: 'period', label: 'Period', render: (r) => `${fdate(r.period_start)} - ${fdate(r.period_end)}` },
            { key: 'due_date', label: 'Due', render: (r) => fdate(r.due_date) },
            { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} overdue={r.status === 'confirmed' && r.due_date < todayStr()} /> },
            { key: 'total', label: 'Total', align: 'right', render: (r) => <span className="num">{m(r.total)}</span> },
            { key: 'balance', label: 'Balance', align: 'right', render: (r) => <span className="num">{m(r.status === 'cancelled' || r.status === 'draft' ? 0 : r.balance)}</span> },
          ]}
        />
      </Card>

      <Card title="History">
        <ul className="timeline">
          {sub.events.map((e) => (
            <li key={e.id}>
              <small>{fdatetime(e.created_at)}</small>
              <span><b>{e.event}</b>{e.to_status && e.from_status !== e.to_status ? <> - {e.from_status ? `${e.from_status} to ` : ''}{e.to_status}</> : ''}{e.note ? <span className="muted"> - {e.note}</span> : ''}{e.user_name && <small> ({e.user_name})</small>}</span>
            </li>
          ))}
        </ul>
      </Card>

      {confirming && (
        <Modal title={ACTIONS[confirming].label} onClose={() => setConfirming(null)}
          footer={<><Button onClick={() => setConfirming(null)}>Cancel</Button><Button variant={confirming === 'close' ? 'danger' : 'primary'} onClick={() => act(confirming)}>{ACTIONS[confirming].label}</Button></>}>
          <p style={{ margin: 0 }}>{CONFIRM_TEXT[confirming]}</p>
        </Modal>
      )}
    </Page>
  );
}
