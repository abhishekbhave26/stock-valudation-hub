import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

type AuthMode = 'login' | 'signup' | 'reset';

const LoginPage = () => {
  const navigate = useNavigate();
  const { user, loading, error, signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  const passwordMismatch = useMemo(
    () => mode === 'signup' && password && confirmPassword && password !== confirmPassword,
    [mode, password, confirmPassword]
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatusMessage('');

    if (passwordMismatch) {
      return;
    }

    if (mode === 'login') {
      await signIn(email, password);
      navigate('/dashboard');
    }

    if (mode === 'signup') {
      await signUp(email, password);
      setStatusMessage('Check your email to confirm your account before logging in.');
    }

    if (mode === 'reset') {
      await resetPassword(email);
      setStatusMessage('Password reset email sent. Check your inbox.');
    }
  };

  if (user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="rounded-2xl bg-white p-8 shadow-lg">
          <p className="text-slate-600">You are already signed in.</p>
          <Link
            to="/dashboard"
            className="mt-4 inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-6 py-12 lg:flex-row lg:items-center lg:gap-16">
        <div className="lg:w-1/2">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">
            Road to EB-5 ($900K Goal)
          </p>
          <h1 className="mt-4 text-3xl font-semibold text-slate-900 sm:text-4xl">
            Track every milestone on the way to your EB-5 investment goal.
          </h1>
          <p className="mt-4 text-base text-slate-600">
            Save snapshots of your assets, visualize progress, and keep all data securely stored in
            Supabase.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-slate-900">Progress ring</p>
              <p className="mt-1 text-xs text-slate-500">
                See % to goal, total saved, and remaining at a glance.
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-slate-900">Snapshots &amp; charts</p>
              <p className="mt-1 text-xs text-slate-500">
                Track trends, category breakdowns, and milestone dates.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-10 w-full max-w-md rounded-2xl bg-white p-8 shadow-xl lg:mt-0 lg:w-1/2">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-slate-900">
              {mode === 'login' && 'Welcome back'}
              {mode === 'signup' && 'Create your account'}
              {mode === 'reset' && 'Reset your password'}
            </h2>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-600">
              Supabase Auth
            </span>
          </div>

          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <div>
              <label className="text-sm font-medium text-slate-700">Email address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>

            {mode !== 'reset' && (
              <div>
                <label className="text-sm font-medium text-slate-700">Password</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>
            )}

            {mode === 'signup' && (
              <div>
                <label className="text-sm font-medium text-slate-700">Confirm password</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
                {passwordMismatch && (
                  <p className="mt-2 text-xs text-rose-600">Passwords do not match.</p>
                )}
              </div>
            )}

            {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>}
            {statusMessage && (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {statusMessage}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || passwordMismatch}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading
                ? 'Working...'
                : mode === 'login'
                  ? 'Sign in'
                  : mode === 'signup'
                    ? 'Create account'
                    : 'Send reset link'}
            </button>
          </form>

          <div className="mt-6 space-y-2 text-sm text-slate-600">
            {mode !== 'login' && (
              <button
                onClick={() => setMode('login')}
                className="font-medium text-blue-600 hover:text-blue-700"
              >
                Back to login
              </button>
            )}
            {mode === 'login' && (
              <div className="flex items-center justify-between text-xs">
                <button
                  onClick={() => setMode('reset')}
                  className="font-medium text-blue-600 hover:text-blue-700"
                >
                  Forgot password?
                </button>
                <button
                  onClick={() => setMode('signup')}
                  className="font-medium text-blue-600 hover:text-blue-700"
                >
                  Create account
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
