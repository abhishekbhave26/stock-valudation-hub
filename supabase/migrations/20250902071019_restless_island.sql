/*
  # Add notes column to saved_stocks table

  1. Schema Changes
    - Add `notes` column to `saved_stocks` table
    - Column type: text (allows unlimited length for detailed analysis)
    - Default value: empty string
    - Nullable: true (existing records won't break)

  2. Notes
    - This allows users to store their investment thesis, pros/cons analysis
    - Supports markdown-style formatting for better readability
    - No character limit for comprehensive analysis
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'saved_stocks' AND column_name = 'notes'
  ) THEN
    ALTER TABLE saved_stocks ADD COLUMN notes text DEFAULT '';
  END IF;
END $$;