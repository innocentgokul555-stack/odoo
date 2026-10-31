import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useDebounced, useFetch, useQueryState } from '../hooks';
import { fdate, METHODS, methodLabel } from '../format';
import PaymentModal from '../components/PaymentModal';
import { Button, Card, ErrorBox, Page, Pagination, SelectField, Table, TextField, useMoney } from '../ui';

export default function Payments() {
  const m = useMoney();
  const [q, setQ] = useQueryState({ method: '', search: '', from: '', to: '', page: '1' });
  const [text, setText] = useState(q.search);
  const debounced = useDebounced(text);
  useEffect(() => { if (debounced !== q.search) setQ({ search: debounced }); }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  const [adding, setAdding] = useState(false);
  const { data, loading, error, reload } = useFetch(() => api('/payments', { params: { ...q, page_size: 20 } }), [q.method, q.search, q.from, q.to, q.page]);

  return (
    <Page title="Payments" subtitle="Every payment, matched to its invoice." actions={<Button variant="primary" onClick={() => setAdding(true)}>Record payment</Button>}>
      <Card>
        <div className="filters">
          <TextField className="grow" label="Search" placeholder="Invoice number, customer or note" value={text} onChange={(e) => setText(e.target.value)} />
          <SelectField label="Method" value={q.method} onChange={(e) => setQ({ method: e.target.value })}>
            <option value="">All methods</option>
            {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </SelectField>
          <TextField label="From" type="date" value={q.from} onChange={(e) => setQ({ from: e.target.value })} />
          <TextField label="To" type="date" value={q.to} onChange={(e) => setQ({ to: e.target.value })} />
        </div>
        <ErrorBox onRetry={reload}>{error}</ErrorBox>
        <Table
          rows={data && data.data}
          loading={loading}
          empty="No payments match these filters."
          columns={[
            { key: 'paid_on', label: 'Date', render: (r) => fdate(r.paid_on) },
            { key: 'invoice', label: 'Invoice', render: (r) => <Link to={`/invoices/${r.invoice_id}`}>{r.invoice_number}</Link> },
            { key: 'customer_name', label: 'Customer' },
            { key: 'method', label: 'Method', render: (r) => methodLabel(r.method) },
            { key: 'note', label: 'Note', render: (r) => <span className="muted">{r.note}</span> },
            { key: 'recorded_by_name', label: 'Recorded by', render: (r) => <span className="muted">{r.recorded_by_name}</span> },
            { key: 'amount', label: 'Amount', align: 'right', render: (r) => <b className="num">{m(r.amount)}</b> },
          ]}
        />
        {data && data.meta.total > 0 && <p className="muted" style={{ margin: '12px 4px 0' }}>{data.meta.total.toLocaleString()} payment(s) - total <b>{m(data.meta.sum_total)}</b></p>}
        <Pagination meta={data && data.meta} onPage={(p) => setQ({ page: String(p) })} />
      </Card>
      {adding && <PaymentModal onClose={() => setAdding(false)} onSaved={reload} />}
    </Page>
  );
}
