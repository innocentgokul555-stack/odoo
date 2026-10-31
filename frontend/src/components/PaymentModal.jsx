import { useState } from 'react';
import { api } from '../api';
import { METHODS, todayStr } from '../format';
import { AreaField, Button, ErrorBox, InvoicePicker, Modal, SelectField, TextField, useForm, useMoney, useToast } from '../ui';

// Records a payment against an invoice (method, amount, date, note).
export default function PaymentModal({ invoice, onClose, onSaved }) {
  const toast = useToast();
  const m = useMoney();
  const [chosen, setChosen] = useState(invoice || null);
  const form = useForm({ amount: invoice ? String(invoice.balance) : '', method: 'bank_transfer', paid_on: todayStr(), note: '' });

  const onSubmit = (e) => {
    e.preventDefault();
    form.submit(async (v) => {
      if (!chosen) { const err = new Error('Please fix the highlighted fields'); err.fields = { invoice_id: 'Choose an invoice' }; throw err; }
      const payment = await api('/payments', { method: 'POST', body: { invoice_id: chosen.id, method: v.method, amount: Number(v.amount), paid_on: v.paid_on, note: v.note } });
      toast.success('Payment recorded');
      onSaved && onSaved(payment);
      onClose();
    });
  };

  return (
    <Modal
      title="Record a payment"
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={form.saving} onClick={onSubmit}>Save payment</Button></>}
    >
      <form onSubmit={onSubmit} noValidate>
        <ErrorBox>{form.formError}</ErrorBox>
        {invoice ? (
          <p style={{ marginTop: 0 }}><b>{invoice.number}</b> - {invoice.customer_name}<br /><span className="muted">Outstanding balance: {m(invoice.balance)}</span></p>
        ) : (
          <InvoicePicker
            value={chosen && chosen.id}
            error={form.errors.invoice_id}
            onChange={(inv) => { setChosen(inv); form.set('amount', String(inv.balance)); }}
          />
        )}
        {!invoice && chosen && <p className="muted" style={{ marginTop: -6 }}>Outstanding balance: {m(chosen.balance)}</p>}
        <div className="form-grid">
          <TextField label="Amount" type="number" step="0.01" min="0" {...form.bind('amount')} required />
          <TextField label="Payment date" type="date" max={todayStr()} {...form.bind('paid_on')} required />
          <SelectField label="Method" {...form.bind('method')}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</SelectField>
        </div>
        <AreaField label="Note" placeholder="Bank reference, cheque number..." {...form.bind('note')} />
      </form>
    </Modal>
  );
}
