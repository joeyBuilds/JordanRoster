// ===========================
// PERFORMANCE UTILITIES
// ===========================
function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// Incremental list renderer — renders items in batches to avoid blocking the main thread
const BATCH_SIZE = 20; // render 20 items initially, then more on scroll
function renderListIncrementally(container, items, renderFn, opts = {}) {
  const { divider = true, batchSize = BATCH_SIZE } = opts;
  container.innerHTML = '';
  if (items.length === 0) return;

  let rendered = 0;
  let isRendering = false;

  function renderBatch() {
    if (rendered >= items.length || isRendering) return;
    isRendering = true;

    const fragment = document.createDocumentFragment();
    const end = Math.min(rendered + batchSize, items.length);

    for (let i = rendered; i < end; i++) {
      if (divider && i > 0) {
        const div = document.createElement('div');
        div.className = 'card-divider';
        div.innerHTML = '<div class="divider-line divider-line-left"></div><span class="divider-bloom">✿</span><div class="divider-line divider-line-right"></div>';
        fragment.appendChild(div);
      }
      fragment.appendChild(renderFn(items[i], i));
    }

    container.appendChild(fragment);
    rendered = end;
    isRendering = false;
  }

  // Render first batch immediately
  renderBatch();

  // Render more batches on scroll
  const scrollParent = container.closest('.tab-content') || container.parentElement;
  const onScroll = debounce(() => {
    if (rendered >= items.length) {
      scrollParent.removeEventListener('scroll', onScroll);
      return;
    }
    const rect = container.getBoundingClientRect();
    const parentRect = scrollParent.getBoundingClientRect();
    // Trigger load when within 200px of the bottom
    if (rect.bottom - parentRect.bottom < 200) {
      renderBatch();
    }
  }, 16); // ~60fps

  if (rendered < items.length) {
    scrollParent.addEventListener('scroll', onScroll, { passive: true });
  }
}

// ===========================
// IMAGE COMPRESSION
// ===========================
const IMG_MAX_DIM = 300;   // max width or height in px (avatars are shown at 90px max)
const IMG_QUALITY = 0.7;   // JPEG quality (0.7 ≈ 70%)
const IMG_MAX_BYTES = 30000; // target ~30KB per photo

function compressImage(dataUrl) {
  return new Promise((resolve) => {
    // If it's not a data URL (i.e. an external URL), skip compression
    if (!dataUrl || !dataUrl.startsWith('data:')) {
      resolve(dataUrl);
      return;
    }
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let w = img.width, h = img.height;

      // Scale down to fit within IMG_MAX_DIM
      if (w > IMG_MAX_DIM || h > IMG_MAX_DIM) {
        const ratio = Math.min(IMG_MAX_DIM / w, IMG_MAX_DIM / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }

      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      // Try JPEG at target quality, then lower if still too big
      let quality = IMG_QUALITY;
      let result = canvas.toDataURL('image/jpeg', quality);
      while (result.length > IMG_MAX_BYTES * 1.37 && quality > 0.3) {
        quality -= 0.1;
        result = canvas.toDataURL('image/jpeg', quality);
      }

      resolve(result);
    };
    img.onerror = () => resolve(dataUrl); // fallback to original on error
    img.src = dataUrl;
  });
}

// db, recycleBin, getSetting, setSetting are provided by db.js (loaded before this file)

function getStorageUsage() {
  return db.getSize();
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ===========================
// CONSTANTS
// ===========================
const PLATFORMS = [
  'Instagram',
  'TikTok',
  'YouTube'
];

const PRESET_NICHES = [
  'Beauty',
  'Comedy',
  'Couples',
  'Education',
  'Fashion',
  'Fitness',
  'Food & Drink',
  'Gaming',
  'International',
  'Lifestyle',
  'Music',
  'Outdoor & Adventure',
  'Parenting',
  'Pets',
  'Tech',
  'Travel',
  'Van Life'
];

// ── Tag Categories ──
const DEFAULT_NICHE_CATEGORIES = {
  'Content & Entertainment': ['Comedy', 'Music', 'Gaming', 'Education'],
  'Lifestyle & Wellness': ['Lifestyle', 'Fitness', 'Beauty', 'Fashion', 'Food & Drink'],
  'People & Relationships': ['Couples', 'Parenting', 'Pets'],
  'Travel & Adventure': ['Travel', 'Outdoor & Adventure', 'Van Life', 'International'],
  'Industry': ['Tech']
};
const DEFAULT_DEMO_CATEGORIES = {
  'Gender & Identity': ['Female', 'Male', 'Non-Binary', 'LGBTQ+'],
  'Culture & Background': ['Person of Color', 'Indigenous', 'Immigrant', 'Bilingual/Multilingual', 'Veteran'],
  'Age & Generation': ['Gen Z', 'Over 40'],
  'Representation': ['Body Positive', 'Disabled/Accessibility', 'Neurodivergent']
};

function loadTagCategories(type) {
  const key = `creator_roster_${type}_categories`;
  const saved = getSetting(key, null);
  if (saved) return saved;
  return type === 'niche' ? { ...DEFAULT_NICHE_CATEGORIES } : { ...DEFAULT_DEMO_CATEGORIES };
}
function saveTagCategories(type, categories) {
  setSetting(`creator_roster_${type}_categories`, categories);
}
function getCategoryForItem(item, categories) {
  for (const [cat, items] of Object.entries(categories)) {
    if (items.includes(item)) return cat;
  }
  return null;
}

// Deleted presets — persisted so preset tags can be permanently removed
// Initialized in init() after database is ready
let deletedNiches = [];
let deletedDemographics = [];

function loadDeletedPresets() {
  deletedNiches = getSetting('deletedNiches', []);
  deletedDemographics = getSetting('deletedDemographics', []);
}

function saveDeletedPresets() {
  setSetting('deletedNiches', deletedNiches);
  setSetting('deletedDemographics', deletedDemographics);
}

// Get all niches across the roster (presets + custom), minus deleted
function getAllNiches() {
  const activePresets = PRESET_NICHES.filter(n => !deletedNiches.includes(n));
  const custom = creators.flatMap(c => (c.niches || []).filter(n => !PRESET_NICHES.includes(n)));
  return [...new Set([...activePresets, ...custom])].sort((a, b) => a.localeCompare(b));
}

const PRESET_DEMOGRAPHICS = [
  'Bilingual/Multilingual', 'Body Positive', 'Disabled/Accessibility', 'Female',
  'Gen Z', 'Immigrant', 'Indigenous', 'LGBTQ+', 'Male', 'Neurodivergent',
  'Non-Binary', 'Over 40', 'Person of Color', 'Veteran'
];

function getAllDemographics() {
  const activePresets = PRESET_DEMOGRAPHICS.filter(d => !deletedDemographics.includes(d));
  const custom = creators.flatMap(c => (c.demographics || []).filter(d => !PRESET_DEMOGRAPHICS.includes(d)));
  return [...new Set([...activePresets, ...custom])].sort((a, b) => a.localeCompare(b));
}

const TIERS = [
  'Nano (<10K)',
  'Micro (10K-100K)',
  'Mid (100K-500K)',
  'Macro (500K-1M)',
  'Mega (1M+)'
];

const PLATFORM_ICONS = {
  'Instagram': '📸',
  'TikTok': '🎵',
  'YouTube': '▶️'
};

// SVG logos for ring detail view (white, sized for cards)
const PLATFORM_SVGS = {
  'Instagram': `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="20" height="20" rx="5" stroke="white" stroke-width="2"/><circle cx="12" cy="12" r="5" stroke="white" stroke-width="2"/><circle cx="17.5" cy="6.5" r="1.5" fill="white"/></svg>`,
  'TikTok': `<svg width="18" height="20" viewBox="0 0 18 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 0v13.5a3.5 3.5 0 1 1-3-3.46V7.04A6.5 6.5 0 1 0 12 13.5V6.73A7.5 7.5 0 0 0 17 8V5a5 5 0 0 1-5-5H9Z" fill="white"/></svg>`,
  'YouTube': `<svg width="22" height="16" viewBox="0 0 22 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="20" height="14" rx="4" stroke="white" stroke-width="2"/><path d="M9 5v6l5-3-5-3Z" fill="white"/></svg>`
};

// Small SVGs for sidebar card chips (platform-colored)
const PLATFORM_SVGS_SM = {
  'Instagram': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="5" stroke="#E1306C" stroke-width="2.5"/><circle cx="12" cy="12" r="5" stroke="#E1306C" stroke-width="2.5"/><circle cx="17.5" cy="6.5" r="1.5" fill="#E1306C"/></svg>`,
  'TikTok': `<svg width="13" height="14" viewBox="0 0 18 20" fill="none"><path d="M9 0v13.5a3.5 3.5 0 1 1-3-3.46V7.04A6.5 6.5 0 1 0 12 13.5V6.73A7.5 7.5 0 0 0 17 8V5a5 5 0 0 1-5-5H9Z" fill="#00F2EA"/></svg>`,
  'YouTube': `<svg width="16" height="12" viewBox="0 0 22 16" fill="none"><rect x="1" y="1" width="20" height="14" rx="4" stroke="#FF0000" stroke-width="2.5"/><path d="M9 5v6l5-3-5-3Z" fill="#FF0000"/></svg>`
};

// ===========================
// STATE
// ===========================
let creators = [];
let currentEditingCreator = null;
let map = null;
let markers = {};
let mapStateBeforeDetail = null; // {center, zoom} saved before flying to a creator
let dispatchFilters = {
  platformTiers: [],  // [{platform: 'Instagram', tier: 'Micro (10K-100K)'}, ...]
  niches: [],
  demographics: [],
  ageMin: null,
  ageMax: null
};

let rosterFilters = { niches: [], demographics: [], ageMin: null, ageMax: null };
let dispatchFilterPanelOpen = false;

// ===========================
// HELPERS
// ===========================
function getInitials(firstName, lastName) {
  const first = (firstName || 'C').charAt(0).toUpperCase();
  const last = (lastName || '').charAt(0).toUpperCase();
  return last ? first + last : first;
}

function generateId() {
  return crypto.randomUUID ? crypto.randomUUID() : 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function getFullName(creator) {
  if (creator.firstName || creator.lastName) {
    return `${creator.firstName || ''} ${creator.lastName || ''}`.trim();
  }
  return creator.name || 'Unknown';
}

function migratePlatforms(creator) {
  if (Array.isArray(creator.platforms)) {
    const migrated = {};
    creator.platforms.forEach(p => {
      migrated[p] = { handle: '', followers: null };
    });
    creator.platforms = migrated;
  }
  if (!creator.platforms || typeof creator.platforms !== 'object') {
    creator.platforms = {};
  }
  return creator;
}

function getCreatorPlatforms(creator) {
  if (Array.isArray(creator.platforms)) return creator.platforms;
  if (creator.platforms && typeof creator.platforms === 'object') return Object.keys(creator.platforms);
  return [];
}

function getHandle(creator, platform) {
  if (creator.platforms && typeof creator.platforms === 'object' && creator.platforms[platform]) {
    return creator.platforms[platform].handle || '';
  }
  return '';
}

function getFollowers(creator, platform) {
  if (creator.platforms && typeof creator.platforms === 'object' && creator.platforms[platform]) {
    return creator.platforms[platform].followers;
  }
  return null;
}

function getUrl(creator, platform) {
  if (creator.platforms && typeof creator.platforms === 'object' && creator.platforms[platform]) {
    return creator.platforms[platform].url || '';
  }
  return '';
}

function formatFollowers(count) {
  if (count === null || count === undefined) return '';
  if (count >= 1000000) return (count / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (count >= 1000) return (count / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return count.toString();
}

function tierFromFollowers(count) {
  if (count === null || count === undefined) return null;
  if (count >= 1000000) return 'Mega (1M+)';
  if (count >= 500000) return 'Macro (500K-1M)';
  if (count >= 100000) return 'Mid (100K-500K)';
  if (count >= 10000) return 'Micro (10K-100K)';
  return 'Nano (<10K)';
}

function getHighestTier(creator) {
  const platforms = getCreatorPlatforms(creator);
  let maxFollowers = null;
  platforms.forEach(p => {
    const f = getFollowers(creator, p);
    if (f !== null && (maxFollowers === null || f > maxFollowers)) {
      maxFollowers = f;
    }
  });
  return tierFromFollowers(maxFollowers);
}

function getCreatorAge(creator) {
  if (!creator.birthday) return null;
  const dob = new Date(creator.birthday + 'T00:00:00');
  if (isNaN(dob)) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ===========================
// GEOCODING (Nominatim)
// ===========================
let geocodingCache = {};
let geocodingTimeout = null;

async function geocodeLocation(location) {
  if (geocodingCache[location]) {
    return geocodingCache[location];
  }

  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(location)}&limit=1`,
      { headers: { 'User-Agent': 'CreatorRoster/1.0' } }
    );
    const results = await response.json();
    if (results.length > 0) {
      const result = {
        lat: parseFloat(results[0].lat),
        lng: parseFloat(results[0].lon)
      };
      geocodingCache[location] = result;
      return result;
    }
  } catch (e) {
    console.error('Geocoding error:', e);
  }

  return null;
}

function debounceGeocode(location, callback) {
  clearTimeout(geocodingTimeout);
  geocodingTimeout = setTimeout(() => {
    geocodeLocation(location).then(coords => {
      if (coords) callback(coords);
    });
  }, 500);
}

// Simplify Nominatim address to "City, ST, CC" format
function simplifyAddress(result) {
  const a = result.address || {};
  const city = a.city || a.town || a.village || a.hamlet || a.municipality || '';
  // Try ISO 3166-2 state code (e.g. "US-TN" → "TN")
  const stateCode = Object.keys(a).filter(k => k.startsWith('ISO3166-2')).map(k => a[k].replace(/^[A-Z]{2}-/, ''))[0] || '';
  const state = stateCode || a.state || '';
  const cc = (a.country_code || '').toUpperCase(); // e.g. "US"
  const parts = [city, state, cc].filter(Boolean);
  return parts.filter((p, i) => i === 0 || p !== parts[i - 1]).join(', ');
}

// For display: just pass through what's stored (simplifyAddress already formats on save)
function displayLocation(loc) {
  return loc || '';
}

// US state name → abbreviation map
const US_STATE_ABBR = {
  'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA',
  'Colorado':'CO','Connecticut':'CT','Delaware':'DE','Florida':'FL','Georgia':'GA',
  'Hawaii':'HI','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA','Kansas':'KS',
  'Kentucky':'KY','Louisiana':'LA','Maine':'ME','Maryland':'MD','Massachusetts':'MA',
  'Michigan':'MI','Minnesota':'MN','Mississippi':'MS','Missouri':'MO','Montana':'MT',
  'Nebraska':'NE','Nevada':'NV','New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM',
  'New York':'NY','North Carolina':'NC','North Dakota':'ND','Ohio':'OH','Oklahoma':'OK',
  'Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC',
  'South Dakota':'SD','Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT',
  'Virginia':'VA','Washington':'WA','West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY',
  'District of Columbia':'DC'
};
// Common country → short code
const COUNTRY_ABBR = {
  'United States of America':'US','United States':'US','USA':'US',
  'United Kingdom':'UK','Great Britain':'UK','England':'UK','Scotland':'UK','Wales':'UK',
  'Canada':'CA','Australia':'AU','New Zealand':'NZ','Germany':'DE','France':'FR',
  'Spain':'ES','Italy':'IT','Japan':'JP','South Korea':'KR','Brazil':'BR',
  'Mexico':'MX','India':'IN','China':'CN','Netherlands':'NL','Sweden':'SE',
  'Norway':'NO','Denmark':'DK','Ireland':'IE','Portugal':'PT','Switzerland':'CH',
  'Belgium':'BE','Austria':'AT','Poland':'PL','Singapore':'SG','Philippines':'PH',
  'Indonesia':'ID','Thailand':'TH','Vietnam':'VN','Colombia':'CO','Argentina':'AR',
  'Chile':'CL','South Africa':'ZA','Nigeria':'NG','Israel':'IL','UAE':'AE',
  'United Arab Emirates':'AE','Turkey':'TR','Russia':'RU','Ukraine':'UA'
};

// Migrate a stored location string to short "City, ST, CC" format
function migrateLocation(creator) {
  if (!creator.location) return;
  const skip = /\b(county|district|region|borough|parish|arrondissement|prefecture|middle)\b/i;
  let parts = creator.location.split(',').map(s => s.trim()).filter(s => s && !skip.test(s));
  // Abbreviate state names
  parts = parts.map(p => US_STATE_ABBR[p] || p);
  // Abbreviate country names
  parts = parts.map(p => COUNTRY_ABBR[p] || p);
  // Deduplicate consecutive
  parts = parts.filter((p, i) => i === 0 || p !== parts[i - 1]);
  // Keep max 3
  creator.location = parts.slice(0, 3).join(', ');
}

