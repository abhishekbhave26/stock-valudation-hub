/*
  # Add stock_price_history table

  1. New Table
    - stock_price_history
      - One row per ticker per price refresh, so the watchlist can show
        the daily % change vs the most recent prior-day close and a short
        history of recent recorded closes.
      - Rows are append-only; nothing here feeds the DCF inputs.

  2. Security
    - RLS enabled with the same permissive "Allow public access" policy
      style used by saved_stocks (see 20250720012926_broken_night.sql).
*/

CREATE TABLE IF NOT EXISTS stock_price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email text NOT NULL,
  ticker text NOT NULL,
  price numeric NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE stock_price_history ENABLE ROW LEVEL SECURITY;

-- Create policy for public access (same pattern as saved_stocks)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'stock_price_history'
      AND policyname = 'Allow public access to stock_price_history'
  ) THEN
    CREATE POLICY "Allow public access to stock_price_history"
      ON stock_price_history
      FOR ALL
      TO public
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_stock_price_history_user_ticker_recorded
  ON stock_price_history (user_email, ticker, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_price_history_ticker_recorded
  ON stock_price_history (ticker, recorded_at DESC);
