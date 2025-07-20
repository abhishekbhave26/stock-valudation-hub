/*
  # Enforce unique stock entries in watchlist

  1. Changes
    - Add unique constraint on ticker column in saved_stocks table
    - This prevents duplicate entries for the same stock ticker
    - Users will need to update existing entries instead of creating duplicates

  2. Security
    - No changes to RLS policies needed
*/

-- Add unique constraint on ticker column
ALTER TABLE saved_stocks ADD CONSTRAINT saved_stocks_ticker_unique UNIQUE (ticker);