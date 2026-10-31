// All calls to the backend go through here.
const BASE = import.meta.env.VITE_API_URL || '';
const TOKEN_KEY = 'odoo_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

export class ApiError extends Error {
  constructor(message, status, fields) {
    super(message);
    this.status = status;
    this.fields = fields || {};
  }
}

export async function api(path, { method = 'GET', body, params } = {}) {
  const query = params
    ? `?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString()}`
    : '';
  const token = getToken();
  let res;
  try {
    res = await fetch(`${BASE}/api${path}${query}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new ApiError('Cannot reach the server. Is the backend running?', 0);
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) {
    if (res.status === 401 && token) {
      setToken(null);
      window.dispatchEvent(new Event('odoo:logout'));
    }
    throw new ApiError((data && data.error) || `Request failed (${res.status})`, res.status, data && data.fields);
  }
  return data;
}
