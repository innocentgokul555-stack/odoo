import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useDebounced, useFetch, useQueryState } from '../hooks';
import { Badge, Button, Card, ErrorBox, Modal, Notice, Page, Pagination, AreaField, CheckField, Table, TextField, useForm, useMoney, useToast } from '../ui';

function CustomerModal({ customer, onClose, onSaved }) {
  const toast = useToast();
  const form = useForm({ name: '', email: '', company: '', phone: '', address: '', active: true, ...(customer || {}) });
  const [setupLink, setSetupLink] = useState('');
  const onSubmit = (e) => {
    e.preventDefault();
    form.submit(async (v) => {
      const saved = await api(customer ? `/customers/${customer.id}` : '/customers', { method: customer ? 'PUT' : 'POST', body: v });
      toast.success(customer ? 'Customer saved' : 'Customer created');
      onSaved();
      if (saved.demo_setup_link) setSetupLink(saved.demo_setup_link); else onClose();
    });
  };
  return (
    <Modal title={customer ? 'Edit customer' : 'New customer'} onClose={onClose}
      footer={setupLink ? <Button variant="primary" onClick={onClose}>Done</Button> : <><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={form.saving} onClick={onSubmit}>Save</Button></>}>
      {setupLink ? (
        <Notice tone="success">Customer created. An email with a link to choose their password was sent (see Email outbox).<br />Demo link: <a href={setupLink.replace(/^https?:\/\/[^/]+/, '')}>{setupLink.replace(/^https?:\/\/[^/]+/, '').slice(0, 60)}...</a></Notice>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <ErrorBox>{form.formError}</ErrorBox>
          <div className="form-grid">
            <TextField label="Full name" required {...form.bind('name')} />
            <TextField label="Email" type="email" required {...form.bind('email')} />
            <TextField label="Company" {...form.bind('company')} />
            <TextField label="Phone" {...form.bind('phone')} />
          </div>
          <AreaField label="Billing address" {...form.bind('address')} />
          {customer && <CheckField label="Account is active" hint="Disabled customers cannot sign in or get new subscriptions." {...form.bindCheck('active')} />}
          {!customer && <small className="muted">The customer receives an email to choose their own password.</small>}
        </form>
      )}
    </Modal>
  );
}

export default function Customers() {
  const m = useMoney();
  const navigate = useNavigate();
  const [q, setQ] = useQueryState({ search: '', page: '1' });
  const [text, setText] = useState(q.search);
  const debounced = useDebounced(text);
  useEffect(() => { if (debounced !== q.search) setQ({ search: debounced }); }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  const [modal, setModal] = useState(null);
  const { data, loading, error, reload } = useFetch(() => api('/customers', { params: { search: q.search, page: q.page, page_size: 20 } }), [q.search, q.page]);

  return (
    <Page title="Customers" subtitle="Customers sign themselves up, or the team can add them here." actions={<Button variant="primary" onClick={() => setModal({})}>New customer</Button>}>
      <Card>
        <div className="filters"><TextField className="grow" label="Search" placeholder="Name, email or company" value={text} onChange={(e) => setText(e.target.value)} /></div>
        <ErrorBox onRetry={reload}>{error}</ErrorBox>
        <Table
          rows={data && data.data}
          loading={loading}
          empty="No customers found."
          rowClass={(r) => (r.active ? '' : 'row-muted')}
          columns={[
            { key: 'name', label: 'Customer', render: (r) => <><b>{r.name}</b>{!r.active && <> <Badge tone="gray">Disabled</Badge></>}<br /><small>{r.company}</small></> },
            { key: 'email', label: 'Contact', render: (r) => <>{r.email}<br /><small>{r.phone}</small></> },
            { key: 'active_subscriptions', label: 'Active subscriptions', align: 'right' },
            { key: 'outstanding', label: 'Owes', align: 'right', render: (r) => <span className={`num ${r.outstanding ? 'tone-red' : ''}`}>{m(r.outstanding)}</span> },
            { key: 'actions', label: '', align: 'right', render: (r) => (
              <>
                <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); navigate(`/subscriptions?customer_id=${r.id}`); }}>Subscriptions</Button>
                <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); navigate(`/invoices?customer_id=${r.id}`); }}>Invoices</Button>
                <Button size="sm" onClick={(e) => { e.stopPropagation(); setModal(r); }}>Edit</Button>
              </>
            ) },
          ]}
        />
        <Pagination meta={data && data.meta} onPage={(p) => setQ({ page: String(p) })} />
      </Card>
      {modal && <CustomerModal customer={modal.id ? modal : null} onClose={() => setModal(null)} onSaved={reload} />}
    </Page>
  );
}
