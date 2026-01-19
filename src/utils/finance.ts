import { format, parseISO } from 'date-fns';
import type { AssetKey, Snapshot, SnapshotFormState } from '../types';

export const assetFields: { key: AssetKey; label: string }[] = [
  { key: 'my_robinhood_portfolio', label: 'My Robinhood portfolio' },
  { key: 'girlfriend_robinhood_portfolio', label: 'Girlfriend Robinhood portfolio' },
  { key: 'girlfriend_bank_account', label: 'Girlfriend bank account' },
  { key: 'my_savings_account', label: 'My savings account' },
  { key: 'my_meta_stock_value', label: 'Meta stock value' },
  { key: 'miscellaneous_assets', label: 'Misc assets' },
];

export const createEmptyFormState = (): SnapshotFormState => ({
  my_robinhood_portfolio: '0',
  girlfriend_robinhood_portfolio: '0',
  girlfriend_bank_account: '0',
  my_savings_account: '0',
  my_meta_stock_value: '0',
  miscellaneous_assets: '0',
  notes: '',
  as_of_date: format(new Date(), 'yyyy-MM-dd'),
});

export const parseNumber = (value: string) => {
  if (value.trim() === '') {
    return 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
};

export const getNumericValues = (formState: SnapshotFormState) =>
  assetFields.reduce<Record<AssetKey, number>>((acc, field) => {
    acc[field.key] = parseNumber(formState[field.key]);
    return acc;
  }, {} as Record<AssetKey, number>);

export const calculateTotals = (
  values: Record<AssetKey, number>,
  goalAmount: number
) => {
  const totalSaved = assetFields.reduce((sum, field) => sum + (values[field.key] || 0), 0);
  const remaining = Math.max(goalAmount - totalSaved, 0);
  const percentToGoal = goalAmount > 0 ? (totalSaved / goalAmount) * 100 : 0;
  return { totalSaved, remaining, percentToGoal };
};

export const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);

export const formatCurrencyWithCents = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value);

export const formatPercent = (value: number) => `${value.toFixed(1)}%`;

export const buildSnapshotChartData = (snapshots: Snapshot[]) =>
  [...snapshots]
    .sort((a, b) => a.as_of_date.localeCompare(b.as_of_date))
    .map((snapshot) => ({
      date: format(parseISO(snapshot.as_of_date), 'MMM d, yyyy'),
      totalSaved: snapshot.total_saved,
    }));

export const buildMilestones = (snapshots: Snapshot[], goalAmount: number) => {
  const sorted = [...snapshots].sort((a, b) => a.as_of_date.localeCompare(b.as_of_date));
  const targets = [25, 50, 75, 100];

  return targets.map((percent) => {
    const threshold = (goalAmount * percent) / 100;
    const hit = sorted.find((snapshot) => snapshot.total_saved >= threshold);
    return {
      percent,
      date: hit ? format(parseISO(hit.as_of_date), 'MMM d, yyyy') : 'Not yet',
    };
  });
};

export const snapshotToFormState = (snapshot: Snapshot): SnapshotFormState => ({
  my_robinhood_portfolio: snapshot.my_robinhood_portfolio.toString(),
  girlfriend_robinhood_portfolio: snapshot.girlfriend_robinhood_portfolio.toString(),
  girlfriend_bank_account: snapshot.girlfriend_bank_account.toString(),
  my_savings_account: snapshot.my_savings_account.toString(),
  my_meta_stock_value: snapshot.my_meta_stock_value.toString(),
  miscellaneous_assets: snapshot.miscellaneous_assets.toString(),
  notes: snapshot.notes ?? '',
  as_of_date: snapshot.as_of_date,
});

export const isFormEqual = (a: SnapshotFormState, b: SnapshotFormState) =>
  assetFields.every((field) => a[field.key] === b[field.key]) &&
  a.notes === b.notes &&
  a.as_of_date === b.as_of_date;

export const buildSnapshotsCsv = (snapshots: Snapshot[]) => {
  const header = [
    'as_of_date',
    'created_at',
    'total_saved',
    'remaining',
    'percent_to_goal',
    ...assetFields.map((field) => field.key),
    'notes',
  ];

  const rows = snapshots.map((snapshot) => {
    const remaining = Math.max(snapshot.goal_amount - snapshot.total_saved, 0);
    const percent = snapshot.goal_amount
      ? (snapshot.total_saved / snapshot.goal_amount) * 100
      : 0;
    return [
      snapshot.as_of_date,
      snapshot.created_at,
      snapshot.total_saved,
      remaining,
      percent,
      snapshot.my_robinhood_portfolio,
      snapshot.girlfriend_robinhood_portfolio,
      snapshot.girlfriend_bank_account,
      snapshot.my_savings_account,
      snapshot.my_meta_stock_value,
      snapshot.miscellaneous_assets,
      snapshot.notes ?? '',
    ];
  });

  return [header, ...rows].map((row) => row.join(',')).join('\n');
};
