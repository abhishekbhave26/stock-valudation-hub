/*
  # Add current price to portfolio stocks

  1. Changes
    - Add `current_price` column to `portfolio_stocks` table
    - Set default value and add check constraint for positive values
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'portfolio_stocks' AND column_name = 'current_price'
  ) THEN
    ALTER TABLE portfolio_stocks ADD COLUMN current_price double precision;
    ALTER TABLE portfolio_stocks ADD CONSTRAINT portfolio_stocks_current_price_check CHECK ((current_price > (0)::double precision));
  END IF;
END $$;