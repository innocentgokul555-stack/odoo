import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useDebounced, useFetch, useQueryState } from '../hooks';
import { resetLookups, useLookups } from '../lookups';
import { Badge, Button, Card, ErrorBox, Modal, Page, Pagination, AreaField, CheckField, SelectField, Table, TextField, useForm, useMoney, useToast } from '../ui';

const TYPES = [['software', 'Software'], ['addon', 'Add-on'], ['service', 'Service'], ['hardware', 'Hardware'], ['other', 'Other']];

function ProductModal({ product, onClose, onSaved }) {
  const toast = useToast();
  const lookups = useLookups();
  const form = useForm({ name: '', type: 'software', sales_price: '', cost_price: '', notes: '', tax_id: '', active: true, ...(product || {}), tax_id: product ? product.tax_id || '' : '' });
  const [variants, setVariants] = useState((product && product.variants) || []);
  const setVariant = (i, patch) => setVariants((vs) => vs.map((v, j) => (j === i ? { ...v, ...patch } : v)));

  const onSubmit = (e) => {
    e.preventDefault();
    form.submit(async (v) => {
      const body = { ...v, tax_id: v.tax_id ? Number(v.tax_id) : null, variants: variants.filter((x) => x.attribute || x.value).map((x) => ({ id: x.id, attribute: x.attribute, value: x.value, extra_price: x.extra_price === '' ? 0 : Number(x.extra_price) })) };
      await api(product ? `/products/${product.id}` : '/products', { method: product ? 'PUT' : 'POST', body });
      resetLookups();
      toast.success('Product saved');
      onSaved();
      onClose();
    });
  };
  return (
    <Modal wide title={product ? `Edit ${product.name}` : 'New product'} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={form.saving} onClick={onSubmit}>Save product</Button></>}>
      <form onSubmit={onSubmit} noValidate>
        <ErrorBox>{form.formError}</ErrorBox>
        <div className="form-grid">
          <TextField label="Name" required {...form.bind('name')} />
          <SelectField label="Type" required {...form.bind('type')}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</SelectField>
          <TextField label="Sales price" type="number" step="0.01" min="0" required {...form.bind('sales_price')} />
          <TextField label="Cost price" type="number" step="0.01" min="0" required {...form.bind('cost_price')} />
          <SelectField label="Tax" {...form.bind('tax_id')} hint="Calculated automatically on invoices">
            <option value="">No tax</option>
            {lookups && lookups.taxes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </SelectField>
          <div />
        </div>
        <AreaField label="Notes" {...form.bind('notes')} />

        <h3 style={{ margin: '4px 0 6px' }}>Variants</h3>
        <p className="muted" style={{ marginTop: 0 }}>For example attribute <b>Brand</b>, value <b>Odoo</b>, extra price <b>560</b>: choosing that variant adds 560 to the price.</p>
        <ErrorBox>{form.errors.variants}</ErrorBox>
        {variants.map((v, i) => (
          <div key={v.id || `new-${i}`} className="filters" style={{ alignItems: 'flex-start' }}>
            <TextField label={i === 0 ? 'Attribute' : undefined} placeholder="Brand" value={v.attribute} onChange={(e) => setVariant(i, { attribute: e.target.value })} aria-label="Attribute" />
            <TextField label={i === 0 ? 'Value' : undefined} placeholder="Odoo" value={v.value} onChange={(e) => setVariant(i, { value: e.target.value })} aria-label="Value" />
            <TextField label={i === 0 ? 'Extra price' : undefined} type="number" step="0.01" value={v.extra_price} onChange={(e) => setVariant(i, { extra_price: e.target.value })} aria-label="Extra price" />
            <Button type="button" variant="ghost" onClick={() => setVariants((vs) => vs.filter((_, j) => j !== i))}>Remove</Button>
          </div>
        ))}
        <Button size="sm" type="button" onClick={() => setVariants((vs) => [...vs, { attribute: vs[0] ? vs[0].attribute : '', value: '', extra_price: 0 }])}>+ Add a variant</Button>
        <div style={{ marginTop: 14 }}><CheckField label="Available for new subscriptions" {...form.bindCheck('active')} /></div>
      </form>
    </Modal>
  );
}

export default function Products() {
  const m = useMoney();
  const { user } = useAuth();
  const canEdit = user.role === 'admin';
  const [q, setQ] = useQueryState({ search: '', type: '', page: '1' });
  const [text, setText] = useState(q.search);
  const debounced = useDebounced(text);
  useEffect(() => { if (debounced !== q.search) setQ({ search: debounced }); }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  const [modal, setModal] = useState(null);
  const toast = useToast();
  const { data, loading, error, reload } = useFetch(() => api('/products', { params: { ...q, page_size: 20 } }), [q.search, q.type, q.page]);

  const remove = async (p) => {
    if (!window.confirm(`Delete ${p.name}? If it is already used it will be hidden instead.`)) return;
    try { const r = await api(`/products/${p.id}`, { method: 'DELETE' }); resetLookups(); toast.success(r.deactivated ? 'Product is in use, so it was deactivated' : 'Product deleted'); reload(); } catch (e) { toast.error(e.message); }
  };

  return (
    <Page title="Products" subtitle="What Brightloop sells: software, add-ons and services, with variants such as brand." actions={canEdit && <Button variant="primary" onClick={() => setModal({})}>New product</Button>}>
      <Card>
        <div className="filters">
          <TextField className="grow" label="Search" value={text} onChange={(e) => setText(e.target.value)} />
          <SelectField label="Type" value={q.type} onChange={(e) => setQ({ type: e.target.value })}>
            <option value="">All types</option>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </SelectField>
        </div>
        {!canEdit && <small className="muted">Only the admin can change products. You can view them here.</small>}
        <ErrorBox onRetry={reload}>{error}</ErrorBox>
        <Table
          rows={data && data.data}
          loading={loading}
          empty="No products yet."
          rowClass={(r) => (r.active ? '' : 'row-muted')}
          columns={[
            { key: 'name', label: 'Product', render: (r) => <><b>{r.name}</b>{!r.active && <> <Badge tone="gray">Inactive</Badge></>}<br /><small>{r.notes}</small></> },
            { key: 'type', label: 'Type', render: (r) => (TYPES.find(([v]) => v === r.type) || [0, r.type])[1] },
            { key: 'variants', label: 'Variants', render: (r) => (r.variants.length ? r.variants.map((v) => <div key={v.id}><small>{v.attribute}: <b>{v.value}</b>{v.extra_price ? ` (${v.extra_price > 0 ? '+' : ''}${m(v.extra_price)})` : ''}</small></div>) : <span className="muted">-</span>) },
            { key: 'tax', label: 'Tax', render: (r) => (r.tax_name ? `${r.tax_name}` : <span className="muted">None</span>) },
            { key: 'cost_price', label: 'Cost', align: 'right', render: (r) => <span className="num">{m(r.cost_price)}</span> },
            { key: 'sales_price', label: 'Sales price', align: 'right', render: (r) => <b className="num">{m(r.sales_price)}</b> },
            ...(canEdit ? [{ key: 'actions', label: '', align: 'right', render: (r) => (<><Button size="sm" onClick={() => setModal(r)}>Edit</Button> <Button size="sm" variant="ghost" onClick={() => remove(r)}>Delete</Button></>) }] : []),
          ]}
        />
        <Pagination meta={data && data.meta} onPage={(p) => setQ({ page: String(p) })} />
      </Card>
      {modal && <ProductModal product={modal.id ? modal : null} onClose={() => setModal(null)} onSaved={reload} />}
    </Page>
  );
}
