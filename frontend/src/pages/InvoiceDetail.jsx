import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../hooks';
import InvoiceDocument from '../components/InvoiceDocument';
import PaymentModal from '../components/PaymentModal';
import { Button, ErrorBox, Page, Spinner, StatusBadge, useToast } from '../ui';

export default function InvoiceDetail() {
  const { id } = useParams();
  const toast = useToast();
  const { user } = useAuth();
  const { data: inv, loading, error, reload } = useFetch(() => api(`/invoices/${id}`), [id]);
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const [paying, setPaying] = useState(false);

  if (loading && !inv) return <Spinner />;
  if (error) return <ErrorBox onRetry={reload}>{error}</ErrorBox>;

  const act = async (action, doneText) => {
    setBusy(action); setActionError('');
    try { await api(`/invoices/${id}/${action}`, { method: 'POST', body: {} }); toast.success(doneText); reload(); } catch (e) { setActionError(e.message); } finally { setBusy(''); }
  };
  const removePayment = async (pid) => {
    if (!window.confirm('Remove this payment? The invoice balance will be restored.')) return;
    try { await api(`/payments/${pid}`, { method: 'DELETE' }); toast.success('Payment removed'); reload(); } catch (e) { setActionError(e.message); }
  };

  const canCancel = (inv.status === 'draft' || inv.status === 'confirmed') && inv.amount_paid === 0;

  return (
    <Page
      title={<>{inv.number} <StatusBadge status={inv.status} overdue={inv.overdue} /></>}
      subtitle={<>For <Link to={`/subscriptions/${inv.subscription_id}`}>{inv.subscription_number}</Link>{inv.sent_at ? ` - sent ${inv.sent_at.slice(0, 10)}` : ' - not sent yet'}</>}
      actions={
        <>
          {inv.status === 'draft' && <Button variant="primary" loading={busy === 'confirm'} onClick={() => act('confirm', 'Invoice confirmed')}>Confirm</Button>}
          {inv.status === 'confirmed' && <Button variant="primary" onClick={() => setPaying(true)}>Record payment</Button>}
          {inv.status !== 'cancelled' && <Button loading={busy === 'send'} onClick={() => act('send', 'Invoice emailed to the customer')}>{inv.status === 'draft' ? 'Confirm & send' : inv.sent_at ? 'Send again' : 'Send'}</Button>}
          <Button onClick={() => window.print()}>Print</Button>
          {canCancel && <Button variant="danger" loading={busy === 'cancel'} onClick={() => { if (window.confirm('Cancel this invoice?')) act('cancel', 'Invoice cancelled'); }}>Cancel invoice</Button>}
        </>
      }
    >
      <ErrorBox>{actionError}</ErrorBox>
      <InvoiceDocument invoice={inv} />
      {user.role === 'admin' && inv.payments.length > 0 && (
        <div className="no-print" style={{ marginTop: 14 }}>
          <small className="muted">Admin: </small>
          {inv.payments.map((p) => <Button key={p.id} size="sm" variant="ghost" onClick={() => removePayment(p.id)}>Remove payment of {p.amount}</Button>)}
        </div>
      )}
      {paying && <PaymentModal invoice={inv} onClose={() => setPaying(false)} onSaved={reload} />}
    </Page>
  );
}
