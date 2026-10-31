import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useDebounced, useFetch, useQueryState } from '../hooks';
import { useLookups } from '../lookups';
import { fdate, PERIOD_LABEL } from '../format';
import { Button, Card, CustomerPicker, ErrorBox, Page, Pagination, SelectField, StatusBadge, Table, TextField, useMoney } from '../ui';

const TABS = [['', 'All'], ['draft', 'Draft'], ['quotation', 'Quotation'], ['confirmed', 'Confirmed'], ['active', 'Active'], ['paused', 'Paused'], ['expiring', 'Ending soon'], ['closed', 'Closed']];

export default function Subscriptions() {
  const m = useMoney();
  const navigate = useNavigate();
  const lookups = useLookups();
  const [q, setQ] = useQueryState({ status: '', search: '', page: '1', customer_id: '', plan_id: '' });
  const [text, setText] = useState(q.search);
  const debounced = useDebounced(text);
  useEffect(() => { if (debounced !== q.search) setQ({ search: debounced }); }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data, loading, error, reload } = useFetch(
    () => api('/subscriptions', { params: { status: q.status, search: q.search, page: q.page, customer_id: q.customer_id, plan_id: q.plan_id, page_size: 20 } }),
    [q.status, q.search, q.page, q.customer_id, q.plan_id]
  );

  return (
    <Page title="Subscriptions" subtitle="Every subscription, and exactly where it stands." actions={<Button variant="primary" onClick={() => navigate('/subscriptions/new')}>New subscription</Button>}>
      <div className="tabs" role="tablist">
        {TABS.map(([v, label]) => <button key={v} role="tab" className={`tab ${q.status === v ? 'active' : ''}`} onClick={() => setQ({ status: v })}>{label}</button>)}
      </div>
      <Card>
        <div className="filters">
          <TextField className="grow" label="Search" placeholder="Subscription number, customer or company" value={text} onChange={(e) => setText(e.target.value)} />
          <div style={{ minWidth: 240 }}><CustomerPicker label="Customer" allowEmpty value={q.customer_id} onChange={(id) => setQ({ customer_id: id })} /></div>
          <SelectField label="Plan" value={q.plan_id} onChange={(e) => setQ({ plan_id: e.target.value })}>
            <option value="">All plans</option>
            {lookups && lookups.plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </SelectField>
        </div>
        <ErrorBox onRetry={reload}>{error}</ErrorBox>
        <Table
          rows={data && data.data}
          loading={loading}
          empty="No subscriptions match these filters."
          onRowClick={(r) => navigate(`/subscriptions/${r.id}`)}
          columns={[
            { key: 'number', label: 'Number', render: (r) => <b>{r.number}</b> },
            { key: 'customer', label: 'Customer', render: (r) => <>{r.customer_name}<br /><small>{r.customer_company}</small></> },
            { key: 'plan', label: 'Plan', render: (r) => <>{r.plan_name}<br /><small>{PERIOD_LABEL[r.billing_period]}</small></> },
            { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} paused={r.is_paused} /> },
            { key: 'start_date', label: 'Start', render: (r) => fdate(r.start_date) },
            { key: 'expiry_date', label: 'Expires', render: (r) => fdate(r.expiry_date) },
            { key: 'next', label: 'Next invoice', render: (r) => (r.status === 'active' && !r.is_paused ? fdate(r.next_invoice_date) : <span className="muted">-</span>) },
            { key: 'recurring_total', label: 'Per cycle', align: 'right', render: (r) => <span className="num">{m(r.recurring_total)}</span> },
          ]}
        />
        <Pagination meta={data && data.meta} onPage={(p) => setQ({ page: String(p) })} />
      </Card>
    </Page>
  );
}
