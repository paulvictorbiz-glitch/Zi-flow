-- Resources tab: a soft-coded spreadsheet of links and notes.
-- Columns are defined in resource_columns; cells stored in resource_cells.

CREATE TABLE IF NOT EXISTS public.resource_columns (
  col_key    TEXT PRIMARY KEY,
  col_label  TEXT NOT NULL,
  col_index  INTEGER NOT NULL,
  col_type   TEXT DEFAULT 'text'
);

CREATE TABLE IF NOT EXISTS public.resource_rows (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  row_index  INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.resource_cells (
  row_id   UUID NOT NULL REFERENCES public.resource_rows(id) ON DELETE CASCADE,
  col_key  TEXT NOT NULL REFERENCES public.resource_columns(col_key) ON DELETE CASCADE,
  value    TEXT,
  PRIMARY KEY (row_id, col_key)
);

-- Seed default columns
INSERT INTO public.resource_columns (col_key, col_label, col_index, col_type)
VALUES
  ('name',  'Name',  0, 'text'),
  ('url',   'URL',   1, 'url'),
  ('notes', 'Notes', 2, 'text')
ON CONFLICT (col_key) DO NOTHING;

-- RLS: open read/write for all authenticated users
ALTER TABLE public.resource_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_rows    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_cells   ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl TEXT;
  pol TEXT;
  stmt TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['resource_columns','resource_rows','resource_cells'] LOOP
    FOREACH pol IN ARRAY ARRAY['select','insert','update','delete'] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = tbl AND policyname = tbl || '_' || pol || '_all'
      ) THEN
        IF pol = 'select' THEN
          stmt := 'CREATE POLICY ' || tbl || '_select_all ON public.' || tbl || ' FOR SELECT USING (true)';
        ELSIF pol = 'insert' THEN
          stmt := 'CREATE POLICY ' || tbl || '_insert_all ON public.' || tbl || ' FOR INSERT WITH CHECK (true)';
        ELSIF pol = 'update' THEN
          stmt := 'CREATE POLICY ' || tbl || '_update_all ON public.' || tbl || ' FOR UPDATE USING (true) WITH CHECK (true)';
        ELSE
          stmt := 'CREATE POLICY ' || tbl || '_delete_all ON public.' || tbl || ' FOR DELETE USING (true)';
        END IF;
        EXECUTE stmt;
      END IF;
    END LOOP;
  END LOOP;
END
$$;
