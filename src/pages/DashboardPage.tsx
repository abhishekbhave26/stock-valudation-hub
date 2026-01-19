import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import type { AssetKey, Profile, Snapshot, SnapshotFormState } from '../types';
import {
  assetFields,
  buildMilestones,
  buildSnapshotChartData,
  buildSnapshotsCsv,
  calculateTotals,
  createEmptyFormState,
  formatCurrency,
  formatCurrencyWithCents,
  formatPercent,
  getNumericValues,
  isFormEqual,
  snapshotToFormState,
} from '../utils/finance';

const DEFAULT_GOAL = 900000;

type ToastState = { message: string; variant: 'success' | 'error' } | null;

const DashboardPage = () => {
  const { user, signOut } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [formState, setFormState] = useState<SnapshotFormState>(() => createEmptyFormState());
  const [lastSavedForm, setLastSavedForm] = useState<SnapshotFormState>(() => createEmptyFormState());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [whatIfMode, setWhatIfMode] = useState(false);
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [goalInput, setGoalInput] = useState('');

  const isDirty = useMemo(() => !isFormEqual(formState, lastSavedForm), [formState, lastSavedForm]);

  const goalAmount = profile?.goal_amount ?? DEFAULT_GOAL;
  const numericValues = useMemo(() => getNumericValues(formState), [formState]);
  const validationErrors = useMemo(() => {
    return assetFields.reduce<Record<AssetKey, string | null>>((acc, field) => {
      const value = formState[field.key];
      const parsed = value.trim() === '' ? 0 : Number(value);
      if (!Number.isFinite(parsed)) {
        acc[field.key] = 'Enter a valid number';
      } else if (parsed < 0) {
        acc[field.key] = 'Value cannot be negative';
      } else {
        acc[field.key] = null;
      }
      return acc;
    }, {} as Record<AssetKey, string | null>);
  }, [formState]);

  const isFormValid = useMemo(
    () => Object.values(validationErrors).every((error) => !error),
    [validationErrors]
  );

  const totals = useMemo(
    () => calculateTotals(numericValues, goalAmount),
    [numericValues, goalAmount]
  );

  const milestones = useMemo(
    () => buildMilestones(snapshots, goalAmount),
    [snapshots, goalAmount]
  );

  const chartData = useMemo(() => buildSnapshotChartData(snapshots), [snapshots]);

  const breakdownData = useMemo(
    () =>
      assetFields.map((field) => ({
        name: field.label,
        value: numericValues[field.key] || 0,
      })),
    [numericValues]
  );

  const showToast = (message: string, variant: ToastState['variant']) => {
    setToast({ message, variant });
    setTimeout(() => setToast(null), 4000);
  };

  const loadProfile = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
      showToast(error.message, 'error');
      return;
    }

    if (!data) {
      const { data: created, error: createError } = await supabase
        .from('profiles')
        .insert({
          id: user.id,
          email: user.email,
          goal_amount: DEFAULT_GOAL,
        })
        .select()
        .single();

      if (createError) {
        showToast(createError.message, 'error');
        return;
      }

      setProfile(created);
      return;
    }

    setProfile(data);
  }, [user]);

  const loadSnapshots = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('snapshots')
      .select('*')
      .eq('user_id', user.id)
      .order('as_of_date', { ascending: false });

    if (error) {
      showToast(error.message, 'error');
      return;
    }

    setSnapshots(data ?? []);
    if (data && data.length > 0) {
      const latest = data[0];
      const nextFormState = snapshotToFormState(latest);
      setFormState(nextFormState);
      setLastSavedForm(nextFormState);
    }
  }, [user]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadProfile(), loadSnapshots()]);
    setLoading(false);
  }, [loadProfile, loadSnapshots]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const handleInputChange = (key: keyof SnapshotFormState, value: string) => {
    setFormState((prev) => ({ ...prev, [key]: value }));
  };

  const handleSaveSnapshot = async () => {
    if (!user || !profile) return;
    if (!isFormValid) {
      showToast('Fix validation errors before saving.', 'error');
      return;
    }

    setSaving(true);
    const payload = {
      user_id: user.id,
      as_of_date: formState.as_of_date,
      my_robinhood_portfolio: numericValues.my_robinhood_portfolio,
      girlfriend_robinhood_portfolio: numericValues.girlfriend_robinhood_portfolio,
      girlfriend_bank_account: numericValues.girlfriend_bank_account,
      my_savings_account: numericValues.my_savings_account,
      my_meta_stock_value: numericValues.my_meta_stock_value,
      miscellaneous_assets: numericValues.miscellaneous_assets,
      total_saved: totals.totalSaved,
      goal_amount: goalAmount,
      notes: formState.notes || null,
    };

    const { data, error } = await supabase.from('snapshots').insert(payload).select().single();
    setSaving(false);

    if (error) {
      showToast(error.message, 'error');
      return;
    }

    const nextSnapshots = [data, ...snapshots];
    setSnapshots(nextSnapshots);
    const nextFormState = snapshotToFormState(data);
    setFormState(nextFormState);
    setLastSavedForm(nextFormState);
    setWhatIfMode(false);
    showToast('Snapshot saved.', 'success');
  };

  const handleDeleteSnapshot = async (snapshotId: string) => {
    if (!user) return;
    const { error } = await supabase.from('snapshots').delete().eq('id', snapshotId);
    if (error) {
      showToast(error.message, 'error');
      return;
    }
    const nextSnapshots = snapshots.filter((snapshot) => snapshot.id !== snapshotId);
    setSnapshots(nextSnapshots);
    showToast('Snapshot deleted.', 'success');
  };

  const handleViewSnapshot = (snapshot: Snapshot) => {
    const nextFormState = snapshotToFormState(snapshot);
    setFormState(nextFormState);
    setLastSavedForm(nextFormState);
    setWhatIfMode(false);
  };

  const handleResetForm = () => {
    setFormState(lastSavedForm);
  };

  const handleExportCsv = () => {
    const csv = buildSnapshotsCsv(snapshots);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'eb5-snapshots.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleUpdateGoal = async () => {
    if (!user || !profile) return;
    const parsed = Number(goalInput);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 5000000) {
      showToast('Goal must be between 0 and 5,000,000.', 'error');
      return;
    }

    const { data, error } = await supabase
      .from('profiles')
      .update({ goal_amount: parsed })
      .eq('id', user.id)
      .select()
      .single();

    if (error) {
      showToast(error.message, 'error');
      return;
    }

    setProfile(data);
    setShowGoalModal(false);
    showToast('Goal updated.', 'success');
  };

  const handleSeedSnapshots = async () => {
    if (!user) return;
    const baseDate = new Date();
    const samples = [60, 30, 0].map((offset, index) => {
      const date = new Date(baseDate);
      date.setDate(baseDate.getDate() - offset);
      const multiplier = (index + 1) * 0.18;
      const values = {
        my_robinhood_portfolio: 120000 * multiplier,
        girlfriend_robinhood_portfolio: 60000 * multiplier,
        girlfriend_bank_account: 40000 * multiplier,
        my_savings_account: 80000 * multiplier,
        my_meta_stock_value: 100000 * multiplier,
        miscellaneous_assets: 20000 * multiplier,
      };
      const totalSaved =
        values.my_robinhood_portfolio +
        values.girlfriend_robinhood_portfolio +
        values.girlfriend_bank_account +
        values.my_savings_account +
        values.my_meta_stock_value +
        values.miscellaneous_assets;

      return {
        user_id: user.id,
        as_of_date: format(date, 'yyyy-MM-dd'),
        ...values,
        total_saved: totalSaved,
        goal_amount: goalAmount,
        notes: `Seed snapshot ${index + 1}`,
      };
    });

    const { data, error } = await supabase.from('snapshots').insert(samples).select();
    if (error) {
      showToast(error.message, 'error');
      return;
    }

    setSnapshots([...(data ?? []), ...snapshots]);
    showToast('Seed snapshots added.', 'success');
  };

  if (!user) {
    return null;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">
              Road to EB-5 ($900K Goal)
            </p>
            <h1 className="mt-2 text-2xl font-semibold">Dashboard</h1>
            <p className="text-sm text-slate-500">
              Logged in as <span className="font-medium text-slate-700">{user.email}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => {
                setGoalInput(goalAmount.toString());
                setShowGoalModal(true);
              }}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:border-blue-200"
            >
              Update goal
            </button>
            <button
              onClick={handleSeedSnapshots}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:border-blue-200"
            >
              Seed sample data
            </button>
            <button
              onClick={signOut}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl space-y-8 px-6 py-8">
        {whatIfMode && isDirty && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>What-if mode is on. You have unsaved changes.</span>
              <div className="flex gap-2">
                <button
                  onClick={handleSaveSnapshot}
                  disabled={!isFormValid || saving}
                  className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Save snapshot
                </button>
                <button
                  onClick={handleResetForm}
                  className="rounded-lg border border-amber-300 px-3 py-2 text-xs font-semibold text-amber-700"
                >
                  Reset
                </button>
              </div>
            </div>
          </div>
        )}

        <section className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-2xl bg-white p-6 shadow-sm lg:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Progress</h2>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>What-if mode</span>
                <button
                  onClick={() => setWhatIfMode((prev) => !prev)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    whatIfMode ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {whatIfMode ? 'On' : 'Off'}
                </button>
              </div>
            </div>
            <div className="mt-6 grid gap-6 md:grid-cols-[220px,1fr]">
              <div className="flex flex-col items-center justify-center rounded-xl bg-slate-50 p-4">
                <div className="text-3xl font-semibold text-blue-600">
                  {formatPercent(Math.min(totals.percentToGoal, 100))}
                </div>
                <p className="mt-2 text-xs text-slate-500">Goal progress</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="text-xs text-slate-500">Total saved</p>
                  <p className="mt-2 text-lg font-semibold text-slate-900">
                    {formatCurrency(totals.totalSaved)}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="text-xs text-slate-500">Remaining</p>
                  <p className="mt-2 text-lg font-semibold text-slate-900">
                    {formatCurrency(totals.remaining)}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="text-xs text-slate-500">Goal</p>
                  <p className="mt-2 text-lg font-semibold text-slate-900">
                    {formatCurrency(goalAmount)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Milestones</h2>
            <ul className="mt-4 space-y-3 text-sm text-slate-600">
              {milestones.map((milestone) => (
                <li
                  key={milestone.percent}
                  className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2"
                >
                  <span className="font-medium text-slate-700">{milestone.percent}%</span>
                  <span>{milestone.date}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Category breakdown</h2>
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={breakdownData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={3}
                  >
                    {breakdownData.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={['#2563eb', '#0ea5e9', '#22c55e', '#f97316', '#a855f7', '#14b8a6'][index % 6]}
                      />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => formatCurrencyWithCents(value)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Trend over time</h2>
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(value: number) => formatCurrencyWithCents(value)} />
                  <Line
                    type="monotone"
                    dataKey="totalSaved"
                    stroke="#2563eb"
                    strokeWidth={3}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Snapshot input</h2>
              <p className="text-sm text-slate-500">
                Update asset values and save a snapshot when ready.
              </p>
            </div>
            <button
              onClick={handleSaveSnapshot}
              disabled={!isFormValid || saving}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save snapshot'}
            </button>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {assetFields.map((field) => (
              <div key={field.key}>
                <label className="text-sm font-medium text-slate-700">{field.label}</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formState[field.key]}
                  onChange={(event) => handleInputChange(field.key, event.target.value)}
                  className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
                {validationErrors[field.key] && (
                  <p className="mt-1 text-xs text-rose-600">{validationErrors[field.key]}</p>
                )}
              </div>
            ))}
            <div>
              <label className="text-sm font-medium text-slate-700">As-of date</label>
              <input
                type="date"
                value={formState.as_of_date}
                onChange={(event) => handleInputChange('as_of_date', event.target.value)}
                className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-sm font-medium text-slate-700">Notes (optional)</label>
              <textarea
                value={formState.notes}
                onChange={(event) => handleInputChange('notes', event.target.value)}
                rows={3}
                className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Snapshot history</h2>
              <p className="text-sm text-slate-500">Review and export your saved snapshots.</p>
            </div>
            <button
              onClick={handleExportCsv}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:border-blue-200"
              disabled={snapshots.length === 0}
            >
              Export CSV
            </button>
          </div>

          {snapshots.length === 0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
              No snapshots yet. Save your first snapshot to see history.
            </div>
          ) : (
            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2 pr-4">As of</th>
                    <th className="py-2 pr-4">Created</th>
                    <th className="py-2 pr-4">Total saved</th>
                    <th className="py-2 pr-4">Remaining</th>
                    <th className="py-2 pr-4">% to goal</th>
                    <th className="py-2 pr-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {snapshots.map((snapshot) => {
                    const remaining = Math.max(snapshot.goal_amount - snapshot.total_saved, 0);
                    const percent = snapshot.goal_amount
                      ? (snapshot.total_saved / snapshot.goal_amount) * 100
                      : 0;
                    return (
                      <tr key={snapshot.id}>
                        <td className="py-3 pr-4 font-medium text-slate-700">
                          {snapshot.as_of_date}
                        </td>
                        <td className="py-3 pr-4 text-slate-500">
                          {format(new Date(snapshot.created_at), 'MMM d, yyyy')}
                        </td>
                        <td className="py-3 pr-4">{formatCurrency(snapshot.total_saved)}</td>
                        <td className="py-3 pr-4">{formatCurrency(remaining)}</td>
                        <td className="py-3 pr-4">{formatPercent(percent)}</td>
                        <td className="py-3 pr-4">
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => handleViewSnapshot(snapshot)}
                              className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700"
                            >
                              View
                            </button>
                            <button
                              onClick={() => handleDeleteSnapshot(snapshot.id)}
                              className="rounded-lg border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-600"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {showGoalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold">Update goal amount</h2>
            <p className="mt-2 text-sm text-slate-500">
              Set a new target between $0 and $5,000,000.
            </p>
            <input
              type="number"
              min="0"
              max="5000000"
              value={goalInput}
              onChange={(event) => setGoalInput(event.target.value)}
              className="mt-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowGoalModal(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdateGoal}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
              >
                Save goal
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50">
          <div
            className={`rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
              toast.variant === 'success'
                ? 'bg-emerald-600 text-white'
                : 'bg-rose-600 text-white'
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
