export type AssetKey =
  | 'my_robinhood_portfolio'
  | 'girlfriend_robinhood_portfolio'
  | 'girlfriend_bank_account'
  | 'my_savings_account'
  | 'my_meta_stock_value'
  | 'miscellaneous_assets';

export type Profile = {
  id: string;
  created_at: string;
  email: string | null;
  goal_amount: number;
};

export type Snapshot = {
  id: string;
  user_id: string;
  created_at: string;
  as_of_date: string;
  my_robinhood_portfolio: number;
  girlfriend_robinhood_portfolio: number;
  girlfriend_bank_account: number;
  my_savings_account: number;
  my_meta_stock_value: number;
  miscellaneous_assets: number;
  total_saved: number;
  goal_amount: number;
  notes: string | null;
};

export type SnapshotFormState = Record<AssetKey, string> & {
  notes: string;
  as_of_date: string;
};
