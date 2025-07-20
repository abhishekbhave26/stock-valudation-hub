/*
  # Fix price column types

  1. Changes
    - Change `buy_price` column from integer to double precision
    - Change `current_price` column from integer to double precision
  
  2. Security
    - No changes to RLS policies needed
*/

-- Change buy_price column type to double precision
ALTER TABLE portfolio_stocks 
ALTER COLUMN buy_price TYPE double precision;

-- Change current_price column type to double precision  
ALTER TABLE portfolio_stocks 
ALTER COLUMN current_price TYPE double precision;