import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../hooks';
import { resetLookups } from '../lookups';
import { Badge, Button, Card, CheckField, ErrorBox, Modal, Page, Table, TextField, useForm, useToast } from '../ui';

// One small page used for both Taxes and Payment terms.
function SimplePage({ title, subtitle, endpoint, noun, fields, columns, empty }) {
  const { user } = useAuth();
  const toast = useToast();
  const canEdit = user.role === 'admin';
  const [modal, setModal] = useState(null);
  const { data, loading, error, reload } = useFetch(() => api(`/${endpoint}`), [endpoint]);

  const remove = async (row) => {
    if (!window.confirm(`Delete this ${noun}? If it is already used it is switched off instead.`)) return;
    try { const r = await api(`/${endpoint}/${row.id}`, { method: 'DELETE' }); resetLookups(); toast.success(r.deactivated ? 'It is in use, so it was switched off' : 'Deleted'); reload(); } catch (e) { toast.error(e.message); }
  };
  return (
    <Page title={title} subtitle={subtitle} actions={canEdit && <Button variant="primary" onClick={() => setModal({})}>New {noun}</Button>}>
      <Card pad={false}>
        <ErrorBox onRetry={reload}>{error}</ErrorBox>
        {!canEdit && <div className="card-body"><small className="muted">Only the admin can change these. You can view them here.</small></div>}
        <Table
          rows={data && data.data}
          loading={loading}
          empty={empty}
          rowClass={(r) => (r.active ? '' : 'row-muted')}
          columns={[
            ...columns,
            { key: 'active', label: 'Status', render: (r) => (r.active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Off</Badge>) },
            ...(canEdit ? [{ key: 'actions', label: '', align: 'right', render: (r) => (<><Button size="sm" onClick={() => setModal(r)}>Edit</Button> <Button size="sm" variant="ghost" onClick={() => remove(r)}>Delete</Button></>) }] : []),
          ]}
        />
      </Card>
      {modal && <SimpleModal row={modal.id ? modal : null} endpoint={endpoint} noun={noun} fields={fields} onClose={() => setModal(null)} onSaved={reload} />}
    </Page>
  );
}

function SimpleModal({ row, endpoint, noun, fields, onClose, onSaved }) {
  const toast = useToast();
  const initial = { active: true };
  fields.forEach((f) => { initial[f.name] = ''; });
  const form = useForm({ ...initial, ...(row || {}), active: row ? !!row.active : true });
  const onSubmit = (e) => {
    e.preventDefault();
    form.submit(async (v) => {
      await api(row ? `/${endpoint}/${row.id}` : `/${endpoint}`, { method: row ? 'PUT' : 'POST', body: v });
      resetLookups(); toast.success('Saved'); onSaved(); onClose();
    });
  };
  return (
    <Modal title={row ? `Edit ${noun}` : `New ${noun}`} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={form.saving} onClick={onSubmit}>Save</Button></>}>
      <form onSubmit={onSubmit} noValidate>
        <ErrorBox>{form.formError}</ErrorBox>
        {fields.map((f) => <TextField key={f.name} label={f.label} type={f.type || 'text'} step={f.step} min={f.min} hint={f.hint} required={f.required} {...form.bind(f.name)} />)}
        <CheckField label="Active" {...form.bindCheck('active')} />
      </form>
    </Modal>
  );
}

export const Taxes = () => (
  <SimplePage
    title="Taxes" noun="tax" endpoint="taxes" empty="No taxes yet."
    subtitle="Tax rules. Attach one to a product or plan and it is calculated automatically on every invoice."
    fields={[{ name: 'name', label: 'Name', required: true }, { name: 'rate', label: 'Rate (%)', type: 'number', step: '0.01', min: 0, required: true }, { name: 'description', label: 'Description' }]}
    columns={[{ key: 'name', label: 'Tax', render: (r) => <b>{r.name}</b> }, { key: 'rate', label: 'Rate', render: (r) => `${r.rate}%` }, { key: 'description', label: 'Description', render: (r) => <span className="muted">{r.description}</span> }]}
  />
);

export const PaymentTerms = () => (
  <SimplePage
    title="Payment terms" noun="payment term" endpoint="payment-terms" empty="No payment terms yet."
    subtitle="How many days a customer has to pay. Sets the due date on invoices."
    fields={[{ name: 'name', label: 'Name', required: true }, { name: 'days', label: 'Days until due', type: 'number', step: '1', min: 0, required: true, hint: '0 means payment is due immediately' }]}
    columns={[{ key: 'name', label: 'Payment term', render: (r) => <b>{r.name}</b> }, { key: 'days', label: 'Due after', render: (r) => (r.days === 0 ? 'Immediately' : `${r.days} days`) }]}
  />
);
