import { useConfig } from '../auth';
import { fdate, methodLabel } from '../format';
import { useMoney } from '../ui';

// The invoice as the customer sees it (and as it prints).
export default function InvoiceDocument({ invoice: inv }) {
  const { company } = useConfig();
  const m = useMoney();
  const stamp = inv.status === 'paid' ? ['PAID', 'paid'] : inv.status === 'cancelled' ? ['CANCELLED', 'cancelled']
    : inv.status === 'draft' ? ['DRAFT', 'draft'] : inv.overdue ? ['OVERDUE', 'overdue'] : null;
  const taxGroups = {};
  inv.lines.forEach((l) => { if (l.tax_amount) taxGroups[l.tax_name || 'Tax'] = (taxGroups[l.tax_name || 'Tax'] || 0) + l.tax_amount; });

  return (
    <article className="doc print-area">
      {stamp && <div className={`doc-stamp stamp-${stamp[1]}`}>{stamp[0]}</div>}
      <div className="doc-head">
        <div>
          <div className="doc-title">Invoice</div>
          <div className="muted">{inv.number}</div>
        </div>
        <div style={{ textAlign: 'right', marginRight: stamp ? 130 : 0 }}>
          <b style={{ fontSize: 17 }}>{company}</b>
          <div className="muted">Subscription billing</div>
        </div>
      </div>

      <div className="doc-meta">
        <div><h4>Billed to</h4><b>{inv.customer_name}</b>{inv.customer_company && <div>{inv.customer_company}</div>}<div className="muted">{inv.customer_email}</div>{inv.customer_address && <div className="muted">{inv.customer_address}</div>}</div>
        <div><h4>Invoice date</h4>{fdate(inv.invoice_date)}<h4 style={{ marginTop: 10 }}>Due date</h4>{fdate(inv.due_date)}<div className="muted">{inv.payment_term_name}</div></div>
        <div><h4>Billing period</h4>{fdate(inv.period_start)} - {fdate(inv.period_end)}<h4 style={{ marginTop: 10 }}>Subscription</h4>{inv.subscription_number}</div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Description</th><th className="right">Qty</th><th className="right">Unit price</th><th className="right">Discount</th><th className="right">Tax</th><th className="right">Amount</th></tr></thead>
          <tbody>
            {inv.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.description}</td>
                <td className="right num">{l.quantity}</td>
                <td className="right num">{m(l.unit_price)}</td>
                <td className="right num">{l.discount_amount ? `-${m(l.discount_amount)}` : '-'}</td>
                <td className="right num">{l.tax_rate ? `${l.tax_rate}%` : '-'}</td>
                <td className="right num">{m(l.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="totals" style={{ marginTop: 18 }}>
        <div><span>Subtotal</span><span className="num">{m(inv.subtotal)}</span></div>
        {inv.discounts.map((d) => <div key={d.id} className="muted"><span>Discount: {d.name}</span><span className="num">-{m(d.amount)}</span></div>)}
        {Object.entries(taxGroups).map(([name, amt]) => <div key={name}><span>{name}</span><span className="num">{m(amt)}</span></div>)}
        <div className="grand"><span>Total</span><span className="num">{m(inv.total)}</span></div>
        {inv.amount_paid > 0 && <div><span>Paid</span><span className="num">-{m(inv.amount_paid)}</span></div>}
        {inv.status !== 'cancelled' && <div style={{ fontWeight: 700 }}><span>Balance due</span><span className="num">{m(inv.balance)}</span></div>}
      </div>

      {inv.payments.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <h3>Payments received</h3>
          <table className="table">
            <tbody>
              {inv.payments.map((p) => (
                <tr key={p.id}><td>{fdate(p.paid_on)}</td><td>{methodLabel(p.method)}</td><td className="muted">{p.note}</td><td className="right num">{m(p.amount)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}
