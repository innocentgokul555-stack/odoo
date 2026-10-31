import { useState } from 'react';
import { api } from '../api';
import { useFetch } from '../hooks';
import { resetLookups, useLookups } from '../lookups';
import LineEditor, { newLine } from '../components/LineEditor';
import { AreaField, Badge, Button, Card, CheckField, ErrorBox, Modal, Page, SelectField, Spinner, Table, TextField, useForm, useToast } from '../ui';

function TemplateModal({ template, onClose, onSaved }) {
  const toast = useToast();
  const lookups = useLookups();
  const form = useForm({ name: '', plan_id: '', validity_days: 30, notes: '', active: true, ...(template || {}) });
  const [lines, setLines] = useState(template ? template.lines.map((l) => ({ ...newLine(), product_id: l.product_id, variant_id: l.variant_id || '', quantity: l.quantity })) : []);
  if (!lookups) return <Modal title="Quotation template" onClose={onClose}><Spinner /></Modal>;

  const onSubmit = (e) => {
    e.preventDefault();
    form.submit(async (v) => {
      const body = { name: v.name, plan_id: v.plan_id ? Number(v.plan_id) : null, validity_days: v.validity_days, notes: v.notes, active: v.active,
        lines: lines.filter((l) => l.product_id).map((l) => ({ product_id: Number(l.product_id), variant_id: l.variant_id ? Number(l.variant_id) : null, quantity: Number(l.quantity) })) };
      await api(template ? `/templates/${template.id}` : '/templates', { method: template ? 'PUT' : 'POST', body });
      resetLookups(); toast.success('Template saved'); onSaved(); onClose();
    });
  };
  return (
    <Modal wide title={template ? `Edit ${template.name}` : 'New quotation template'} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={form.saving} onClick={onSubmit}>Save template</Button></>}>
      <form onSubmit={onSubmit} noValidate>
        <ErrorBox>{form.formError}</ErrorBox>
        <div className="form-grid">
          <TextField label="Template name" required {...form.bind('name')} />
          <SelectField label="Plan" required {...form.bind('plan_id')}>
            <option value="">Choose a plan...</option>{lookups.plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </SelectField>
          <TextField label="Quotation stays valid for (days)" type="number" min="1" step="1" required {...form.bind('validity_days')} />
        </div>
        <AreaField label="Notes" {...form.bind('notes')} />
        <h3 style={{ margin: '4px 0 6px' }}>Product lines</h3>
        <ErrorBox>{form.errors.lines}</ErrorBox>
        <LineEditor lines={lines} onChange={setLines} products={lookups.products} priced={false} />
        <CheckField label="Available to use" {...form.bindCheck('active')} />
      </form>
    </Modal>
  );
}

export default function Templates() {
  const toast = useToast();
  const [modal, setModal] = useState(null);
  const { data, loading, error, reload } = useFetch(() => api('/templates'), []);
  const remove = async (t) => {
    if (!window.confirm(`Delete ${t.name}?`)) return;
    try { await api(`/templates/${t.id}`, { method: 'DELETE' }); resetLookups(); toast.success('Template removed'); reload(); } catch (e) { toast.error(e.message); }
  };
  return (
    <Page title="Quotation templates" subtitle="Start an offer from a template instead of building it from scratch." actions={<Button variant="primary" onClick={() => setModal({})}>New template</Button>}>
      <Card pad={false}>
        <ErrorBox onRetry={reload}>{error}</ErrorBox>
        <Table
          rows={data && data.data}
          loading={loading}
          empty="No templates yet."
          rowClass={(r) => (r.active ? '' : 'row-muted')}
          columns={[
            { key: 'name', label: 'Template', render: (r) => <><b>{r.name}</b>{!r.active && <> <Badge tone="gray">Inactive</Badge></>}<br /><small>{r.notes}</small></> },
            { key: 'plan_name', label: 'Plan' },
            { key: 'validity_days', label: 'Valid for', render: (r) => `${r.validity_days} days` },
            { key: 'lines', label: 'Product lines', render: (r) => r.lines.map((l) => <div key={l.id}><small>{l.quantity} x {l.product_name}{l.value ? ` (${l.value})` : ''}</small></div>) },
            { key: 'actions', label: '', align: 'right', render: (r) => (<><Button size="sm" onClick={() => setModal(r)}>Edit</Button> <Button size="sm" variant="ghost" onClick={() => remove(r)}>Delete</Button></>) },
          ]}
        />
      </Card>
      {modal && <TemplateModal template={modal.id ? modal : null} onClose={() => setModal(null)} onSaved={reload} />}
    </Page>
  );
}
