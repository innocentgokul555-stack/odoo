import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../hooks';
import { fdate } from '../format';
import { Badge, Button, Card, CheckField, ErrorBox, Modal, Notice, Page, Table, TextField, useForm, useToast } from '../ui';

function StaffModal({ member, onClose, onSaved }) {
  const toast = useToast();
  const form = useForm({ name: '', email: '', phone: '', password: '', active: true, ...(member || {}), password: '' });
  const onSubmit = (e) => {
    e.preventDefault();
    form.submit(async (v) => {
      const body = member ? { name: v.name, phone: v.phone, active: v.active, password: v.password || undefined } : { name: v.name, email: v.email, phone: v.phone, password: v.password };
      await api(member ? `/staff/${member.id}` : '/staff', { method: member ? 'PUT' : 'POST', body });
      toast.success(member ? 'Staff member saved' : 'Staff member added'); onSaved(); onClose();
    });
  };
  return (
    <Modal title={member ? `Edit ${member.name}` : 'Add a member of staff'} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={form.saving} onClick={onSubmit}>Save</Button></>}>
      <form onSubmit={onSubmit} noValidate>
        <ErrorBox>{form.formError}</ErrorBox>
        <TextField label="Full name" required {...form.bind('name')} />
        {!member && <TextField label="Email" type="email" required {...form.bind('email')} />}
        <TextField label="Phone" {...form.bind('phone')} />
        <TextField label={member ? 'New password (leave empty to keep the current one)' : 'Password'} type="password" autoComplete="new-password" required={!member} {...form.bind('password')}
          hint="More than 8 characters, with an uppercase letter, a lowercase letter and a special character" />
        {member && member.role !== 'admin' && <CheckField label="Account is active" {...form.bindCheck('active')} />}
        <Notice>Staff can manage customers, subscriptions, invoices and payments. They cannot change products, plans, taxes or discounts, or add other staff.</Notice>
      </form>
    </Modal>
  );
}

export default function Staff() {
  const { user } = useAuth();
  const [modal, setModal] = useState(null);
  const { data, loading, error, reload } = useFetch(() => api('/staff'), []);
  return (
    <Page title="Staff" subtitle="Only the admin can add a member of staff." actions={<Button variant="primary" onClick={() => setModal({})}>Add staff member</Button>}>
      <Card pad={false}>
        <ErrorBox onRetry={reload}>{error}</ErrorBox>
        <Table
          rows={data && data.data}
          loading={loading}
          rowClass={(r) => (r.active ? '' : 'row-muted')}
          columns={[
            { key: 'name', label: 'Name', render: (r) => <b>{r.name}{r.id === user.id ? ' (you)' : ''}</b> },
            { key: 'email', label: 'Email' },
            { key: 'role', label: 'Role', render: (r) => <Badge tone={r.role === 'admin' ? 'indigo' : 'blue'}>{r.role === 'admin' ? 'Admin' : 'Staff'}</Badge> },
            { key: 'created_at', label: 'Added', render: (r) => fdate(r.created_at.slice(0, 10)) },
            { key: 'active', label: 'Status', render: (r) => (r.active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Disabled</Badge>) },
            { key: 'actions', label: '', align: 'right', render: (r) => <Button size="sm" onClick={() => setModal(r)}>Edit</Button> },
          ]}
        />
      </Card>
      {modal && <StaffModal member={modal.id ? modal : null} onClose={() => setModal(null)} onSaved={reload} />}
    </Page>
  );
}
