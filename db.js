// ===========================
// DATABASE LAYER — Supabase
// ===========================
// Cloud-hosted PostgreSQL via Supabase. Replaces the sql.js/IndexedDB layer.
// Same public API: db, recycleBin, getSetting, setSetting, initDatabase, flushPersist.

const SUPABASE_URL = 'https://imlmcbnvrkupplvgmytb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImltbG1jYm52cmt1cHBsdmdteXRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMDQwMDEsImV4cCI6MjA4OTg4MDAwMX0.0QYh-ZibrJy4Sn5yryc2j236qzBdTjvAC300VgOXtxo';

let _supabase = null;
let _settingsCache = {};
let _persistTimeout = null;
let _recycleBinCount = 0;
const PERSIST_DEBOUNCE_MS = 500;

// Safe wrapper for Supabase queries that might fail (e.g. table doesn't exist yet)
async function safeQuery(queryBuilder) {
  try { return await queryBuilder; } catch { return { data: null, error: null }; }
}

// ── Column mapping: app (camelCase) ↔ Supabase (snake_case) ──

function creatorToRow(c) {
  return {
    id: c.id,
    first_name: c.firstName || '',
    last_name: c.lastName || '',
    photo: c.photo || null,
    email: c.email || null,
    media_kit: c.mediaKit || null,
    birthday: c.birthday || null,
    location: c.location || null,
    lat: c.lat ?? null,
    lng: c.lng ?? null,
    notes: c.notes || null,
    created_at: c.createdAt,
    updated_at: c.updatedAt
  };
}

