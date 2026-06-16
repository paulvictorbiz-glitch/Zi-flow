-- =========================================================
-- 0050_gamify.sql — Gamify system tables
--
-- Two tables:
--   gamify_progress  — per-person XP total, skill scores (0-100 per skill),
--                      medal tier, and unlocked rewards. One row per person.
--   gamify_rubric    — per-reel, per-person, per-skill rubric assessment.
--                      Editor self-assessment + reviewer grade stored together.
--
-- app_settings is reused for toggle flags:
--   key="gamify_enabled"      value={ "enabled": true/false }
--   key="gamify_grading_mode" value={ "mode": "editor+reviewer" | "reviewer_only" }
-- =========================================================

-- Per-person cumulative gamify state
CREATE TABLE IF NOT EXISTS gamify_progress (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id        text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  total_xp         integer NOT NULL DEFAULT 0,
  skill_scores     jsonb NOT NULL DEFAULT '{}',
  medal            text NOT NULL DEFAULT 'none'
                     CHECK (medal IN ('none','bronze','silver','gold')),
  unlocked_rewards jsonb NOT NULL DEFAULT '[]',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(person_id)
);

-- Trigger updated_at
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_updated_at_gamify_progress'
  ) THEN
    CREATE TRIGGER set_updated_at_gamify_progress
      BEFORE UPDATE ON gamify_progress
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- Per-reel rubric assessment (one row per reel+person+skill combination)
CREATE TABLE IF NOT EXISTS gamify_rubric (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reel_id         text NOT NULL,
  person_id       text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  skill_key       text NOT NULL,
  editor_checked  jsonb NOT NULL DEFAULT '[]',
  reviewer_grade  text CHECK (reviewer_grade IN ('average','decent','excellent') OR reviewer_grade IS NULL),
  xp_awarded      integer NOT NULL DEFAULT 0,
  graded_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(reel_id, person_id, skill_key)
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_updated_at_gamify_rubric'
  ) THEN
    CREATE TRIGGER set_updated_at_gamify_rubric
      BEFORE UPDATE ON gamify_rubric
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ── RLS ──────────────────────────────────────────────────

ALTER TABLE gamify_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE gamify_rubric   ENABLE ROW LEVEL SECURITY;

-- gamify_progress: anyone authenticated reads all (for admin overlay chart)
DROP POLICY IF EXISTS "gp_auth_read"   ON gamify_progress;
DROP POLICY IF EXISTS "gp_self_write"  ON gamify_progress;
DROP POLICY IF EXISTS "gp_owner_all"   ON gamify_progress;

CREATE POLICY "gp_auth_read"  ON gamify_progress
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "gp_self_write" ON gamify_progress
  FOR ALL TO authenticated USING (
    person_id = (
      SELECT id FROM people WHERE user_id = auth.uid() LIMIT 1
    )
  ) WITH CHECK (
    person_id = (
      SELECT id FROM people WHERE user_id = auth.uid() LIMIT 1
    )
  );

CREATE POLICY "gp_owner_all"  ON gamify_progress
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM people WHERE user_id = auth.uid() AND role = 'owner')
  );

-- gamify_rubric: auth can read their own; editor writes editor_checked;
-- owner reads/writes all (for grading)
DROP POLICY IF EXISTS "gr_auth_read"    ON gamify_rubric;
DROP POLICY IF EXISTS "gr_self_write"   ON gamify_rubric;
DROP POLICY IF EXISTS "gr_self_update"  ON gamify_rubric;
DROP POLICY IF EXISTS "gr_owner_all"    ON gamify_rubric;

CREATE POLICY "gr_auth_read" ON gamify_rubric
  FOR SELECT TO authenticated USING (
    person_id = (
      SELECT id FROM people WHERE user_id = auth.uid() LIMIT 1
    )
    OR EXISTS (SELECT 1 FROM people WHERE user_id = auth.uid() AND role = 'owner')
  );

CREATE POLICY "gr_self_write" ON gamify_rubric
  FOR INSERT TO authenticated WITH CHECK (
    person_id = (
      SELECT id FROM people WHERE user_id = auth.uid() LIMIT 1
    )
  );

CREATE POLICY "gr_self_update" ON gamify_rubric
  FOR UPDATE TO authenticated USING (
    person_id = (
      SELECT id FROM people WHERE user_id = auth.uid() LIMIT 1
    )
  );

CREATE POLICY "gr_owner_all" ON gamify_rubric
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM people WHERE user_id = auth.uid() AND role = 'owner')
  );

-- ── Realtime ─────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'gamify_progress'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE gamify_progress;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'gamify_rubric'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE gamify_rubric;
  END IF;
END $$;
