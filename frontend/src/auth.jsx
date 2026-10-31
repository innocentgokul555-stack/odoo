import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from './api';
import { resetLookups } from './lookups';

const AuthContext = createContext(null);
const ConfigContext = createContext({ company: 'Brightloop Software', currency: 'USD', demo_mode: false });

export function ConfigProvider({ children }) {
  const [config, setConfig] = useState({ company: 'Brightloop Software', currency: 'USD', demo_mode: false });
  useEffect(() => { api('/config').then(setConfig).catch(() => {}); }, []);
  return <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>;
}
export const useConfig = () => useContext(ConfigContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(!getToken());

  useEffect(() => {
    if (!getToken()) return;
    api('/auth/me').then((r) => setUser(r.user)).catch(() => setToken(null)).finally(() => setReady(true));
  }, []);
  useEffect(() => {
    const onLogout = () => { resetLookups(); setUser(null); };
    window.addEventListener('odoo:logout', onLogout);
    return () => window.removeEventListener('odoo:logout', onLogout);
  }, []);

  const startSession = useCallback((r) => { setToken(r.token); resetLookups(); setUser(r.user); return r.user; }, []);
  const value = useMemo(() => ({
    user,
    ready,
    login: async (email, password) => startSession(await api('/auth/login', { method: 'POST', body: { email, password } })),
    signup: async (data) => startSession(await api('/auth/signup', { method: 'POST', body: data })),
    logout: () => { setToken(null); resetLookups(); setUser(null); },
    updateUser: (u) => setUser((prev) => ({ ...prev, ...u })),
  }), [user, ready, startSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);
export const isTeam = (user) => user && (user.role === 'admin' || user.role === 'staff');