// Nominatim search returning multiple suggestions
let locSearchTimeout = null;
async function searchLocations(query) {
  if (!query || query.length < 2) return [];
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`,
      { headers: { 'User-Agent': 'CreatorRoster/1.0' } }
    );
    return await response.json();
  } catch (e) {
    console.error('Location search error:', e);
    return [];
  }
}

function debounceLocSearch(query, callback) {
  clearTimeout(locSearchTimeout);
  locSearchTimeout = setTimeout(() => {
    searchLocations(query).then(callback);
  }, 300);
}

// Haversine distance in miles
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 3959; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Dispatch destination state
let dispatchDestination = null; // { lat, lng, display_name }
let dispatchDestinationMarker = null;

// ===========================
// FILTERING & SORTING
// ===========================
function getFilteredCreators(searchTerm = '', sortBy = 'a-z', applyDispatchFilters = false) {
  let filtered = creators.slice();

  // Apply search filter (roster tab)
  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    filtered = filtered.filter(c => {
      const name = getFullName(c).toLowerCase();
      const location = (c.location || '').toLowerCase();
      const platformNames = getCreatorPlatforms(c);
      const tiers = platformNames.map(p => tierFromFollowers(getFollowers(c, p))).filter(Boolean);
      const handles = platformNames.map(p => getHandle(c, p)).filter(Boolean);
      const email = (c.email || '').toLowerCase();
      const allTags = [...platformNames, ...handles, ...(c.niches || []), ...(c.demographics || []), ...tiers].join(' ').toLowerCase();
      return name.includes(term) || location.includes(term) || email.includes(term) || allTags.includes(term);
    });
  }

  // Apply dispatch filters
  if (applyDispatchFilters) {
    // Platform × Tier combined filter: creator must match at least one combo
    if (dispatchFilters.platformTiers.length > 0) {
      filtered = filtered.filter(c => {
        return dispatchFilters.platformTiers.some(pt => {
          const platforms = getCreatorPlatforms(c);
          if (!platforms.includes(pt.platform)) return false;
          const followers = getFollowers(c, pt.platform);
          return tierFromFollowers(followers) === pt.tier;
        });
      });
    }
    if (dispatchFilters.niches.length > 0) {
      filtered = filtered.filter(c =>
        dispatchFilters.niches.some(n => (c.niches || []).includes(n))
      );
    }
    if (dispatchFilters.demographics.length > 0) {
      filtered = filtered.filter(c =>
        dispatchFilters.demographics.some(d => (c.demographics || []).includes(d))
      );
    }
    // Age range filter
    if (dispatchFilters.ageMin !== null || dispatchFilters.ageMax !== null) {
      filtered = filtered.filter(c => {
        const age = getCreatorAge(c);
        if (age === null) return false;
        if (dispatchFilters.ageMin !== null && age < dispatchFilters.ageMin) return false;
        if (dispatchFilters.ageMax !== null && age > dispatchFilters.ageMax) return false;
        return true;
      });
    }
  }

  // Apply sorting
  switch (sortBy) {
    case 'z-a':
      filtered.sort((a, b) => getFullName(b).localeCompare(getFullName(a)));
      break;
    case 'newest':
      filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      break;
    case 'age-asc':
      filtered.sort((a, b) => (getCreatorAge(a) ?? 999) - (getCreatorAge(b) ?? 999));
      break;
    case 'age-desc':
      filtered.sort((a, b) => (getCreatorAge(b) ?? -1) - (getCreatorAge(a) ?? -1));
      break;
    case 'a-z':
    default:
      filtered.sort((a, b) => getFullName(a).localeCompare(getFullName(b)));
  }

  return filtered;
}

// ===========================
// RENDER FUNCTIONS
// ===========================
function renderCreatorCard(creator) {
  const card = document.createElement('div');
  card.className = 'creator-card';
  card.onclick = () => showDetailPanel(creator.id);

  const avatar = document.createElement('div');
  avatar.className = 'creator-avatar';
  if (creator.photo) {
    const img = document.createElement('img');
    img.src = creator.photo;
    avatar.appendChild(img);
  } else {
    avatar.textContent = getInitials(creator.firstName, creator.lastName);
  }

  const info = document.createElement('div');
  info.className = 'creator-info';

  // — Name + age —
  const name = document.createElement('div');
  name.className = 'creator-name';
  const creatorAge = getCreatorAge(creator);
  name.innerHTML = getFullName(creator) + (creatorAge !== null ? ` <span style="font-size:11px;opacity:0.5;font-weight:400">(${creatorAge})</span>` : '');
  info.appendChild(name);

  // — Header meta rows: email, presskit with copy + visit —
  const emailSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 4L12 13 2 4"/></svg>`;
  const presskitSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
  const hasEmail = !!creator.email;
  const hasKit = !!creator.mediaKit;
  if (hasEmail || hasKit) {
    const metaLinks = document.createElement('div');
    metaLinks.className = 'creator-meta-links';
    if (hasEmail) {
      const row = document.createElement('div');
      row.className = 'creator-meta-link-row';
      row.innerHTML = `<span class="meta-link-icon">${emailSvg}</span><span class="meta-link-text" title="Click to copy">${creator.email}</span><a class="meta-link-visit" href="mailto:${creator.email}" title="Send email" onclick="event.stopPropagation()">↗</a>`;
      row.querySelector('.meta-link-text').addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(creator.email).then(() => showToast('Email copied!', 'success'));
      });
      metaLinks.appendChild(row);
    }
    if (hasKit) {
      const row = document.createElement('div');
      row.className = 'creator-meta-link-row';
      const displayUrl = creator.mediaKit.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
      row.innerHTML = `<span class="meta-link-icon">${presskitSvg}</span><span class="meta-link-text" title="Click to copy">${displayUrl}</span><a class="meta-link-visit" href="${creator.mediaKit}" target="_blank" rel="noopener noreferrer" title="Visit presskit" onclick="event.stopPropagation()">↗</a>`;
      row.querySelector('.meta-link-text').addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(creator.mediaKit).then(() => showToast('Presskit URL copied!', 'success'));
      });
      metaLinks.appendChild(row);
    }
    info.appendChild(metaLinks);
  }

  // — Location —
  const location = document.createElement('div');
  location.className = 'creator-location';
  location.textContent = creator.location ? `📍 ${displayLocation(creator.location)}` : '📍 No location';
  info.appendChild(location);

  // — Platform chips row (uniform, canonical order) —
  const platforms = getCreatorPlatforms(creator).slice().sort((a, b) => {
    const ia = PLATFORMS.indexOf(a), ib = PLATFORMS.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  if (platforms.length > 0) {
    const platformRow = document.createElement('div');
    platformRow.className = 'creator-platforms-row';
    platforms.forEach(p => {
      const url = getUrl(creator, p);
      const chip = document.createElement(url ? 'a' : 'span');
      chip.className = 'creator-platform-chip platform-' + p.toLowerCase();
      if (url) {
        chip.href = url;
        chip.target = '_blank';
        chip.rel = 'noopener noreferrer';
        chip.title = `Open ${p} profile`;
        chip.addEventListener('click', e => e.stopPropagation());
      }
      const svg = PLATFORM_SVGS_SM[p];
      const handle = getHandle(creator, p);
      const followers = getFollowers(creator, p);
      let inner = svg || '';
      const hasText = handle || followers !== null;
      if (hasText) {
        inner += '<span class="chip-text-stack">';
        if (handle) inner += `<span class="chip-handle">@${handle.replace(/^@/, '')}</span>`;
        if (followers !== null) inner += `<span class="chip-followers">${formatFollowers(followers)}</span>`;
        inner += '</span>';
      }
      chip.innerHTML = inner;
      platformRow.appendChild(chip);
    });
    info.appendChild(platformRow);
  }

  // — Tag count pills (niches + demographics) —
  const hasNiches = creator.niches && creator.niches.length > 0;
  const hasDemos = creator.demographics && creator.demographics.length > 0;
  if (hasNiches || hasDemos) {
    const tagCounts = document.createElement('div');
    tagCounts.className = 'card-tag-counts';

    if (hasNiches) {
      const pill = document.createElement('span');
      pill.className = 'tag-count-pill niche-count';
      pill.textContent = `${creator.niches.length} niche${creator.niches.length !== 1 ? 's' : ''}`;
      attachTagHoverPopover(pill, creator.niches, 'Niches', 'niche-pill-sm');
      tagCounts.appendChild(pill);
    }
    if (hasDemos) {
      const pill = document.createElement('span');
      pill.className = 'tag-count-pill demo-count';
      pill.textContent = `${creator.demographics.length} demo${creator.demographics.length !== 1 ? 's' : ''}`;
      attachTagHoverPopover(pill, creator.demographics, 'Demographics', 'demographic-pill-sm');
      tagCounts.appendChild(pill);
    }

    info.appendChild(tagCounts);
  }

  // Avatar column: avatar + small edit button
  const avatarCol = document.createElement('div');
  avatarCol.className = 'creator-avatar-col';
  avatarCol.appendChild(avatar);

  const cardEditBtn = document.createElement('button');
  cardEditBtn.className = 'creator-card-edit-btn';
  cardEditBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit`;
  cardEditBtn.onclick = (e) => {
    e.stopPropagation();
    openEditModal(creator.id);
  };
  avatarCol.appendChild(cardEditBtn);

  card.appendChild(avatarCol);
  card.appendChild(info);

  return card;
}

// Attach a fixed-position hover popover to a tag count pill
function attachTagHoverPopover(anchor, tags, label, pillClass) {
  let popover = null;
  let hideTimeout = null;

  function buildPopover() {
    const el = document.createElement('div');
    el.className = 'tag-hover-popover';
    el.innerHTML = `<div class="hover-label">${label}</div>`;
    const wrap = document.createElement('div');
    wrap.className = 'hover-pills';
    [...tags].sort((a, b) => a.localeCompare(b)).forEach(t => {
      const p = document.createElement('span');
      p.className = pillClass;
      p.textContent = t;
      wrap.appendChild(p);
    });
    el.appendChild(wrap);
    // Keep popover open when hovering over it
    el.addEventListener('mouseenter', () => clearTimeout(hideTimeout));
    el.addEventListener('mouseleave', () => { hideTimeout = setTimeout(hide, 80); });
    return el;
  }

  function show() {
    clearTimeout(hideTimeout);
    if (!popover) {
      popover = buildPopover();
      document.body.appendChild(popover);
    }
    const rect = anchor.getBoundingClientRect();
    popover.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - 250)) + 'px';
    popover.style.top = (rect.top - popover.offsetHeight - 8) + 'px';
    requestAnimationFrame(() => popover.classList.add('visible'));
  }

  function hide() {
    if (popover) {
      popover.classList.remove('visible');
      const el = popover;
      setTimeout(() => el.remove(), 200);
      popover = null;
    }
  }

  anchor.addEventListener('mouseenter', show);
  anchor.addEventListener('mouseleave', () => { hideTimeout = setTimeout(hide, 80); });
}

/* Shared helper: render categorized filter pills into a container.
   opts = { container, allNiches, allDemos, filters, onToggleNiche, onToggleDemo,
            ageMinId, ageMaxId, onAgeChange, onClear, searchTerm } */
function renderCategorizedFilterPills(opts) {
  const { container, filters, onToggleNiche, onToggleDemo, ageMinId, ageMaxId, onAgeChange, onClear } = opts;
  const q = (opts.searchTerm || '').toLowerCase();
  container.innerHTML = '';

  const niches = q ? opts.allNiches.filter(n => n.toLowerCase().includes(q)) : opts.allNiches;
  const demographics = q ? opts.allDemos.filter(d => d.toLowerCase().includes(q)) : opts.allDemos;
  const nicheCategories = loadTagCategories('niche');
  const demoCategories = loadTagCategories('demographic');

  const catNameMatch = (catName) => !q || catName.toLowerCase().includes(q);

  // Helper: render a category block (label + pill row)
  function renderCatBlock(catName, items, type, onToggle, selectedArr) {
    const wrap = document.createElement('div');
    wrap.className = 'roster-filter-cat-block';
    const catLabel = document.createElement('div');
    catLabel.className = 'roster-filter-category-label';
    catLabel.textContent = catName;
    wrap.appendChild(catLabel);
    const pillRow = document.createElement('div');
    pillRow.className = 'roster-filter-category-pills';
    items.forEach(item => {
      const pill = document.createElement('button');
      pill.className = 'roster-filter-pill' + (selectedArr.includes(item) ? ` active ${type}` : '');
      pill.textContent = item;
      pill.addEventListener('click', () => onToggle(item));
      pillRow.appendChild(pill);
    });
    wrap.appendChild(pillRow);
    return wrap;
  }

  // --- Niches by category ---
  const allVisibleNiches = new Set(niches);
  if (q) {
    Object.entries(nicheCategories).forEach(([catName, catItems]) => {
      if (catNameMatch(catName)) catItems.forEach(item => { if (opts.allNiches.includes(item)) allVisibleNiches.add(item); });
    });
  }

  if (allVisibleNiches.size > 0) {
    const nicheHeader = document.createElement('div');
    nicheHeader.className = 'roster-filter-group-label';
    nicheHeader.textContent = 'Niches';
    container.appendChild(nicheHeader);

    const placed = new Set();
    Object.entries(nicheCategories).forEach(([catName, catItems]) => {
      const itemsInCat = catItems.filter(item => allVisibleNiches.has(item));
      if (itemsInCat.length === 0) return;
      container.appendChild(renderCatBlock(catName, itemsInCat, 'niche', onToggleNiche, filters.niches));
      itemsInCat.forEach(n => placed.add(n));
    });
    const uncatNiches = [...allVisibleNiches].filter(n => !placed.has(n));
    if (uncatNiches.length > 0) {
      container.appendChild(renderCatBlock('Other', uncatNiches, 'niche', onToggleNiche, filters.niches));
    }
  }

  // --- Demographics by category ---
  const allVisibleDemos = new Set(demographics);
  if (q) {
    Object.entries(demoCategories).forEach(([catName, catItems]) => {
      if (catNameMatch(catName)) catItems.forEach(item => { if (opts.allDemos.includes(item)) allVisibleDemos.add(item); });
    });
  }

  if (allVisibleDemos.size > 0) {
    const demoHeader = document.createElement('div');
    demoHeader.className = 'roster-filter-group-label';
    demoHeader.textContent = 'Demographics';
    container.appendChild(demoHeader);

    const placed = new Set();
    Object.entries(demoCategories).forEach(([catName, catItems]) => {
      const itemsInCat = catItems.filter(item => allVisibleDemos.has(item));
      if (itemsInCat.length === 0) return;
      container.appendChild(renderCatBlock(catName, itemsInCat, 'demographic', onToggleDemo, filters.demographics));
      itemsInCat.forEach(d => placed.add(d));
    });
    const uncatDemos = [...allVisibleDemos].filter(d => !placed.has(d));
    if (uncatDemos.length > 0) {
      container.appendChild(renderCatBlock('Other', uncatDemos, 'demographic', onToggleDemo, filters.demographics));
    }
  }

  // "No matches" when searching yields nothing
  if (q && allVisibleNiches.size === 0 && allVisibleDemos.size === 0) {
    const noMatch = document.createElement('div');
    noMatch.style.cssText = 'padding:8px 2px;font-size:11px;color:var(--text-muted);opacity:0.7;';
    noMatch.textContent = 'No matching filters';
    container.appendChild(noMatch);
  }

  // Age range
  const ageRow = document.createElement('div');
  ageRow.className = 'roster-age-range';
  ageRow.innerHTML = `<span class="age-label">Age</span><input type="number" id="${ageMinId}" placeholder="Min" min="0" max="120" value="${filters.ageMin ?? ''}"><span class="age-sep">–</span><input type="number" id="${ageMaxId}" placeholder="Max" min="0" max="120" value="${filters.ageMax ?? ''}">`;
  ageRow.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', () => {
      onAgeChange(
        document.getElementById(ageMinId).value ? parseInt(document.getElementById(ageMinId).value) : null,
        document.getElementById(ageMaxId).value ? parseInt(document.getElementById(ageMaxId).value) : null
      );
      const activeId = inp.id;
      setTimeout(() => {
        const el = document.getElementById(activeId);
        if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; }
      }, 0);
    });
    inp.addEventListener('mousedown', (e) => e.stopPropagation());
  });
  container.appendChild(ageRow);

  // Clear all button
  const hasActive = filters.niches.length > 0 || filters.demographics.length > 0 || filters.ageMin !== null || filters.ageMax !== null;
  if (hasActive) {
    const clear = document.createElement('button');
    clear.className = 'roster-filter-clear visible';
    clear.textContent = '✕ Clear';
    clear.addEventListener('mousedown', (e) => e.stopPropagation());
    clear.addEventListener('click', onClear);
    container.appendChild(clear);
  }
}

function renderRosterFilterPills() {
  const container = document.getElementById('rosterFilterPills');
  if (!container) return;

  const niches = getAllNiches();
  const demographics = getAllDemographics();
  const hasAny = niches.length > 0 || demographics.length > 0;
  const hasActiveFilters = rosterFilters.niches.length > 0 || rosterFilters.demographics.length > 0 || rosterFilters.ageMin !== null || rosterFilters.ageMax !== null;
  container.classList.toggle('has-pills', hasAny);
  if (hasActiveFilters || filterPanelOpen) container.classList.add('expanded');

  renderCategorizedFilterPills({
    container,
    allNiches: niches,
    allDemos: demographics,
    filters: rosterFilters,
    ageMinId: 'rosterAgeMin',
    ageMaxId: 'rosterAgeMax',
    onToggleNiche: (n) => {
      const idx = rosterFilters.niches.indexOf(n);
      if (idx >= 0) rosterFilters.niches.splice(idx, 1);
      else rosterFilters.niches.push(n);
      renderRosterFilterPills();
      renderRosterTab();
    },
    onToggleDemo: (d) => {
      const idx = rosterFilters.demographics.indexOf(d);
      if (idx >= 0) rosterFilters.demographics.splice(idx, 1);
      else rosterFilters.demographics.push(d);
      renderRosterFilterPills();
      renderRosterTab();
    },
    onAgeChange: (min, max) => {
      rosterFilters.ageMin = min;
      rosterFilters.ageMax = max;
      renderRosterTab();
    },
    onClear: () => {
      rosterFilters.niches = [];
      rosterFilters.demographics = [];
      rosterFilters.ageMin = null;
      rosterFilters.ageMax = null;
      renderRosterFilterPills();
      renderRosterTab();
    }
  });
}

function renderRosterTab() {
  const searchTerm = document.getElementById('searchInput').value;
  const sortBy = document.getElementById('sortSelect').value;
  let filtered = getFilteredCreators(searchTerm, sortBy, false);

  const list = document.getElementById('creatorList');
  list.innerHTML = '';

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <svg width="80" height="100" viewBox="0 0 80 100" fill="none">
        <path d="M40 95V50" stroke="var(--sage)" stroke-width="2.5" stroke-linecap="round"/>
        <path d="M40 50C40 42 35 32 25 26C20 23 16 26 18 30C22 38 30 44 40 50Z" stroke="var(--sage)" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="M28 34C32 32 37 36 40 42" stroke="var(--sage)" stroke-width="1.2" fill="none" opacity="0.5" stroke-linecap="round"/>
        <path d="M40 60C44 54 52 50 60 50C64 50 64 54 61 56C54 60 46 62 40 60Z" stroke="var(--sage)" stroke-width="1.8" fill="none" stroke-linecap="round"/>
        <path d="M20 92C20 92 28 86 40 86C52 86 60 92 60 92" stroke="var(--mocha)" stroke-width="2.5" stroke-linecap="round" fill="none"/>
        <circle cx="25" cy="25" r="2" fill="var(--rose)" opacity="0.6"/>
        <circle cx="61" cy="49" r="1.5" fill="var(--lavender)" opacity="0.5"/>
        <circle cx="40" cy="15" r="1.5" fill="var(--warning)" opacity="0.4"/>
      </svg>
      <div class="empty-title">Plant your first seed</div>
      <div class="empty-sub">Add a creator to watch your garden grow</div>
    </div>`;
    return;
  }

  const hasRosterFilters = rosterFilters.niches.length > 0 || rosterFilters.demographics.length > 0 || rosterFilters.ageMin !== null || rosterFilters.ageMax !== null;

  // Floating match panel references
  const matchPanel = document.getElementById('matchFloatPanel');
  const matchBody = document.getElementById('matchFloatBody');
  const matchCount = document.getElementById('matchFloatCount');

  // Render roster in sidebar incrementally (first 20, then more on scroll)
  renderListIncrementally(list, filtered, (creator) => renderCreatorCard(creator));

  // Handle floating match panel
  if (!hasRosterFilters) {
    // No filters — hide match panel
    matchPanel.classList.remove('visible');
    matchBody.innerHTML = '';
  } else {
    // Pre-filter by age range for match candidates
    let matchCandidates = filtered;
    if (rosterFilters.ageMin !== null || rosterFilters.ageMax !== null) {
      matchCandidates = filtered.filter(c => {
        const age = getCreatorAge(c);
        if (age === null) return false;
        if (rosterFilters.ageMin !== null && age < rosterFilters.ageMin) return false;
        if (rosterFilters.ageMax !== null && age > rosterFilters.ageMax) return false;
        return true;
      });
    }

    // Split into matches and non-matches
    const matches = [];
    matchCandidates.forEach(creator => {
      const cNiches = creator.niches || [];
      const cDemos = creator.demographics || [];
      const matchedNiches = rosterFilters.niches.filter(n => cNiches.includes(n));
      const matchedDemos = rosterFilters.demographics.filter(d => cDemos.includes(d));
      const hasNicheMatch = rosterFilters.niches.length === 0 || matchedNiches.length > 0;
      const hasDemoMatch = rosterFilters.demographics.length === 0 || matchedDemos.length > 0;
      if (hasNicheMatch && hasDemoMatch) matches.push({ creator, matchedNiches, matchedDemos });
    });

    // Populate floating panel
    matchBody.innerHTML = '';
    matchCount.textContent = matches.length;

    if (matches.length === 0) {
      const noBloom = document.createElement('div');
      noBloom.className = 'no-blooms-divider';
      noBloom.textContent = 'No blooms found for these filters';
      matchBody.appendChild(noBloom);
    } else {
      matches.forEach(({ creator, matchedNiches, matchedDemos }, i) => {
        if (i > 0) {
          const divider = document.createElement('div');
          divider.className = 'card-divider';
          divider.innerHTML = '<div class="divider-line divider-line-left"></div><span class="divider-bloom">✿</span><div class="divider-line divider-line-right"></div>';
          matchBody.appendChild(divider);
        }
        const card = renderCreatorCard(creator);
        card.classList.add('filter-match');
        const tagsRow = document.createElement('div');
        tagsRow.className = 'filter-match-tags';
        [...matchedNiches, ...matchedDemos].forEach(label => {
          const tag = document.createElement('span');
          tag.className = 'filter-match-tag';
          tag.textContent = label;
          tagsRow.appendChild(tag);
        });
        if (tagsRow.children.length > 0) {
          card.querySelector('.creator-info').appendChild(tagsRow);
        }
        matchBody.appendChild(card);
      });
    }
    matchPanel.classList.add('visible');
  }
}

