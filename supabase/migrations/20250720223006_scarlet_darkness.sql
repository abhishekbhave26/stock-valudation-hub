/*
  # Create portfolio_stocks table

  1. New Tables
    - `portfolio_stocks`
      - `id` (uuid, primary key)
      - `ticker` (text, stock symbol)
      - `quantity` (integer, number of shares)
      - `buy_price` (double precision, purchase price per share)
      - `purchase_date` (date, when the stock was purchased)
      - `created_at` (timestamp, record creation time)

  2. Security
    - Enable RLS on `portfolio_stocks` table
    - Add policy for public access to all operations
*/

CREATE TABLE IF NOT EXISTS portfolio_stocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  buy_price double precision NOT NULL CHECK (buy_price > 0),
  purchase_date date NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE portfolio_stocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public access to portfolio_stocks"
  ON portfolio_stocks
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_portfolio_stocks_ticker ON portfolio_stocks (ticker);
CREATE INDEX IF NOT EXISTS idx_portfolio_stocks_created_at ON portfolio_stocks (created_at DESC);