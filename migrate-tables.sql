-- Migration: Add creator_rates and creator_collabs tables
-- Run this in Supabase Dashboard → SQL Editor → New Query → Run

-- Creator rates (pricing/rate card from July media kit)
CREATE TABLE IF NOT EXISTS creator_rates (
  id BIGSERIAL PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  price NUMERIC,
  uuid TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0
);

-- Creator collaborations / brand partnerships
CREATE TABLE IF NOT EXISTS creator_collabs (
  id BIGSERIAL PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  description TEXT,
  url TEXT,
  logo_url TEXT,
  logo_uuid TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0
);

-- Enable RLS (same pattern as other tables)
ALTER TABLE creator_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_collabs ENABLE ROW LEVEL SECURITY;

-- Allow anon access (same as other creator_* tables)
CREATE POLICY "Allow anon read creator_rates" ON creator_rates FOR SELECT USING (true);
CREATE POLICY "Allow anon insert creator_rates" ON creator_rates FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anon update creator_rates" ON creator_rates FOR UPDATE USING (true);
CREATE POLICY "Allow anon delete creator_rates" ON creator_rates FOR DELETE USING (true);

CREATE POLICY "Allow anon read creator_collabs" ON creator_collabs FOR SELECT USING (true);
CREATE POLICY "Allow anon insert creator_collabs" ON creator_collabs FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anon update creator_collabs" ON creator_collabs FOR UPDATE USING (true);
CREATE POLICY "Allow anon delete creator_collabs" ON creator_collabs FOR DELETE USING (true);

-- Indexes for fast lookup by creator
CREATE INDEX IF NOT EXISTS idx_creator_rates_creator_id ON creator_rates(creator_id);
CREATE INDEX IF NOT EXISTS idx_creator_collabs_creator_id ON creator_collabs(creator_id);
