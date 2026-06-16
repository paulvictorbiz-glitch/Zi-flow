-- Reel skill tags — link a production reel to the Training syllabus skills it
-- practices. The reel detail page writes this array (skill keys from
-- src/lib/training-data.jsx SKILLS), and the Training tab lists tagged reels
-- under each module's "Practice on real projects". Mirrors the vision_tags
-- pattern. Apply via `npm run migrate:apply`.

ALTER TABLE public.reels
  ADD COLUMN IF NOT EXISTS skill_tags text[] NOT NULL DEFAULT '{}';

-- GIN index so "reels tagged with skill X" stays cheap as the library grows.
CREATE INDEX IF NOT EXISTS reels_skill_tags_idx ON public.reels USING gin (skill_tags);