function renderDispatchTab() {
  const sortBy = document.getElementById('sortSelect').value;
  const filtered = getFilteredCreators('', sortBy, true);

  // Check if any filters are active
  const hasFilters = dispatchFilters.platformTiers.length > 0 ||
                     dispatchFilters.niches.length > 0 ||
                     dispatchFilters.demographics.length > 0 ||
                     dispatchFilters.ageMin !== null ||
                     dispatchFilters.ageMax !== null;

  // Reuse the match float panel (same as roster, different color)
  const matchPanel = document.getElementById('matchFloatPanel');
  const matchBody = document.getElementById('matchFloatBody');
  const matchCount = document.getElementById('matchFloatCount');

  if (!hasFilters) {
    matchPanel.classList.remove('visible', 'dispatch-mode');
    matchBody.innerHTML = '';
    updateMapMarkers();
    if (dispatchDestination) renderNearestCreators();
    return;
  }

  matchPanel.classList.add('dispatch-mode');
  matchBody.innerHTML = '';
  matchCount.textContent = filtered.length;

  if (filtered.length === 0) {
    const noBloom = document.createElement('div');
    noBloom.className = 'no-blooms-divider';
    noBloom.textContent = 'No blooms found for these filters';
    matchBody.appendChild(noBloom);
  } else {
    filtered.forEach((creator, i) => {
      if (i > 0) {
        const divider = document.createElement('div');
        divider.className = 'card-divider';
        divider.innerHTML = '<div class="divider-line divider-line-left"></div><span class="divider-bloom">✿</span><div class="divider-line divider-line-right"></div>';
        matchBody.appendChild(divider);
      }
      const card = renderCreatorCard(creator);

      // Build match tags showing which dispatch filters this creator matched
      const tagsRow = document.createElement('div');
      tagsRow.className = 'filter-match-tags';

      // Platform × Tier matches
      if (dispatchFilters.platformTiers.length > 0) {
        const creatorPlats = getCreatorPlatforms(creator);
        dispatchFilters.platformTiers.forEach(pt => {
          if (!creatorPlats.includes(pt.platform)) return;
          const followers = getFollowers(creator, pt.platform);
          if (tierFromFollowers(followers) === pt.tier) {
            const tag = document.createElement('span');
            tag.className = 'filter-match-tag';
            tag.textContent = `${PLATFORM_ICONS[pt.platform] || ''} ${TIER_SHORT[pt.tier] || pt.tier}`;
            tagsRow.appendChild(tag);
          }
        });
      }

      // Niche matches
      if (dispatchFilters.niches.length > 0) {
        (creator.niches || []).forEach(n => {
          if (dispatchFilters.niches.includes(n)) {
            const tag = document.createElement('span');
            tag.className = 'filter-match-tag';
            tag.textContent = n;
            tagsRow.appendChild(tag);
          }
        });
      }

      // Demographic matches
      if (dispatchFilters.demographics.length > 0) {
        (creator.demographics || []).forEach(d => {
          if (dispatchFilters.demographics.includes(d)) {
            const tag = document.createElement('span');
            tag.className = 'filter-match-tag';
            tag.textContent = d;
            tagsRow.appendChild(tag);
          }
        });
      }

      // Age match
      if (dispatchFilters.ageMin !== null || dispatchFilters.ageMax !== null) {
        const age = getCreatorAge(creator);
        if (age !== null) {
          const tag = document.createElement('span');
          tag.className = 'filter-match-tag';
          tag.textContent = `Age ${age}`;
          tagsRow.appendChild(tag);
        }
      }

      if (tagsRow.children.length > 0) {
        card.querySelector('.creator-info').appendChild(tagsRow);
      }
      matchBody.appendChild(card);
    });
  }

  matchPanel.classList.add('visible');
  updateMapMarkers();
  if (dispatchDestination) renderNearestCreators();
}

// Short tier labels for the compact buttons
const TIER_SHORT = {
  'Nano (<10K)': 'Nano',
  'Micro (10K-100K)': 'Micro',
  'Mid (100K-500K)': 'Mid',
  'Macro (500K-1M)': 'Macro',
  'Mega (1M+)': 'Mega'
};
const TIER_RANGE = {
  'Nano (<10K)': '<10K',
  'Micro (10K-100K)': '10-100K',
  'Mid (100K-500K)': '100-500K',
  'Macro (500K-1M)': '500K-1M',
  'Mega (1M+)': '1M+'
};

function renderDispatchFilters() {
  // Platform × Tier combined filter
  const ptContainer = document.getElementById('platformTierFilter');
  ptContainer.innerHTML = '';

  PLATFORMS.forEach(platform => {
    const row = document.createElement('div');
    row.className = 'pt-platform-row';

    const label = document.createElement('div');
    label.className = 'pt-platform-label';
    label.innerHTML = (PLATFORM_SVGS_SM[platform] || '') + ' ' + platform;
    row.appendChild(label);

    const tierRow = document.createElement('div');
    tierRow.className = 'pt-tier-row';

    TIERS.forEach(tier => {
      const btn = document.createElement('button');
      btn.className = 'pt-tier-btn platform-' + platform.toLowerCase();
      btn.innerHTML = `${TIER_SHORT[tier] || tier}<span class="pt-tier-range">${TIER_RANGE[tier] || ''}</span>`;

      // Check if this combo is active
      const isActive = dispatchFilters.platformTiers.some(
        pt => pt.platform === platform && pt.tier === tier
      );
      if (isActive) btn.classList.add('active');

      btn.onclick = () => {
        const idx = dispatchFilters.platformTiers.findIndex(
          pt => pt.platform === platform && pt.tier === tier
        );
        if (idx >= 0) {
          dispatchFilters.platformTiers.splice(idx, 1);
        } else {
          dispatchFilters.platformTiers.push({ platform, tier });
        }
        renderDispatchFilters();
        renderDispatchTab();
        updateMapMarkers();
        updateClearFiltersBtn();
      };

      tierRow.appendChild(btn);
    });

    row.appendChild(tierRow);
    ptContainer.appendChild(row);
  });

  // Active combo pills
  const pillsContainer = document.getElementById('platformTierPills');
  pillsContainer.innerHTML = '';
  dispatchFilters.platformTiers.forEach(pt => {
    const pill = document.createElement('span');
    pill.className = 'pt-active-pill platform-' + pt.platform.toLowerCase();
    pill.innerHTML = `${PLATFORM_SVGS_SM[pt.platform] || ''} ${TIER_SHORT[pt.tier] || pt.tier} <span class="pt-pill-remove">&times;</span>`;
    pill.querySelector('.pt-pill-remove').onclick = () => {
      dispatchFilters.platformTiers = dispatchFilters.platformTiers.filter(
        p => !(p.platform === pt.platform && p.tier === pt.tier)
      );
      renderDispatchFilters();
      renderDispatchTab();
      updateMapMarkers();
      updateClearFiltersBtn();
    };
    pillsContainer.appendChild(pill);
  });

  // Combined niche + demographics — pill clump selected row
  renderDispatchTagsSelected();
}

/* ── Dispatch Inline Filter Pills (mirrors Roster pattern) ── */
function renderDispatchFilterPills() {
  const nicheContainer = document.getElementById('dispatchNichePills');
  const demoContainer = document.getElementById('dispatchDemoPills');
  const ageContainer = document.getElementById('dispatchAgeRow');
  if (!nicheContainer || !demoContainer) return;

  const nicheCategories = loadTagCategories('niche');
  const demoCategories = loadTagCategories('demographic');
  const allNiches = getAllNiches();
  const allDemos = getAllDemographics();

  function onToggleNiche(n) {
    const idx = dispatchFilters.niches.indexOf(n);
    if (idx >= 0) dispatchFilters.niches.splice(idx, 1);
    else dispatchFilters.niches.push(n);
    renderDispatchFilterPills();
    renderDispatchTab();
    updateMapMarkers();
  }
  function onToggleDemo(d) {
    const idx = dispatchFilters.demographics.indexOf(d);
    if (idx >= 0) dispatchFilters.demographics.splice(idx, 1);
    else dispatchFilters.demographics.push(d);
    renderDispatchFilterPills();
    renderDispatchTab();
    updateMapMarkers();
  }

  // Helper: render category pills into a container
  function renderSection(container, items, categories, type, selectedArr, onToggle) {
    container.innerHTML = '';
    const placed = new Set();
    Object.entries(categories).forEach(([catName, catItems]) => {
      const visible = catItems.filter(item => items.includes(item));
      if (visible.length === 0) return;
      const block = document.createElement('div');
      block.className = 'roster-filter-cat-block';
      const label = document.createElement('div');
      label.className = 'roster-filter-category-label';
      label.textContent = catName;
      block.appendChild(label);
      const row = document.createElement('div');
      row.className = 'roster-filter-category-pills';
      visible.forEach(item => {
        placed.add(item);
        const pill = document.createElement('button');
        pill.className = 'roster-filter-pill' + (selectedArr.includes(item) ? ` active ${type}` : '');
        pill.textContent = item;
        pill.addEventListener('click', () => onToggle(item));
        row.appendChild(pill);
      });
      block.appendChild(row);
      container.appendChild(block);
    });
    const uncat = items.filter(i => !placed.has(i));
    if (uncat.length > 0) {
      const block = document.createElement('div');
      block.className = 'roster-filter-cat-block';
      const label = document.createElement('div');
      label.className = 'roster-filter-category-label';
      label.textContent = 'Other';
      block.appendChild(label);
      const row = document.createElement('div');
      row.className = 'roster-filter-category-pills';
      uncat.forEach(item => {
        const pill = document.createElement('button');
        pill.className = 'roster-filter-pill' + (selectedArr.includes(item) ? ` active ${type}` : '');
        pill.textContent = item;
        pill.addEventListener('click', () => onToggle(item));
        row.appendChild(pill);
      });
      block.appendChild(row);
      container.appendChild(block);
    }
  }

  renderSection(nicheContainer, allNiches, nicheCategories, 'niche', dispatchFilters.niches, onToggleNiche);
  renderSection(demoContainer, allDemos, demoCategories, 'demographic', dispatchFilters.demographics, onToggleDemo);

  // Age range
  if (ageContainer) {
    ageContainer.innerHTML = `<span class="age-label">Age</span><input type="number" id="dispatchAgeMin" placeholder="Min" min="0" max="120" value="${dispatchFilters.ageMin ?? ''}"><span class="age-sep">–</span><input type="number" id="dispatchAgeMax" placeholder="Max" min="0" max="120" value="${dispatchFilters.ageMax ?? ''}">`;
    ageContainer.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('input', () => {
        dispatchFilters.ageMin = document.getElementById('dispatchAgeMin').value ? parseInt(document.getElementById('dispatchAgeMin').value) : null;
        dispatchFilters.ageMax = document.getElementById('dispatchAgeMax').value ? parseInt(document.getElementById('dispatchAgeMax').value) : null;
        renderDispatchTab();
        updateMapMarkers();
        const activeId = inp.id;
        setTimeout(() => { const el = document.getElementById(activeId); if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; } }, 0);
      });
      inp.addEventListener('mousedown', (e) => e.stopPropagation());
    });
  }

  // Update active count badges
  const nichesCount = document.getElementById('nichesActiveCount');
  const demosCount = document.getElementById('demosActiveCount');
  if (nichesCount) {
    const n = dispatchFilters.niches.length;
    nichesCount.textContent = n;
    nichesCount.classList.toggle('visible', n > 0);
  }
  if (demosCount) {
    const n = dispatchFilters.demographics.length;
    demosCount.textContent = n;
    demosCount.classList.toggle('visible', n > 0);
  }
}

/* Legacy stubs for any remaining references */
function renderDispatchTagsSelected() { renderDispatchFilterPills(); }
function openDispatchTagsPanel() {}
function closeDispatchTagsPanel() {}
function commitDispatchTags() {}
function renderDispatchTagsGrid() {}

let markerClusterGroup = null;

function updateMapMarkers() {
  // Remove all existing markers
  if (markerClusterGroup) {
    markerClusterGroup.clearLayers();
  } else {
    // First time — create cluster group with custom styling
    markerClusterGroup = L.markerClusterGroup({
      maxClusterRadius: 40,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      iconCreateFunction: function (cluster) {
        const count = cluster.getChildCount();
        return L.divIcon({
          html: `<div class="marker-cluster-inner">${count}</div>`,
          className: 'marker-cluster-custom',
          iconSize: [40, 40]
        });
      }
    });
    map.addLayer(markerClusterGroup);
  }
  markers = {};

  // Determine which creators to show
  const sortBy = document.getElementById('sortSelect').value;
  const creatorsToShow = getFilteredCreators('', sortBy, true);

  const newMarkers = [];

  creatorsToShow.forEach(creator => {
    if (creator.lat && creator.lng) {
      const iconHtml = `
        <div class="marker-inner" style="position: relative; width: 48px; height: 48px;">
          <svg style="position: absolute; top: 0; left: 0; width: 48px; height: 48px; opacity: 0.3;" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="4" r="3" fill="var(--sage)"/>
            <circle cx="42" cy="14" r="2.5" fill="var(--rose)"/>
            <circle cx="44" cy="34" r="2" fill="var(--lavender)"/>
            <circle cx="24" cy="46" r="2.5" fill="var(--sage)"/>
            <circle cx="4" cy="34" r="2" fill="var(--rose)"/>
            <circle cx="6" cy="14" r="3" fill="var(--lavender)"/>
          </svg>
          <div style="
            position: absolute;
            top: 3px; left: 3px;
            width: 42px;
            height: 42px;
            border-radius: 50%;
            border: 2px solid var(--accent);
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            background: linear-gradient(135deg, var(--lavender), var(--sage));
            color: white;
            font-weight: 600;
          ">
            ${creator.photo ? `<img src="${creator.photo}" style="width: 100%; height: 100%; object-fit: cover;">` : getInitials(creator.firstName, creator.lastName)}
          </div>
        </div>
      `;

      const icon = L.divIcon({
        html: iconHtml,
        className: 'creator-marker',
        iconSize: [48, 48],
        iconAnchor: [24, 24]
      });

      const marker = L.marker([creator.lat, creator.lng], { icon });

      // Click marker → open profile directly (no popup)
      marker.on('click', () => {
        showDetailPanel(creator.id);
      });

      markers[creator.id] = marker;
      newMarkers.push(marker);
    }
  });

  // Batch add all markers to cluster group (much faster than individual adds)
  markerClusterGroup.addLayers(newMarkers);
}

