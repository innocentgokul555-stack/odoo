import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useConfig } from './auth';
import { money as fmtMoney, cap } from './format';
import { api } from './api';

/* ---------------------------- Layout bits ---------------------------- */
export function Page({ title, subtitle, actions, children }) {
  return (
    <div className="page">
      <div className="page-head no-print">
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Card({ title, actions, children, className = '', pad = true }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <h2>{title}</h2>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={pad ? 'card-body' : ''}>{children}</div>
    </section>
  );
}

export function Spinner({ label = 'Loading...' }) {
  return <div className="spinner" role="status"><span className="dot" />{label}</div>;
}
export function ErrorBox({ children, onRetry }) {
  if (!children) return null;
  return (
    <div className="alert alert-error" role="alert">
      <span>{children}</span>
      {onRetry && <button className="btn btn-sm" onClick={onRetry}>Try again</button>}
    </div>
  );
}
export const Notice = ({ tone = 'info', children }) => <div className={`alert alert-${tone}`}>{children}</div>;
export const Empty = ({ children = 'Nothing here yet.' }) => <div className="empty">{children}</div>;

/* ------------------------------ Buttons ------------------------------ */
export function Button({ variant = 'secondary', size, loading, children, className = '', disabled, ...rest }) {
  return (
    <button
      className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? 'Please wait...' : children}
    </button>
  );
}

/* ------------------------------- Badges ------------------------------- */
const TONES = {
  draft: 'gray', quotation: 'blue', confirmed: 'indigo', active: 'green', closed: 'dark', paused: 'amber',
  paid: 'green', cancelled: 'dark', overdue: 'red', running: 'green', scheduled: 'blue', expired: 'dark', 'used up': 'amber', inactive: 'gray',
};
export function Badge({ tone = 'gray', children }) { return <span className={`badge badge-${tone}`}>{children}</span>; }
export function StatusBadge({ status, overdue, paused }) {
  if (overdue) return <Badge tone="red">Overdue</Badge>;
  if (paused) return <Badge tone="amber">Paused</Badge>;
  return <Badge tone={TONES[status] || 'gray'}>{cap(status)}</Badge>;
}

/* -------------------------------- Money -------------------------------- */
export function useMoney() {
  const { currency } = useConfig();
  return useCallback((n) => fmtMoney(n, currency), [currency]);
}
export function Money({ value, className }) {
  const m = useMoney();
  return <span className={`num ${className || ''}`}>{m(value)}</span>;
}

/* -------------------------------- Forms -------------------------------- */
export function Field({ label, error, hint, required, children, className = '' }) {
  return (
    <label className={`field ${error ? 'has-error' : ''} ${className}`}>
      {label && <span className="field-label">{label}{required && <i aria-hidden> *</i>}</span>}
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}
export const TextField = ({ label, error, hint, required, className, ...p }) => (
  <Field label={label} error={error} hint={hint} required={required} className={className}><input className="input" {...p} /></Field>
);
export const AreaField = ({ label, error, hint, className, ...p }) => (
  <Field label={label} error={error} hint={hint} className={className}><textarea className="input" rows={3} {...p} /></Field>
);
export const SelectField = ({ label, error, hint, required, children, className, ...p }) => (
  <Field label={label} error={error} hint={hint} required={required} className={className}><select className="input" {...p}>{children}</select></Field>
);
export function CheckField({ label, hint, ...p }) {
  return (
    <label className="check">
      <input type="checkbox" {...p} />
      <span><b>{label}</b>{hint && <small>{hint}</small>}</span>
    </label>
  );
}

// Keeps form values + server-side field errors together.
export function useForm(initial) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const set = (name, value) => setValues((v) => ({ ...v, [name]: value }));
  const bind = (name) => ({
    value: values[name] ?? '',
    onChange: (e) => set(name, e.target.type === 'checkbox' ? e.target.checked : e.target.value),
    error: errors[name],
  });
  const bindCheck = (name) => ({ checked: !!values[name], onChange: (e) => set(name, e.target.checked) });
  const submit = async (fn) => {
    setSaving(true); setFormError(''); setErrors({});
    try { return await fn(values); } catch (e) {
      setErrors(e.fields || {});
      setFormError(e.message);
      return undefined;
    } finally { setSaving(false); }
  };
  return { values, setValues, set, bind, bindCheck, errors, saving, formError, submit };
}

/* -------------------------------- Modal -------------------------------- */
export function Modal({ title, onClose, children, footer, wide }) {
  const titleId = useId();
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">x</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

/* --------------------------------- Toast -------------------------------- */
const ToastContext = createContext({ success: () => {}, error: () => {} });
export const useToast = () => useContext(ToastContext);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((tone, text) => {
    const id = Math.random().toString(36).slice(2);
    setItems((l) => [...l, { id, tone, text }]);
    setTimeout(() => setItems((l) => l.filter((i) => i.id !== id)), 4500);
  }, []);
  const api2 = useMemo(() => ({ success: (t) => push('success', t), error: (t) => push('error', t) }), [push]);
  return (
    <ToastContext.Provider value={api2}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((i) => <div key={i.id} className={`toast toast-${i.tone}`}>{i.text}</div>)}
      </div>
    </ToastContext.Provider>
  );
}

