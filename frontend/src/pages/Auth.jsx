import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth, useConfig } from '../auth';
import { Button, ErrorBox, Notice, TextField, useForm } from '../ui';

function AuthShell({ title, subtitle, children, footer }) {
  const { company } = useConfig();
  return (
    <div className="auth">
      <div className="auth-hero">
        <h1>{company}</h1>
        <p>One place to run plans, subscriptions and recurring billing - from the first quotation to the last payment.</p>
        <ul>
          <li>Invoices created automatically on billing day</li>
          <li>Taxes and discounts applied by rules, not by memory</li>
          <li>Payments matched to invoices, overdue ones highlighted</li>
          <li>A customer portal so nobody has to send an email</li>
        </ul>
      </div>
      <div className="auth-panel">
        <div className="auth-card">
          <h2>{title}</h2>
          <p className="muted" style={{ marginTop: 0 }}>{subtitle}</p>
          {children}
          {footer && <p style={{ marginTop: 18 }}>{footer}</p>}
        </div>
      </div>
    </div>
  );
}

export const homeFor = (user) => (user.role === 'customer' ? '/portal' : '/');

export function Login() {
  const { login, user } = useAuth();
  const { demo_mode: demo } = useConfig();
  const navigate = useNavigate();
  const location = useLocation();
  const form = useForm({ email: '', password: '' });
  if (user) return <Navigate to={homeFor(user)} replace />;

  const demoLogin = (email, password) => form.setValues({ email, password });
  const onSubmit = (e) => {
    e.preventDefault();
    form.submit(async (v) => {
      const u = await login(v.email, v.password);
      const from = location.state && location.state.from && location.state.from.pathname;
      navigate(from && from !== '/login' ? from : homeFor(u), { replace: true });
    });
  };
  return (
    <AuthShell title="Sign in" subtitle="Welcome back. Enter your details to continue." footer={<>New customer? <Link to="/signup">Create an account</Link></>}>
      <form onSubmit={onSubmit} noValidate>
        <ErrorBox>{form.formError}</ErrorBox>
        <TextField label="Email" type="email" autoComplete="username" {...form.bind('email')} required />
        <TextField label="Password" type="password" autoComplete="current-password" {...form.bind('password')} required />
        <Button variant="primary" type="submit" loading={form.saving} style={{ width: '100%' }}>Sign in</Button>
        <p style={{ textAlign: 'right', marginBottom: 0 }}><Link to="/forgot-password">Forgot your password?</Link></p>
      </form>
      {demo && (
        <div className="demo-box">
          <b>Demo mode</b> <small>(after running <code>npm run seed</code>)</small>
          <div className="chips">
            <Button size="sm" onClick={() => demoLogin('admin@brightloop.test', 'Admin@12345')}>Fill in Admin</Button>
            <Button size="sm" onClick={() => demoLogin('staff@brightloop.test', 'Staff@12345')}>Fill in Staff</Button>
            <Button size="sm" onClick={() => demoLogin('customer@brightloop.test', 'Customer@123')}>Fill in Customer</Button>
          </div>
        </div>
      )}
    </AuthShell>
  );
}

const RULES = [
  ['More than 8 characters', (p) => p.length > 8],
  ['An uppercase letter', (p) => /[A-Z]/.test(p)],
  ['A lowercase letter', (p) => /[a-z]/.test(p)],
  ['A special character', (p) => /[^A-Za-z0-9]/.test(p)],
];
function PasswordRules({ value }) {
  return (
    <ul className="pw-rules" aria-label="Password rules">
      {RULES.map(([label, test]) => <li key={label} className={test(value) ? 'ok' : ''}>{test(value) ? '[ok]' : '[ ]'} {label}</li>)}
    </ul>
  );
}