function showDetailPanel(creatorId) {
  const creator = creators.find(c => c.id === creatorId);
  if (!creator) return;

  // If ring is already open for a different creator, close it first (no map restore)
  const overlay = document.getElementById('ringOverlay');
  const wasOpen = overlay.classList.contains('open');
  if (wasOpen) {
    overlay.classList.remove('open');
    document.getElementById('ringScrim').classList.remove('open');
    overlay.innerHTML = '';
  }

  currentEditingCreator = creatorId;

  // Save map state only on first open (not when switching between creators)
  if (creator.lat && creator.lng) {
    if (!wasOpen) {
      mapStateBeforeDetail = {
        center: map.getCenter(),
        zoom: map.getZoom()
      };
    }
    map.once('moveend', () => {
      // Small extra delay for any tile settling
      setTimeout(() => renderRing(creator), 50);
    });
    map.flyTo([creator.lat, creator.lng], 10, { duration: 0.8 });
  } else {
    renderRing(creator);
  }
}

function renderRing(creator) {
  const overlay = document.getElementById('ringOverlay');
  const scrim = document.getElementById('ringScrim');
  overlay.innerHTML = '';

  // Get marker pixel position on map
  const mapContainer = document.getElementById('mapContainer');
  const mapRect = mapContainer.getBoundingClientRect();
  let cx, cy;

  if (creator.lat && creator.lng) {
    const point = map.latLngToContainerPoint([creator.lat, creator.lng]);
    cx = point.x;
    cy = point.y;
  } else {
    cx = mapRect.width / 2;
    cy = mapRect.height / 2;
  }

  // Position overlay and scrim over the map container
  overlay.style.left = mapRect.left + 'px';
  overlay.style.top = mapRect.top + 'px';
  overlay.style.width = mapRect.width + 'px';
  overlay.style.height = mapRect.height + 'px';

  scrim.style.left = mapRect.left + 'px';
  scrim.style.top = mapRect.top + 'px';
  scrim.style.width = mapRect.width + 'px';
  scrim.style.height = mapRect.height + 'px';

  // === Build the entire ring as a single centered column ===
  const ringColumn = document.createElement('div');
  ringColumn.className = 'ring-column';
  ringColumn.style.left = cx + 'px';
  ringColumn.style.top = cy + 'px';

  // --- Row 1: Platform chips ---
  const ringPlatforms = getCreatorPlatforms(creator);
  if (ringPlatforms.length > 0) {
    const platformRow = document.createElement('div');
    platformRow.className = 'ring-platforms-row';

    ringPlatforms.forEach((p, i) => {
      const url = getUrl(creator, p);
      const chip = document.createElement(url ? 'a' : 'div');
      chip.className = 'ring-platform-chip platform-' + p.toLowerCase();
      if (url) {
        chip.href = url;
        chip.target = '_blank';
        chip.rel = 'noopener noreferrer';
        chip.title = `Open ${p} profile`;
        chip.onclick = (e) => e.stopPropagation();
      }

      if (PLATFORM_SVGS[p]) {
        const logoWrap = document.createElement('span');
        logoWrap.className = 'ring-chip-logo';
        logoWrap.innerHTML = PLATFORM_SVGS[p];
        chip.appendChild(logoWrap);
      }

      const textWrap = document.createElement('span');
      textWrap.className = 'ring-chip-text';
      const handle = getHandle(creator, p);
      if (handle) {
        const handleLine = document.createElement('span');
        handleLine.className = 'ring-chip-handle';
        handleLine.textContent = `@${handle.replace(/^@/, '')}`;
        textWrap.appendChild(handleLine);
      }
      const followers = getFollowers(creator, p);
      if (followers !== null) {
        const followLine = document.createElement('span');
        followLine.className = 'ring-chip-followers';
        followLine.textContent = formatFollowers(followers);
        textWrap.appendChild(followLine);
      }
      chip.appendChild(textWrap);

      chip.style.opacity = '0';
      chip.style.transform = 'translateY(8px)';
      chip.style.transition = 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)';
      platformRow.appendChild(chip);
      setTimeout(() => {
        chip.style.opacity = '1';
        chip.style.transform = 'translateY(0)';
        setTimeout(() => { chip.style.opacity = ''; chip.style.transform = ''; chip.style.transition = ''; }, 250);
      }, 60 + i * 40);
    });

    ringColumn.appendChild(platformRow);
  }

  // --- Row 2: Avatar with close button ---
  const avatarWrap = document.createElement('div');
  avatarWrap.className = 'ring-avatar-wrap';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'ring-close-btn';
  closeBtn.innerHTML = '&times;';
  closeBtn.onclick = (e) => { e.stopPropagation(); closeDetailPanel(); };
  avatarWrap.appendChild(closeBtn);

  const avatar = document.createElement('div');
  avatar.className = 'ring-avatar';
  if (creator.photo) {
    avatar.innerHTML = `<img src="${creator.photo}">`;
  } else {
    avatar.textContent = getInitials(creator.firstName, creator.lastName);
  }
  avatarWrap.appendChild(avatar);
  ringColumn.appendChild(avatarWrap);

  // --- Row 3: Contact info card (center) with absolutely-positioned side columns ---
  const hasNiches = creator.niches && creator.niches.length > 0;
  const hasDemographics = creator.demographics && creator.demographics.length > 0;

  const infoSection = document.createElement('div');
  infoSection.className = 'ring-info-section';

  // Center: Contact info card
  const contactCard = document.createElement('div');
  contactCard.className = 'ring-name-card';

  const emailSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 4L12 13 2 4"/></svg>`;
  const presskitSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;

  const nameDiv = document.createElement('div');
  nameDiv.className = 'ring-name';
  nameDiv.innerHTML = getFullName(creator) + (getCreatorAge(creator) !== null ? ` <span style="font-size:11px;opacity:0.6;font-weight:400">(${getCreatorAge(creator)})</span>` : '');
  contactCard.appendChild(nameDiv);

  const locDiv = document.createElement('div');
  locDiv.className = 'ring-location';
  locDiv.textContent = '📍 ' + (displayLocation(creator.location) || 'No location');
  contactCard.appendChild(locDiv);

  const hasEmail = !!creator.email;
  const hasKit = !!creator.mediaKit;
  if (hasEmail || hasKit) {
    const metaLinks = document.createElement('div');
    metaLinks.className = 'ring-meta-links';

    if (hasEmail) {
      const row = document.createElement('div');
      row.className = 'ring-meta-link-row';
      row.innerHTML = `<span class="meta-link-icon">${emailSvg}</span><span class="meta-link-text" title="Click to copy">${creator.email}</span><a class="meta-link-visit" href="mailto:${creator.email}" title="Send email" onclick="event.stopPropagation()">↗</a>`;
      row.querySelector('.meta-link-text').addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(creator.email).then(() => showToast('Email copied!', 'success'));
      });
      metaLinks.appendChild(row);
    }

    if (hasKit) {
      const row = document.createElement('div');
      row.className = 'ring-meta-link-row';
      const displayUrl = creator.mediaKit.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
      row.innerHTML = `<span class="meta-link-icon">${presskitSvg}</span><span class="meta-link-text" title="Click to copy">${displayUrl}</span><a class="meta-link-visit" href="${creator.mediaKit}" target="_blank" rel="noopener noreferrer" title="Visit presskit" onclick="event.stopPropagation()">↗</a>`;
      row.querySelector('.meta-link-text').addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(creator.mediaKit).then(() => showToast('Presskit URL copied!', 'success'));
      });
      metaLinks.appendChild(row);
    }

    contactCard.appendChild(metaLinks);
  }

  infoSection.appendChild(contactCard);

  // Left column: Niches (absolutely positioned, top-aligned with contact card)
  if (hasNiches) {
    const nicheCol = document.createElement('div');
    nicheCol.className = 'ring-side-col ring-side-col-left';
    [...creator.niches].sort((a, b) => a.localeCompare(b)).forEach((niche, i) => {
      const el = document.createElement('div');
      el.className = 'ring-pill niche';
      el.textContent = niche;
      el.onclick = (e) => { e.stopPropagation(); openTagModal(niche, 'niche'); };
      el.style.opacity = '0';
      el.style.transform = 'translateX(-12px)';
      el.style.transition = 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)';
      nicheCol.appendChild(el);
      setTimeout(() => {
        el.style.opacity = '1';
        el.style.transform = 'translateX(0)';
        setTimeout(() => { el.style.opacity = ''; el.style.transform = ''; el.style.transition = ''; }, 250);
      }, 100 + i * 40);
    });
    infoSection.appendChild(nicheCol);
  }

  // Right column: Demographics (absolutely positioned, top-aligned with contact card)
  if (hasDemographics) {
    const demoCol = document.createElement('div');
    demoCol.className = 'ring-side-col ring-side-col-right';
    const nicheCount = hasNiches ? creator.niches.length : 0;
    [...creator.demographics].sort((a, b) => a.localeCompare(b)).forEach((demographic, i) => {
      const el = document.createElement('div');
      el.className = 'ring-pill demographic';
      el.textContent = demographic;
      el.onclick = (e) => { e.stopPropagation(); openTagModal(demographic, 'demographic'); };
      el.style.opacity = '0';
      el.style.transform = 'translateX(12px)';
      el.style.transition = 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)';
      demoCol.appendChild(el);
      setTimeout(() => {
        el.style.opacity = '1';
        el.style.transform = 'translateX(0)';
        setTimeout(() => { el.style.opacity = ''; el.style.transform = ''; el.style.transition = ''; }, 250);
      }, 100 + (nicheCount + i) * 40);
    });
    infoSection.appendChild(demoCol);
  }

  ringColumn.appendChild(infoSection);

  // --- Row 4: Action buttons ---
  const actions = document.createElement('div');
  actions.className = 'ring-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'ring-action-btn';
  editBtn.textContent = 'Edit';
  editBtn.onclick = (e) => {
    e.stopPropagation();
    closeDetailPanel();
    openEditModal(creator.id);
  };

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'ring-action-btn danger';
  deleteBtn.textContent = 'Delete';
  deleteBtn.onclick = (e) => {
    e.stopPropagation();
    if (confirm('Move this creator to the recycle bin?')) {
      recycleBin.add(creator);
      closeDetailPanel();
      creators = creators.filter(c => c.id !== creator.id);
      db.persist(creators);
      renderRosterTab();
      renderDispatchTab();
      updateMapMarkers();
      updateRecycleBinBadge();
      showToast('Moved to recycle bin', 'success');
    }
  };

  actions.appendChild(editBtn);
  actions.appendChild(deleteBtn);
  ringColumn.appendChild(actions);

  // --- Row 5: Notes ---
  if (creator.notes) {
    const notes = document.createElement('div');
    notes.className = 'ring-notes';
    notes.textContent = creator.notes;
    ringColumn.appendChild(notes);
  }

  overlay.appendChild(ringColumn);

  // Reposition so the avatar (not the top of the column) sits exactly on cy.
  // Measure the avatar's center offset within the column and shift accordingly.
  const avatarRect = avatar.getBoundingClientRect();
  const columnRect = ringColumn.getBoundingClientRect();
  const avatarCenterInColumn = (avatarRect.top + avatarRect.height / 2) - columnRect.top;
  ringColumn.style.top = (cy - avatarCenterInColumn) + 'px';

  // Show ring + scrim
  overlay.classList.add('open');
  scrim.classList.add('open');
}

// Make it global for marker click
window.showDetailPanel = showDetailPanel;

function closeDetailPanel() {
  const overlay = document.getElementById('ringOverlay');
  const scrim = document.getElementById('ringScrim');
  overlay.classList.remove('open');
  scrim.classList.remove('open');
  currentEditingCreator = null;

  // Restore map to previous view
  if (mapStateBeforeDetail) {
    map.flyTo(mapStateBeforeDetail.center, mapStateBeforeDetail.zoom, { duration: 0.8 });
    mapStateBeforeDetail = null;
  }

  // Clean up after animation
  setTimeout(() => { overlay.innerHTML = ''; }, 400);
}

// ===========================
// TAG MODAL FUNCTIONS
// ===========================
let tagModalState = {
  tagName: null,
  tagType: null, // 'niche' or 'demographic'
  creators: [],
  currentIndex: 0
};

function openTagModal(tagName, tagType) {
  // Close ring if open so tag modal isn't obscured
  closeDetailPanel();

  // Find all creators with this tag
  const matching = creators.filter(creator => {
    if (tagType === 'niche') {
      return creator.niches && creator.niches.includes(tagName);
    } else if (tagType === 'demographic') {
      return creator.demographics && creator.demographics.includes(tagName);
    }
    return false;
  });

  if (matching.length === 0) {
    showToast('No creators found for this tag', 'info');
    return;
  }

  // Store state
  tagModalState.tagName = tagName;
  tagModalState.tagType = tagType;
  tagModalState.creators = matching;
  tagModalState.currentIndex = 0;

  // Render modal
  renderTagModal();

  // Open scrim
  document.getElementById('tagModalScrim').classList.add('open');
}

function closeTagModal() {
  document.getElementById('tagModalScrim').classList.remove('open');
  tagModalState = { tagName: null, tagType: null, creators: [], currentIndex: 0 };
}