/* --------------------------------- Table -------------------------------- */
export function Table({ columns, rows, loading, empty, onRowClick, rowKey = 'id', rowClass }) {
  if (loading && !rows?.length) return <Spinner />;
  if (!rows?.length) return <Empty>{empty || 'Nothing here yet.'}</Empty>;
  return (
    <div className={`table-wrap ${loading ? 'is-loading' : ''}`}>
      <table className="table">
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={c.align === 'right' ? 'right' : ''} style={c.width ? { width: c.width } : undefined}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[rowKey]} className={`${onRowClick ? 'clickable' : ''} ${rowClass ? rowClass(r) : ''}`} onClick={onRowClick ? () => onRowClick(r) : undefined}>
              {columns.map((c) => (
                <td key={c.key} className={c.align === 'right' ? 'right' : ''} data-label={c.label}>{c.render ? c.render(r) : r[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ meta, onPage }) {
  if (!meta || meta.total === 0) return null;
  const from = (meta.page - 1) * meta.page_size + 1;
  const to = Math.min(meta.total, meta.page * meta.page_size);
  return (
    <div className="pagination no-print">
      <span className="muted">Showing {from}-{to} of {meta.total.toLocaleString()}</span>
      <div>
        <Button size="sm" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>Previous</Button>
        <span className="page-num">Page {meta.page} of {meta.total_pages}</span>
        <Button size="sm" disabled={meta.page >= meta.total_pages} onClick={() => onPage(meta.page + 1)}>Next</Button>
      </div>
    </div>
  );
}

/* ----------------------------- Stat card ----------------------------- */
export function Stat({ label, value, sub, tone, to }) {
  const body = (
    <>
      <span className="stat-label">{label}</span>
      <strong className={`stat-value ${tone ? `tone-${tone}` : ''}`}>{value}</strong>
      {sub && <span className="stat-sub">{sub}</span>}
    </>
  );
  return to ? <Link to={to} className="stat stat-link">{body}</Link> : <div className="stat">{body}</div>;
}

/* ------------------------------- Pickers ------------------------------- */
// Search-as-you-type picker, so it stays fast with thousands of customers.
export function CustomerPicker({ value, onChange, error, label = 'Customer', required, allowEmpty }) {
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const box = useRef(null);

  useEffect(() => {
    if (!value) { setName(''); return; }
    api(`/customers/${value}`).then((c) => setName(`${c.name}${c.company ? ` (${c.company})` : ''}`)).catch(() => setName(`Customer #${value}`));
  }, [value]);
  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => api('/customers', { params: { search: text, page_size: 8, active: 'true' } }).then((r) => setResults(r.data)).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [text, open]);
  useEffect(() => {
    const close = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const pick = (c) => { onChange(c ? c.id : ''); setOpen(false); setText(''); };
  return (
    <div className={`field picker ${error ? 'has-error' : ''}`} ref={box}>
      <span className="field-label">{label}{required && <i> *</i>}</span>
      <div className="picker-box">
        <input
          className="input"
          placeholder="Search by name, email or company..."
          value={open ? text : name}
          onFocus={() => { setOpen(true); setText(''); }}
          onChange={(e) => setText(e.target.value)}
          aria-label={label}
        />
        {allowEmpty && value && <button type="button" className="icon-btn" onClick={() => pick(null)} aria-label="Clear">x</button>}
      </div>
      {open && (
        <ul className="picker-list">
          {results.length === 0 && <li className="muted">No customers found</li>}
          {results.map((c) => (
            <li key={c.id}><button type="button" onClick={() => pick(c)}><b>{c.name}</b><small>{c.company || c.email}</small></button></li>
          ))}
        </ul>
      )}
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}

export function InvoicePicker({ value, onChange, error }) {
  const [label, setLabel] = useState('');
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const m = useMoney();
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => api('/invoices', { params: { status: 'outstanding', search: text, page_size: 8, sort: 'due_date', dir: 'asc' } }).then((r) => setResults(r.data)).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [text, open]);
  useEffect(() => {
    const close = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div className={`field picker ${error ? 'has-error' : ''}`} ref={box}>
      <span className="field-label">Invoice <i>*</i></span>
      <input
        className="input"
        placeholder="Search unpaid invoices by number or customer..."
        value={open ? text : label}
        onFocus={() => { setOpen(true); setText(''); }}
        onChange={(e) => setText(e.target.value)}
        aria-label="Invoice"
      />
      {open && (
        <ul className="picker-list">
          {results.length === 0 && <li className="muted">No unpaid invoices found</li>}
          {results.map((i) => (
            <li key={i.id}>
              <button type="button" onClick={() => { onChange(i); setLabel(`${i.number} - ${i.customer_name}`); setOpen(false); }}>
                <b>{i.number} - {i.customer_name}</b><small>Balance {m(i.balance)} - due {i.due_date}{i.overdue ? ' (overdue)' : ''}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <span className="field-error">{error}</span>}
      {value && !label && <span className="field-hint">Invoice #{value}</span>}
    </div>
  );
}
