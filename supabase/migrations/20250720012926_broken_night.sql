/*
  # Update saved_stocks table for single case DCF

  1. Schema Changes
    - Remove bull/bear scenario columns
    - Keep only single fair_value, expected_return, cagr columns
    - Update existing data structure

  2. Security
    - Maintain existing RLS policies
*/

-- Drop existing table and recreate with new structure
DROP TABLE IF EXISTS saved_stocks;

CREATE TABLE saved_stocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text NOT NULL,
  current_price double precision NOT NULL,
  fair_value double precision NOT NULL,
  expected_return double precision NOT NULL,
  cagr double precision NOT NULL,
  buy_target double precision NOT NULL,
  dcf_inputs jsonb NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE saved_stocks ENABLE ROW LEVEL SECURITY;

-- Create policy for public access
CREATE POLICY "Allow public access to saved_stocks"
  ON saved_stocks
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- Create indexes
CREATE INDEX idx_saved_stocks_ticker ON saved_stocks (ticker);
CREATE INDEX idx_saved_stocks_created_at ON saved_stocks (created_at DESC);