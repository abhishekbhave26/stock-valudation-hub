/*
  # Seed stock categories

  1. Data Changes
    - Set one primary category per stock, stored as `category` inside the
      saved row's `dcf_inputs` JSONB (no schema change is needed: the app
      reads `dcf_inputs.category`, and the add/edit forms write it there).
    - Only rows that have no category yet are updated, so re-running this
      migration never overwrites a category the user set by hand.

  2. Notes
    - Apply after merging the categories PR (run via `supabase db push` or
      the Supabase dashboard SQL editor). Until it is applied, rows simply
      show "Uncategorized" and the category can be set from the edit form.
    - The mapping below is the initial assignment for review; every
      category is editable in the app afterwards.
*/

-- AI Semiconductors
UPDATE saved_stocks SET dcf_inputs = dcf_inputs || '{"category": "AI Semiconductors"}'::jsonb
  WHERE ticker = 'NVDA' AND (dcf_inputs ->> 'category') IS NULL;

-- Semiconductors
UPDATE saved_stocks SET dcf_inputs = dcf_inputs || '{"category": "Semiconductors"}'::jsonb
  WHERE ticker IN ('AMD', 'ASML', 'AVGO', 'CRDO', 'MRVL', 'MU', 'SNDK', 'TSM')
    AND (dcf_inputs ->> 'category') IS NULL;

-- Big Tech
UPDATE saved_stocks SET dcf_inputs = dcf_inputs || '{"category": "Big Tech"}'::jsonb
  WHERE ticker IN ('AMZN', 'GOOGL', 'META', 'MSFT')
    AND (dcf_inputs ->> 'category') IS NULL;

-- Software & Cloud
UPDATE saved_stocks SET dcf_inputs = dcf_inputs || '{"category": "Software & Cloud"}'::jsonb
  WHERE ticker IN ('ADBE', 'CRM', 'CRWV', 'CSU.CA', 'ESTC', 'INTU', 'NET', 'NOW', 'ORCL', 'PATH', 'PLTR', 'SNOW')
    AND (dcf_inputs ->> 'category') IS NULL;

-- Cybersecurity
UPDATE saved_stocks SET dcf_inputs = dcf_inputs || '{"category": "Cybersecurity"}'::jsonb
  WHERE ticker IN ('CRWD', 'PANW', 'S', 'ZS')
    AND (dcf_inputs ->> 'category') IS NULL;

-- Hardware & IT Infrastructure
UPDATE saved_stocks SET dcf_inputs = dcf_inputs || '{"category": "Hardware & IT Infrastructure"}'::jsonb
  WHERE ticker IN ('ANET', 'CLS', 'DELL', 'HPE', 'VRT')
    AND (dcf_inputs ->> 'category') IS NULL;

-- Fintech & Payments
UPDATE saved_stocks SET dcf_inputs = dcf_inputs || '{"category": "Fintech & Payments"}'::jsonb
  WHERE ticker IN ('DLO', 'FICO', 'HOOD', 'MA', 'TOST')
    AND (dcf_inputs ->> 'category') IS NULL;

-- Banking & Finance
UPDATE saved_stocks SET dcf_inputs = dcf_inputs || '{"category": "Banking & Finance"}'::jsonb
  WHERE ticker IN ('NU', 'SOFI')
    AND (dcf_inputs ->> 'category') IS NULL;

-- Healthcare & Biotech
UPDATE saved_stocks SET dcf_inputs = dcf_inputs || '{"category": "Healthcare & Biotech"}'::jsonb
  WHERE ticker IN ('HIMS', 'ISRG', 'KRYS', 'LLY', 'OSCR', 'TMDX', 'UNH')
    AND (dcf_inputs ->> 'category') IS NULL;

-- Consumer & E-Commerce
UPDATE saved_stocks SET dcf_inputs = dcf_inputs || '{"category": "Consumer & E-Commerce"}'::jsonb
  WHERE ticker IN ('CMG', 'GLBE', 'GRAB', 'MAMA', 'MELI', 'SE', 'SHOP', 'UBER')
    AND (dcf_inputs ->> 'category') IS NULL;

-- Communication & Media
UPDATE saved_stocks SET dcf_inputs = dcf_inputs || '{"category": "Communication & Media"}'::jsonb
  WHERE ticker IN ('APP', 'NFLX', 'RDDT', 'SPOT', 'ZETA')
    AND (dcf_inputs ->> 'category') IS NULL;

-- Energy
UPDATE saved_stocks SET dcf_inputs = dcf_inputs || '{"category": "Energy"}'::jsonb
  WHERE ticker IN ('CEG', 'GEV', 'VST')
    AND (dcf_inputs ->> 'category') IS NULL;

-- Industrials
UPDATE saved_stocks SET dcf_inputs = dcf_inputs || '{"category": "Industrials"}'::jsonb
  WHERE ticker IN ('AXON', 'ETN')
    AND (dcf_inputs ->> 'category') IS NULL;

-- Aerospace & Defense
UPDATE saved_stocks SET dcf_inputs = dcf_inputs || '{"category": "Aerospace & Defense"}'::jsonb
  WHERE ticker = 'RKLB' AND (dcf_inputs ->> 'category') IS NULL;