export function Signup() {
  const { signup, user } = useAuth();
  const navigate = useNavigate();
  const form = useForm({ name: '', email: '', company: '', phone: '', password: '', confirm: '' });
  if (user) return <Navigate to={homeFor(user)} replace />;
  const onSubmit = (e) => {
    e.preventDefault();
    form.submit(async (v) => {
      if (v.password !== v.confirm) { const err = new Error('Please fix the highlighted fields'); err.fields = { confirm: 'Passwords do not match' }; throw err; }
      const { confirm, ...data } = v;
      const u = await signup(data);
      navigate(homeFor(u), { replace: true });
    });
  };
  return (
    <AuthShell title="Create your account" subtitle="Manage your subscriptions and invoices online." footer={<>Already have an account? <Link to="/login">Sign in</Link></>}>
      <form onSubmit={onSubmit} noValidate>
        <ErrorBox>{form.formError}</ErrorBox>
        <TextField label="Full name" autoComplete="name" {...form.bind('name')} required />
        <TextField label="Email" type="email" autoComplete="email" {...form.bind('email')} required hint="One account per email address" />
        <div className="form-grid">
          <TextField label="Company" {...form.bind('company')} />
          <TextField label="Phone" {...form.bind('phone')} />
        </div>
        <TextField label="Password" type="password" autoComplete="new-password" {...form.bind('password')} required />
        <PasswordRules value={form.values.password} />
        <TextField label="Confirm password" type="password" autoComplete="new-password" {...form.bind('confirm')} required />
        <Button variant="primary" type="submit" loading={form.saving} style={{ width: '100%' }}>Create account</Button>
      </form>
    </AuthShell>
  );
}

export function ForgotPassword() {
  const { demo_mode: demo } = useConfig();
  const form = useForm({ email: '' });
  const [result, setResult] = useState(null);
  const onSubmit = (e) => {
    e.preventDefault();
    form.submit(async (v) => setResult(await api('/auth/forgot-password', { method: 'POST', body: v })));
  };
  return (
    <AuthShell title="Forgot your password?" subtitle="Enter your registered email and we will send you a reset link." footer={<Link to="/login">Back to sign in</Link>}>
      {result ? (
        <>
          <Notice tone="success">{result.message}</Notice>
          {demo && result.demo_reset_link && (
            <div className="demo-box">
              <b>Demo mode:</b> no email server is connected, so here is the link that was "emailed":
              <p><a href={result.demo_reset_link.replace(/^https?:\/\/[^/]+/, '')}>Open the reset link</a></p>
            </div>
          )}
        </>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <ErrorBox>{form.formError}</ErrorBox>
          <TextField label="Email" type="email" {...form.bind('email')} required />
          <Button variant="primary" type="submit" loading={form.saving} style={{ width: '100%' }}>Send reset link</Button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const form = useForm({ password: '', confirm: '' });
  const [done, setDone] = useState(false);
  const token = params.get('token');
  const email = params.get('email');
  if (!token || !email) return <AuthShell title="Reset link problem" subtitle="This link is incomplete." footer={<Link to="/forgot-password">Request a new link</Link>} />;
  const onSubmit = (e) => {
    e.preventDefault();
    form.submit(async (v) => {
      if (v.password !== v.confirm) { const err = new Error('Please fix the highlighted fields'); err.fields = { confirm: 'Passwords do not match' }; throw err; }
      await api('/auth/reset-password', { method: 'POST', body: { token, email, password: v.password } });
      setDone(true);
      setTimeout(() => navigate('/login'), 1800);
    });
  };
  return (
    <AuthShell title="Choose a new password" subtitle={email}>
      {done ? <Notice tone="success">Your password was changed. Taking you to sign in...</Notice> : (
        <form onSubmit={onSubmit} noValidate>
          <ErrorBox>{form.formError}</ErrorBox>
          <TextField label="New password" type="password" autoComplete="new-password" {...form.bind('password')} required />
          <PasswordRules value={form.values.password} />
          <TextField label="Confirm new password" type="password" autoComplete="new-password" {...form.bind('confirm')} required />
          <Button variant="primary" type="submit" loading={form.saving} style={{ width: '100%' }}>Change password</Button>
        </form>
      )}
    </AuthShell>
  );
}
