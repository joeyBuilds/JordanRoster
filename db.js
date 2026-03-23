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

function rowToCreator(row, platformRows, nicheRows, demoRows) {
  const platforms = {};
  platformRows.forEach(p => {
    platforms[p.platform] = {
      handle: p.handle || '',
      url: p.url || '',
      followers: p.followers,
      engagementRate: p.engagement_rate ?? null
    };
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
    ([platform, data]) => ({
      creator_id: c.id,
      platform,
      handle: data.handle || '',
      url: data.url || '',
      followers: data.followers ?? null,
      engagement_rate: data.engagementRate ?? null
    })
  );
  const niches = (c.niches || []).map(niche => ({ creator_id: c.id, niche }));
  const demographics = (c.demographics || []).map(demographic => ({ creator_id: c.id, demographic }));
  return { platforms, niches, demographics };
}

// ── Public API: db ──

const db = {
  async load() {
    const [{ data: rows, error: e1 }, { data: platforms }, { data: niches }, { data: demos }] = await Promise.all([
      _supabase.from('creators').select('*'),
      _supabase.from('creator_platforms').select('*'),
      _supabase.from('creator_niches').select('*'),
      _supabase.from('creator_demographics').select('*')
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

    return rows.map(row => rowToCreator(
      row,
      platformMap[row.id] || [],
      nicheMap[row.id] || [],
      demoMap[row.id] || []
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
      const allPlatforms = [];
      const allNiches = [];
      const allDemos = [];
      creators.forEach(c => {
        const related = creatorRelatedRows(c);
        allPlatforms.push(...related.platforms);
        allNiches.push(...related.niches);
        allDemos.push(...related.demographics);
      });

      await Promise.all([
        allPlatforms.length ? _supabase.from('creator_platforms').insert(allPlatforms) : null,
        allNiches.length ? _supabase.from('creator_niches').insert(allNiches) : null,
        allDemos.length ? _supabase.from('creator_demographics').insert(allDemos) : null
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
        _supabase.from('creator_demographics').delete().in('creator_id', ids)
      ]);

      const allPlatforms = [];
      const allNiches = [];
      const allDemos = [];
      creators.forEach(c => {
        const related = creatorRelatedRows(c);
        allPlatforms.push(...related.platforms);
        allNiches.push(...related.niches);
        allDemos.push(...related.demographics);
      });

      await Promise.all([
        allPlatforms.length ? _supabase.from('creator_platforms').insert(allPlatforms) : null,
        allNiches.length ? _supabase.from('creator_niches').insert(allNiches) : null,
        allDemos.length ? _supabase.from('creator_demographics').insert(allDemos) : null
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
        _supabase.from('creator_demographics').delete().eq('creator_id', creator.id)
      ]);

      const related = creatorRelatedRows(creator);
      await Promise.all([
        related.platforms.length ? _supabase.from('creator_platforms').insert(related.platforms) : null,
        related.niches.length ? _supabase.from('creator_niches').insert(related.niches) : null,
        related.demographics.length ? _supabase.from('creator_demographics').insert(related.demographics) : null
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

// ── Migration from old SQLite/IndexedDB ──

async function _migrateFromIndexedDB() {
  try {
    if (typeof initSqlJs === 'undefined') {
      console.log('sql.js not available — skipping IndexedDB migration');
      return false;
    }

    // Try to load old database from IndexedDB
    const savedData = await new Promise((resolve) => {
      const req = indexedDB.open('creator_roster', 1);
      req.onupgradeneeded = () => {
        const idb = req.result;
        if (!idb.objectStoreNames.contains('sqliteDb')) {
          idb.createObjectStore('sqliteDb');
        }
      };
      req.onsuccess = () => {
        const idb = req.result;
        try {
          const tx = idb.transaction('sqliteDb', 'readonly');
          const store = tx.objectStore('sqliteDb');
          const getReq = store.get('main');
          getReq.onsuccess = () => resolve(getReq.result || null);
          getReq.onerror = () => resolve(null);
        } catch (e) {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });

    if (!savedData) {
      console.log('No IndexedDB data found — nothing to migrate');
      return false;
    }

    console.log('Found old SQLite data in IndexedDB. Migrating to Supabase...');
    if (typeof showToast === 'function') showToast('Migrating data to cloud...', 'info');

    // Load old SQLite database
    const SQL = await initSqlJs({
      locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/${file}`
    });
    const oldDb = new SQL.Database(new Uint8Array(savedData));

    function oldQueryAll(sql) {
      try {
        const stmt = oldDb.prepare(sql);
        const results = [];
        while (stmt.step()) results.push(stmt.getAsObject());
        stmt.free();
        return results;
      } catch (e) {
        return [];
      }
    }

    const oldCreators = oldQueryAll('SELECT * FROM creators');
    const oldPlatforms = oldQueryAll('SELECT * FROM creator_platforms');
    const oldNiches = oldQueryAll('SELECT * FROM creator_niches');
    const oldDemos = oldQueryAll('SELECT * FROM creator_demographics');
    const oldBin = oldQueryAll('SELECT * FROM recycle_bin');
    const oldSettings = oldQueryAll('SELECT * FROM settings');

    if (oldCreators.length === 0) {
      console.log('No creators in old database');
      oldDb.close();
      return false;
    }

    console.log(`Migrating ${oldCreators.length} creators...`);

    // Build lookup maps from old data
    const platformMap = {};
    oldPlatforms.forEach(p => {
      if (!platformMap[p.creatorId]) platformMap[p.creatorId] = [];
      platformMap[p.creatorId].push(p);
    });

    const nicheMap = {};
    oldNiches.forEach(n => {
      if (!nicheMap[n.creatorId]) nicheMap[n.creatorId] = [];
      nicheMap[n.creatorId].push(n);
    });

    const demoMap = {};
    oldDemos.forEach(d => {
      if (!demoMap[d.creatorId]) demoMap[d.creatorId] = [];
      demoMap[d.creatorId].push(d);
    });

    // Convert old format to app format
    const creators = oldCreators.map(row => ({
      id: row.id,
      firstName: row.firstName || '',
      lastName: row.lastName || '',
      photo: row.photo || null,
      email: row.email || null,
      mediaKit: row.mediaKit || null,
      birthday: row.birthday || null,
      platforms: (() => {
        const p = {};
        (platformMap[row.id] || []).forEach(pr => {
          p[pr.platform] = { handle: pr.handle || '', url: pr.url || '', followers: pr.followers };
        });
        return p;
      })(),
      niches: (nicheMap[row.id] || []).map(n => n.niche),
      demographics: (demoMap[row.id] || []).map(d => d.demographic),
      location: row.location || null,
      lat: row.lat,
      lng: row.lng,
      notes: row.notes || null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }));

    // Write to Supabase
    await db.save(creators);

    // Migrate recycle bin
    if (oldBin.length > 0) {
      const binRows = oldBin.map(row => ({
        id: row.id,
        creator_data: JSON.parse(row.creatorData),
        deleted_at: row.deletedAt
      }));
      await _supabase.from('recycle_bin').upsert(binRows);
      _recycleBinCount = binRows.length;
    }

    // Migrate settings
    if (oldSettings.length > 0) {
      const settingsRows = oldSettings.map(s => {
        let value;
        try { value = JSON.parse(s.value); } catch { value = s.value; }
        return { key: s.key, value };
      });
      await _supabase.from('settings').upsert(settingsRows);
      settingsRows.forEach(s => { _settingsCache[s.key] = s.value; });
    }

    oldDb.close();
    console.log('Migration complete!');
    if (typeof showToast === 'function') showToast(`Migrated ${creators.length} creators to cloud!`, 'success');
    return true;
  } catch (e) {
    console.error('Migration from IndexedDB failed:', e);
    if (typeof showToast === 'function') showToast('Migration failed — check console', 'error');
    return false;
  }
}

// ── Initialization ──

async function initDatabase() {
  if (typeof window.supabase === 'undefined') {
    throw new Error('Supabase client not loaded — check script tag in index.html');
  }

  _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Load settings into cache
  const { data: settingsRows } = await _supabase.from('settings').select('*');
  (settingsRows || []).forEach(s => {
    _settingsCache[s.key] = s.value;
  });

  // Load recycle bin count
  const { count } = await _supabase.from('recycle_bin')
    .select('*', { count: 'exact', head: true });
  _recycleBinCount = count || 0;

  // Check if Supabase has any creators — if not, try migration from old IndexedDB
  const { count: creatorCount } = await _supabase.from('creators')
    .select('*', { count: 'exact', head: true });

  if (creatorCount === 0) {
    await _migrateFromIndexedDB();
  }
}
