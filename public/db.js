// ===========================
// DATABASE LAYER — sql.js (SQLite in WebAssembly)
// ===========================
// Replaces localStorage with in-browser SQLite persisted to IndexedDB.
// Provides the same `db` and `recycleBin` API as the old localStorage layer.

const IDB_NAME = 'creator_roster';
const IDB_STORE = 'sqliteDb';
const IDB_KEY = 'main';

let sqlDb = null;
let _persistTimeout = null;
const PERSIST_DEBOUNCE_MS = 300;

// ── IndexedDB helpers ──

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(IDB_STORE)) {
        idb.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadFromIndexedDB() {
  try {
    const idb = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(IDB_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error('Failed to load from IndexedDB:', e);
    return null;
  }
}

async function saveToIndexedDB(data) {
  try {
    const idb = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const req = store.put(data, IDB_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error('Failed to save to IndexedDB:', e);
  }
}

// ── Debounced persist to IndexedDB ──

function schedulePersist() {
  clearTimeout(_persistTimeout);
  _persistTimeout = setTimeout(() => {
    if (!sqlDb) return;
    const data = sqlDb.export();
    saveToIndexedDB(data);
  }, PERSIST_DEBOUNCE_MS);
}

// Force immediate persist (for export, before unload, etc.)
function flushPersist() {
  clearTimeout(_persistTimeout);
  if (!sqlDb) return;
  const data = sqlDb.export();
  saveToIndexedDB(data);
}

// ── Schema ──

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS creators (
  id TEXT PRIMARY KEY,
  firstName TEXT NOT NULL DEFAULT '',
  lastName TEXT DEFAULT '',
  photo TEXT,
  email TEXT,
  mediaKit TEXT,
  birthday TEXT,
  location TEXT,
  lat REAL,
  lng REAL,
  notes TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS creator_platforms (
  creatorId TEXT NOT NULL,
  platform TEXT NOT NULL,
  handle TEXT DEFAULT '',
  url TEXT DEFAULT '',
  followers INTEGER,
  engagementRate REAL,
  PRIMARY KEY (creatorId, platform)
);

CREATE TABLE IF NOT EXISTS creator_niches (
  creatorId TEXT NOT NULL,
  niche TEXT NOT NULL,
  PRIMARY KEY (creatorId, niche)
);

CREATE TABLE IF NOT EXISTS creator_demographics (
  creatorId TEXT NOT NULL,
  demographic TEXT NOT NULL,
  PRIMARY KEY (creatorId, demographic)
);

CREATE TABLE IF NOT EXISTS recycle_bin (
  id TEXT PRIMARY KEY,
  creatorData TEXT NOT NULL,
  deletedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_platforms_platform ON creator_platforms(platform);
CREATE INDEX IF NOT EXISTS idx_platforms_followers ON creator_platforms(followers);
CREATE INDEX IF NOT EXISTS idx_niches_niche ON creator_niches(niche);
CREATE INDEX IF NOT EXISTS idx_demographics_demographic ON creator_demographics(demographic);
CREATE INDEX IF NOT EXISTS idx_creators_lat_lng ON creators(lat, lng);
`;

function createSchema() {
  // exec() supports multiple statements; run() only executes the first one
  sqlDb.exec(SCHEMA_SQL);
  // Migrate: add engagementRate column if upgrading from older schema
  try { run('ALTER TABLE creator_platforms ADD COLUMN engagementRate REAL'); } catch (_) { /* already exists */ }
}

// ── Creator object ↔ SQL ──

function creatorToRows(c) {
  return {
    main: [
      c.id, c.firstName || '', c.lastName || '', c.photo || null,
      c.email || null, c.mediaKit || null, c.birthday || null,
      c.location || null, c.lat ?? null, c.lng ?? null,
      c.notes || null, c.createdAt, c.updatedAt
    ],
    platforms: Object.entries(c.platforms && typeof c.platforms === 'object' ? c.platforms : {}).map(
      ([platform, data]) => [c.id, platform, data.handle || '', data.url || '', data.followers ?? null, data.engagementRate ?? null]
    ),
    niches: (c.niches || []).map(n => [c.id, n]),
    demographics: (c.demographics || []).map(d => [c.id, d])
  };
}

function rowsToCreator(row, platformRows, nicheRows, demoRows) {
  const platforms = {};
  platformRows.forEach(p => {
    platforms[p.platform] = {
      handle: p.handle || '',
      url: p.url || '',
      followers: p.followers,
      engagementRate: p.engagementRate ?? null
    };
  });

  return {
    id: row.id,
    firstName: row.firstName || '',
    lastName: row.lastName || '',
    photo: row.photo || null,
    email: row.email || null,
    mediaKit: row.mediaKit || null,
    birthday: row.birthday || null,
    platforms,
    niches: nicheRows.map(n => n.niche),
    demographics: demoRows.map(d => d.demographic),
    location: row.location || null,
    lat: row.lat,
    lng: row.lng,
    notes: row.notes || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

// Helper: run a SELECT and return array of objects
function queryAll(sql, params) {
  const stmt = sqlDb.prepare(sql);
  if (params) stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// Helper: run a statement (INSERT/UPDATE/DELETE)
function run(sql, params) {
  sqlDb.run(sql, params);
}

// ── Public API: db ──

const db = {
  load() {
    const creatorRows = queryAll('SELECT * FROM creators');
    if (creatorRows.length === 0) return [];

    const allPlatforms = queryAll('SELECT * FROM creator_platforms');
    const allNiches = queryAll('SELECT * FROM creator_niches');
    const allDemos = queryAll('SELECT * FROM creator_demographics');

    // Build lookup maps
    const platformMap = {};
    allPlatforms.forEach(p => {
      if (!platformMap[p.creatorId]) platformMap[p.creatorId] = [];
      platformMap[p.creatorId].push(p);
    });

    const nicheMap = {};
    allNiches.forEach(n => {
      if (!nicheMap[n.creatorId]) nicheMap[n.creatorId] = [];
      nicheMap[n.creatorId].push(n);
    });

    const demoMap = {};
    allDemos.forEach(d => {
      if (!demoMap[d.creatorId]) demoMap[d.creatorId] = [];
      demoMap[d.creatorId].push(d);
    });

    return creatorRows.map(row => rowsToCreator(
      row,
      platformMap[row.id] || [],
      nicheMap[row.id] || [],
      demoMap[row.id] || []
    ));
  },

  save(creators) {
    // Wrap in a transaction for speed
    run('BEGIN TRANSACTION');
    try {
      run('DELETE FROM creator_demographics');
      run('DELETE FROM creator_niches');
      run('DELETE FROM creator_platforms');
      run('DELETE FROM creators');

      const insertCreator = sqlDb.prepare(
        `INSERT INTO creators (id, firstName, lastName, photo, email, mediaKit, birthday,
         location, lat, lng, notes, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const insertPlatform = sqlDb.prepare(
        `INSERT INTO creator_platforms (creatorId, platform, handle, url, followers, engagementRate)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      const insertNiche = sqlDb.prepare(
        `INSERT INTO creator_niches (creatorId, niche) VALUES (?, ?)`
      );
      const insertDemo = sqlDb.prepare(
        `INSERT INTO creator_demographics (creatorId, demographic) VALUES (?, ?)`
      );

      creators.forEach(c => {
        const rows = creatorToRows(c);
        insertCreator.run(rows.main);
        rows.platforms.forEach(p => insertPlatform.run(p));
        rows.niches.forEach(n => insertNiche.run(n));
        rows.demographics.forEach(d => insertDemo.run(d));
      });

      insertCreator.free();
      insertPlatform.free();
      insertNiche.free();
      insertDemo.free();

      run('COMMIT');
    } catch (e) {
      run('ROLLBACK');
      console.error('Failed to save creators:', e);
    }
  },

  persist(creators) {
    this.save(creators);
    schedulePersist();
    if (typeof updateStorageIndicator === 'function') updateStorageIndicator();
  },

  // Save a single creator (upsert) — faster for single-item updates
  upsert(creator) {
    run('BEGIN TRANSACTION');
    try {
      // Remove old related data
      run('DELETE FROM creator_platforms WHERE creatorId = ?', [creator.id]);
      run('DELETE FROM creator_niches WHERE creatorId = ?', [creator.id]);
      run('DELETE FROM creator_demographics WHERE creatorId = ?', [creator.id]);

      // Upsert main row
      run(
        `INSERT OR REPLACE INTO creators (id, firstName, lastName, photo, email, mediaKit, birthday,
         location, lat, lng, notes, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [creator.id, creator.firstName || '', creator.lastName || '', creator.photo || null,
         creator.email || null, creator.mediaKit || null, creator.birthday || null,
         creator.location || null, creator.lat ?? null, creator.lng ?? null,
         creator.notes || null, creator.createdAt, creator.updatedAt]
      );

      // Insert related data
      const rows = creatorToRows(creator);
      rows.platforms.forEach(p => {
        run('INSERT INTO creator_platforms (creatorId, platform, handle, url, followers) VALUES (?, ?, ?, ?, ?)', p);
      });
      rows.niches.forEach(n => {
        run('INSERT INTO creator_niches (creatorId, niche) VALUES (?, ?)', n);
      });
      rows.demographics.forEach(d => {
        run('INSERT INTO creator_demographics (creatorId, demographic) VALUES (?, ?)', d);
      });

      run('COMMIT');
    } catch (e) {
      run('ROLLBACK');
      console.error('Failed to upsert creator:', e);
    }
  },

  // Delete a single creator
  delete(creatorId) {
    run('DELETE FROM creator_demographics WHERE creatorId = ?', [creatorId]);
    run('DELETE FROM creator_niches WHERE creatorId = ?', [creatorId]);
    run('DELETE FROM creator_platforms WHERE creatorId = ?', [creatorId]);
    run('DELETE FROM creators WHERE id = ?', [creatorId]);
  },

  // Get database size in bytes (approximate)
  getSize() {
    if (!sqlDb) return 0;
    return sqlDb.export().byteLength;
  }
};

// ── Public API: recycleBin ──

const RECYCLE_EXPIRY_DAYS = 7;

const recycleBin = {
  load() {
    const cutoff = Date.now() - RECYCLE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    // Purge expired entries
    run('DELETE FROM recycle_bin WHERE deletedAt < ?', [cutoff]);
    schedulePersist();

    return queryAll('SELECT * FROM recycle_bin ORDER BY deletedAt DESC').map(row => {
      const creator = JSON.parse(row.creatorData);
      creator.deletedAt = row.deletedAt;
      return creator;
    });
  },

  save(items) {
    run('DELETE FROM recycle_bin');
    items.forEach(item => {
      const { deletedAt, ...creatorData } = item;
      run(
        'INSERT INTO recycle_bin (id, creatorData, deletedAt) VALUES (?, ?, ?)',
        [item.id, JSON.stringify(creatorData), deletedAt]
      );
    });
    schedulePersist();
  },

  add(creator) {
    const { deletedAt, ...cleanCreator } = creator; // strip any existing deletedAt
    run(
      'INSERT OR REPLACE INTO recycle_bin (id, creatorData, deletedAt) VALUES (?, ?, ?)',
      [creator.id, JSON.stringify(cleanCreator), Date.now()]
    );
    schedulePersist();
  },

  restore(creatorId) {
    const rows = queryAll('SELECT * FROM recycle_bin WHERE id = ?', [creatorId]);
    if (rows.length === 0) return null;

    const creator = JSON.parse(rows[0].creatorData);
    creator.updatedAt = new Date().toISOString();
    run('DELETE FROM recycle_bin WHERE id = ?', [creatorId]);
    schedulePersist();
    return creator;
  },

  permanentDelete(creatorId) {
    run('DELETE FROM recycle_bin WHERE id = ?', [creatorId]);
    schedulePersist();
  },

  emptyAll() {
    run('DELETE FROM recycle_bin');
    schedulePersist();
  },

  count() {
    const cutoff = Date.now() - RECYCLE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    const rows = queryAll('SELECT COUNT(*) as cnt FROM recycle_bin WHERE deletedAt >= ?', [cutoff]);
    return rows[0]?.cnt || 0;
  }
};

// ── Public API: settings (replaces localStorage key-value for categories, etc.) ──

function getSetting(key, defaultValue) {
  const rows = queryAll('SELECT value FROM settings WHERE key = ?', [key]);
  if (rows.length === 0) return defaultValue;
  try {
    return JSON.parse(rows[0].value);
  } catch {
    return rows[0].value;
  }
}

function setSetting(key, value) {
  run(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    [key, JSON.stringify(value)]
  );
  schedulePersist();
}

// ── localStorage migration ──

function migrateFromLocalStorage() {
  // Check if there's existing localStorage data to migrate
  const oldCreators = localStorage.getItem('creator_roster_data');
  if (!oldCreators) return false;

  console.log('Migrating from localStorage to SQLite...');

  try {
    // Migrate creators
    const creators = JSON.parse(oldCreators);
    if (Array.isArray(creators) && creators.length > 0) {
      db.save(creators);
    }

    // Migrate recycle bin
    const oldBin = localStorage.getItem('creator_roster_recyclebin');
    if (oldBin) {
      const binItems = JSON.parse(oldBin);
      if (Array.isArray(binItems)) {
        binItems.forEach(item => {
          const { deletedAt, ...creatorData } = item;
          run(
            'INSERT OR REPLACE INTO recycle_bin (id, creatorData, deletedAt) VALUES (?, ?, ?)',
            [item.id, JSON.stringify(creatorData), deletedAt || Date.now()]
          );
        });
      }
    }

    // Migrate settings
    const settingsKeys = [
      'creator_roster_niche_categories',
      'creator_roster_demographic_categories',
      'deletedNiches',
      'deletedDemographics'
    ];

    settingsKeys.forEach(key => {
      const val = localStorage.getItem(key);
      if (val) {
        setSetting(key, JSON.parse(val));
      }
    });

    // Persist immediately
    flushPersist();

    // Clear old localStorage (keep a migration flag)
    localStorage.setItem('creator_roster_migrated_to_sqlite', 'true');

    console.log('Migration complete!');
    return true;
  } catch (e) {
    console.error('Migration failed:', e);
    return false;
  }
}

// ── Initialization ──

async function initDatabase() {
  if (typeof initSqlJs === 'undefined') {
    throw new Error('sql.js not loaded — check script tag in index.html');
  }

  // Load sql.js WASM
  const SQL = await initSqlJs({
    locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/${file}`
  });

  // Try loading existing DB from IndexedDB
  const savedData = await loadFromIndexedDB();
  if (savedData) {
    try {
      sqlDb = new SQL.Database(new Uint8Array(savedData));
      // Ensure schema is up to date (IF NOT EXISTS is safe)
      createSchema();
    } catch (e) {
      console.error('Failed to load saved DB, creating new:', e);
      sqlDb = new SQL.Database();
      createSchema();
      migrateFromLocalStorage();
    }
  } else {
    sqlDb = new SQL.Database();
    createSchema();
    migrateFromLocalStorage();
  }

  // Persist on page unload
  window.addEventListener('beforeunload', flushPersist);
}
