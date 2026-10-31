import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../hooks';
import { useLookups } from '../lookups';
import { fdate } from '../format';
import { Badge, Button, Card, CheckField, CustomerPicker, ErrorBox, Modal, Notice, Page, SelectField, StatusBadge, Table, TextField, useForm, useMoney, useToast } from '../ui';

function DiscountModal({ discount, onClose, onSaved }) {
  const toast = useToast();
  const lookups = useLookups();
  const form = useForm({
    name: '', type: 'percentage', value: '', min_purchase: 0, min_quantity: 0, start_date: '', end_date: '', usage_limit: '', applies_to: 'subscription', customer_id: '', active: true,
    ...(discount || {}), start_date: (discount && discount.start_date) || '', end_date: (discount && discount.end_date) || '', usage_limit: (discount && discount.usage_limit) || '', customer_id: (discount && discount.customer_id) || '',
  });
  const [productIds, setProductIds] = useState((discount && discount.product_ids) || []);
  const toggle = (id) => setProductIds((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));

  const onSubmit = (e) => {
    e.preventDefault();
    form.submit(async (v) => {
      const body = { ...v, customer_id: v.customer_id ? Number(v.customer_id) : null, product_ids: v.applies_to === 'products' ? productIds : [] };
      await api(discount ? `/discounts/${discount.id}` : '/discounts', { method: discount ? 'PUT' : 'POST', body });
      toast.success('Discount saved'); onSaved(); onClose();
    });
  };
  return (
    <Modal wide title={discount ? `Edit discount` : 'New discount rule'} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={form.saving} onClick={onSubmit}>Save discount</Button></>}>
      <form onSubmit={onSubmit} noValidate>
        <ErrorBox>{form.formError}</ErrorBox>
        <TextField label="Name" required placeholder="e.g. 10% off for 10+ seats" {...form.bind('name')} />
        <div className="form-grid">
          <SelectField label="Type" required {...form.bind('type')}><option value="percentage">Percentage (%)</option><option value="fixed">Fixed amount</option></SelectField>
          <TextField label={form.values.type === 'percentage' ? 'Percentage off' : 'Amount off'} type="number" step="0.01" min="0" required {...form.bind('value')} />
          <TextField label="Minimum purchase" type="number" step="0.01" min="0" {...form.bind('min_purchase')} hint="Invoice amount needed for the discount to apply" />
          <TextField label="Minimum quantity" type="number" step="1" min="0" {...form.bind('min_quantity')} hint="Number of items needed" />
          <TextField label="Starts" type="date" {...form.bind('start_date')} />
          <TextField label="Ends" type="date" {...form.bind('end_date')} />
          <TextField label="Can be used (times)" type="number" step="1" min="1" {...form.bind('usage_limit')} hint="Leave empty for no limit" />
          <SelectField label="Applies to" required {...form.bind('applies_to')}>
            <option value="subscription">The whole subscription</option><option value="products">Specific products</option>
          </SelectField>
        </div>
        {form.values.applies_to === 'products' && (
          <div style={{ marginBottom: 14 }}>
            <b style={{ fontSize: 13 }}>Products this discount applies to</b>
            <ErrorBox>{form.errors.product_ids}</ErrorBox>
            <div className="chips" style={{ marginTop: 8 }}>
              {lookups && lookups.products.map((p) => (
                <label key={p.id} className="chip" style={{ cursor: 'pointer', background: productIds.includes(p.id) ? 'var(--primary-soft)' : undefined }}>
                  <input type="checkbox" checked={productIds.includes(p.id)} onChange={() => toggle(p.id)} /> {p.name}
                </label>
              ))}
            </div>
          </div>
        )}
        <CustomerPicker label="Only for one customer (optional)" allowEmpty value={form.values.customer_id} onChange={(id) => form.set('customer_id', id)} error={form.errors.customer_id} />
        <CheckField label="Rule is switched on" {...form.bindCheck('active')} />
        <Notice>Once saved, the discount appears on matching invoices by itself, and stops when it expires or its limit is reached.</Notice>
      </form>
    </Modal>
  );
}

export default function Discounts() {
  const m = useMoney();
  const toast = useToast();
  const { user } = useAuth();
  const canEdit = user.role === 'admin';
  const [modal, setModal] = useState(null);
  const { data, loading, error, reload } = useFetch(() => api('/discounts'), []);
  const remove = async (d) => {
    if (!window.confirm(`Delete "${d.name}"? If invoices already used it, it is switched off instead.`)) return;
    try { const r = await api(`/discounts/${d.id}`, { method: 'DELETE' }); toast.success(r.deactivated ? 'Discount was used, so it was switched off' : 'Discount deleted'); reload(); } catch (e) { toast.error(e.message); }
  };
  return (
    <Page title="Discounts" subtitle="Rules that apply on their own. Only the admin can create them." actions={canEdit && <Button variant="primary" onClick={() => setModal({})}>New discount</Button>}>
      <Card pad={false}>
        <ErrorBox onRetry={reload}>{error}</ErrorBox>
        {!canEdit && <div className="card-body"><small className="muted">Only the admin can create or change discount rules. You can see them here.</small></div>}
        <Table
          rows={data && data.data}
          loading={loading}
          empty="No discount rules yet."
          rowClass={(r) => (r.state === 'running' ? '' : 'row-muted')}
          columns={[
            { key: 'name', label: 'Discount', render: (r) => <><b>{r.name}</b><br /><small>{r.applies_to === 'products' ? `On: ${r.products.map((p) => p.name).join(', ')}` : 'On the whole subscription'}{r.customer_name ? ` - only for ${r.customer_name}` : ''}</small></> },
            { key: 'value', label: 'Value', render: (r) => (r.type === 'percentage' ? `${r.value}%` : m(r.value)) },
            { key: 'conditions', label: 'Conditions', render: (r) => <small>{r.min_purchase > 0 ? `Min purchase ${m(r.min_purchase)}` : 'No minimum purchase'}<br />{r.min_quantity > 0 ? `Min quantity ${r.min_quantity}` : 'No minimum quantity'}</small> },
            { key: 'dates', label: 'Dates', render: (r) => (r.start_date || r.end_date ? <small>{fdate(r.start_date)} to {fdate(r.end_date)}</small> : <small>Always</small>) },
            { key: 'usage', label: 'Used', render: (r) => (r.usage_limit ? `${r.times_used} of ${r.usage_limit}` : `${r.times_used} times`) },
            { key: 'state', label: 'Status', render: (r) => <StatusBadge status={r.state} /> },
            ...(canEdit ? [{ key: 'actions', label: '', align: 'right', render: (r) => (<><Button size="sm" onClick={() => setModal(r)}>Edit</Button> <Button size="sm" variant="ghost" onClick={() => remove(r)}>Delete</Button></>) }] : []),
          ]}
        />
      </Card>
      {modal && <DiscountModal discount={modal.id ? modal : null} onClose={() => setModal(null)} onSaved={reload} />}
    </Page>
  );
}