function rowToCreator(row, platformRows, nicheRows, demoRows, rateRows, collabRows) {
  const platforms = {};
  platformRows.forEach(p => {
    const entry = {
      handle: p.handle || '',
      url: p.url || '',
      followers: p.followers,
      engagementRate: p.engagement_rate ?? null
    };
    if (p.audience_data) entry.audienceData = p.audience_data;
    platforms[p.platform] = entry;
  });

  return {
    id: row.id,
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    photo: row.photo || null,
    email: row.email || null,
    mediaKit: row.media_kit || null,
    birthday: row.birthday || null,
    platforms,
    niches: nicheRows.map(n => n.niche),
    demographics: demoRows.map(d => d.demographic),
    rates: (rateRows || []).map(r => ({ title: r.title, price: r.price, uuid: r.uuid, order: r.sort_order ?? 0 })).sort((a, b) => a.order - b.order),
    collabs: (collabRows || []).map(c => ({ title: c.title, description: c.description, url: c.url, logoUrl: c.logo_url, logoUuid: c.logo_uuid })),
    location: row.location || null,
    lat: row.lat,
    lng: row.lng,
    notes: row.notes || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function creatorRelatedRows(c) {
  const platforms = Object.entries(c.platforms && typeof c.platforms === 'object' ? c.platforms : {}).map(
    ([platform, data]) => {
      const row = {
        creator_id: c.id,
        platform,
        handle: data.handle || '',
        url: data.url || '',
        followers: data.followers ?? null
      };
      if (data.engagementRate != null) row.engagement_rate = data.engagementRate;
      if (data.audienceData) row.audience_data = data.audienceData;
      return row;
    }
  );
  const niches = (c.niches || []).map(niche => ({ creator_id: c.id, niche }));
  const demographics = (c.demographics || []).map(demographic => ({ creator_id: c.id, demographic }));
  const rates = (c.rates || []).map((r, i) => ({ creator_id: c.id, title: r.title || '', price: r.price ?? null, uuid: r.uuid || '', sort_order: r.order ?? i }));
  const collabs = (c.collabs || []).map((col, i) => ({ creator_id: c.id, title: col.title || '', description: col.description || null, url: col.url || null, logo_url: col.logoUrl || null, logo_uuid: col.logoUuid || '', sort_order: i }));
  return { platforms, niches, demographics, rates, collabs };
}

// ── Public API: db ──

const db = {
  async load() {
    const [{ data: rows, error: e1 }, { data: platforms }, { data: niches }, { data: demos }, { data: rates }, { data: collabs }] = await Promise.all([
      _supabase.from('creators').select('*'),
      _supabase.from('creator_platforms').select('*'),
      _supabase.from('creator_niches').select('*'),
      _supabase.from('creator_demographics').select('*'),
      safeQuery(_supabase.from('creator_rates').select('*')),
      safeQuery(_supabase.from('creator_collabs').select('*'))
    ]);

    if (e1) { console.error('Failed to load creators:', e1); return []; }
    if (!rows || rows.length === 0) return [];

    // Build lookup maps
    const platformMap = {};
    (platforms || []).forEach(p => {
      if (!platformMap[p.creator_id]) platformMap[p.creator_id] = [];
      platformMap[p.creator_id].push(p);
    });

    const nicheMap = {};
    (niches || []).forEach(n => {
      if (!nicheMap[n.creator_id]) nicheMap[n.creator_id] = [];
      nicheMap[n.creator_id].push(n);
    });

    const demoMap = {};
    (demos || []).forEach(d => {
      if (!demoMap[d.creator_id]) demoMap[d.creator_id] = [];
      demoMap[d.creator_id].push(d);
    });

    const rateMap = {};
    (rates || []).forEach(r => {
      if (!rateMap[r.creator_id]) rateMap[r.creator_id] = [];
      rateMap[r.creator_id].push(r);
    });

    const collabMap = {};
    (collabs || []).forEach(c => {
      if (!collabMap[c.creator_id]) collabMap[c.creator_id] = [];
      collabMap[c.creator_id].push(c);
    });

    return rows.map(row => rowToCreator(
      row,
      platformMap[row.id] || [],
      nicheMap[row.id] || [],
      demoMap[row.id] || [],
      rateMap[row.id] || [],
      collabMap[row.id] || []
    ));
  },

  async save(creators) {
    try {
      // Full wipe and re-insert (used for reset/import)
      await _supabase.from('creators').delete().not('id', 'is', null);

      if (creators.length === 0) return;

      const mainRows = creators.map(creatorToRow);
      const { error } = await _supabase.from('creators').upsert(mainRows);
      if (error) throw error;

      // Batch insert all related data
      const allPlatforms = [], allNiches = [], allDemos = [], allRates = [], allCollabs = [];
      creators.forEach(c => {
        const related = creatorRelatedRows(c);
        allPlatforms.push(...related.platforms);
        allNiches.push(...related.niches);
        allDemos.push(...related.demographics);
        allRates.push(...related.rates);
        allCollabs.push(...related.collabs);
      });

      await Promise.all([
        allPlatforms.length ? _supabase.from('creator_platforms').insert(allPlatforms) : null,
        allNiches.length ? _supabase.from('creator_niches').insert(allNiches) : null,
        allDemos.length ? _supabase.from('creator_demographics').insert(allDemos) : null,
        allRates.length ? safeQuery(_supabase.from('creator_rates').insert(allRates)) : null,
        allCollabs.length ? safeQuery(_supabase.from('creator_collabs').insert(allCollabs)) : null
      ]);
    } catch (e) {
      console.error('Failed to save all creators:', e);
    }
  },

  persist(creators) {
    // Debounced sync to Supabase — fire and forget
    clearTimeout(_persistTimeout);
    _persistTimeout = setTimeout(() => {
      this._syncAll(creators).catch(e => console.error('Persist failed:', e));
    }, PERSIST_DEBOUNCE_MS);
    if (typeof updateStorageIndicator === 'function') updateStorageIndicator();
  },

  async _syncAll(creators) {
    try {
      // Get existing IDs in Supabase
      const { data: existing } = await _supabase.from('creators').select('id');
      const existingIds = new Set((existing || []).map(r => r.id));
      const currentIds = new Set(creators.map(c => c.id));

      // Delete removed creators (CASCADE handles related tables)
      const toDelete = [...existingIds].filter(id => !currentIds.has(id));
      if (toDelete.length > 0) {
        await _supabase.from('creators').delete().in('id', toDelete);
      }

      if (creators.length === 0) return;

      // Upsert all current creators
      const mainRows = creators.map(creatorToRow);
      await _supabase.from('creators').upsert(mainRows);

      // Rebuild related data: delete existing, then re-insert
      const ids = creators.map(c => c.id);
      await Promise.all([
        _supabase.from('creator_platforms').delete().in('creator_id', ids),
        _supabase.from('creator_niches').delete().in('creator_id', ids),
        _supabase.from('creator_demographics').delete().in('creator_id', ids),
        safeQuery(_supabase.from('creator_rates').delete().in('creator_id', ids)),
        safeQuery(_supabase.from('creator_collabs').delete().in('creator_id', ids))
      ]);

      const allPlatforms = [], allNiches = [], allDemos = [], allRates = [], allCollabs = [];
      creators.forEach(c => {
        const related = creatorRelatedRows(c);
        allPlatforms.push(...related.platforms);
        allNiches.push(...related.niches);
        allDemos.push(...related.demographics);
        allRates.push(...related.rates);
        allCollabs.push(...related.collabs);
      });

      await Promise.all([
        allPlatforms.length ? _supabase.from('creator_platforms').insert(allPlatforms) : null,
        allNiches.length ? _supabase.from('creator_niches').insert(allNiches) : null,
        allDemos.length ? _supabase.from('creator_demographics').insert(allDemos) : null,
        allRates.length ? safeQuery(_supabase.from('creator_rates').insert(allRates)) : null,
        allCollabs.length ? safeQuery(_supabase.from('creator_collabs').insert(allCollabs)) : null
      ]);
    } catch (e) {
      console.error('Sync to Supabase failed:', e);
    }
  },

  async upsert(creator) {
    try {
      const { error } = await _supabase.from('creators').upsert(creatorToRow(creator));
      if (error) throw error;

      // Delete + reinsert related data for this creator
      await Promise.all([
        _supabase.from('creator_platforms').delete().eq('creator_id', creator.id),
        _supabase.from('creator_niches').delete().eq('creator_id', creator.id),
        _supabase.from('creator_demographics').delete().eq('creator_id', creator.id),
        safeQuery(_supabase.from('creator_rates').delete().eq('creator_id', creator.id)),
        safeQuery(_supabase.from('creator_collabs').delete().eq('creator_id', creator.id))
      ]);

      const related = creatorRelatedRows(creator);
      await Promise.all([
        related.platforms.length ? _supabase.from('creator_platforms').insert(related.platforms) : null,
        related.niches.length ? _supabase.from('creator_niches').insert(related.niches) : null,
        related.demographics.length ? _supabase.from('creator_demographics').insert(related.demographics) : null,
        related.rates.length ? safeQuery(_supabase.from('creator_rates').insert(related.rates)) : null,
        related.collabs.length ? safeQuery(_supabase.from('creator_collabs').insert(related.collabs)) : null
      ]);
    } catch (e) {
      console.error('Failed to upsert creator:', e);
    }
  },

  async delete(creatorId) {
    // CASCADE handles related tables
    await _supabase.from('creators').delete().eq('id', creatorId);
  },

  getSize() {
    return 0; // Not meaningful for remote DB
  }
};

// ── Public API: recycleBin ──

const RECYCLE_EXPIRY_DAYS = 7;

const recycleBin = {
  async load() {
    const cutoff = Date.now() - RECYCLE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

    // Purge expired entries
    await _supabase.from('recycle_bin').delete().lt('deleted_at', cutoff);

    const { data: rows } = await _supabase.from('recycle_bin')
      .select('*')
      .order('deleted_at', { ascending: false });

    const items = (rows || []).map(row => {
      const creator = row.creator_data;
      creator.deletedAt = row.deleted_at;
      return creator;
    });

    _recycleBinCount = items.length;
    return items;
  },

  async add(creator) {
    const { deletedAt, ...cleanCreator } = creator;
    await _supabase.from('recycle_bin').upsert({
      id: creator.id,
      creator_data: cleanCreator,
      deleted_at: Date.now()
    });
    _recycleBinCount++;
  },

  async restore(creatorId) {
    const { data: rows } = await _supabase.from('recycle_bin')
      .select('*')
      .eq('id', creatorId);

    if (!rows || rows.length === 0) return null;

    const creator = rows[0].creator_data;
    creator.updatedAt = new Date().toISOString();
    await _supabase.from('recycle_bin').delete().eq('id', creatorId);
    _recycleBinCount = Math.max(0, _recycleBinCount - 1);
    return creator;
  },

  async permanentDelete(creatorId) {
    await _supabase.from('recycle_bin').delete().eq('id', creatorId);
    _recycleBinCount = Math.max(0, _recycleBinCount - 1);
  },

  async emptyAll() {
    await _supabase.from('recycle_bin').delete().not('id', 'is', null);
    _recycleBinCount = 0;
  },

  count() {
    return _recycleBinCount;
  }
};

// ── Public API: settings (cached in memory, synced to Supabase) ──

function getSetting(key, defaultValue) {
  const cached = _settingsCache[key];
  if (cached === undefined) return defaultValue;
  return cached;
}

function setSetting(key, value) {
  _settingsCache[key] = value;
  // Fire and forget to Supabase
  _supabase.from('settings')
    .upsert({ key, value })
    .then(({ error }) => {
      if (error) console.error('Failed to save setting:', key, error);
    });
}

// Force persist — triggers any pending debounced sync immediately
function flushPersist() {
  // No-op for Supabase — writes are already remote
}

// ── Initialization ──

async function initDatabase() {
  // Wait for Supabase to load (async script)
  let retries = 0;
  while (typeof window.supabase === 'undefined' && retries < 50) {
    await new Promise(r => setTimeout(r, 100));
    retries++;
  }
  if (typeof window.supabase === 'undefined') {
    throw new Error('Supabase client not loaded — check script tag in index.html');
  }

  _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Load settings and recycle bin count in parallel
  const [{ data: settingsRows }, { count }] = await Promise.all([
    _supabase.from('settings').select('*'),
    _supabase.from('recycle_bin').select('*', { count: 'exact', head: true })
  ]);

  (settingsRows || []).forEach(s => {
    _settingsCache[s.key] = s.value;
  });
  _recycleBinCount = count || 0;
}
