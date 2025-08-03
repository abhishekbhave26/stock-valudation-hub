/*
  # Update existing data attribution

  1. Data Updates
    - Update all existing saved_stocks records to be attributed to abhishekbhave26@gmail.com
    - Update all existing portfolio_stocks records to be attributed to abhishekbhave26@gmail.com
  
  2. Purpose
    - Ensure existing data is properly attributed to the correct user
    - Prepare for proper user data isolation
*/

-- Update all existing saved_stocks to be attributed to the correct email
UPDATE saved_stocks 
SET user_email = 'abhishekbhave26@gmail.com'
WHERE user_email IS NULL OR user_email = '';

-- Update all existing portfolio_stocks to be attributed to the correct email  
UPDATE portfolio_stocks
SET user_email = 'abhishekbhave26@gmail.com'
WHERE user_email IS NULL OR user_email = '';