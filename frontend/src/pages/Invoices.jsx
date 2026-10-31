import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useDebounced, useFetch, useQueryState } from '../hooks';
import { fdate } from '../format';
import BillingModal from '../components/BillingModal';
import { Button, Card, ErrorBox, Notice, Page, Pagination, StatusBadge, Table, TextField, useMoney, useToast } from '../ui';

const TABS = [['', 'All'], ['draft', 'Draft'], ['outstanding', 'Confirmed (unpaid)'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['cancelled', 'Cancelled']];

export default function Invoices() {
  const m = useMoney();
  const navigate = useNavigate();
  const toast = useToast();
  const [q, setQ] = useQueryState({ status: '', search: '', page: '1', from: '', to: '', subscription_id: '', customer_id: '' });
  const [text, setText] = useState(q.search);
  const debounced = useDebounced(text);
  useEffect(() => { if (debounced !== q.search) setQ({ search: debounced }); }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  const [billing, setBilling] = useState(false);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState('');

  const { data, loading, error, reload } = useFetch(
    () => api('/invoices', { params: { ...q, page_size: 20, sort: q.status === 'overdue' ? 'due_date' : undefined, dir: q.status === 'overdue' ? 'asc' : undefined } }),
    [q.status, q.search, q.page, q.from, q.to, q.subscription_id, q.customer_id]
  );
  useEffect(() => setSelected([]), [q.status, q.search, q.page]);

  const drafts = ((data && data.data) || []).filter((i) => i.status === 'draft');
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const confirmMany = async (body) => {
    setBusy(true); setBulkMsg('');
    try {
      const r = await api('/invoices/bulk-confirm', { method: 'POST', body });
      toast.success(`${r.confirmed} invoice(s) confirmed`);
      if (r.skipped) setBulkMsg(`${r.skipped} could not be confirmed.`);
      setSelected([]); reload();
    } catch (e) { setBulkMsg(e.message); } finally { setBusy(false); }
  };

  return (
    <Page
      title="Invoices"
      subtitle="Created from subscriptions on billing day. Confirm, send, print or cancel any invoice."
      actions={<Button variant="primary" onClick={() => setBilling(true)}>Run billing</Button>}
    >
      <div className="tabs" role="tablist">
        {TABS.map(([v, label]) => <button key={v} role="tab" className={`tab ${q.status === v ? 'active' : ''}`} onClick={() => setQ({ status: v })}>{label}</button>)}
      </div>
      <Card>
        <div className="filters">
          <TextField className="grow" label="Search" placeholder="Invoice number, customer or company" value={text} onChange={(e) => setText(e.target.value)} />
          <TextField label="From" type="date" value={q.from} onChange={(e) => setQ({ from: e.target.value })} />
          <TextField label="To" type="date" value={q.to} onChange={(e) => setQ({ to: e.target.value })} />
        </div>
        {(q.subscription_id || q.customer_id) && (
          <Notice>Filtered{q.subscription_id ? ' by one subscription' : ''}{q.customer_id ? ' by one customer' : ''}. <button className="btn btn-sm" onClick={() => setQ({ subscription_id: '', customer_id: '' })}>Show all</button></Notice>
        )}
        <ErrorBox onRetry={reload}>{error}</ErrorBox>
        {bulkMsg && <Notice tone="warn">{bulkMsg}</Notice>}
        {(q.status === 'draft' || q.status === '') && drafts.length > 0 && (
          <div className="filters">
            <Button size="sm" loading={busy} disabled={!selected.length} onClick={() => confirmMany({ ids: selected })}>Confirm selected ({selected.length})</Button>
            <Button size="sm" loading={busy} onClick={() => { if (window.confirm('Confirm every draft invoice?')) confirmMany({ all_drafts: true }); }}>Confirm all drafts</Button>
          </div>
        )}
        <Table
          rows={data && data.data}
          loading={loading}
          empty="No invoices match these filters."
          onRowClick={(r) => navigate(`/invoices/${r.id}`)}
          columns={[
            { key: 'sel', label: '', width: 34, render: (r) => (r.status === 'draft' ? <input type="checkbox" checked={selected.includes(r.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(r.id)} aria-label={`Select ${r.number}`} /> : null) },
            { key: 'number', label: 'Invoice', render: (r) => <b>{r.number}</b> },
            { key: 'customer_name', label: 'Customer', render: (r) => <>{r.customer_name}<br /><small>{r.customer_company}</small></> },
            { key: 'subscription_number', label: 'Subscription' },
            { key: 'invoice_date', label: 'Invoice date', render: (r) => fdate(r.invoice_date) },
            { key: 'due_date', label: 'Due', render: (r) => <>{fdate(r.due_date)}{r.overdue && <><br /><small className="tone-red">{r.days_overdue} days late</small></>}</> },
            { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} overdue={r.overdue} /> },
            { key: 'total', label: 'Total', align: 'right', render: (r) => <span className="num">{m(r.total)}</span> },
            { key: 'balance', label: 'Balance', align: 'right', render: (r) => <span className="num">{r.status === 'confirmed' ? m(r.balance) : '-'}</span> },
          ]}
        />
        {data && data.meta.total > 0 && (
          <p className="muted" style={{ margin: '12px 4px 0' }}>{data.meta.total.toLocaleString()} invoice(s) - total value <b>{m(data.meta.sum_total)}</b> - still owed <b>{m(data.meta.sum_balance)}</b></p>
        )}
        <Pagination meta={data && data.meta} onPage={(p) => setQ({ page: String(p) })} />
      </Card>
      {billing && <BillingModal onClose={() => setBilling(false)} onDone={reload} />}
    </Page>
  );
}