function renderTagModal() {
  const { tagName, tagType, creators: matching, currentIndex } = tagModalState;

  // Header
  const header = document.getElementById('tagModalHeader');
  header.innerHTML = '';
  const pill = document.createElement('div');
  pill.className = `tag-pill ${tagType}`;
  pill.textContent = tagName;
  const count = document.createElement('div');
  count.className = 'tag-count';
  count.textContent = `${matching.length} creator${matching.length !== 1 ? 's' : ''}`;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'tag-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.onclick = closeTagModal;
  header.appendChild(pill);
  header.appendChild(count);
  header.appendChild(closeBtn);

  // Body — render all creator cards
  const body = document.getElementById('tagModalBody');
  body.innerHTML = '';
  matching.forEach((creator, idx) => {
    const card = createTagModalCard(creator, tagName, tagType, idx === currentIndex);
    body.appendChild(card);
  });

  // Navigation buttons
  const nav = document.getElementById('tagModalNav');
  nav.innerHTML = '';
  const prevBtn = document.createElement('button');
  prevBtn.textContent = '↑ Prev';
  prevBtn.disabled = currentIndex === 0;
  prevBtn.onclick = () => navigateTagModal(-1);
  const nextBtn = document.createElement('button');
  nextBtn.textContent = '↓ Next';
  nextBtn.disabled = currentIndex === matching.length - 1;
  nextBtn.onclick = () => navigateTagModal(1);
  nav.appendChild(prevBtn);
  nav.appendChild(nextBtn);

  // Auto-scroll to active card
  setTimeout(() => {
    const activeCard = body.querySelector('.tag-modal-card.active');
    if (activeCard) {
      activeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, 0);
}

function createTagModalCard(creator, activeTag, tagType, isActive) {
  const card = document.createElement('div');
  card.className = `tag-modal-card ${isActive ? 'active' : ''}`;
  card.onclick = () => {
    closeTagModal();
    closeDetailPanel(); // Close any open ring first
    setTimeout(() => {
      showDetailPanel(creator.id);
    }, 150);
  };

  // Head: avatar + info
  const head = document.createElement('div');
  head.className = 'tag-modal-card-head';

  const avatar = document.createElement('div');
  avatar.className = 'tag-modal-card-avatar';
  if (creator.photo) {
    avatar.innerHTML = `<img src="${creator.photo}" alt="">`;
  } else {
    avatar.textContent = getInitials(creator.firstName, creator.lastName);
  }

  const info = document.createElement('div');
  info.className = 'tag-modal-card-info';

  const name = document.createElement('div');
  name.className = 'tag-modal-card-name';
  name.textContent = getFullName(creator);

  const location = document.createElement('div');
  location.className = 'tag-modal-card-location';
  location.textContent = creator.location ? `📍 ${displayLocation(creator.location)}` : 'No location';

  info.appendChild(name);
  info.appendChild(location);
  head.appendChild(avatar);
  head.appendChild(info);
  card.appendChild(head);

  // Platform chips — reuse roster card style
  const platforms = getCreatorPlatforms(creator);
  if (platforms.length > 0) {
    const platformsRow = document.createElement('div');
    platformsRow.className = 'creator-platforms-row';
    platforms.forEach(p => {
      const url = getUrl(creator, p);
      const chip = document.createElement(url ? 'a' : 'span');
      chip.className = 'creator-platform-chip platform-' + p.toLowerCase();
      if (url) {
        chip.href = url;
        chip.target = '_blank';
        chip.rel = 'noopener noreferrer';
        chip.title = `Open ${p} profile`;
        chip.addEventListener('click', e => e.stopPropagation());
      }
      const svg = PLATFORM_SVGS_SM[p];
      const handle = getHandle(creator, p);
      const followers = getFollowers(creator, p);
      let inner = svg || '';
      const hasText = handle || followers !== null;
      if (hasText) {
        inner += '<span class="chip-text-stack">';
        if (handle) inner += `<span class="chip-handle">@${handle.replace(/^@/, '')}</span>`;
        if (followers !== null) inner += `<span class="chip-followers">${formatFollowers(followers)}</span>`;
        inner += '</span>';
      }
      chip.innerHTML = inner;
      platformsRow.appendChild(chip);
    });
    card.appendChild(platformsRow);
  }

  // Tags row (niches and demographics)
  const tagsRow = document.createElement('div');
  tagsRow.className = 'tag-modal-card-tags';

  if (creator.niches && creator.niches.length > 0) {
    creator.niches.forEach(niche => {
      const tag = document.createElement('div');
      tag.className = `tag-modal-card-tag niche ${niche === activeTag && tagType === 'niche' ? 'active' : ''}`;
      tag.textContent = niche;
      tagsRow.appendChild(tag);
    });
  }

  if (creator.demographics && creator.demographics.length > 0) {
    creator.demographics.forEach(demo => {
      const tag = document.createElement('div');
      tag.className = `tag-modal-card-tag demographic ${demo === activeTag && tagType === 'demographic' ? 'active' : ''}`;
      tag.textContent = demo;
      tagsRow.appendChild(tag);
    });
  }

  if (tagsRow.children.length > 0) {
    card.appendChild(tagsRow);
  }

  return card;
}

function navigateTagModal(direction) {
  const { creators: matching } = tagModalState;
  const newIndex = tagModalState.currentIndex + direction;
  if (newIndex >= 0 && newIndex < matching.length) {
    tagModalState.currentIndex = newIndex;
    renderTagModal();
  }
}

// ===========================
// MODAL FUNCTIONS
// ===========================
function openAddModal() {
  currentEditingCreator = null;
  document.getElementById('modalTitle').textContent = 'Add Creator';
  renderModalBody();
  document.getElementById('modalBackdrop').classList.add('open');
  // Scroll to top and focus first name
  const modalBody = document.getElementById('modalBody');
  if (modalBody) modalBody.scrollTop = 0;
  setTimeout(() => {
    const firstNameInput = document.getElementById('firstNameInput');
    if (firstNameInput) firstNameInput.focus();
  }, 50);
}

function openEditModal(creatorId) {
  currentEditingCreator = creatorId;
  document.getElementById('modalTitle').textContent = 'Edit Creator';
  renderModalBody();
  document.getElementById('modalBackdrop').classList.add('open');
}

function closeModal() {
  document.getElementById('modalBackdrop').classList.remove('open');
}

function renderModalBody() {
  const creator = currentEditingCreator ? creators.find(c => c.id === currentEditingCreator) : null;
  const body = document.getElementById('modalBody');
  body.innerHTML = '';

  // ── Identity header: compact photo + name/email/mediakit/birthday ──
  const identityRow = document.createElement('div');
  identityRow.className = 'modal-identity-row';

  // Photo (left)
  const photoSection = document.createElement('div');
  photoSection.className = 'photo-upload-section';

  const photoPreview = document.createElement('div');
  photoPreview.className = creator?.photo ? 'photo-preview' : 'photo-preview empty';
  photoPreview.id = 'photoPreview';
  if (creator?.photo) {
    const img = document.createElement('img');
    img.src = creator.photo;
    photoPreview.appendChild(img);
  } else {
    photoPreview.textContent = '📷';
  }

  const photoControls = document.createElement('div');
  photoControls.className = 'photo-controls';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.id = 'photoFileInput';
  fileInput.accept = 'image/*';
  fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const compressed = await compressImage(event.target.result);
        photoPreview.innerHTML = `<img src="${compressed}">`;
        photoPreview.classList.remove('empty');
        photoPreview.dataset.photoData = compressed;
      };
      reader.readAsDataURL(file);
    }
  };

  const uploadBtn = document.createElement('button');
  uploadBtn.className = 'btn btn-secondary';
  uploadBtn.textContent = 'Upload';
  uploadBtn.type = 'button';
  uploadBtn.onclick = () => fileInput.click();

  const urlBtn = document.createElement('button');
  urlBtn.className = 'btn btn-secondary';
  urlBtn.textContent = 'URL';
  urlBtn.type = 'button';
  urlBtn.onclick = () => {
    const url = prompt('Paste image URL:');
    if (url) {
      photoPreview.innerHTML = `<img src="${url}">`;
      photoPreview.classList.remove('empty');
      photoPreview.dataset.photoUrl = url;
    }
  };

  photoControls.appendChild(fileInput);
  photoControls.appendChild(uploadBtn);
  photoControls.appendChild(urlBtn);

  photoSection.appendChild(photoPreview);
  photoSection.appendChild(photoControls);
  identityRow.appendChild(photoSection);

  // Identity fields (right)
  const idFields = document.createElement('div');
  idFields.className = 'identity-fields';

  // Name row
  const nameRow = document.createElement('div');
  nameRow.className = 'name-row';

  const firstNameGroup = document.createElement('div');
  firstNameGroup.className = 'form-group';
  const firstNameLabel = document.createElement('label');
  firstNameLabel.className = 'form-label';
  firstNameLabel.textContent = 'First Name';
  const firstNameInput = document.createElement('input');
  firstNameInput.type = 'text';
  firstNameInput.className = 'form-input';
  firstNameInput.id = 'firstNameInput';
  firstNameInput.value = creator?.firstName || '';
  firstNameGroup.appendChild(firstNameLabel);
  firstNameGroup.appendChild(firstNameInput);

  const lastNameGroup = document.createElement('div');
  lastNameGroup.className = 'form-group';
  const lastNameLabel = document.createElement('label');
  lastNameLabel.className = 'form-label';
  lastNameLabel.textContent = 'Last Name';
  const lastNameInput = document.createElement('input');
  lastNameInput.type = 'text';
  lastNameInput.className = 'form-input';
  lastNameInput.id = 'lastNameInput';
  lastNameInput.value = creator?.lastName || '';
  lastNameGroup.appendChild(lastNameLabel);
  lastNameGroup.appendChild(lastNameInput);

  nameRow.appendChild(firstNameGroup);
  nameRow.appendChild(lastNameGroup);
  idFields.appendChild(nameRow);

  // Email + Birthday (date) row
  const ebRow = document.createElement('div');
  ebRow.className = 'email-mediakit-row';

  const emailGroup = document.createElement('div');
  emailGroup.className = 'form-group';
  const emailLabel = document.createElement('label');
  emailLabel.className = 'form-label';
  emailLabel.textContent = 'Email';
  const emailInput = document.createElement('input');
  emailInput.type = 'email';
  emailInput.className = 'form-input';
  emailInput.id = 'emailInput';
  emailInput.placeholder = 'creator@email.com';
  emailInput.value = creator?.email || '';
  emailGroup.appendChild(emailLabel);
  emailGroup.appendChild(emailInput);

  const bdayGroup = document.createElement('div');
  bdayGroup.className = 'form-group';
  const bdayLabel = document.createElement('label');
  bdayLabel.className = 'form-label';
  bdayLabel.textContent = 'Birthday';
  const bdayInput = document.createElement('input');
  bdayInput.type = 'date';
  bdayInput.className = 'form-input';
  bdayInput.id = 'birthdayInput';
  bdayInput.value = creator?.birthday || '';
  bdayInput.style.colorScheme = 'dark';
  bdayGroup.appendChild(bdayLabel);
  bdayGroup.appendChild(bdayInput);

  ebRow.appendChild(emailGroup);
  ebRow.appendChild(bdayGroup);
  idFields.appendChild(ebRow);

  // Media Kit row
  const mkGroup = document.createElement('div');
  mkGroup.className = 'form-group';
  const mkLabel = document.createElement('label');
  mkLabel.className = 'form-label';
  mkLabel.textContent = 'Media Kit';
  const mkInput = document.createElement('input');
  mkInput.type = 'url';
  mkInput.className = 'form-input';
  mkInput.id = 'mediaKitInput';
  mkInput.placeholder = 'https://...';
  mkInput.value = creator?.mediaKit || '';
  mkGroup.appendChild(mkLabel);
  mkGroup.appendChild(mkInput);
  idFields.appendChild(mkGroup);

  identityRow.appendChild(idFields);
  body.appendChild(identityRow);

  // Platforms — horizontal 3-column layout with branded colors
  const platformsGroup = document.createElement('div');
  platformsGroup.className = 'form-group';
  const platformsLabel = document.createElement('label');
  platformsLabel.className = 'form-label';
  platformsLabel.textContent = 'Platforms';
  const platformsRow = document.createElement('div');
  platformsRow.className = 'platform-columns';

  const PLATFORM_MODAL_SVGS = {
    'Instagram': `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="5" stroke="#E1306C" stroke-width="2.5"/><circle cx="12" cy="12" r="5" stroke="#E1306C" stroke-width="2.5"/><circle cx="17.5" cy="6.5" r="1.5" fill="#E1306C"/></svg>`,
    'TikTok': `<svg width="14" height="16" viewBox="0 0 18 20" fill="none"><path d="M9 0v13.5a3.5 3.5 0 1 1-3-3.46V7.04A6.5 6.5 0 1 0 12 13.5V6.73A7.5 7.5 0 0 0 17 8V5a5 5 0 0 1-5-5H9Z" fill="#00F2EA"/></svg>`,
    'YouTube': `<svg width="18" height="13" viewBox="0 0 22 16" fill="none"><rect x="1" y="1" width="20" height="14" rx="4" stroke="#FF0000" stroke-width="2.5"/><path d="M9 5v6l5-3-5-3Z" fill="#FF0000"/></svg>`
  };

  PLATFORMS.forEach(platform => {
    const isChecked = creator && getCreatorPlatforms(creator).includes(platform);
    const existingHandle = creator ? getHandle(creator, platform) : '';
    const existingUrl = creator ? getUrl(creator, platform) : '';
    const existingFollowers = creator ? getFollowers(creator, platform) : null;
    const colClass = 'col-' + platform.toLowerCase();

    const col = document.createElement('div');
    col.className = `platform-col ${colClass}${isChecked ? ' checked' : ''}`;

    // Header with checkbox + logo + name
    const header = document.createElement('label');
    header.className = 'platform-col-header';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = platform;
    checkbox.checked = isChecked;
    checkbox.dataset.platform = platform;

    const checkIcon = document.createElement('span');
    checkIcon.className = 'platform-col-check';
    checkIcon.textContent = '✓';

    const logo = document.createElement('span');
    logo.className = 'platform-col-logo';
    logo.innerHTML = PLATFORM_MODAL_SVGS[platform] || '';

    const name = document.createElement('span');
    name.className = 'platform-col-name';
    name.textContent = platform;

    header.appendChild(checkbox);
    header.appendChild(checkIcon);
    header.appendChild(logo);
    header.appendChild(name);

    header.onclick = (e) => {
      e.preventDefault();
      checkbox.checked = !checkbox.checked;
      col.classList.toggle('checked', checkbox.checked);
    };

    // Fields
    const fields = document.createElement('div');
    fields.className = 'platform-col-fields';

    const handleInput = document.createElement('input');
    handleInput.type = 'text';
    handleInput.placeholder = '@handle';
    handleInput.dataset.handle = platform;
    handleInput.value = existingHandle;

    const urlInput = document.createElement('input');
    urlInput.type = 'url';
    urlInput.placeholder = 'Profile URL';
    urlInput.dataset.url = platform;
    urlInput.value = existingUrl;

    const followerWrap = document.createElement('div');
    followerWrap.className = 'platform-follower-wrap';

    const followerInput = document.createElement('input');
    followerInput.type = 'text';
    followerInput.inputMode = 'numeric';
    followerInput.className = 'platform-follower-input';
    followerInput.placeholder = 'Followers';
    followerInput.dataset.followers = platform;
    // Format initial value with commas
    followerInput.value = existingFollowers !== null ? Number(existingFollowers).toLocaleString() : '';

    const tierPill = document.createElement('span');
    tierPill.className = 'platform-tier-pill';
    tierPill.dataset.tierFor = platform;
    const currentTier = tierFromFollowers(existingFollowers);
    tierPill.textContent = currentTier || '';
    tierPill.style.display = currentTier ? 'inline-block' : 'none';

    followerInput.oninput = () => {
      // Strip non-digits, reformat with commas
      const raw = followerInput.value.replace(/[^\d]/g, '');
      const num = raw ? parseInt(raw, 10) : null;
      // Preserve cursor position relative to end
      const distFromEnd = followerInput.value.length - (followerInput.selectionStart || 0);
      followerInput.value = num !== null ? num.toLocaleString() : '';
      const newPos = Math.max(0, followerInput.value.length - distFromEnd);
      followerInput.setSelectionRange(newPos, newPos);
      const tier = tierFromFollowers(num);
      tierPill.textContent = tier || '';
      tierPill.style.display = tier ? 'inline-block' : 'none';
    };

    followerWrap.appendChild(followerInput);
    followerWrap.appendChild(tierPill);

    fields.appendChild(handleInput);
    fields.appendChild(urlInput);
    fields.appendChild(followerWrap);

    col.appendChild(header);
    col.appendChild(fields);
    platformsRow.appendChild(col);
  });

  platformsGroup.appendChild(platformsLabel);
  platformsGroup.appendChild(platformsRow);
  body.appendChild(platformsGroup);

  // ── Reusable tag picker: floating pill-toggle panel ──
  function createTagPicker({ label, type, presets, getAllItems, selected, bodyKey }) {
    body[bodyKey] = selected ? [...selected] : [];

    const group = document.createElement('div');
    group.className = 'form-group';
    const lbl = document.createElement('label');
    lbl.className = 'form-label';
    lbl.textContent = label;

    // Selected pills row (click to open panel)
    const selectedRow = document.createElement('div');
    selectedRow.className = 'tag-picker-selected';
    selectedRow.dataset.placeholder = `Click to select ${label.toLowerCase()}...`;

    function renderSelected() {
      selectedRow.innerHTML = '';
      body[bodyKey].forEach((tag, i) => {
        const pill = document.createElement('span');
        pill.className = `tag-picker-pill ${type}`;
        pill.innerHTML = `${tag}<span class="pill-x">&times;</span>`;
        pill.querySelector('.pill-x').onclick = (e) => {
          e.stopPropagation();
          body[bodyKey].splice(i, 1);
          renderSelected();
        };
        selectedRow.appendChild(pill);
      });
      // Update placeholder visibility
      selectedRow.dataset.placeholder = body[bodyKey].length > 0
        ? `Click to add more ${label.toLowerCase()}...`
        : `Click to select ${label.toLowerCase()}...`;
    }

    // Floating panel overlay
    const overlay = document.createElement('div');
    overlay.className = 'tag-panel-overlay';

    const panel = document.createElement('div');
    panel.className = 'tag-panel';

    // Panel header
    const header = document.createElement('div');
    header.className = 'tag-panel-header';
    const title = document.createElement('span');
    title.className = 'tag-panel-title';
    title.textContent = label;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'tag-panel-close';
    closeBtn.innerHTML = '&times;';
    header.appendChild(title);
    header.appendChild(closeBtn);

    // Search row with +New Category button
    const searchRow = document.createElement('div');
    searchRow.className = 'tag-panel-search-row';
    const search = document.createElement('input');
    search.type = 'text';
    search.className = 'tag-panel-search';
    search.placeholder = 'Search or type to add new...';
    const newCatBtn = document.createElement('button');
    newCatBtn.className = 'tag-panel-new-cat';
    newCatBtn.textContent = '+ Category';
    newCatBtn.type = 'button';
    newCatBtn.onclick = () => {
      const name = prompt('New category name:');
      if (name && name.trim()) {
        const trimmed = name.trim();
        if (!categories[trimmed]) {
          categories[trimmed] = [];
          saveTagCategories(type, categories);
          renderGrid();
        }
      }
    };
    searchRow.appendChild(search);
    searchRow.appendChild(newCatBtn);

    // Pill grid
    const grid = document.createElement('div');
    grid.className = 'tag-panel-grid';

    // "Add custom" row
    const addRow = document.createElement('div');
    addRow.className = 'tag-panel-add-row';

    // Footer with manage toggle (left) + confirm/delete button (right)
    const footer = document.createElement('div');
    footer.className = 'tag-panel-footer';

    const deleteToggle = document.createElement('button');
    deleteToggle.className = 'tag-panel-delete-toggle';
    deleteToggle.innerHTML = '🗑 Manage';
    deleteToggle.type = 'button';

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'tag-panel-confirm';
    confirmBtn.textContent = 'Confirm';

    footer.appendChild(deleteToggle);
    footer.appendChild(confirmBtn);

    // Working copy of selections while panel is open
    let panelSelections = [];
    let panelCustomItems = []; // all custom items added this session (persists even when deselected)
    let deleteMode = false;
    let deleteMarked = new Set(); // items marked for deletion

    function exitDeleteMode() {
      deleteMode = false;
      deleteMarked.clear();
      deleteToggle.classList.remove('active');
      deleteToggle.innerHTML = '🗑 Manage';
      confirmBtn.textContent = 'Confirm';
      confirmBtn.classList.remove('delete-action');
      grid.classList.remove('delete-mode');
      document.querySelector('.tag-delete-confirm-overlay')?.remove();
      renderGrid();
    }

    function updateDeleteButton() {
      if (deleteMode && deleteMarked.size > 0) {
        confirmBtn.textContent = `Delete (${deleteMarked.size})`;
        confirmBtn.classList.add('delete-action');
      } else if (deleteMode) {
        confirmBtn.textContent = 'Delete';
        confirmBtn.classList.add('delete-action');
      }
    }

    // Confirmation dialog — appended to document.body so it's never clipped
    function showDeleteConfirm(items, onConfirm) {
      document.querySelector('.tag-delete-confirm-overlay')?.remove();
      const cOverlay = document.createElement('div');
      cOverlay.className = 'tag-delete-confirm-overlay';
      const box = document.createElement('div');
      box.className = 'tag-delete-confirm-box';
      const names = items.map(n => `"${n}"`).join(', ');
      box.innerHTML = `<p>Delete <span class="delete-tag-name">${names}</span>?</p>` +
        `<small>This will remove ${items.length > 1 ? 'these' : 'this'} from all creators permanently.</small>` +
        `<div class="confirm-btns">` +
        `<button class="cancel-btn">Cancel</button>` +
        `<button class="delete-btn">Delete</button>` +
        `</div>`;
      box.querySelector('.cancel-btn').onclick = () => { cOverlay.remove(); };
      box.querySelector('.delete-btn').onclick = () => {
        onConfirm();
        cOverlay.remove();
      };
      cOverlay.onclick = (e) => { if (e.target === cOverlay) cOverlay.remove(); };
      cOverlay.appendChild(box);
      document.body.appendChild(cOverlay);
    }

    deleteToggle.onclick = () => {
      if (deleteMode) {
        exitDeleteMode();
      } else {
        deleteMode = true;
        deleteMarked.clear();
        deleteToggle.classList.add('active');
        deleteToggle.innerHTML = '🗑 Done';
        confirmBtn.textContent = 'Delete';
        confirmBtn.classList.add('delete-action');
        grid.classList.add('delete-mode');
        renderGrid();
      }
    };

    const categories = loadTagCategories(type);
    let dragItem = null;

    function makePill(item) {
      const pill = document.createElement('div');
      const isCustom = !presets.includes(item);
      let cls = `tag-panel-pill ${type}`;
      if (deleteMode) {
        if (deleteMarked.has(item)) cls += ' marked-delete';
      } else {
        if (panelSelections.includes(item)) cls += ' active';
      }
      if (isCustom) cls += ' custom';
      pill.className = cls;
      pill.textContent = item;
      pill.draggable = !deleteMode;
      pill.dataset.tag = item;

      // Drag start
      pill.addEventListener('dragstart', (e) => {
        dragItem = item;
        pill.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item);
      });
      pill.addEventListener('dragend', () => {
        pill.classList.remove('dragging');
        dragItem = null;
        grid.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      });

      pill.onclick = () => {
        if (deleteMode) {
          if (deleteMarked.has(item)) deleteMarked.delete(item);
          else deleteMarked.add(item);
          updateDeleteButton();
          renderGrid();
          return;
        }
        if (panelSelections.includes(item)) {
          panelSelections = panelSelections.filter(s => s !== item);
        } else {
          panelSelections.push(item);
        }
        renderGrid();
      };
      return pill;
    }

    function makeCategoryLabel(catName, isCustomGroup) {
      const label = document.createElement('div');
      label.className = 'tag-category-label';

      const labelText = document.createElement('span');
      labelText.className = 'tag-category-label-text';
      labelText.textContent = catName;

      if (!isCustomGroup) {
        const editBtn = document.createElement('button');
        editBtn.className = 'tag-category-edit-btn';
        editBtn.innerHTML = '✎';
        editBtn.type = 'button';
        editBtn.title = 'Rename category';
        editBtn.onclick = (e) => {
          e.stopPropagation();
          const input = document.createElement('input');
          input.className = 'tag-category-rename-input';
          input.value = catName;
          input.type = 'text';

          const commitRename = () => {
            const newName = input.value.trim();
            if (newName && newName !== catName && !categories[newName]) {
              categories[newName] = categories[catName];
              delete categories[catName];
              const ordered = {};
              Object.keys(categories).forEach(k => {
                ordered[k === catName ? newName : k] = categories[k === catName ? newName : k];
              });
              Object.keys(categories).forEach(k => delete categories[k]);
              Object.assign(categories, ordered);
              saveTagCategories(type, categories);
            }
            renderGrid();
          };

          input.addEventListener('blur', commitRename);
          input.addEventListener('keydown', (ke) => {
            if (ke.key === 'Enter') { ke.preventDefault(); input.blur(); }
            if (ke.key === 'Escape') { renderGrid(); }
          });

          labelText.replaceWith(input);
          editBtn.style.display = 'none';
          input.focus();
          input.select();
        };
        labelText.appendChild(editBtn);

        // Delete category button — only in manage mode, only for user-created categories
        const defaults = type === 'niche' ? DEFAULT_NICHE_CATEGORIES : DEFAULT_DEMO_CATEGORIES;
        if (deleteMode && !defaults[catName]) {
          const delCatBtn = document.createElement('button');
          delCatBtn.className = 'tag-category-delete-btn';
          delCatBtn.innerHTML = '×';
          delCatBtn.type = 'button';
          delCatBtn.title = 'Delete category (pills move to Custom)';
          delCatBtn.onclick = (e) => {
            e.stopPropagation();
            if (confirm(`Delete category "${catName}"? The tags inside will move to Custom.`)) {
              delete categories[catName];
              saveTagCategories(type, categories);
              renderGrid();
            }
          };
          labelText.appendChild(delCatBtn);
        }
      }

      label.appendChild(labelText);
      const line = document.createElement('div');
      line.className = 'tag-category-label-line';
      label.appendChild(line);
      return label;
    }

    function setupDropZone(pillsWrap, catName) {
      pillsWrap.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        pillsWrap.classList.add('drag-over');
      });
      pillsWrap.addEventListener('dragleave', (e) => {
        if (!pillsWrap.contains(e.relatedTarget)) {
          pillsWrap.classList.remove('drag-over');
        }
      });
      pillsWrap.addEventListener('drop', (e) => {
        e.preventDefault();
        pillsWrap.classList.remove('drag-over');
        if (!dragItem) return;
        // Remove from all categories
        Object.values(categories).forEach(arr => {
          const idx = arr.indexOf(dragItem);
          if (idx >= 0) arr.splice(idx, 1);
        });
        // Add to target category (or create uncategorized)
        if (catName && categories[catName]) {
          categories[catName].push(dragItem);
        }
        saveTagCategories(type, categories);
        renderGrid();
      });
    }

    function renderGrid() {
      const filter = search.value.toLowerCase();
      grid.innerHTML = '';
      const allItems = [...new Set([...getAllItems(), ...panelSelections, ...panelCustomItems])].sort((a, b) => a.localeCompare(b));
      const filtered = filter ? allItems.filter(n => n.toLowerCase().includes(filter)) : allItems;

      // If searching, show flat list
      if (filter) {
        grid.classList.add('flat-mode');
        filtered.forEach(item => grid.appendChild(makePill(item)));
      } else {
        grid.classList.remove('flat-mode');
        const placed = new Set();
        Object.entries(categories).forEach(([catName, catItems]) => {
          const itemsInCat = filtered.filter(item => catItems.includes(item));
          // Show empty categories too (as drop targets)
          const group = document.createElement('div');
          group.className = 'tag-category-group';
          if (itemsInCat.length === 0) group.classList.add('empty-drop-target');
          group.appendChild(makeCategoryLabel(catName, false));
          const pillsWrap = document.createElement('div');
          pillsWrap.className = 'tag-category-pills';
          pillsWrap.dataset.category = catName;
          setupDropZone(pillsWrap, catName);
          itemsInCat.forEach(item => {
            pillsWrap.appendChild(makePill(item));
            placed.add(item);
          });
          group.appendChild(pillsWrap);
          grid.appendChild(group);
        });
        // Uncategorized items
        const uncategorized = filtered.filter(item => !placed.has(item));
        if (uncategorized.length > 0) {
          const group = document.createElement('div');
          group.className = 'tag-category-group';
          group.appendChild(makeCategoryLabel('Custom', true));
          const pillsWrap = document.createElement('div');
          pillsWrap.className = 'tag-category-pills';
          pillsWrap.dataset.category = '__custom__';
          setupDropZone(pillsWrap, null);
          uncategorized.forEach(item => pillsWrap.appendChild(makePill(item)));
          group.appendChild(pillsWrap);
          grid.appendChild(group);
        }
      }

      // Show "Add custom" if typed text doesn't match
      if (!deleteMode && filter && !allItems.some(n => n.toLowerCase() === filter)) {
        addRow.innerHTML = `+ Add "${search.value.trim()}"`;
        addRow.classList.add('visible');
      } else {
        addRow.classList.remove('visible');
      }
    }

    // Add custom tag
    addRow.onclick = () => {
      const val = search.value.trim();
      if (val && !panelSelections.includes(val)) {
        panelSelections.push(val);
      }
      if (val && !panelCustomItems.includes(val)) {
        panelCustomItems.push(val);
      }
      search.value = '';
      renderGrid();
      search.focus();
    };

    search.oninput = () => renderGrid();
    search.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = search.value.trim();
        const allItems = getAllItems();
        const exact = allItems.find(n => n.toLowerCase() === val.toLowerCase());
        if (exact) {
          if (panelSelections.includes(exact)) {
            panelSelections = panelSelections.filter(s => s !== exact);
          } else {
            panelSelections.push(exact);
          }
          search.value = '';
          renderGrid();
        } else if (val) {
          if (!panelSelections.includes(val)) {
            panelSelections.push(val);
          }
          if (!panelCustomItems.includes(val)) {
            panelCustomItems.push(val);
          }
          search.value = '';
          renderGrid();
        }
      }
    };

    function openPanel() {
      panelSelections = [...body[bodyKey]];
      deleteMode = false;
      deleteMarked.clear();
      deleteToggle.classList.remove('active');
      deleteToggle.innerHTML = '🗑 Manage';
      confirmBtn.textContent = 'Confirm';
      confirmBtn.classList.remove('delete-action');
      grid.classList.remove('delete-mode');
      search.value = '';
      overlay.classList.add('open');
      renderGrid();
      setTimeout(() => search.focus(), 50);
    }

    function closePanel() {
      overlay.classList.remove('open');
      document.querySelector('.tag-delete-confirm-overlay')?.remove();
    }

    function confirmPanel() {
      if (deleteMode) {
        if (deleteMarked.size === 0) {
          // Nothing marked, just exit delete mode
          exitDeleteMode();
          return;
        }
        // Show "are you sure" confirmation
        const items = [...deleteMarked];
        showDeleteConfirm(items, () => {
          items.forEach(item => {
            // Remove from all creators
            creators.forEach(c => {
              if (type === 'niche' && c.niches) c.niches = c.niches.filter(n => n !== item);
              if (type === 'demographic' && c.demographics) c.demographics = c.demographics.filter(d => d !== item);
            });
            // If it's a preset, add to deleted presets list
            if (type === 'niche' && PRESET_NICHES.includes(item)) {
              if (!deletedNiches.includes(item)) deletedNiches.push(item);
            }
            if (type === 'demographic' && PRESET_DEMOGRAPHICS.includes(item)) {
              if (!deletedDemographics.includes(item)) deletedDemographics.push(item);
            }
          });
          // Remove from panel selections too
          panelSelections = panelSelections.filter(s => !deleteMarked.has(s));
          saveDeletedPresets();
          db.persist(creators);
          exitDeleteMode();
        });
        return;
      }
      // Normal confirm — apply selections
      body[bodyKey] = [...panelSelections];
      renderSelected();
      closePanel();
    }

    selectedRow.onclick = openPanel;
    closeBtn.onclick = closePanel;
    overlay.onclick = (e) => {
      if (e.target === overlay && !document.querySelector('.tag-delete-confirm-overlay')) closePanel();
    };
    confirmBtn.onclick = confirmPanel;

    // Assemble panel
    panel.appendChild(header);
    panel.appendChild(searchRow);
    panel.appendChild(grid);
    panel.appendChild(addRow);
    panel.appendChild(footer);
    overlay.appendChild(panel);

    group.appendChild(lbl);
    group.appendChild(selectedRow);
    group.appendChild(overlay);

    renderSelected();
    return group;
  }

  // Niches picker
  const nichesGroup = createTagPicker({
    label: 'Niches',
    type: 'niche',
    presets: PRESET_NICHES,
    getAllItems: getAllNiches,
    selected: creator ? creator.niches : [],
    bodyKey: 'modalNiches'
  });
  body.appendChild(nichesGroup);

  // Demographics picker
  const demographicsGroup = createTagPicker({
    label: 'Demographics',
    type: 'demographic',
    presets: PRESET_DEMOGRAPHICS,
    getAllItems: getAllDemographics,
    selected: creator ? creator.demographics : [],
    bodyKey: 'modalDemographics'
  });
  body.appendChild(demographicsGroup);

  // Location with autocomplete dropdown
  const locationGroup = document.createElement('div');
  locationGroup.className = 'form-group';
  const locationLabel = document.createElement('label');
  locationLabel.className = 'form-label';
  locationLabel.textContent = 'Location';

  const locWrap = document.createElement('div');
  locWrap.className = 'loc-autocomplete-wrap';

  const locationInput = document.createElement('input');
  locationInput.type = 'text';
  locationInput.className = 'form-input';
  locationInput.id = 'locationInput';
  locationInput.placeholder = 'City, State or Country...';
  locationInput.value = creator?.location || '';
  locationInput.autocomplete = 'off';

  const locSuggestions = document.createElement('div');
  locSuggestions.className = 'loc-suggestions';
  locSuggestions.id = 'locSuggestions';

  // Store selected coords on the input
  locationInput.dataset.lat = creator?.lat || '';
  locationInput.dataset.lng = creator?.lng || '';

  locationInput.oninput = () => {
    const q = locationInput.value.trim();
    if (q.length < 2) {
      locSuggestions.classList.remove('open');
      return;
    }
    debounceLocSearch(q, (results) => {
      locSuggestions.innerHTML = '';
      if (results.length === 0) {
        locSuggestions.classList.remove('open');
        return;
      }
      results.forEach(r => {
        const item = document.createElement('div');
        item.className = 'loc-suggestion-item';
        // Show simplified city, state, country
        const simplified = simplifyAddress(r);
        item.innerHTML = `<div>${simplified}</div>`;
        item.onmousedown = (e) => {
          e.preventDefault();
          locationInput.value = simplifyAddress(r);
          locationInput.dataset.lat = r.lat;
          locationInput.dataset.lng = r.lon;
          locSuggestions.classList.remove('open');
        };
        locSuggestions.appendChild(item);
      });
      locSuggestions.classList.add('open');
    });
  };

  locationInput.onblur = () => {
    setTimeout(() => locSuggestions.classList.remove('open'), 150);
  };

  locationInput.onfocus = () => {
    if (locSuggestions.children.length > 0) {
      locSuggestions.classList.add('open');
    }
  };

  locWrap.appendChild(locationInput);
  locWrap.appendChild(locSuggestions);
  locationGroup.appendChild(locationLabel);
  locationGroup.appendChild(locWrap);
  body.appendChild(locationGroup);

  // Notes
  const notesGroup = document.createElement('div');
  notesGroup.className = 'form-group';
  const notesLabel = document.createElement('label');
  notesLabel.className = 'form-label';
  notesLabel.textContent = 'Notes';
  const notesTextarea = document.createElement('textarea');
  notesTextarea.className = 'form-textarea';
  notesTextarea.id = 'notesTextarea';
  notesTextarea.placeholder = 'Add any additional notes...';
  notesTextarea.value = creator?.notes || '';
  notesGroup.appendChild(notesLabel);
  notesGroup.appendChild(notesTextarea);
  body.appendChild(notesGroup);

}

