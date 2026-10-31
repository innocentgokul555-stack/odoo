import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useFetch } from '../hooks';
import { useLookups } from '../lookups';
import { addDaysStr, addMonthsStr, PERIOD_LABEL, todayStr } from '../format';
import LineEditor, { newLine } from '../components/LineEditor';
import { Button, Card, CustomerPicker, ErrorBox, Notice, Page, SelectField, Spinner, TextField, AreaField, useForm, useMoney, useToast } from '../ui';

const defaultExpiry = (start, period) =>
  period === 'daily' ? addDaysStr(start, 30) : period === 'weekly' ? addDaysStr(start, 84) : addMonthsStr(start, 12);

// Used to create a subscription (optionally from a quotation template) and to edit drafts/quotations.
export default function SubscriptionForm() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const toast = useToast();
  const m = useMoney();
  const lookups = useLookups();
  const existing = useFetch(() => (editing ? api(`/subscriptions/${id}`) : Promise.resolve(null)), [id]);
  const form = useForm({ customer_id: '', template_id: '', plan_id: '', start_date: todayStr(), expiry_date: '', payment_term_id: '', notes: '' });
  const [lines, setLines] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!editing || !existing.data || loaded) return;
    const s = existing.data;
    form.setValues({ customer_id: s.customer_id, template_id: s.template_id || '', plan_id: s.plan_id, start_date: s.start_date, expiry_date: s.expiry_date, payment_term_id: s.payment_term_id || '', notes: s.notes || '' });
    setLines(s.lines.map((l) => ({ ...newLine(), product_id: l.product_id, variant_id: l.variant_id || '', quantity: l.quantity, unit_price: l.unit_price })));
    setLoaded(true);
  }, [existing.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const plan = useMemo(() => lookups && lookups.plans.find((p) => p.id === Number(form.values.plan_id)), [lookups, form.values.plan_id]);

  if (!lookups || (editing && !loaded)) return existing.error ? <ErrorBox>{existing.error}</ErrorBox> : <Spinner />;
  if (editing && !['draft', 'quotation'].includes(existing.data.status)) {
    return <Page title="Subscription locked"><Notice tone="warn">Once a subscription is confirmed its terms are locked. Open it from the subscriptions list instead.</Notice></Page>;
  }

  const setPlan = (planId) => {
    const p = lookups.plans.find((x) => x.id === Number(planId));
    form.set('plan_id', planId);
    if (p && !editing) form.set('expiry_date', defaultExpiry(form.values.start_date, p.billing_period));
  };
  const applyTemplate = (tplId) => {
    form.set('template_id', tplId);
    const t = lookups.templates.find((x) => x.id === Number(tplId));
    if (!t) return;
    const p = lookups.plans.find((x) => x.id === t.plan_id);
    form.setValues((v) => ({ ...v, template_id: tplId, plan_id: t.plan_id, expiry_date: p ? defaultExpiry(v.start_date, p.billing_period) : v.expiry_date }));
    setLines(t.lines.map((l) => {
      const prod = lookups.products.find((x) => x.id === l.product_id);
      const variant = prod && prod.variants.find((x) => x.id === l.variant_id);
      return { ...newLine(), product_id: l.product_id, variant_id: l.variant_id || '', quantity: l.quantity, unit_price: prod ? Math.round((prod.sales_price + (variant ? variant.extra_price : 0)) * 100) / 100 : '' };
    }));
  };

  // Live preview of one billing cycle.
  const byId = (pid) => lookups.products.find((p) => p.id === Number(pid));
  const planFee = plan ? plan.price : 0;
  let subtotal = planFee;
  let tax = plan ? (planFee * (plan.tax_rate || 0)) / 100 : 0;
  lines.forEach((l) => {
    const amt = (Number(l.quantity) || 0) * (Number(l.unit_price) || 0);
    subtotal += amt;
    const p = byId(l.product_id);
    tax += (amt * ((p && p.tax_rate) || 0)) / 100;
  });

  const onSubmit = (e) => {
    e.preventDefault();
    form.submit(async (v) => {
      const body = {
        customer_id: v.customer_id ? Number(v.customer_id) : null,
        plan_id: v.plan_id ? Number(v.plan_id) : null,
        template_id: v.template_id ? Number(v.template_id) : null,
        start_date: v.start_date, expiry_date: v.expiry_date,
        payment_term_id: v.payment_term_id ? Number(v.payment_term_id) : null,
        notes: v.notes,
        lines: lines.filter((l) => l.product_id).map((l) => ({
          product_id: Number(l.product_id), variant_id: l.variant_id ? Number(l.variant_id) : null,
          quantity: Number(l.quantity), unit_price: l.unit_price === '' ? null : Number(l.unit_price),
        })),
      };
      const saved = await api(editing ? `/subscriptions/${id}` : '/subscriptions', { method: editing ? 'PUT' : 'POST', body });
      toast.success(editing ? 'Subscription saved' : `Subscription ${saved.number} created`);
      navigate(`/subscriptions/${saved.id}`);
    });
  };

  return (
    <Page title={editing ? `Edit ${existing.data.number}` : 'New subscription'} subtitle="Start from a quotation template to fill in the plan and product lines for you.">
      <form onSubmit={onSubmit} noValidate>
        <ErrorBox>{form.formError}</ErrorBox>
        <Card title="Offer">
          <div className="form-grid">
            <CustomerPicker required value={form.values.customer_id} onChange={(cid) => form.set('customer_id', cid)} error={form.errors.customer_id} />
            <SelectField label="Quotation template" value={form.values.template_id} onChange={(e) => applyTemplate(e.target.value)} hint="Optional - fills in the plan and lines">
              <option value="">Start from scratch</option>
              {lookups.templates.map((t) => <option key={t.id} value={t.id}>{t.name} (valid {t.validity_days} days)</option>)}
            </SelectField>
            <SelectField label="Plan" required value={form.values.plan_id} onChange={(e) => setPlan(e.target.value)} error={form.errors.plan_id}
              hint={plan ? `${PERIOD_LABEL[plan.billing_period]} - plan fee ${m(plan.price)} - minimum quantity ${plan.min_quantity}` : undefined}>
              <option value="">Choose a plan...</option>
              {lookups.plans.map((p) => <option key={p.id} value={p.id}>{p.name} ({PERIOD_LABEL[p.billing_period]})</option>)}
            </SelectField>
            <SelectField label="Payment terms" value={form.values.payment_term_id} onChange={(e) => form.set('payment_term_id', e.target.value)} error={form.errors.payment_term_id}>
              <option value="">Immediate payment</option>
              {lookups.payment_terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </SelectField>
            <TextField label="Start date" type="date" required {...form.bind('start_date')} />
            <TextField label="Expiry date" type="date" required {...form.bind('expiry_date')} />
          </div>
          <AreaField label="Internal notes" {...form.bind('notes')} />
        </Card>

        <Card title="Product lines" pad={false}>
          <ErrorBox>{form.errors.lines}</ErrorBox>
          <LineEditor lines={lines} onChange={setLines} products={lookups.products} minQty={plan ? plan.min_quantity : 1} />
          <div className="card-body">
            <div className="totals">
              {planFee > 0 && <div><span>Plan fee</span><span className="num">{m(planFee)}</span></div>}
              <div><span>Subtotal per cycle</span><span className="num">{m(subtotal)}</span></div>
              <div><span>Tax</span><span className="num">{m(tax)}</span></div>
              <div className="grand"><span>Total per cycle</span><span className="num">{m(subtotal + tax)}</span></div>
            </div>
            <small className="muted">Discounts are applied automatically to invoices when their rules are met, so they are not shown here.</small>
          </div>
        </Card>

        <div className="page-actions">
          <Button type="button" onClick={() => navigate(editing ? `/subscriptions/${id}` : '/subscriptions')}>Cancel</Button>
          <Button variant="primary" type="submit" loading={form.saving}>{editing ? 'Save changes' : 'Create draft'}</Button>
        </div>
      </form>
    </Page>
  );
}
