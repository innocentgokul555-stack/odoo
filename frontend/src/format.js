export const money = (n, currency = 'USD') =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(n || 0));

export const num = (n) => new Intl.NumberFormat().format(Number(n || 0));

// Dates from the API are plain YYYY-MM-DD strings (UTC).
export function fdate(d) {
  if (!d) return '-';
  const dt = new Date(`${String(d).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) ? '-' : dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
export function fdatetime(s) {
  if (!s) return '-';
  const dt = new Date(`${String(s).replace(' ', 'T')}Z`);
  return Number.isNaN(dt.getTime()) ? '-' : dt.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export const todayStr = () => new Date().toISOString().slice(0, 10);
export function addMonthsStr(d, n) {
  const [y, m, day] = d.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(day, last));
  return dt.toISOString().slice(0, 10);
}
export function addDaysStr(d, n) {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : '');
export const PERIOD_LABEL = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };
export const PERIOD_UNIT = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };
export const METHODS = [
  ['bank_transfer', 'Bank transfer'], ['card', 'Card'], ['online', 'Online'], ['cheque', 'Cheque'], ['cash', 'Cash'], ['other', 'Other'],
];
export const methodLabel = (m) => (METHODS.find(([v]) => v === m) || [m, cap(m)])[1];
