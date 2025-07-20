/*
  # Allow duplicate stock entries in watchlist

  1. Changes
    - Remove unique constraint on ticker column in saved_stocks table
    - Allow multiple entries for the same stock with different assumptions

  2. Security
    - Maintain existing RLS policies
*/

-- Remove the unique index on ticker if it exists
DROP INDEX IF EXISTS idx_saved_stocks_ticker_unique;

-- Keep the regular index for performance but remove uniqueness
-- The existing idx_saved_stocks_ticker should remain for query performance