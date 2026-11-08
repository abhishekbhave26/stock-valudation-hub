/*
  # Stock taxonomy registry (categories + regions)

  1. New Table
    - stock_taxonomies
      - One row per (user, kind, name): the canonical list of categories
        and regions offered in the add/edit form dropdowns and managed on
        the Categories | Regions page.
      - kind is 'category' or 'region'. A stock's own value is still
        stored per stock as `category` / `region` inside its dcf_inputs
        JSONB — this table only holds the list of available names.
      - The manager adds/renames/merges/removes rows here; every rename,
        merge or remove also updates the matching stocks' dcf_inputs, so
        a merged-away name disappears from the dropdowns and filters for
        good instead of lingering in the hardcoded seed lists.

  2. Seed
    - Inserts the 14 default categories and 20 default regions for every
      user_email already in saved_stocks (ON CONFLICT DO NOTHING, so
      re-running never duplicates rows or overwrites a renamed list).

  3. Security
    - RLS enabled with the same permissive "Allow public access" policy
      style used by saved_stocks (see 20250720012926_broken_night.sql).

  4. Notes
    - Apply after merging the taxonomy-manager PR (run via
      `supabase db push` or the Supabase dashboard SQL editor). Until it
      is applied, the app falls back to the hardcoded seed lists in
      src/utils/categories.ts and src/utils/regions.ts: the manager can
      still rename, merge and remove values on your stocks, but a
      merged-away seed name may keep showing in the dropdowns, and
      adding a standalone category/region with no stocks yet is disabled
      until this table exists.
*/

CREATE TABLE IF NOT EXISTS stock_taxonomies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('category', 'region')),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_email, kind, name)
);

-- Enable RLS
ALTER TABLE stock_taxonomies ENABLE ROW LEVEL SECURITY;

-- Create policy for public access (same pattern as saved_stocks)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'stock_taxonomies'
      AND policyname = 'Allow public access to stock_taxonomies'
  ) THEN
    CREATE POLICY "Allow public access to stock_taxonomies"
      ON stock_taxonomies
      FOR ALL
      TO public
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_stock_taxonomies_user_kind
  ON stock_taxonomies (user_email, kind);

-- Seed the default categories for every user already in saved_stocks.
INSERT INTO stock_taxonomies (user_email, kind, name)
SELECT DISTINCT s.user_email, 'category', cat.name
FROM saved_stocks s
CROSS JOIN unnest(ARRAY[
  'AI Semiconductors',
  'Semiconductors',
  'Big Tech',
  'Software & Cloud',
  'Cybersecurity',
  'Hardware & IT Infrastructure',
  'Fintech & Payments',
  'Banking & Finance',
  'Healthcare & Biotech',
  'Consumer & E-Commerce',
  'Communication & Media',
  'Energy',
  'Industrials',
  'Aerospace & Defense'
]) AS cat(name)
ON CONFLICT (user_email, kind, name) DO NOTHING;

-- Seed the default regions for every user already in saved_stocks.
INSERT INTO stock_taxonomies (user_email, kind, name)
SELECT DISTINCT s.user_email, 'region', reg.name
FROM saved_stocks s
CROSS JOIN unnest(ARRAY[
  'Global',
  'North America',
  'South America',
  'Europe',
  'Asia',
  'Africa',
  'Oceania',
  'United States',
  'Canada',
  'India',
  'China',
  'Japan',
  'United Kingdom',
  'Germany',
  'France',
  'Taiwan',
  'South Korea',
  'Netherlands',
  'Israel',
  'Brazil'
]) AS reg(name)
ON CONFLICT (user_email, kind, name) DO NOTHING;