async function saveCreator() {
  const photo = document.getElementById('photoPreview').dataset.photoUrl ||
                document.getElementById('photoPreview').dataset.photoData ||
                (document.getElementById('photoPreview').querySelector('img')?.src);

  const firstName = document.getElementById('firstNameInput').value.trim();
  const lastName = document.getElementById('lastNameInput').value.trim();

  if (!firstName) {
    showToast('First name is required', 'error');
    return;
  }

  const platforms = {};
  document.querySelectorAll('input[data-platform]:checked').forEach(el => {
    const p = el.value;
    const handle = (document.querySelector(`input[data-handle="${p}"]`)?.value || '').trim();
    const url = (document.querySelector(`input[data-url="${p}"]`)?.value || '').trim();
    const followersRaw = (document.querySelector(`input[data-followers="${p}"]`)?.value || '').replace(/[^\d]/g, '');
    const followers = followersRaw ? parseInt(followersRaw, 10) : null;
    platforms[p] = { handle, url, followers };
  });
  const email = document.getElementById('emailInput').value.trim();
  const mediaKit = document.getElementById('mediaKitInput').value.trim();
  const birthday = document.getElementById('birthdayInput').value || null;
  const niches = document.getElementById('modalBody').modalNiches || [];
  const demographics = document.getElementById('modalBody').modalDemographics || [];
  const location = document.getElementById('locationInput').value.trim();
  const notes = document.getElementById('notesTextarea').value.trim();
  let creator;
  if (currentEditingCreator) {
    creator = creators.find(c => c.id === currentEditingCreator);
    creator.firstName = firstName;
    creator.lastName = lastName;
    creator.photo = photo || null;
    creator.email = email || null;
    creator.mediaKit = mediaKit || null;
    creator.birthday = birthday;
    creator.platforms = platforms;
    creator.niches = niches;
    creator.demographics = demographics;
    creator.location = location;
    creator.notes = notes;
    creator.updatedAt = new Date().toISOString();
  } else {
    creator = {
      id: generateId(),
      firstName,
      lastName,
      photo: photo || null,
      email: email || null,
      mediaKit: mediaKit || null,
      birthday,
      platforms,
      niches,
      demographics,
      location,
      notes,
      lat: null,
      lng: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    creators.push(creator);
  }

  // Use pre-selected coords from autocomplete, or fall back to geocoding
  if (location) {
    const locInput = document.getElementById('locationInput');
    const preLat = parseFloat(locInput?.dataset?.lat);
    const preLng = parseFloat(locInput?.dataset?.lng);
    if (!isNaN(preLat) && !isNaN(preLng)) {
      creator.lat = preLat;
      creator.lng = preLng;
    } else {
      const coords = await geocodeLocation(location);
      if (coords) {
        creator.lat = coords.lat;
        creator.lng = coords.lng;
      }
    }
  }

  db.persist(creators);
  closeModal();
  renderRosterFilterPills();
  renderRosterTab();
  renderDispatchTab();
  updateMapMarkers();
  showToast('Creator saved', 'success');
}

function deleteCreator(creatorId) {
  if (confirm('Move this creator to the recycle bin?')) {
    const creator = creators.find(c => c.id === creatorId);
    if (creator) recycleBin.add(creator);
    creators = creators.filter(c => c.id !== creatorId);
    db.persist(creators);
    closeDetailPanel();
    renderRosterFilterPills();
    renderRosterTab();
    renderDispatchTab();
    updateMapMarkers();
    updateRecycleBinBadge();
    showToast('Moved to recycle bin', 'success');
  }
}

// ===========================
// STORAGE INDICATOR
// ===========================
function updateStorageIndicator() {
  const used = getStorageUsage();
  const limit = 50 * 1024 * 1024; // 50MB (IndexedDB)
  const pct = Math.min((used / limit) * 100, 100);
  const text = document.getElementById('storageText');
  const fill = document.getElementById('storageBarFill');
  if (!text || !fill) return;
  const creatorCount = creators.length;
  text.textContent = `${creatorCount} creator${creatorCount !== 1 ? 's' : ''} · ${formatBytes(used)} / ${formatBytes(limit)}`;
  fill.style.width = pct + '%';
  fill.classList.remove('warn', 'danger');
  if (pct > 80) fill.classList.add('danger');
  else if (pct > 50) fill.classList.add('warn');
}

// ===========================
// MIGRATE EXISTING PHOTOS (compress oversized base64 on first load)
// ===========================
async function migratePhotos() {
  let changed = false;
  for (const creator of creators) {
    if (creator.photo && creator.photo.startsWith('data:') && creator.photo.length > IMG_MAX_BYTES * 1.5) {
      const compressed = await compressImage(creator.photo);
      if (compressed.length < creator.photo.length) {
        creator.photo = compressed;
        changed = true;
      }
    }
  }
  if (changed) {
    db.persist(creators);
    updateStorageIndicator();
  }
}

// ===========================
// RECYCLE BIN UI
// ===========================
function updateRecycleBinBadge() {
  const count = recycleBin.count();
  const label = document.getElementById('recycleBinLabel');
  if (count > 0) {
    label.innerHTML = `Bin <span class="recycle-badge">${count}</span>`;
  } else {
    label.textContent = 'Bin';
  }
}

function renderRecycleBinTab() {
  const list = document.getElementById('recycleList');
  const emptyState = document.getElementById('recycleEmpty');
  const emptyBtn = document.getElementById('emptyBinBtn');
  list.innerHTML = '';

  const items = recycleBin.load();
  updateRecycleBinBadge();

  if (items.length === 0) {
    emptyState.style.display = 'flex';
    emptyBtn.style.display = 'none';
    return;
  }

  emptyState.style.display = 'none';
  emptyBtn.style.display = 'block';

  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'recycle-card';

    // Avatar
    const avatar = document.createElement('div');
    avatar.className = 'creator-avatar';
    if (item.photo) {
      const img = document.createElement('img');
      img.src = item.photo;
      avatar.appendChild(img);
    } else {
      avatar.textContent = getInitials(item.firstName, item.lastName);
    }
    card.appendChild(avatar);

    // Info
    const info = document.createElement('div');
    info.className = 'recycle-card-info';

    const name = document.createElement('div');
    name.className = 'recycle-card-name';
    name.textContent = getFullName(item);
    info.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'recycle-card-meta';
    const daysAgo = Math.floor((Date.now() - item.deletedAt) / (24 * 60 * 60 * 1000));
    const daysLeft = 7 - daysAgo;
    const timeLabel = daysAgo === 0 ? 'Deleted today' : `Deleted ${daysAgo}d ago`;
    const expiryLabel = daysLeft <= 1 ? ' · Expires soon' : ` · ${daysLeft}d left`;
    meta.textContent = timeLabel + expiryLabel;
    if (item.location) meta.textContent += ` · ${displayLocation(item.location)}`;
    info.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'recycle-card-actions';

    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'recycle-btn restore';
    restoreBtn.textContent = 'Restore';
    restoreBtn.onclick = () => {
      const restored = recycleBin.restore(item.id);
      if (restored) {
        creators.push(restored);
        db.persist(creators);
        renderRosterTab();
        renderDispatchTab();
        updateMapMarkers();
        showToast(`${getFullName(restored)} restored`, 'success');
      }
      renderRecycleBinTab();
    };

    const permDeleteBtn = document.createElement('button');
    permDeleteBtn.className = 'recycle-btn perm-delete';
    permDeleteBtn.textContent = 'Delete';
    permDeleteBtn.onclick = () => {
      if (confirm('Permanently delete? This cannot be undone.')) {
        recycleBin.permanentDelete(item.id);
        renderRecycleBinTab();
        showToast('Permanently deleted', 'success');
      }
    };

    actions.appendChild(restoreBtn);
    actions.appendChild(permDeleteBtn);
    info.appendChild(actions);
    card.appendChild(info);
    list.appendChild(card);
  });
}

