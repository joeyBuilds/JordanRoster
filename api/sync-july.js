// Vercel Serverless Function: Sync July.bio roster → Supabase
// Scrapes July, compares against existing creators, auto-adds new + updates existing.
// Called by Vercel cron (daily) and by the frontend Refresh button.
//
// Uses fingerprint-based differential sync: only does expensive work (detail page
// fetching, geocoding, photo downloads) for NEW or CHANGED creators. Unchanged
// creators are skipped entirely. User-added data (demographics, notes, custom
// niches) is never overwritten.

const { createClient } = require('@supabase/supabase-js');
const {
  scrapeRoster, downloadCreatorPhotos, resolveHandles,
  enrichWithAudienceData, geocodeCreators, computeRosterHash
} = require('./july-helpers');

const SUPABASE_URL = 'https://imlmcbnvrkupplvgmytb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImltbG1jYm52cmt1cHBsdmdteXRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMDQwMDEsImV4cCI6MjA4OTg4MDAwMX0.0QYh-ZibrJy4Sn5yryc2j236qzBdTjvAC300VgOXtxo';

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

function parseName(fullName) {
  const parts = (fullName || '').trim().split(/\s+/);
  if (parts.length <= 1) return { firstName: parts[0] || '', lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function normalizeName(name) {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// ── Differential sync: compare roster hashes, only process new/changed creators ──

async function differentialSync(supabase, rosterCreators, force) {
  const now = new Date().toISOString();

  // Load existing DB state + sync cache in parallel
  const [
    { data: existingRows },
    { data: existingPlatforms },
    { data: existingNiches },
    { data: cacheRows },
  ] = await Promise.all([
    supabase.from('creators').select('*'),
    supabase.from('creator_platforms').select('*'),
    supabase.from('creator_niches').select('*'),
    supabase.from('sync_cache').select('*'),
  ]);

  // Build lookup maps
  const existingByName = {};
  const duplicateIds = [];
  (existingRows || []).forEach(row => {
    const fullName = normalizeName((row.first_name || '') + ' ' + (row.last_name || ''));
    if (existingByName[fullName]) {
      const existing = existingByName[fullName];
      const existingDate = existing.updated_at || existing.created_at || '';
      const newDate = row.updated_at || row.created_at || '';
      if (newDate > existingDate) {
        duplicateIds.push(existing.id);
        existingByName[fullName] = row;
      } else {
        duplicateIds.push(row.id);
      }
    } else {
      existingByName[fullName] = row;
    }
  });

  if (duplicateIds.length > 0) {
    console.log(`[sync] Removing ${duplicateIds.length} duplicate creator(s)`);
    await supabase.from('creators').delete().in('id', duplicateIds);
  }

  const existingPlatformMap = {};
  (existingPlatforms || []).forEach(p => {
    if (!existingPlatformMap[p.creator_id]) existingPlatformMap[p.creator_id] = {};
    existingPlatformMap[p.creator_id][p.platform] = p;
  });

  const existingNicheMap = {};
  (existingNiches || []).forEach(n => {
    if (!existingNicheMap[n.creator_id]) existingNicheMap[n.creator_id] = new Set();
    existingNicheMap[n.creator_id].add(n.niche);
  });

  const cacheByUsername = {};
  (cacheRows || []).forEach(r => { cacheByUsername[r.july_username] = r; });

  const cacheByCreatorId = {};
  (cacheRows || []).forEach(r => { cacheByCreatorId[r.creator_id] = r; });

  // ── Categorize each roster creator as NEW, CHANGED, or UNCHANGED ──
  const newCreators = [];
  const changedCreators = [];
  const unchangedCreators = [];

  for (const rc of rosterCreators) {
    if (!rc.name) continue;
    const hash = computeRosterHash(rc);
    const cached = rc.username ? cacheByUsername[rc.username] : null;
    const jName = normalizeName(rc.name);
    const existing = existingByName[jName];

    if (!cached && !existing) {
      // Brand new creator
      newCreators.push({ roster: rc, hash });
    } else if (force || !cached) {
      // Exists in DB but not in cache (first run or force refresh)
      changedCreators.push({ roster: rc, hash, existing, cached });
    } else if (cached.roster_hash !== hash) {
      // Cache exists but data changed
      const existingById = (existingRows || []).find(r => r.id === cached.creator_id);
      changedCreators.push({ roster: rc, hash, existing: existingById || existing, cached });
    } else {
      // Unchanged
      unchangedCreators.push({ roster: rc, hash, cached, existing });
    }
  }

  console.log(`[sync] Categorized: ${newCreators.length} new, ${changedCreators.length} changed, ${unchangedCreators.length} unchanged`);

  // ── Process NEW creators: full pipeline ──
  if (newCreators.length > 0) {
    const newRoster = newCreators.map(n => n.roster);
    await resolveHandles(newRoster, { logPrefix: '[sync]' });
    await enrichWithAudienceData(newRoster, { logPrefix: '[sync]' });
    await geocodeCreators(newRoster, { logPrefix: '[sync]' });
    await downloadCreatorPhotos(newRoster, { logPrefix: '[sync]' });
  }

  // ── Process CHANGED creators: selective work ──
  if (changedCreators.length > 0) {
    const needsEnrich = [];
    const needsGeocode = [];
    const needsPhoto = [];
    const needsResolve = [];

    for (const { roster, existing, cached } of changedCreators) {
      const locationChanged = existing ? normalizeName(roster.location || '') !== normalizeName(existing.location || '') : true;
      const photoUrlChanged = cached ? (roster.photo !== cached.photo_source_url) : true;
      const wasEnriched = cached ? cached.audience_enriched : !!(existing && Object.values(existingPlatformMap[existing.id] || {}).some(p => p.audience_data));

      if (!wasEnriched) needsEnrich.push(roster);
      if (locationChanged && (!existing || existing.lat == null)) needsGeocode.push(roster);
      else if (existing && existing.lat != null && !locationChanged) {
        roster.lat = existing.lat;
        roster.lng = existing.lng;
      }
      if (photoUrlChanged) needsPhoto.push(roster);
      else if (existing && existing.photo) roster.photo = existing.photo;

      // Check if any platform handle is missing
      const hasMissingHandle = Object.values(roster.platforms || {}).some(p => !p.handle && p.url);
      if (hasMissingHandle) needsResolve.push(roster);
    }

    if (needsResolve.length > 0) await resolveHandles(needsResolve, { logPrefix: '[sync]' });
    if (needsEnrich.length > 0) await enrichWithAudienceData(needsEnrich, { logPrefix: '[sync]' });
    if (needsGeocode.length > 0) await geocodeCreators(needsGeocode, { logPrefix: '[sync]' });
    if (needsPhoto.length > 0) await downloadCreatorPhotos(needsPhoto, { logPrefix: '[sync]' });
  }

  // ── Write changes to Supabase ──

  let added = 0, updated = 0, unchanged = unchangedCreators.length;

  const newCreatorRows = [];
  const newPlatformRows = [];
  const newNicheRows = [];
  const newCollabRows = [];
  const newCreatorIdMap = {};  // roster index → assigned ID

  // Stage NEW creator inserts
  for (const { roster } of newCreators) {
    const { firstName, lastName } = parseName(roster.name);
    const id = generateId();
    newCreatorIdMap[roster.username || roster.name] = id;

    newCreatorRows.push({
      id, first_name: firstName, last_name: lastName,
      photo: roster.photo || null,
      location: roster.location || null,
      lat: roster.lat ?? null, lng: roster.lng ?? null,
      notes: roster.bio || 'Imported from July',
      created_at: now, updated_at: now,
    });

    Object.entries(roster.platforms || {}).forEach(([platform, data]) => {
      newPlatformRows.push({
        creator_id: id, platform,
        handle: data.handle || '', url: data.url || '',
        followers: data.followers ?? null,
        engagement_rate: data.engagementRate ?? null,
        audience_data: data.audienceData || null,
      });
    });

    (roster.niches || []).forEach(niche => {
      newNicheRows.push({ creator_id: id, niche });
    });

    (roster.collabs || []).forEach((c, i) => {
      newCollabRows.push({
        creator_id: id, title: c.title || '', description: c.description || null,
        url: c.url || null, logo_url: c.logoUrl || null,
        logo_uuid: c.logoUuid || '', sort_order: i,
      });
    });

    added++;
  }

  // Stage CHANGED creator updates
  const updateCreatorRows = [];
  const updatePlatformDeletes = [];
  const updatePlatformInserts = [];
  const updateNicheInserts = [];
  const changedCollabCreatorIds = [];
  const changedCollabRows = [];

  for (const { roster, existing } of changedCreators) {
    if (!existing) {
      // Edge case: in cache but not in DB (deleted by user?) — treat as new
      const { firstName, lastName } = parseName(roster.name);
      const id = generateId();
      newCreatorIdMap[roster.username || roster.name] = id;
      newCreatorRows.push({
        id, first_name: firstName, last_name: lastName,
        photo: roster.photo || null,
        location: roster.location || null,
        lat: roster.lat ?? null, lng: roster.lng ?? null,
        notes: roster.bio || 'Imported from July',
        created_at: now, updated_at: now,
      });
      Object.entries(roster.platforms || {}).forEach(([platform, data]) => {
        newPlatformRows.push({
          creator_id: id, platform,
          handle: data.handle || '', url: data.url || '',
          followers: data.followers ?? null,
          engagement_rate: data.engagementRate ?? null,
          audience_data: data.audienceData || null,
        });
      });
      (roster.niches || []).forEach(niche => {
        newNicheRows.push({ creator_id: id, niche });
      });
      added++;
      continue;
    }

    const creatorId = existing.id;
    let changed = false;
    const updates = {};

    // Only update photo if we have a new one (don't overwrite user-set photos with null)
    if (roster.photo && roster.photo !== existing.photo) { updates.photo = roster.photo; changed = true; }
    if (roster.location && roster.location !== existing.location) { updates.location = roster.location; changed = true; }
    if (roster.lat != null && roster.lat !== existing.lat) { updates.lat = roster.lat; changed = true; }
    if (roster.lng != null && roster.lng !== existing.lng) { updates.lng = roster.lng; changed = true; }
    // Notes are NEVER overwritten — user may have edited them

    // Platform updates
    const existingPlats = existingPlatformMap[creatorId] || {};
    Object.entries(roster.platforms || {}).forEach(([platform, data]) => {
      const ep = existingPlats[platform];
      if (!ep) {
        updatePlatformInserts.push({
          creator_id: creatorId, platform,
          handle: data.handle || '', url: data.url || '',
          followers: data.followers ?? null,
          engagement_rate: data.engagementRate ?? null,
          audience_data: data.audienceData || null,
        });
        changed = true;
      } else {
        const followersChanged = data.followers != null && data.followers !== ep.followers;
        const engChanged = data.engagementRate != null && data.engagementRate !== ep.engagement_rate;
        const handleChanged = data.handle && data.handle !== ep.handle;
        const audienceChanged = data.audienceData && JSON.stringify(data.audienceData) !== JSON.stringify(ep.audience_data);
        if (followersChanged || engChanged || handleChanged || audienceChanged) {
          updatePlatformDeletes.push(creatorId);
          updatePlatformInserts.push({
            creator_id: creatorId, platform,
            handle: data.handle || ep.handle || '',
            url: data.url || ep.url || '',
            followers: data.followers ?? ep.followers,
            engagement_rate: data.engagementRate ?? ep.engagement_rate,
            audience_data: data.audienceData || ep.audience_data || null,
          });
          changed = true;
        }
      }
    });

    // Niches: only ADD new ones, never remove user-added niches
    const existingNicheSet = existingNicheMap[creatorId] || new Set();
    const newNiches = (roster.niches || []).filter(n => !existingNicheSet.has(n));
    if (newNiches.length > 0) {
      newNiches.forEach(niche => {
        updateNicheInserts.push({ creator_id: creatorId, niche });
      });
      changed = true;
    }

    // Collabs: only update if July has collab data AND something changed
    if (roster.collabs && roster.collabs.length > 0) {
      changedCollabCreatorIds.push(creatorId);
      roster.collabs.forEach((c, i) => {
        changedCollabRows.push({
          creator_id: creatorId, title: c.title || '', description: c.description || null,
          url: c.url || null, logo_url: c.logoUrl || null,
          logo_uuid: c.logoUuid || '', sort_order: i,
        });
      });
      changed = true;
    }

    if (changed) {
      updates.updated_at = now;
      updateCreatorRows.push({ id: creatorId, ...updates });
      updated++;
    } else {
      unchanged++;
    }
  }

  // ── Execute batched writes ──

  // New creators
  if (newCreatorRows.length > 0) {
    const { error } = await supabase.from('creators').insert(newCreatorRows);
    if (error) console.error('[sync] Failed to insert new creators:', error);
  }
  if (newPlatformRows.length > 0) {
    await supabase.from('creator_platforms').insert(newPlatformRows);
  }
  if (newNicheRows.length > 0) {
    await supabase.from('creator_niches').insert(newNicheRows);
  }
  if (newCollabRows.length > 0) {
    try { await supabase.from('creator_collabs').insert(newCollabRows); } catch (e) { console.warn('[sync] creator_collabs insert:', e.message); }
  }

  // Update existing creators — PARALLEL instead of sequential
  if (updateCreatorRows.length > 0) {
    await Promise.all(updateCreatorRows.map(row => {
      const { id, ...updates } = row;
      return Object.keys(updates).length > 0
        ? supabase.from('creators').update(updates).eq('id', id)
        : Promise.resolve();
    }));
  }

  // Rebuild platforms for updated creators
  const platformDeleteIds = [...new Set(updatePlatformDeletes)];
  if (platformDeleteIds.length > 0) {
    await supabase.from('creator_platforms').delete().in('creator_id', platformDeleteIds);
    const reinsertPlatforms = [];
    platformDeleteIds.forEach(cid => {
      const fromInserts = updatePlatformInserts.filter(p => p.creator_id === cid);
      const fromExisting = Object.values(existingPlatformMap[cid] || {})
        .filter(ep => !fromInserts.some(fi => fi.platform === ep.platform))
        .map(ep => ({
          creator_id: cid, platform: ep.platform,
          handle: ep.handle || '', url: ep.url || '',
          followers: ep.followers, engagement_rate: ep.engagement_rate,
          audience_data: ep.audience_data || null,
        }));
      reinsertPlatforms.push(...fromInserts, ...fromExisting);
    });
    if (reinsertPlatforms.length > 0) {
      await supabase.from('creator_platforms').insert(reinsertPlatforms);
    }
  }

  const newPlatformOnlyInserts = updatePlatformInserts.filter(p => !platformDeleteIds.includes(p.creator_id));
  if (newPlatformOnlyInserts.length > 0) {
    await supabase.from('creator_platforms').insert(newPlatformOnlyInserts);
  }

  if (updateNicheInserts.length > 0) {
    await supabase.from('creator_niches').insert(updateNicheInserts);
  }

  // Collabs: only rebuild for CHANGED creators that have July collab data
  // (never touch collabs for unchanged creators — preserves user-added data)
  if (changedCollabCreatorIds.length > 0) {
    try { await supabase.from('creator_collabs').delete().in('creator_id', changedCollabCreatorIds); } catch {}
    try { if (changedCollabRows.length > 0) await supabase.from('creator_collabs').insert(changedCollabRows); } catch {}
  }

  // ── Update sync_cache ──
  const cacheUpserts = [];

  for (const { roster, hash } of newCreators) {
    const id = newCreatorIdMap[roster.username || roster.name];
    if (!id) continue;
    cacheUpserts.push({
      july_username: roster.username || normalizeName(roster.name),
      creator_id: id,
      roster_hash: hash,
      photo_source_url: (roster.photo && !roster.photo.startsWith('data:')) ? roster.photo : null,
      audience_enriched: Object.values(roster.platforms || {}).some(p => p.audienceData),
      last_synced_at: now,
    });
  }

  for (const { roster, hash, existing, cached } of changedCreators) {
    const creatorId = existing ? existing.id : newCreatorIdMap[roster.username || roster.name];
    if (!creatorId) continue;
    cacheUpserts.push({
      july_username: roster.username || normalizeName(roster.name),
      creator_id: creatorId,
      roster_hash: hash,
      photo_source_url: (roster.photo && !roster.photo.startsWith('data:')) ? roster.photo : null,
      audience_enriched: cached?.audience_enriched || Object.values(roster.platforms || {}).some(p => p.audienceData),
      last_synced_at: now,
    });
  }

  for (const { roster, hash, cached } of unchangedCreators) {
    if (!cached) continue;
    cacheUpserts.push({
      july_username: cached.july_username,
      creator_id: cached.creator_id,
      roster_hash: cached.roster_hash,
      photo_source_url: cached.photo_source_url,
      audience_enriched: cached.audience_enriched,
      last_synced_at: now,
    });
  }

  if (cacheUpserts.length > 0) {
    const { error } = await supabase.from('sync_cache').upsert(cacheUpserts);
    if (error) console.warn('[sync] sync_cache upsert:', error.message);
  }

  return { added, updated, unchanged };
}

// ── Handler ──

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const force = req.query?.force === 'true';
    console.log(`[sync] Starting July sync...${force ? ' (force refresh)' : ''}`);

    // Step 1: Fast roster-only scrape (single page fetch, no detail pages)
    const { creators: rosterCreators } = await scrapeRoster({
      logPrefix: '[sync]',
      rosterOnly: !force,
      geocode: force,
    });
    console.log(`[sync] Scraped ${rosterCreators.length} creators from July roster`);

    if (force) {
      await downloadCreatorPhotos(rosterCreators, { logPrefix: '[sync]' });
    }

    if (rosterCreators.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No creators found on July — nothing to sync',
        added: 0, updated: 0, unchanged: 0,
        syncedAt: new Date().toISOString()
      });
    }

    // Step 2: Differential sync
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const result = await differentialSync(supabase, rosterCreators, force);

    console.log(`[sync] Done: ${result.added} added, ${result.updated} updated, ${result.unchanged} unchanged`);

    return res.status(200).json({
      success: true,
      ...result,
      total: rosterCreators.length,
      syncedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('[sync] Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
