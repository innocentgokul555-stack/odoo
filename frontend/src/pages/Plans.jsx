import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../hooks';
import { resetLookups, useLookups } from '../lookups';
import { fdate, PERIOD_LABEL } from '../format';
import { AreaField, Badge, Button, Card, CheckField, ErrorBox, Modal, Page, SelectField, Table, TextField, useForm, useMoney, useToast } from '../ui';

const EMPTY = { name: '', price: '', billing_period: 'monthly', min_quantity: 1, available_from: '', available_to: '', auto_close: false, closable: true, pausable: false, renewable: true, tax_id: '', description: '', active: true };

function PlanModal({ plan, onClose, onSaved }) {
  const toast = useToast();
  const lookups = useLookups();
  const form = useForm({ ...EMPTY, ...(plan || {}), tax_id: plan ? plan.tax_id || '' : '', available_from: (plan && plan.available_from) || '', available_to: (plan && plan.available_to) || '',
    auto_close: !!(plan && plan.auto_close), closable: plan ? !!plan.closable : true, pausable: !!(plan && plan.pausable), renewable: plan ? !!plan.renewable : true });
  const onSubmit = (e) => {
    e.preventDefault();
    form.submit(async (v) => {
      await api(plan ? `/plans/${plan.id}` : '/plans', { method: plan ? 'PUT' : 'POST', body: { ...v, tax_id: v.tax_id ? Number(v.tax_id) : null } });
      resetLookups(); toast.success('Plan saved'); onSaved(); onClose();
    });
  };
  return (
    <Modal wide title={plan ? `Edit ${plan.name}` : 'New plan'} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={form.saving} onClick={onSubmit}>Save plan</Button></>}>
      <form onSubmit={onSubmit} noValidate>
        <ErrorBox>{form.formError}</ErrorBox>
        <div className="form-grid">
          <TextField label="Plan name" required {...form.bind('name')} />
          <SelectField label="Billed" required {...form.bind('billing_period')}>{Object.entries(PERIOD_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</SelectField>
          <TextField label="Plan price (per billing period)" type="number" step="0.01" min="0" required {...form.bind('price')} hint="Added to every invoice as the plan fee" />
          <TextField label="Minimum quantity" type="number" min="1" step="1" required {...form.bind('min_quantity')} hint="Lowest quantity allowed on a product line" />
          <TextField label="Available from" type="date" {...form.bind('available_from')} />
          <TextField label="Available until" type="date" {...form.bind('available_to')} />
          <SelectField label="Tax on the plan fee" {...form.bind('tax_id')}>
            <option value="">No tax</option>{lookups && lookups.taxes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </SelectField>
        </div>
        <AreaField label="Description" {...form.bind('description')} />
        <h3 style={{ margin: '4px 0 8px' }}>What can happen to a subscription on this plan?</h3>
        <CheckField label="Close automatically when it ends" hint="Off: the subscription renews itself for another term when its expiry date passes." {...form.bindCheck('auto_close')} />
        <CheckField label="Can be closed early" hint="Customers and staff may close it before the expiry date." {...form.bindCheck('closable')} />
        <CheckField label="Can be paused" hint="No invoices are created while it is paused." {...form.bindCheck('pausable')} />
        <CheckField label="Can be renewed" hint="The term can be extended before it ends." {...form.bindCheck('renewable')} />
        <CheckField label="Offered to new customers" {...form.bindCheck('active')} />
      </form>
    </Modal>
  );
}

export default function Plans() {
  const m = useMoney();
  const toast = useToast();
  const { user } = useAuth();
  const canEdit = user.role === 'admin';
  const [modal, setModal] = useState(null);
  const { data, loading, error, reload } = useFetch(() => api('/plans'), []);
  const yes = (b) => (b ? <Badge tone="green">Yes</Badge> : <Badge tone="gray">No</Badge>);

  const remove = async (p) => {
    if (!window.confirm(`Delete ${p.name}? If it is already used it will be hidden instead.`)) return;
    try { const r = await api(`/plans/${p.id}`, { method: 'DELETE' }); resetLookups(); toast.success(r.deactivated ? 'Plan is in use, so it was deactivated' : 'Plan deleted'); reload(); } catch (e) { toast.error(e.message); }
  };

  return (
    <Page title="Plans" subtitle="What a plan costs, how often it bills, and what customers may do with it." actions={canEdit && <Button variant="primary" onClick={() => setModal({})}>New plan</Button>}>
      <Card pad={false}>
        <ErrorBox onRetry={reload}>{error}</ErrorBox>
        {!canEdit && <div className="card-body"><small className="muted">Only the admin can change plans.</small></div>}
        <Table
          rows={data && data.data}
          loading={loading}
          rowClass={(r) => (r.active ? '' : 'row-muted')}
          columns={[
            { key: 'name', label: 'Plan', render: (r) => <><b>{r.name}</b>{!r.active && <> <Badge tone="gray">Inactive</Badge></>}<br /><small>{r.description}</small></> },
            { key: 'billing_period', label: 'Billed', render: (r) => PERIOD_LABEL[r.billing_period] },
            { key: 'price', label: 'Price', align: 'right', render: (r) => <b className="num">{m(r.price)}</b> },
            { key: 'min_quantity', label: 'Min qty', align: 'right' },
            { key: 'available', label: 'Available', render: (r) => (r.available_from || r.available_to ? `${fdate(r.available_from)} to ${fdate(r.available_to)}` : 'Always') },
            { key: 'auto_close', label: 'Ends by itself', render: (r) => yes(r.auto_close) },
            { key: 'closable', label: 'Close early', render: (r) => yes(r.closable) },
            { key: 'pausable', label: 'Pause', render: (r) => yes(r.pausable) },
            { key: 'renewable', label: 'Renew', render: (r) => yes(r.renewable) },
            ...(canEdit ? [{ key: 'actions', label: '', align: 'right', render: (r) => (<><Button size="sm" onClick={() => setModal(r)}>Edit</Button> <Button size="sm" variant="ghost" onClick={() => remove(r)}>Delete</Button></>) }] : []),
          ]}
        />
      </Card>
      {modal && <PlanModal plan={modal.id ? modal : null} onClose={() => setModal(null)} onSaved={reload} />}
    </Page>
  );
}