// ===========================
// IMPORT / EXPORT
// ===========================
function exportData() {
  const json = JSON.stringify(creators, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `creator-roster-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Data exported', 'success');
}

function migrateDemographics(creator) {
  if (!creator.demographics) {
    creator.demographics = [];
  }
  return creator;
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data)) throw new Error('Invalid format');
      creators = data;
      creators.forEach(migratePlatforms);
      creators.forEach(migrateDemographics);
      db.persist(creators);
      renderRosterTab();
      renderDispatchTab();
      updateMapMarkers();
      showToast('Data imported', 'success');
    } catch (err) {
      showToast('Import failed', 'error');
    }
  };
  reader.readAsText(file);
}

// ===========================
// EVENT LISTENERS
// ===========================
document.getElementById('searchInput').addEventListener('input', debounce(renderRosterTab, 120));

// Show/hide filter pills
const searchInput = document.getElementById('searchInput');
const filterPillsContainer = document.getElementById('rosterFilterPills');
let filterPanelOpen = false;

function openFilterPanel() {
  filterPanelOpen = true;
  filterPillsContainer.classList.add('expanded');
}
function closeFilterPanel() {
  filterPanelOpen = false;
  const hasActive = rosterFilters.niches.length > 0 || rosterFilters.demographics.length > 0 || rosterFilters.ageMin !== null || rosterFilters.ageMax !== null;
  if (!hasActive) {
    filterPillsContainer.classList.remove('expanded');
  }
}

// Open on search focus or click
searchInput.addEventListener('focus', openFilterPanel);
searchInput.addEventListener('click', openFilterPanel);

// Close roster filter panel when clicking outside
document.addEventListener('mousedown', (e) => {
  if (filterPanelOpen) {
    const clickedInside = filterPillsContainer.contains(e.target) || e.target === searchInput;
    if (!clickedInside) closeFilterPanel();
  }
});

// Dispatch collapsible toggles
['niches', 'demos'].forEach(key => {
  const toggleId = key === 'niches' ? 'nichesToggle' : 'demosToggle';
  const bodyId = key === 'niches' ? 'nichesBody' : 'demosBody';
  document.getElementById(toggleId).addEventListener('click', () => {
    const btn = document.getElementById(toggleId);
    const body = document.getElementById(bodyId);
    btn.classList.toggle('open');
    body.classList.toggle('open');
  });
});

function openDispatchFilterPanel() {}
function closeDispatchFilterPanel() {}

document.getElementById('sortSelect').addEventListener('change', () => {
  renderRosterTab();
  renderDispatchTab();
});

// Dispatch destination autocomplete
(function setupDispatchLocation() {
  const input = document.getElementById('locationFilterInput');
  const suggestions = document.getElementById('dispatchLocSuggestions');

  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (q.length < 2) {
      suggestions.classList.remove('open');
      // Clear destination if input is emptied
      if (q.length === 0) {
        clearDispatchDestination();
      }
      return;
    }
    debounceLocSearch(q, (results) => {
      suggestions.innerHTML = '';
      if (results.length === 0) {
        suggestions.classList.remove('open');
        return;
      }
      results.forEach(r => {
        const item = document.createElement('div');
        item.className = 'loc-suggestion-item';
        const parts = r.display_name.split(',');
        const primary = parts.slice(0, 2).join(',').trim();
        const secondary = parts.slice(2).join(',').trim();
        item.innerHTML = `<div>${primary}</div>${secondary ? `<div class="loc-secondary">${secondary}</div>` : ''}`;
        item.onmousedown = (e) => {
          e.preventDefault();
          const displayName = r.display_name.split(',').slice(0, 3).join(',').trim();
          input.value = displayName;
          suggestions.classList.remove('open');
          setDispatchDestination(parseFloat(r.lat), parseFloat(r.lon), displayName);
        };
        suggestions.appendChild(item);
      });
      suggestions.classList.add('open');
    });
  });

  input.addEventListener('blur', () => {
    setTimeout(() => suggestions.classList.remove('open'), 150);
  });

  input.addEventListener('focus', () => {
    if (suggestions.children.length > 0) {
      suggestions.classList.add('open');
    }
  });
})();

// Clear button for destination input
document.getElementById('locationFilterClear').addEventListener('click', () => {
  document.getElementById('locationFilterInput').value = '';
  clearDispatchDestination();
});

function setDispatchDestination(lat, lng, displayName) {
  dispatchDestination = { lat, lng, displayName };
  document.getElementById('locationFilterClear').style.display = 'flex';

  // Remove old destination marker
  if (dispatchDestinationMarker) {
    map.removeLayer(dispatchDestinationMarker);
  }

  // Add red pin
  const redIcon = L.divIcon({
    html: `<div style="
      width: 28px; height: 28px; border-radius: 50% 50% 50% 0;
      background: #D4A08E; border: 2px solid rgba(255,255,255,0.8);
      transform: rotate(-45deg);
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      display: flex; align-items: center; justify-content: center;
    "><div style="
      width: 8px; height: 8px; background: white; border-radius: 50%; transform: rotate(45deg);
    "></div></div>`,
    className: 'destination-marker',
    iconSize: [28, 28],
    iconAnchor: [14, 28]
  });

  dispatchDestinationMarker = L.marker([lat, lng], { icon: redIcon }).addTo(map);

  // Fly map to show destination area
  map.flyTo([lat, lng], 7, { duration: 1 });

  // Render nearest creators
  renderNearestCreators();
  if (typeof updateClearFiltersBtn === 'function') updateClearFiltersBtn();
}

function clearDispatchDestination() {
  dispatchDestination = null;
  if (dispatchDestinationMarker) {
    map.removeLayer(dispatchDestinationMarker);
    dispatchDestinationMarker = null;
  }
  document.getElementById('locationFilterClear').style.display = 'none';
  const panel = document.getElementById('dispatchNearest');
  panel.classList.remove('open');
  setTimeout(() => { panel.style.display = 'none'; }, 300);
  updateMapMarkers();
}

function renderNearestCreators() {
  const container = document.getElementById('dispatchNearest');
  if (!dispatchDestination) {
    container.classList.remove('open');
    setTimeout(() => { container.style.display = 'none'; }, 300);
    return;
  }

  // Get filtered creators (respecting platform/niche/tier filters) that have coordinates
  const sortBy = document.getElementById('sortSelect').value;
  const filtered = getFilteredCreators('', sortBy, true)
    .filter(c => c.lat && c.lng);

  // Calculate distances and sort
  const withDist = filtered.map(c => ({
    creator: c,
    distance: haversineDistance(dispatchDestination.lat, dispatchDestination.lng, c.lat, c.lng)
  })).sort((a, b) => a.distance - b.distance);

  const nearest = withDist.slice(0, 3);

  container.innerHTML = '';

  if (nearest.length === 0) {
    container.innerHTML = '<div style="font-size: 12px; color: var(--text-muted); text-align: center; padding: 8px;">No creators with locations match current filters</div>';
    container.style.display = 'flex';
    requestAnimationFrame(() => container.classList.add('open'));
    return;
  }

  // Header with label + close button
  const header = document.createElement('div');
  header.className = 'nearest-float-header';

  const label = document.createElement('div');
  label.className = 'nearest-float-label';
  // Show just a short destination name
  const shortDest = dispatchDestination.displayName.split(',').slice(0, 2).join(',').trim();
  label.textContent = `Nearest to ${shortDest}`;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'nearest-float-close';
  closeBtn.innerHTML = '×';
  closeBtn.onclick = () => {
    document.getElementById('locationFilterInput').value = '';
    clearDispatchDestination();
  };

  header.appendChild(label);
  header.appendChild(closeBtn);
  container.appendChild(header);

  nearest.forEach((item, i) => {
    const c = item.creator;
    const row = document.createElement('div');
    row.className = 'nearest-float-item';
    row.onclick = () => showDetailPanel(c.id);

    const rank = document.createElement('div');
    rank.className = 'nearest-float-rank';
    rank.textContent = i + 1;

    const info = document.createElement('div');
    info.className = 'nearest-float-info';

    const name = document.createElement('div');
    name.className = 'nearest-float-name';
    name.textContent = getFullName(c);

    const meta = document.createElement('div');
    meta.className = 'nearest-float-meta';
    const metaParts = [];
    const nPlatforms = getCreatorPlatforms(c);
    if (nPlatforms.length) metaParts.push(nPlatforms.map(p => PLATFORM_ICONS[p] || p).join(' '));
    if (c.niches?.length) metaParts.push(c.niches.slice(0, 2).join(', '));
    if (c.location) metaParts.push(c.location);
    meta.textContent = metaParts.join(' · ');

    info.appendChild(name);
    info.appendChild(meta);

    const dist = document.createElement('div');
    dist.className = 'nearest-float-dist';
    dist.textContent = item.distance < 1 ? '< 1 mi' : Math.round(item.distance).toLocaleString() + ' mi';

    row.appendChild(rank);
    row.appendChild(info);
    row.appendChild(dist);
    container.appendChild(row);
  });

  container.style.display = 'flex';
  requestAnimationFrame(() => container.classList.add('open'));
}

// Bloom transition effect
function triggerBloom(toDispatch) {
  const overlay = document.createElement('div');
  overlay.className = 'bloom-overlay';
  document.body.appendChild(overlay);

  // Main color bloom circle — originates from the tab area
  const circle = document.createElement('div');
  circle.className = 'bloom-circle';
  const size = Math.max(window.innerWidth, window.innerHeight) * 2.5;
  circle.style.width = size + 'px';
  circle.style.height = size + 'px';
  circle.style.left = '180px';
  circle.style.top = '70px';
  circle.style.transform = 'translate(-50%, -50%) scale(0)';
  circle.style.background = toDispatch
    ? 'radial-gradient(circle, rgba(122, 86, 84, 0.5) 0%, rgba(92, 61, 61, 0.25) 40%, transparent 70%)'
    : 'radial-gradient(circle, rgba(44, 35, 32, 0.5) 0%, rgba(52, 42, 38, 0.25) 40%, transparent 70%)';
  overlay.appendChild(circle);

  requestAnimationFrame(() => circle.classList.add('expanding'));

  // Scatter petals
  const petalColors = toDispatch
    ? ['#E8A8A0', '#D4908E', '#F0C8C0', '#BBA7CF', '#F5DDD5']
    : ['#9BB5A0', '#8A7A70', '#C09A8A', '#BBA7CF', '#4A3E38'];

  for (let i = 0; i < 12; i++) {
    const petal = document.createElement('div');
    petal.className = 'bloom-petal';
    petal.style.left = (140 + Math.random() * 80) + 'px';
    petal.style.top = (50 + Math.random() * 40) + 'px';
    petal.style.background = petalColors[Math.floor(Math.random() * petalColors.length)];
    petal.style.setProperty('--dx', (Math.random() * 200 - 100) + 'px');
    petal.style.setProperty('--dy', (Math.random() * 200 + 50) + 'px');
    petal.style.setProperty('--rot', (Math.random() * 360) + 'deg');
    petal.style.transform = `rotate(${Math.random() * 360}deg)`;
    overlay.appendChild(petal);

    setTimeout(() => petal.classList.add('falling'), 50 + Math.random() * 200);
  }

  // Cleanup
  setTimeout(() => overlay.remove(), 1400);
}

// Tab switching
document.querySelectorAll('.tab-button').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    const wasDispatch = document.body.classList.contains('dispatch-mode');
    const goingToDispatch = tab === 'dispatch';

    // Only animate if actually changing modes
    if (goingToDispatch !== wasDispatch) {
      triggerBloom(goingToDispatch);
    }

    document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Toggle dispatch mode theme
    if (goingToDispatch) {
      document.body.classList.add('dispatch-mode');
    } else {
      document.body.classList.remove('dispatch-mode');
    }

    document.getElementById('rosterTab').style.display = tab === 'roster' ? 'flex' : 'none';
    document.getElementById('dispatchTab').style.display = tab === 'dispatch' ? 'flex' : 'none';
    document.getElementById('recycleTab').style.display = tab === 'recycle' ? 'flex' : 'none';

    // Hide match float panel when leaving to recycle tab
    if (tab === 'recycle') {
      document.getElementById('matchFloatPanel').classList.remove('visible', 'dispatch-mode');
    }
    // When switching to roster, remove dispatch-mode and re-render roster (which manages the panel)
    if (tab === 'roster') {
      document.getElementById('matchFloatPanel').classList.remove('dispatch-mode');
      renderRosterTab();
    }

    if (tab === 'dispatch') {
      // Hide roster's match results, dispatch will repopulate
      document.getElementById('matchFloatPanel').classList.remove('visible');
      renderDispatchFilters();
      renderDispatchFilterPills();
      renderDispatchTab();
    }
    if (tab === 'recycle') {
      renderRecycleBinTab();
    }
  });
});

// Add Creator button
document.getElementById('addBtn').addEventListener('click', openAddModal);

