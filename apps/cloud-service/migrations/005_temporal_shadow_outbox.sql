CREATE SCHEMA IF NOT EXISTS temporal_shadow;
REVOKE ALL ON SCHEMA temporal_shadow FROM PUBLIC;

CREATE TABLE IF NOT EXISTS temporal_shadow.schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO temporal_shadow.schema_migrations(version) VALUES (5) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS temporal_shadow.events (
  event_id uuid PRIMARY KEY,
  account_hash text NOT NULL CHECK(octet_length(account_hash) = 64),
  session_id uuid NOT NULL,
  event_type text NOT NULL CHECK(event_type IN (
    'session_created','session_updated','checkpoint_committed',
    'device_connected','lease_changed','command_changed','session_deleted'
  )),
  revision bigint NOT NULL CHECK(revision >= 0),
  deadline_at timestamptz,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_until timestamptz,
  claim_token uuid,
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS temporal_shadow_events_claim
  ON temporal_shadow.events(available_at, occurred_at)
  WHERE completed_at IS NULL;

-- Defence in depth: user content has no column in this table and payload-shaped
-- columns must not be added without a successor RFC and privacy review.
