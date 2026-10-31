import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useFetch } from '../hooks';
import { todayStr } from '../format';
import { Button, CheckField, ErrorBox, Modal, Notice, TextField, useToast } from '../ui';

// "Billing day": creates every invoice that is due, once, from the subscriptions.
export default function BillingModal({ onClose, onDone }) {
  const toast = useToast();
  const [asOf, setAsOf] = useState(todayStr());
  const [auto, setAuto] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const preview = useFetch(() => api('/billing/preview', { params: { as_of: asOf } }), [asOf]);

  const run = async () => {
    setRunning(true); setError('');
    try {
      const r = await api('/billing/run', { method: 'POST', body: { as_of: asOf, auto_confirm: auto } });
      setResult(r);
      toast.success(`${r.invoices_created} invoice(s) created`);
      onDone && onDone(r);
    } catch (e) { setError(e.message); } finally { setRunning(false); }
  };

  return (
    <Modal
      title="Run billing"
      onClose={onClose}
      footer={result ? <Button variant="primary" onClick={onClose}>Done</Button> : (
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={running} onClick={run}>Create invoices now</Button>
        </>
      )}
    >
      {result ? (
        <>
          <Notice tone="success"><b>{result.invoices_created}</b> invoice(s) created for <b>{result.subscriptions_billed}</b> subscription(s).</Notice>
          <ul>
            <li>{result.activated} confirmed subscription(s) became active</li>
            <li>{result.closed} subscription(s) closed because their plan ended</li>
            <li>{result.rolled_over} subscription(s) rolled into a new term</li>
          </ul>
          {result.errors.length > 0 && <ErrorBox>{result.errors.length} subscription(s) could not be billed: {result.errors.map((e) => e.error).join('; ')}</ErrorBox>}
          {result.invoices_created > 0 && <p><Link to="/invoices?status=draft" onClick={onClose}>Review the new draft invoices</Link></p>}
        </>
      ) : (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Every active subscription that is due gets its invoice, with the customer details, product lines, taxes and discounts already filled in.
            It is safe to run this more than once: a billing period is never invoiced twice, and any period that was missed is caught up.
          </p>
          <TextField label="Bill everything due up to" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          {preview.data && (
            <Notice tone="info">
              {preview.data.subscriptions_due} subscription(s) are due for billing
              {preview.data.subscriptions_to_activate > 0 && <> and {preview.data.subscriptions_to_activate} confirmed one(s) will be activated first</>}.
            </Notice>
          )}
          <CheckField label="Confirm the new invoices straight away" hint="Otherwise they stay as drafts so you can check them first." checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          <ErrorBox>{error}</ErrorBox>
        </>
      )}
    </Modal>
  );
}
