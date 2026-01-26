/*
  # Add portfolio snapshot holdings

  1. New Table
    - portfolio_snapshot_holdings
      - Stores per-stock holdings data at the time of a snapshot
      - Links back to portfolio_snapshots for historical comparisons
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'portfolio_snapshot_holdings'
  ) THEN
    CREATE TABLE portfolio_snapshot_holdings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      snapshot_id uuid NOT NULL REFERENCES portfolio_snapshots(id) ON DELETE CASCADE,
      ticker text NOT NULL,
      quantity double precision NOT NULL,
      buy_price double precision NOT NULL,
      current_price double precision NOT NULL,
      total_value double precision NOT NULL,
      total_cost double precision NOT NULL,
      total_return double precision NOT NULL,
      weight_percent double precision NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS portfolio_snapshot_holdings_snapshot_id_idx
  ON portfolio_snapshot_holdings(snapshot_id);