// Match float panel close
document.getElementById('matchFloatClose').addEventListener('click', () => {
  const panel = document.getElementById('matchFloatPanel');
  const isDispatch = panel.classList.contains('dispatch-mode');
  panel.classList.remove('visible', 'dispatch-mode');

  if (isDispatch) {
    // Clear dispatch niche/demo/age filters
    dispatchFilters.niches = [];
    dispatchFilters.demographics = [];
    dispatchFilters.ageMin = null;
    dispatchFilters.ageMax = null;
    renderDispatchFilterPills();
    renderDispatchTab();
    updateMapMarkers();
  } else {
    // Clear roster filters
    rosterFilters.niches = [];
    rosterFilters.demographics = [];
    rosterFilters.ageMin = null;
    rosterFilters.ageMax = null;
    renderRosterFilterPills();
    renderRosterTab();
  }
});

// Recycle bin
document.getElementById('emptyBinBtn').addEventListener('click', () => {
  if (confirm('Permanently delete all creators in the recycle bin?')) {
    recycleBin.emptyAll();
    renderRecycleBinTab();
    showToast('Recycle bin emptied', 'success');
  }
});
// Reset All Data — nuclear confirmation
document.getElementById('resetAllBtn').addEventListener('click', () => {
  const overlay = document.createElement('div');
  overlay.className = 'nuke-overlay';
  overlay.innerHTML = `
    <div class="nuke-dialog">
      <div class="nuke-icon">☢️</div>
      <div class="nuke-title">Reset All Data</div>
      <div class="nuke-msg">This will permanently delete <strong>all creators</strong>, the recycle bin, and all settings. This cannot be undone.</div>
      <div class="nuke-confirm-label">Type <strong>RESET</strong> to confirm</div>
      <input type="text" class="nuke-confirm-input" id="nukeConfirmInput" placeholder="RESET" autocomplete="off" spellcheck="false">
      <div class="nuke-actions">
        <button class="nuke-cancel" id="nukeCancel">Cancel</button>
        <button class="nuke-delete" id="nukeConfirm">Delete Everything</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const input = document.getElementById('nukeConfirmInput');
  const confirmBtn = document.getElementById('nukeConfirm');

  input.focus();
  input.addEventListener('input', () => {
    if (input.value.trim().toUpperCase() === 'RESET') {
      confirmBtn.classList.add('armed');
    } else {
      confirmBtn.classList.remove('armed');
    }
  });

  document.getElementById('nukeCancel').addEventListener('click', () => {
    overlay.remove();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  confirmBtn.addEventListener('click', () => {
    if (!confirmBtn.classList.contains('armed')) return;
    overlay.remove();
    creators = [];
    db.save(creators);
    recycleBin.emptyAll();
    setSetting('deletedNiches', []);
    setSetting('deletedDemographics', []);
    setSetting('creator_roster_niche_categories', DEFAULT_NICHE_CATEGORIES);
    setSetting('creator_roster_demographic_categories', DEFAULT_DEMO_CATEGORIES);
    deletedNiches = [];
    deletedDemographics = [];
    flushPersist();
    renderRosterTab();
    renderRecycleBinTab();
    updateMapMarkers();
    updateStorageIndicator();
    updateRecycleBinBadge();
    showToast('All data has been reset', 'success');
  });
});

// updateRecycleBinBadge, updateStorageIndicator, migratePhotos
// are called inside init() after the database is ready
// updateClearFiltersBtn is now a no-op; clearing is handled by inline ✕ Clear pill
function updateClearFiltersBtn() {}

// Dispatch filter pills are rendered inline via renderDispatchFilterPills()
// (called from renderDispatchFilters → renderDispatchTagsSelected stub)

// Modal
document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modalCancelBtn').addEventListener('click', closeModal);
document.getElementById('modalSaveBtn').addEventListener('click', saveCreator);
// Backdrop click no longer closes modal — use ×, Cancel, or Esc instead

// Ring scrim — click to close
document.getElementById('ringScrim').addEventListener('click', closeDetailPanel);

// Tag modal scrim — click to close
document.getElementById('tagModalScrim').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    closeTagModal();
  }
});

// Esc key closes popups in priority order (innermost first)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // Close ALL open popups at once
    const deleteConfirm = document.querySelector('.tag-delete-confirm-overlay');
    if (deleteConfirm) deleteConfirm.remove();

    const tagPanel = document.querySelector('.tag-panel-overlay.open');
    if (tagPanel) tagPanel.classList.remove('open');

    const dispatchTagsPanel = document.getElementById('dispatchTagsOverlay');
    if (dispatchTagsPanel && dispatchTagsPanel.classList.contains('open')) closeDispatchTagsPanel();

    const modal = document.getElementById('modal');
    if (modal && modal.style.display !== 'none') closeModal();

    const tagModal = document.getElementById('tagModalScrim');
    if (tagModal && tagModal.classList.contains('open')) closeTagModal();

    const ring = document.getElementById('ringOverlay');
    if (ring && ring.classList.contains('open')) closeDetailPanel();
  }
});

// ===========================
// MAP INITIALIZATION
// ===========================
function initMap() {
  map = L.map('map', {
    center: [37.0902, -95.7129],
    zoom: 4,
    minZoom: 2,
    maxBounds: [[-90, -180], [90, 180]],
    maxBoundsViscosity: 1.0,
    noWrap: true
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap contributors © CARTO',
    maxZoom: 20,
    noWrap: true
  }).addTo(map);

  // Scale markers based on zoom level
  function updateMarkerScale() {
    const zoom = map.getZoom();
    // At zoom 2-3: ~0.5, zoom 5: ~0.7, zoom 8: ~0.9, zoom 10+: 1.0
    const scale = Math.min(1, Math.max(0.45, (zoom - 2) / 10 + 0.45));
    document.documentElement.style.setProperty('--marker-scale', scale.toFixed(2));
  }
  map.on('zoomend', updateMarkerScale);
  map.on('zoom', updateMarkerScale);
  updateMarkerScale(); // set initial scale

  updateMapMarkers();
  fitMapToCreators();
}

function fitMapToCreators() {
  const located = creators.filter(c => c.lat && c.lng);
  if (located.length === 0) return;
  if (located.length === 1) {
    map.setView([located[0].lat, located[0].lng], 6);
    return;
  }
  const bounds = L.latLngBounds(located.map(c => [c.lat, c.lng]));
  map.fitBounds(bounds, { padding: [50, 50], maxZoom: 10 });
}

// ===========================
// JULY IMPORT MODULE
// ===========================
const julyImport = (() => {
  let julyCreators = []; // scraped data cache
  let selectedIds = new Set();
  let activeFilter = null;
  let searchQuery = '';

  const PLATFORM_ICONS_SM = {
    Instagram: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>',
    TikTok: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.75a8.18 8.18 0 004.77 1.52V6.84a4.85 4.85 0 01-1-.15z"/></svg>',
    YouTube: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>',
    Facebook: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>'
  };

  function formatCount(n) {
    if (n == null) return '';
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return n.toLocaleString();
  }

  function parseName(fullName) {
    const parts = (fullName || '').trim().split(/\s+/);
    if (parts.length <= 1) return { firstName: parts[0] || '', lastName: '' };
    return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
  }

  // Check if a July creator is already in the roster
  function isAlreadyInRoster(julyCreator) {
    const jName = (julyCreator.name || '').toLowerCase().trim();
    return creators.some(c => {
      const rName = getFullName(c).toLowerCase().trim();
      return rName === jName;
    });
  }

  function getFilteredJulyCreators() {
    let filtered = julyCreators;
    if (activeFilter) {
      filtered = filtered.filter(c => (c.niches || []).includes(activeFilter));
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(c => {
        const name = (c.name || '').toLowerCase();
        const niches = (c.niches || []).join(' ').toLowerCase();
        const platforms = Object.keys(c.platforms || {}).join(' ').toLowerCase();
        const location = (c.location || '').toLowerCase();
        return name.includes(q) || niches.includes(q) || platforms.includes(q) || location.includes(q);
      });
    }
    return filtered;
  }

  function renderGrid() {
    const grid = document.getElementById('julyGrid');
    const empty = document.getElementById('julyEmpty');
    grid.innerHTML = '';

    const filtered = getFilteredJulyCreators();

    if (filtered.length === 0) {
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    filtered.forEach((jc, idx) => {
      const card = document.createElement('div');
      const alreadyAdded = isAlreadyInRoster(jc);
      card.className = 'july-card' +
        (selectedIds.has(idx) ? ' selected' : '') +
        (alreadyAdded ? ' already-added' : '');

      if (!alreadyAdded) {
        card.onclick = () => {
          if (selectedIds.has(idx)) selectedIds.delete(idx);
          else selectedIds.add(idx);
          renderGrid();
          updateFooter();
        };
      }

      // Checkbox indicator
      const check = document.createElement('div');
      check.className = 'july-card-check';
      check.innerHTML = selectedIds.has(idx) ? '✓' : '';
      card.appendChild(check);

      // Top row: avatar + name + location
      const top = document.createElement('div');
      top.className = 'july-card-top';

      const avatar = document.createElement('div');
      avatar.className = 'july-card-avatar';
      if (jc.photo) {
        avatar.innerHTML = `<img src="${jc.photo}" loading="lazy">`;
      } else {
        const { firstName, lastName } = parseName(jc.name);
        avatar.textContent = (firstName[0] || '') + (lastName[0] || '');
      }

      const info = document.createElement('div');
      info.className = 'july-card-info';
      const name = document.createElement('div');
      name.className = 'july-card-name';
      name.textContent = jc.name;
      info.appendChild(name);

      if (jc.location) {
        const loc = document.createElement('div');
        loc.className = 'july-card-location';
        loc.textContent = '📍 ' + jc.location;
        info.appendChild(loc);
      }

      top.appendChild(avatar);
      top.appendChild(info);
      card.appendChild(top);

      // Platform pills
      const platforms = Object.entries(jc.platforms || {});
      if (platforms.length > 0) {
        const row = document.createElement('div');
        row.className = 'july-card-platforms';
        platforms.forEach(([platform, data]) => {
          const pill = document.createElement('span');
          pill.className = 'july-platform-pill ' + platform.toLowerCase();
          const icon = PLATFORM_ICONS_SM[platform] || '';
          const count = formatCount(data.followers);
          pill.innerHTML = icon + (count ? ' ' + count : '');
          row.appendChild(pill);
        });
        card.appendChild(row);
      }

      // Niche tags
      if (jc.niches && jc.niches.length > 0) {
        const tags = document.createElement('div');
        tags.className = 'july-card-niches';
        jc.niches.slice(0, 5).forEach(n => {
          const tag = document.createElement('span');
          tag.className = 'july-niche-tag';
          tag.textContent = n;
          tags.appendChild(tag);
        });
        if (jc.niches.length > 5) {
          const more = document.createElement('span');
          more.className = 'july-niche-tag';
          more.textContent = `+${jc.niches.length - 5}`;
          tags.appendChild(more);
        }
        card.appendChild(tags);
      }

      grid.appendChild(card);
    });
  }

  function renderFilterPills() {
    const row = document.getElementById('julyFilterRow');
    row.innerHTML = '';

    // Collect all niches across July creators
    const allNiches = {};
    julyCreators.forEach(c => (c.niches || []).forEach(n => {
      allNiches[n] = (allNiches[n] || 0) + 1;
    }));

    // Sort by frequency
    const sorted = Object.entries(allNiches).sort((a, b) => b[1] - a[1]);

    // "All" pill
    const allPill = document.createElement('button');
    allPill.className = 'july-filter-pill' + (!activeFilter ? ' active' : '');
    allPill.textContent = `All (${julyCreators.length})`;
    allPill.onclick = () => { activeFilter = null; renderGrid(); renderFilterPills(); };
    row.appendChild(allPill);

    sorted.forEach(([niche, count]) => {
      const pill = document.createElement('button');
      pill.className = 'july-filter-pill' + (activeFilter === niche ? ' active' : '');
      pill.textContent = `${niche} (${count})`;
      pill.onclick = () => {
        activeFilter = activeFilter === niche ? null : niche;
        renderGrid();
        renderFilterPills();
      };
      row.appendChild(pill);
    });
  }

  function updateFooter() {
    const info = document.getElementById('julyFooterInfo');
    const addBtn = document.getElementById('julyAddBtn');
    const count = selectedIds.size;
    info.textContent = count === 0 ? '0 selected' : `${count} creator${count !== 1 ? 's' : ''} selected`;
    addBtn.disabled = count === 0;
  }

  async function fetchFromJuly() {
    const loading = document.getElementById('julyLoading');
    const grid = document.getElementById('julyGrid');
    const status = document.getElementById('julyStatus');
    const refreshBtn = document.getElementById('julyRefreshBtn');

    loading.style.display = 'flex';
    grid.innerHTML = '';
    refreshBtn.classList.add('spinning');
    status.textContent = 'Scraping...';

    try {
      const resp = await fetch('/api/scrape-july');
      const data = await resp.json();

      if (data.success && data.creators) {
        julyCreators = data.creators;
        status.textContent = `${data.count} creators · ${new Date(data.scrapedAt).toLocaleString()}`;
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (e) {
      console.error('July fetch failed:', e);
      status.textContent = 'Fetch failed — ' + e.message;
      document.getElementById('julyEmpty').style.display = 'block';
      document.getElementById('julyEmpty').textContent = 'Failed to fetch from July. Check the console for details.';
    } finally {
      loading.style.display = 'none';
      refreshBtn.classList.remove('spinning');
    }

    selectedIds.clear();
    renderFilterPills();
    renderGrid();
    updateFooter();
  }

  async function addSelectedToRoster() {
    const toAdd = [];
    selectedIds.forEach(idx => {
      const jc = julyCreators[idx];
      if (!jc || isAlreadyInRoster(jc)) return;

      const { firstName, lastName } = parseName(jc.name);

      // Build platforms object in our app's format
      const platforms = {};
      Object.entries(jc.platforms || {}).forEach(([platform, data]) => {
        platforms[platform] = {
          handle: data.handle || '',
          url: data.url || '',
          followers: data.followers || null
        };
      });

      const creator = {
        id: generateId(),
        firstName,
        lastName,
        photo: null, // Don't import external photos — use our own aesthetic
        email: null,
        mediaKit: null,
        birthday: null,
        platforms,
        niches: jc.niches || [],
        demographics: [],
        location: jc.location || null,
        lat: null,
        lng: null,
        notes: jc.bio ? `Imported from July · ${jc.bio.substring(0, 200)}` : 'Imported from July',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      toAdd.push(creator);
    });

    if (toAdd.length === 0) return;

    // Geocode locations in parallel (fire and forget — UI updates immediately)
    const geocodePromises = toAdd.filter(c => c.location).map(async (creator) => {
      try {
        const results = await searchLocations(creator.location);
        if (results.length > 0) {
          creator.lat = parseFloat(results[0].lat);
          creator.lng = parseFloat(results[0].lon);
          // Simplify location
          migrateLocation(creator);
        }
      } catch (e) {
        // Skip failed geocodes
      }
    });

    // Add creators to roster immediately
    creators.push(...toAdd);
    db.persist(creators);
    renderRosterFilterPills();
    renderRosterTab();
    updateMapMarkers();
    updateStorageIndicator();

    showToast(`${toAdd.length} creator${toAdd.length !== 1 ? 's' : ''} added to roster`, 'success');

    // Close panel
    close();

    // Geocode in background, then update
    await Promise.allSettled(geocodePromises);
    db.persist(creators);
    updateMapMarkers();
    fitMapToCreators();
  }

  function open() {
    const overlay = document.getElementById('julyOverlay');
    overlay.style.display = 'flex';
    requestAnimationFrame(() => overlay.classList.add('open'));

    // Fetch if we don't have cached data
    if (julyCreators.length === 0) {
      fetchFromJuly();
    } else {
      // Re-render with possibly updated roster
      renderGrid();
      updateFooter();
    }
  }

  function close() {
    const overlay = document.getElementById('julyOverlay');
    overlay.classList.remove('open');
    setTimeout(() => { overlay.style.display = 'none'; }, 250);
  }

  // Wire up events
  document.getElementById('julyImportBtn').addEventListener('click', open);
  document.getElementById('julyCloseBtn').addEventListener('click', close);
  document.getElementById('julyCancelBtn').addEventListener('click', close);
  document.getElementById('julyAddBtn').addEventListener('click', addSelectedToRoster);
  document.getElementById('julyRefreshBtn').addEventListener('click', fetchFromJuly);
  document.getElementById('julyOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) close();
  });
  document.getElementById('julySearch').addEventListener('input', debounce((e) => {
    searchQuery = e.target.value.trim();
    renderGrid();
  }, 150));

  return { open, close, fetchFromJuly };
})();

// ===========================
// INITIALIZATION
// ===========================
async function init() {
  try {
    // Initialize SQLite database (loads WASM, opens/creates DB, migrates localStorage)
    await initDatabase();
    console.log('SQLite database initialized successfully');
  } catch (e) {
    console.error('Database initialization failed:', e);
    showToast('Database failed to load — check console', 'error');
    // Still try to render the map so the page isn't completely broken
    initMap();
    return;
  }

  try {
    // Load deleted presets from settings (must be after DB init)
    console.log('[init] Loading deleted presets...');
    loadDeletedPresets();

    console.log('[init] Loading creators from DB...');
    creators = db.load();
    console.log('[init] Loaded', creators.length, 'creators');

    creators.forEach(migratePlatforms);
    creators.forEach(migrateDemographics);
    creators.forEach(migrateLocation);
    db.persist(creators);

    console.log('[init] Rendering UI...');
    renderRosterFilterPills();
    renderRosterTab();
    renderDispatchFilters();
    renderDispatchFilterPills();
    console.log('[init] Initializing map...');
    initMap();

    updateRecycleBinBadge();
    updateStorageIndicator();
    migratePhotos(); // compress any oversized legacy photos in the background
    console.log('[init] Done!');
  } catch (e) {
    console.error('App initialization failed:', e);
    showToast('Failed to load app data — check console', 'error');
    initMap(); // still show the map
  }
}

init().catch(e => console.error('Unhandled init error:', e));
