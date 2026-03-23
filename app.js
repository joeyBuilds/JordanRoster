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

// ── Tag Categories ──
// Comprehensive niche categories including all July import niches
const DEFAULT_NICHE_CATEGORIES = {
  'Content & Entertainment': ['Comedy', 'Music', 'Entertainment', 'Podcast', 'Education', 'True Crime'],
  'Lifestyle & Wellness': ['Lifestyle', 'Wellness', 'Mental Health', 'Fitness', 'Yoga', 'Running', 'Skincare', 'Beauty', 'Fashion'],
  'Food & Drink': ['Food', 'Cooking', 'Vegan'],
  'Travel & Adventure': ['Travel', 'Adventure', 'Outdoors', 'Camping', 'Hiking', 'Domestic Travel', 'International Travel', 'Tourism Board', 'Luxury Stays', 'Spas', 'Van Life'],
  'People & Relationships': ['Couple', 'Family', 'Parenthood', 'Relationship', 'Pets', 'BIPOC'],
  'Sports & Fitness': ['Sports', 'Athlete', 'Extreme Sports', 'Cycling', 'Fishing', 'Rafting'],
  'Home & DIY': ['Home', 'DIY', 'Productivity'],
  'Tech & Business': ['Tech', 'Entrepreneurship', 'Personal Finance', 'Artificial Intelligence (AI)'],
  'Creative': ['Photography', 'Art', 'Model', 'History']
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

// Deleted presets — persisted so preset demographics can be permanently removed
// Niches no longer have the preset/custom distinction, so only demographics need this
// Initialized in init() after database is ready
let deletedDemographics = [];

function loadDeletedPresets() {
  deletedDemographics = getSetting('deletedDemographics', []);
}

function saveDeletedPresets() {
  setSetting('deletedDemographics', deletedDemographics);
}

// Get all unique niches across the roster (no preset/custom distinction)
function getAllNiches() {
  const fromCreators = creators.flatMap(c => c.niches || []);
  const fromCategories = Object.values(loadTagCategories('niche')).flat();
  return [...new Set([...fromCategories, ...fromCreators])].sort((a, b) => a.localeCompare(b));
}

const PRESET_DEMOGRAPHICS = [
  'Bilingual/Multilingual', 'Body Positive', 'Disabled/Accessibility', 'Female',
  'Gen Z', 'Immigrant', 'Indigenous', 'LGBTQ+', 'Male', 'Neurodivergent',
  'Non-Binary', 'Over 40', 'Person of Color', 'Veteran'
];

function getAllDemographics() {
  const fromCategories = Object.values(loadTagCategories('demographic')).flat();
  const activePresets = PRESET_DEMOGRAPHICS.filter(d => !deletedDemographics.includes(d));
  const custom = creators.flatMap(c => (c.demographics || []).filter(d => !PRESET_DEMOGRAPHICS.includes(d)));
  return [...new Set([...fromCategories, ...activePresets, ...custom])].sort((a, b) => a.localeCompare(b));
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

// ── Category Icons for Icon Row Layout ──
const CATEGORY_ICONS = {
  'Content & Entertainment': '🎭',
  'Lifestyle & Wellness': '✨',
  'Food & Drink': '🍽',
  'Travel & Adventure': '🧭',
  'People & Relationships': '💛',
  'Sports & Fitness': '⚡',
  'Home & DIY': '🏠',
  'Tech & Business': '💻',
  'Creative': '🎨',
  'Gender & Identity': '👤',
  'Culture & Background': '🌍',
  'Age & Generation': '🕰',
  'Representation': '♿',
  'Other': '📌'
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

// NL search region filter — set by natural language parser, used by getFilteredCreators
let nlRegionFilter = null; // { label, bounds: [latMin, latMax, lngMin, lngMax] }

// rosterFilters removed — niches/demographics filtering is dispatch-only

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

function getEngagementRate(creator, platform) {
  if (creator.platforms && typeof creator.platforms === 'object' && creator.platforms[platform]) {
    return creator.platforms[platform].engagementRate || null;
  }
  return null;
}

function formatEngagementRate(rate) {
  if (rate === null || rate === undefined) return '';
  // Rate may come as decimal (0.032) or percentage (3.2)
  const pct = rate < 1 ? rate * 100 : rate;
  return pct.toFixed(1) + '%';
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

// ── Fuzzy Location Matching ──
// Common US cities for typo correction (covers major metros + common brand destinations)
const KNOWN_CITIES = [
  'Nashville','New York','Los Angeles','Chicago','Houston','Phoenix','Philadelphia',
  'San Antonio','San Diego','Dallas','San Jose','Austin','Jacksonville','Fort Worth',
  'Columbus','Charlotte','Indianapolis','San Francisco','Seattle','Denver','Washington',
  'Oklahoma City','Nashville','El Paso','Boston','Portland','Las Vegas','Memphis',
  'Louisville','Baltimore','Milwaukee','Albuquerque','Tucson','Fresno','Sacramento',
  'Mesa','Kansas City','Atlanta','Omaha','Colorado Springs','Raleigh','Long Beach',
  'Virginia Beach','Miami','Oakland','Minneapolis','Tampa','Tulsa','Arlington',
  'New Orleans','Wichita','Cleveland','Bakersfield','Aurora','Anaheim','Honolulu',
  'Santa Ana','Riverside','Corpus Christi','Lexington','Stockton','Pittsburgh',
  'Saint Paul','Anchorage','Cincinnati','Henderson','Greensboro','Plano','Newark',
  'Lincoln','Orlando','Irvine','Toledo','Jersey City','Chula Vista','Durham',
  'Laredo','Madison','Gilbert','Norfolk','Winston-Salem','Glendale','Hialeah',
  'Garland','Scottsdale','Irving','Chesapeake','North Las Vegas','Fremont',
  'Baton Rouge','Richmond','Boise','San Bernardino','Spokane','Des Moines',
  'Birmingham','Rochester','Tacoma','Fontana','Modesto','Moreno Valley','Fayetteville',
  'Salt Lake City','Savannah','Charleston','Asheville','Knoxville','Chattanooga',
  'McAllen','Santa Fe','Bend','Bozeman','Missoula','Sedona','Park City',
  'Scottsdale','Aspen','Jackson','Moab','Whitefish','Coeur d\'Alene',
];

// Levenshtein distance (edit distance)
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = a[i-1] === b[j-1]
        ? d[i-1][j-1]
        : 1 + Math.min(d[i-1][j], d[i][j-1], d[i-1][j-1]);
    }
  }
  return d[m][n];
}

// Find best fuzzy match from known cities
function fuzzyMatchCity(input) {
  if (!input || input.length < 3) return null;
  const q = input.toLowerCase().trim();
  let bestMatch = null;
  let bestDist = Infinity;
  // Max acceptable edit distance scales with input length
  const maxDist = Math.max(2, Math.floor(q.length * 0.4));

  for (const city of KNOWN_CITIES) {
    const cl = city.toLowerCase();
    // Quick skip if lengths are too different
    if (Math.abs(cl.length - q.length) > maxDist) continue;
    // Check if it starts similarly (first char match is a strong signal)
    const dist = levenshtein(q, cl);
    if (dist < bestDist && dist <= maxDist) {
      bestDist = dist;
      bestMatch = city;
    }
  }
  return bestMatch;
}

function debounceLocSearch(query, callback) {
  clearTimeout(locSearchTimeout);
  locSearchTimeout = setTimeout(async () => {
    // Try Nominatim first with raw query
    let results = await searchLocations(query);

    // If no results or very few, try fuzzy city correction
    if (results.length === 0 && query.length >= 3) {
      const corrected = fuzzyMatchCity(query);
      if (corrected && corrected.toLowerCase() !== query.toLowerCase()) {
        results = await searchLocations(corrected);
      }
    }

    callback(results);
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
let dispatchProximityRings = []; // Leaflet circle layers for distance rings
let dispatchProximityLabels = []; // Leaflet marker labels for ring distances
let dispatchLegend = null; // Map legend DOM element

// ===========================
// FILTERING & SORTING
// ===========================
function getFilteredCreators(searchTerm = '', sortBy = 'a-z', applyDispatchFilters = false) {
  let filtered = creators.slice();

  // Apply search filter (roster tab) — name, location, email, handles only
  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    filtered = filtered.filter(c => {
      const name = getFullName(c).toLowerCase();
      const location = (c.location || '').toLowerCase();
      const email = (c.email || '').toLowerCase();
      const handles = getCreatorPlatforms(c).map(p => getHandle(c, p)).filter(Boolean).join(' ').toLowerCase();
      return name.includes(term) || location.includes(term) || email.includes(term) || handles.includes(term);
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

    // Region bounding box filter (from NL search)
    if (nlRegionFilter && nlRegionFilter.bounds) {
      const [latMin, latMax, lngMin, lngMax] = nlRegionFilter.bounds;
      filtered = filtered.filter(c => {
        if (c.lat == null || c.lng == null) return false;
        return c.lat >= latMin && c.lat <= latMax && c.lng >= lngMin && c.lng <= lngMax;
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

  // ── Avatar ──
  const avatar = document.createElement('div');
  avatar.className = 'creator-avatar';
  if (creator.photo) {
    const img = document.createElement('img');
    img.src = creator.photo;
    avatar.appendChild(img);
  } else {
    avatar.textContent = getInitials(creator.firstName, creator.lastName);
  }

  // ── Avatar column ──
  const avatarCol = document.createElement('div');
  avatarCol.className = 'creator-avatar-col';
  avatarCol.appendChild(avatar);

  // ── Card body (Warm Dossier: name, location, platform meta line) ──
  const body = document.createElement('div');
  body.className = 'creator-info';

  // Name
  const name = document.createElement('div');
  name.className = 'creator-name';
  const creatorAge = getCreatorAge(creator);
  name.innerHTML = getFullName(creator) + (creatorAge !== null ? ` <span style="font-size:11px;opacity:0.5;font-weight:400">(${creatorAge})</span>` : '');
  body.appendChild(name);

  // Location
  const location = document.createElement('div');
  location.className = 'creator-location';
  location.textContent = creator.location ? '📍 ' + creator.location : '';
  body.appendChild(location);

  // Platform meta line — compact dots + follower counts
  const platforms = getCreatorPlatforms(creator).slice().sort((a, b) => {
    const ia = PLATFORMS.indexOf(a), ib = PLATFORMS.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  if (platforms.length > 0) {
    const metaLine = document.createElement('div');
    metaLine.className = 'creator-meta-line';
    platforms.forEach((p, idx) => {
      const chip = document.createElement('div');
      chip.className = 'creator-meta-chip';
      const dotClass = p === 'Instagram' ? 'ig' : p === 'TikTok' ? 'tt' : p === 'YouTube' ? 'yt' : '';
      const followers = getFollowers(creator, p);
      const followerText = followers !== null ? formatFollowers(followers) : p;
      const engRate = getEngagementRate(creator, p);
      const engText = engRate !== null ? ` <span class="eng-inline">&middot; ${formatEngagementRate(engRate)}</span>` : '';
      chip.innerHTML = `<span class="meta-dot ${dotClass}"></span>${followerText}${engText}`;
      metaLine.appendChild(chip);
    });
    body.appendChild(metaLine);
  }

  card.appendChild(avatarCol);
  card.appendChild(body);

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

  // Render all roster items at once (80 creators is trivial for the DOM)
  renderListIncrementally(list, filtered, (creator) => renderCreatorCard(creator), { divider: false, batchSize: Infinity });
}

// Score a single creator against current dispatch filters.
// Platform/tier filters narrow results but do NOT count toward the match score.
// Only niches, demographics, and age contribute to scoring.
// Returns { matchCount, totalFilters, pct, matchDetails, missedDetails }
function scoreCreatorFilters(creator) {
  const totalFilters = (dispatchFilters.platformTiers.length > 0 ? 1 : 0) +
                       dispatchFilters.niches.length +
                       dispatchFilters.demographics.length +
                       ((dispatchFilters.ageMin !== null || dispatchFilters.ageMax !== null) ? 1 : 0);
  let matchCount = 0;
  const matchDetails = [];
  const missedDetails = [];

  // Platform × Tier: counts as 1 criterion — pass if ANY combo matches
  if (dispatchFilters.platformTiers.length > 0) {
    const ptMatch = dispatchFilters.platformTiers.some(pt => {
      const platforms = getCreatorPlatforms(creator);
      if (!platforms.includes(pt.platform)) return false;
      const followers = getFollowers(creator, pt.platform);
      return tierFromFollowers(followers) === pt.tier;
    });
    if (ptMatch) {
      matchCount++;
      const labels = dispatchFilters.platformTiers.map(pt => `${pt.platform} ${TIER_SHORT[pt.tier] || pt.tier}`);
      matchDetails.push({ type: 'platform', label: labels.join(', ') });
    } else {
      const labels = dispatchFilters.platformTiers.map(pt => `${pt.platform} ${TIER_SHORT[pt.tier] || pt.tier}`);
      missedDetails.push({ type: 'platform', label: labels.join(', ') });
    }
  }

  if (dispatchFilters.niches.length > 0) {
    dispatchFilters.niches.forEach(n => {
      if ((creator.niches || []).includes(n)) {
        matchCount++;
        matchDetails.push({ type: 'niche', label: n });
      } else {
        missedDetails.push({ type: 'niche', label: n });
      }
    });
  }
  if (dispatchFilters.demographics.length > 0) {
    dispatchFilters.demographics.forEach(d => {
      if ((creator.demographics || []).includes(d)) {
        matchCount++;
        matchDetails.push({ type: 'demographic', label: d });
      } else {
        missedDetails.push({ type: 'demographic', label: d });
      }
    });
  }
  if (dispatchFilters.ageMin !== null || dispatchFilters.ageMax !== null) {
    const age = getCreatorAge(creator);
    if (age !== null) {
      matchCount++;
      matchDetails.push({ type: 'age', label: `Age ${age}` });
    } else {
      missedDetails.push({ type: 'age', label: 'Age' });
    }
  }

  const pct = totalFilters > 0 ? matchCount / totalFilters : 0;
  return { matchCount, totalFilters, pct, matchDetails, missedDetails };
}

function renderDispatchTab() {
  const sortBy = document.getElementById('sortSelect').value;
  const filtered = getFilteredCreators('', sortBy, true);

  // Check if any filters are active
  const hasFilters = dispatchFilters.platformTiers.length > 0 ||
                     dispatchFilters.niches.length > 0 ||
                     dispatchFilters.demographics.length > 0 ||
                     dispatchFilters.ageMin !== null ||
                     dispatchFilters.ageMax !== null ||
                     nlRegionFilter !== null;

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
    // ── Score each creator by individual filter matches (using shared scorer) ──
    const scored = filtered.map(creator => {
      const score = scoreCreatorFilters(creator);
      return { creator, ...score };
    });

    // Sort: best matches first, then alphabetically within same score
    scored.sort((a, b) => {
      if (b.pct !== a.pct) return b.pct - a.pct;
      return getFullName(a.creator).localeCompare(getFullName(b.creator));
    });

    scored.forEach((entry, i) => {
      const { creator, matchCount, totalFilters, pct, matchDetails, missedDetails } = entry;

      // Spacer between cards (no bloom — blooms reserved for section dividers)
      if (i > 0) {
        const spacer = document.createElement('div');
        spacer.style.height = '6px';
        spacer.style.flexShrink = '0';
        matchBody.appendChild(spacer);
      }

      const card = renderCreatorCard(creator);

      // ── Score level for color wash ──
      let scoreLevel = 'low';
      if (pct >= 1.0) scoreLevel = 'full';
      else if (pct >= 0.66) scoreLevel = 'most';
      else if (pct >= 0.34) scoreLevel = 'half';
      card.setAttribute('data-score', scoreLevel);

      // ── Stagger transition delay based on card index ──
      card.classList.add('dispatch-stagger-card');
      card.style.transitionDelay = (i * 0.04) + 's';

      // ── Segmented pip gauge under avatar ──
      const avatarCol = card.querySelector('.creator-avatar-col');
      if (avatarCol && totalFilters > 0) {
        const pipGauge = document.createElement('div');
        pipGauge.className = 'card-pip-gauge';
        for (let p = 0; p < totalFilters; p++) {
          const seg = document.createElement('div');
          seg.className = 'card-pip-seg' + (p < matchCount ? ' filled' : '');
          pipGauge.appendChild(seg);
        }
        avatarCol.appendChild(pipGauge);

        // Stagger pip appearance after card
        setTimeout(() => pipGauge.classList.add('visible'), 150 + i * 40);
      }

      // ── Score fraction in top-right corner ──
      if (totalFilters > 0) {
        const fraction = document.createElement('div');
        fraction.className = 'card-score-fraction';
        fraction.textContent = `${matchCount}/${totalFilters}`;
        card.appendChild(fraction);

        // Stagger fraction appearance after pips
        setTimeout(() => fraction.classList.add('visible'), 250 + i * 40);
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
          if (!_dispatchSections.platformTier) toggleDispatchSection('platformTier');
        }
        renderDispatchFilters();
        renderDispatchTab();
        updateMapMarkers();
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
    };
    pillsContainer.appendChild(pill);
  });

  // Update Platform & Tier active count badge
  const ptCountEl = document.getElementById('platformTierActiveCount');
  if (ptCountEl) {
    const n = dispatchFilters.platformTiers.length;
    ptCountEl.textContent = n;
    ptCountEl.classList.toggle('visible', n > 0);
  }

  // Combined niche + demographics — pill clump selected row
  renderDispatchFilterPills();
}

/* ═══ Dispatch Filter Pills — Typeahead + Visible Category Lanes ═══ */
let _vibeSearchTerm = '';

function clearVibesFilters() {
  dispatchFilters.niches = [];
  dispatchFilters.demographics = [];
  _vibeSearchTerm = '';
  const nlInput = document.getElementById('nlSearchInput');
  if (nlInput) nlInput.value = '';
  renderDispatchFilterPills();
  renderDispatchTab();
  updateMapMarkers();
  renderDispatchActiveStrip();
}

// ── Collapsible Niche / Demographic sections ──
const _dispatchSections = { niches: false, demos: false, platformTier: false, age: false }; // collapsed by default

function toggleDispatchSection(section) {
  _dispatchSections[section] = !_dispatchSections[section];
  const body = document.getElementById(section + 'Collapsible');
  const caret = document.getElementById(section + 'Caret');
  const label = document.getElementById(section + 'Label');
  if (body) body.classList.toggle('open', _dispatchSections[section]);
  if (caret) caret.classList.toggle('open', _dispatchSections[section]);
  if (label) label.classList.toggle('expanded', _dispatchSections[section]);
}

function renderDispatchFilterPills() {
  const nicheContainer = document.getElementById('dispatchNichePills');
  const demoContainer = document.getElementById('dispatchDemoPills');
  const ageContainer = document.getElementById('dispatchAgeRow');
  if (!nicheContainer || !demoContainer) return;

  const nicheCategories = loadTagCategories('niche');
  const demoCategories = loadTagCategories('demographic');
  const allNiches = getAllNiches();
  const allDemos = getAllDemographics();
  const q = _vibeSearchTerm.toLowerCase();

  function clearVibeSearch() {
    _vibeSearchTerm = '';
    const nlInput = document.getElementById('nlSearchInput');
    if (nlInput) {
      nlInput.value = '';
      setTimeout(() => nlInput.focus(), 0);
    }
  }
  function onToggleNiche(n) {
    const idx = dispatchFilters.niches.indexOf(n);
    if (idx >= 0) dispatchFilters.niches.splice(idx, 1);
    else { dispatchFilters.niches.push(n); if (!_dispatchSections.niches) toggleDispatchSection('niches'); }
    clearVibeSearch();
    renderDispatchFilterPills();
    renderDispatchTab();
    updateMapMarkers();
  }
  function onToggleDemo(d) {
    const idx = dispatchFilters.demographics.indexOf(d);
    if (idx >= 0) dispatchFilters.demographics.splice(idx, 1);
    else { dispatchFilters.demographics.push(d); if (!_dispatchSections.demos) toggleDispatchSection('demos'); }
    clearVibeSearch();
    renderDispatchFilterPills();
    renderDispatchTab();
    updateMapMarkers();
  }

  // ── Render icon-row category lanes (always visible, typeahead filters) ──
  function renderLanes(container, items, categories, type, selectedArr, onToggle) {
    container.innerHTML = '';
    const placed = new Set();
    let anyVisible = false;

    Object.entries(categories).forEach(([catName, catItems]) => {
      const catVisible = catItems.filter(item => items.includes(item));
      if (catVisible.length === 0) return;

      // Filter by typeahead
      const filtered = q ? catVisible.filter(item => item.toLowerCase().includes(q)) : catVisible;
      // Mark all as placed regardless of search (to handle uncategorized correctly)
      catVisible.forEach(item => placed.add(item));
      if (filtered.length === 0) return;
      anyVisible = true;

      const group = document.createElement('div');
      group.className = `icon-row-group icon-row-${type}`;

      const header = document.createElement('div');
      header.className = 'icon-row-header';
      const icon = CATEGORY_ICONS[catName] || '📌';
      header.innerHTML = `<div class="icon-row-icon">${icon}</div><h4>${catName}</h4><span class="icon-row-count">${filtered.length}</span>`;
      group.appendChild(header);

      const pills = document.createElement('div');
      pills.className = 'dispatch-lane-pills icon-row-pills';
      filtered.forEach(item => {
        const pill = document.createElement('button');
        const isActive = selectedArr.includes(item);
        pill.className = 'dispatch-pill' + (isActive ? ` active ${type}` : '');
        pill.textContent = item;
        pill.addEventListener('click', () => onToggle(item));
        pills.appendChild(pill);
      });
      group.appendChild(pills);
      container.appendChild(group);
    });

    // Uncategorized
    const uncat = items.filter(i => !placed.has(i));
    const filteredUncat = q ? uncat.filter(i => i.toLowerCase().includes(q)) : uncat;
    if (filteredUncat.length > 0) {
      anyVisible = true;
      const group = document.createElement('div');
      group.className = `icon-row-group icon-row-${type}`;

      const header = document.createElement('div');
      header.className = 'icon-row-header';
      const icon = CATEGORY_ICONS['Other'] || '📌';
      header.innerHTML = `<div class="icon-row-icon">${icon}</div><h4>Other</h4><span class="icon-row-count">${filteredUncat.length}</span>`;
      group.appendChild(header);

      const pills = document.createElement('div');
      pills.className = 'dispatch-lane-pills icon-row-pills';
      filteredUncat.forEach(item => {
        const pill = document.createElement('button');
        const isActive = selectedArr.includes(item);
        pill.className = 'dispatch-pill' + (isActive ? ` active ${type}` : '');
        pill.textContent = item;
        pill.addEventListener('click', () => onToggle(item));
        pills.appendChild(pill);
      });
      group.appendChild(pills);
      container.appendChild(group);
    }

    return anyVisible;
  }

  const nichesVisible = renderLanes(nicheContainer, allNiches, nicheCategories, 'niche', dispatchFilters.niches, onToggleNiche);
  const demosVisible = renderLanes(demoContainer, allDemos, demoCategories, 'demographic', dispatchFilters.demographics, onToggleDemo);

  // Show/hide section labels based on search results
  const nichesLabel = document.getElementById('nichesLabel');
  const demosLabel = document.getElementById('demosLabel');
  if (nichesLabel) nichesLabel.style.display = nichesVisible ? '' : 'none';
  if (demosLabel) demosLabel.style.display = demosVisible ? '' : 'none';

  // Show "no results" if typeahead matches nothing
  if (q && !nichesVisible && !demosVisible) {
    nicheContainer.innerHTML = `<div class="dispatch-no-results">No niches or demographics matching "${_vibeSearchTerm}"</div>`;
  }

  // ── Age range ──
  if (ageContainer) {
    ageContainer.innerHTML = `<input type="number" id="dispatchAgeMin" placeholder="Min" min="0" max="120" value="${dispatchFilters.ageMin ?? ''}"><span class="age-sep">–</span><input type="number" id="dispatchAgeMax" placeholder="Max" min="0" max="120" value="${dispatchFilters.ageMax ?? ''}">`;
    ageContainer.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('input', () => {
        dispatchFilters.ageMin = document.getElementById('dispatchAgeMin').value ? parseInt(document.getElementById('dispatchAgeMin').value) : null;
        dispatchFilters.ageMax = document.getElementById('dispatchAgeMax').value ? parseInt(document.getElementById('dispatchAgeMax').value) : null;
        renderDispatchActiveStrip();
        renderDispatchTab();
        updateMapMarkers();
        const activeId = inp.id;
        setTimeout(() => { const el = document.getElementById(activeId); if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; } }, 0);
      });
      inp.addEventListener('mousedown', (e) => e.stopPropagation());
    });
  }

  // ── Active count badges ──
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

  // Platform & Tier active count
  const ptCount = document.getElementById('platformTierActiveCount');
  if (ptCount) {
    const n = dispatchFilters.platformTiers.length;
    ptCount.textContent = n;
    ptCount.classList.toggle('visible', n > 0);
  }

  // ── Active filters strip ──
  renderDispatchActiveStrip();
}

/* ═══ Active Filters Strip — collected badges at top ═══ */
function renderDispatchActiveStrip() {
  const strip = document.getElementById('dispatchActiveStrip');
  if (!strip) return;

  const existingKeys = new Set([...strip.children].map(el => el.dataset.key));
  const neededKeys = new Set();

  function addBadge(key, label, type, onRemove) {
    neededKeys.add(key);
    if (existingKeys.has(key)) return;
    const badge = document.createElement('span');
    badge.className = `dispatch-active-badge ${type}`;
    badge.dataset.key = key;
    badge.innerHTML = `${label} <span class="badge-x">×</span>`;
    badge.querySelector('.badge-x').addEventListener('click', (e) => {
      e.stopPropagation();
      onRemove();
    });
    strip.appendChild(badge);
  }

  // Location — not shown as a filter badge; destination is a map reference point, not a filter.
  // It has its own clear button (×) in the Where? input field.

  // Platform × Tier — rendered as styled pills in #platformTierPills instead

  // Niches
  dispatchFilters.niches.forEach(n => {
    addBadge('n-' + n, n, 'niche', () => {
      dispatchFilters.niches = dispatchFilters.niches.filter(x => x !== n);
      renderDispatchFilterPills();
      renderDispatchTab();
      updateMapMarkers();
    });
  });

  // Demographics
  dispatchFilters.demographics.forEach(d => {
    addBadge('d-' + d, d, 'demographic', () => {
      dispatchFilters.demographics = dispatchFilters.demographics.filter(x => x !== d);
      renderDispatchFilterPills();
      renderDispatchTab();
      updateMapMarkers();
    });
  });

  // Age
  if (dispatchFilters.ageMin !== null || dispatchFilters.ageMax !== null) {
    const ageLabel = `Age ${dispatchFilters.ageMin ?? '?'}–${dispatchFilters.ageMax ?? '?'}`;
    addBadge('age', ageLabel, 'age', () => {
      dispatchFilters.ageMin = null;
      dispatchFilters.ageMax = null;
      renderDispatchFilterPills();
      renderDispatchTab();
      updateMapMarkers();
    });
  }

  // Region (from NL search)
  if (nlRegionFilter) {
    addBadge('region', '🗺️ ' + nlRegionFilter.label, 'location', () => {
      nlRegionFilter = null;
      renderDispatchTab();
      updateMapMarkers();
      renderDispatchActiveStrip();
    });
  }

  // Remove stale badges
  [...strip.children].forEach(el => {
    if (!neededKeys.has(el.dataset.key)) {
      el.style.animation = 'none';
      el.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
      el.style.transform = 'scale(0.5)';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 200);
    }
  });
}


/* ═══ Standalone Category Organizer — drag-and-drop from Dispatch ═══ */
function openCategoryOrganizer(type) {
  // Remove any existing organizer
  document.querySelector('.cat-organizer-overlay')?.remove();

  const presets = type === 'niche'
    ? Object.values(DEFAULT_NICHE_CATEGORIES).flat()
    : PRESET_DEMOGRAPHICS;
  const getAllItems = type === 'niche' ? getAllNiches : getAllDemographics;
  const categories = loadTagCategories(type);
  let dragItem = null;
  let deleteMode = false;
  let deleteMarked = new Set();

  // Build overlay
  const overlay = document.createElement('div');
  overlay.className = 'tag-panel-overlay cat-organizer-overlay open';

  const panel = document.createElement('div');
  panel.className = 'tag-panel';

  // Header
  const header = document.createElement('div');
  header.className = 'tag-panel-header';
  const title = document.createElement('span');
  title.className = 'tag-panel-title';
  title.textContent = type === 'niche' ? 'Organize Niches' : 'Organize Demographics';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'tag-panel-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.onclick = () => overlay.remove();
  header.appendChild(title);
  header.appendChild(closeBtn);

  // Search row
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

  // Grid
  const grid = document.createElement('div');
  grid.className = 'tag-panel-grid';

  // Add custom row
  const addRow = document.createElement('div');
  addRow.className = 'tag-panel-add-row';

  // Footer
  const footer = document.createElement('div');
  footer.className = 'tag-panel-footer';
  const deleteToggle = document.createElement('button');
  deleteToggle.className = 'tag-panel-delete-toggle';
  deleteToggle.innerHTML = '🗑 Manage';
  deleteToggle.type = 'button';
  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'tag-panel-confirm';
  confirmBtn.textContent = 'Done';

  footer.appendChild(deleteToggle);
  footer.appendChild(confirmBtn);

  function exitDeleteMode() {
    deleteMode = false;
    deleteMarked.clear();
    deleteToggle.classList.remove('active');
    deleteToggle.innerHTML = '🗑 Manage';
    confirmBtn.textContent = 'Done';
    confirmBtn.classList.remove('delete-action');
    grid.classList.remove('delete-mode');
    renderGrid();
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

  confirmBtn.onclick = () => {
    if (deleteMode) {
      if (deleteMarked.size === 0) { exitDeleteMode(); return; }
      const items = [...deleteMarked];
      if (confirm(`Delete ${items.map(n => '"' + n + '"').join(', ')}? This removes from all creators permanently.`)) {
        items.forEach(item => {
          creators.forEach(c => {
            if (type === 'niche' && c.niches) c.niches = c.niches.filter(n => n !== item);
            if (type === 'demographic' && c.demographics) c.demographics = c.demographics.filter(d => d !== item);
          });
          Object.values(categories).forEach(arr => {
            const idx = arr.indexOf(item);
            if (idx >= 0) arr.splice(idx, 1);
          });
        });
        saveTagCategories(type, categories);
        db.persist(creators);
        exitDeleteMode();
      }
    } else {
      overlay.remove();
      renderDispatchFilterPills();
    }
  };

  function makePill(item) {
    const pill = document.createElement('div');
    const isCustom = !presets.includes(item);
    let cls = `tag-panel-pill ${type}`;
    if (deleteMode && deleteMarked.has(item)) cls += ' marked-delete';
    if (isCustom) cls += ' custom';
    pill.className = cls;
    pill.textContent = item;
    pill.draggable = !deleteMode;

    pill.addEventListener('dragstart', (e) => {
      dragItem = item;
      pill.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    pill.addEventListener('dragend', () => {
      pill.classList.remove('dragging');
      dragItem = null;
      grid.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });

    if (deleteMode) {
      pill.onclick = () => {
        if (deleteMarked.has(item)) deleteMarked.delete(item);
        else deleteMarked.add(item);
        renderGrid();
      };
    }
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
            saveTagCategories(type, categories);
          }
          renderGrid();
        };
        input.addEventListener('blur', commitRename);
        input.addEventListener('keydown', (ke) => {
          if (ke.key === 'Enter') { ke.preventDefault(); input.blur(); }
          if (ke.key === 'Escape') renderGrid();
        });
        labelText.replaceWith(input);
        editBtn.style.display = 'none';
        input.focus();
        input.select();
      };
      labelText.appendChild(editBtn);

      const defaults = type === 'niche' ? DEFAULT_NICHE_CATEGORIES : DEFAULT_DEMO_CATEGORIES;
      if (deleteMode && !defaults[catName]) {
        const delCatBtn = document.createElement('button');
        delCatBtn.className = 'tag-category-delete-btn';
        delCatBtn.innerHTML = '×';
        delCatBtn.type = 'button';
        delCatBtn.title = 'Delete category';
        delCatBtn.onclick = (e) => {
          e.stopPropagation();
          if (confirm(`Delete category "${catName}"? Tags move to Custom.`)) {
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
      if (!pillsWrap.contains(e.relatedTarget)) pillsWrap.classList.remove('drag-over');
    });
    pillsWrap.addEventListener('drop', (e) => {
      e.preventDefault();
      pillsWrap.classList.remove('drag-over');
      if (!dragItem) return;
      Object.values(categories).forEach(arr => {
        const idx = arr.indexOf(dragItem);
        if (idx >= 0) arr.splice(idx, 1);
      });
      if (catName && categories[catName]) categories[catName].push(dragItem);
      saveTagCategories(type, categories);
      renderGrid();
    });
  }

  function renderGrid() {
    const filter = search.value.toLowerCase();
    grid.innerHTML = '';
    const allItems = getAllItems().sort((a, b) => a.localeCompare(b));
    const filtered = filter ? allItems.filter(n => n.toLowerCase().includes(filter)) : allItems;

    if (filter) {
      grid.classList.add('flat-mode');
      filtered.forEach(item => grid.appendChild(makePill(item)));
    } else {
      grid.classList.remove('flat-mode');
      const placed = new Set();
      Object.entries(categories).forEach(([catName, catItems]) => {
        const itemsInCat = filtered.filter(item => catItems.includes(item));
        const group = document.createElement('div');
        group.className = 'tag-category-group';
        if (itemsInCat.length === 0) group.classList.add('empty-drop-target');
        group.appendChild(makeCategoryLabel(catName, false));
        const pillsWrap = document.createElement('div');
        pillsWrap.className = 'tag-category-pills';
        pillsWrap.dataset.category = catName;
        setupDropZone(pillsWrap, catName);
        itemsInCat.forEach(item => { pillsWrap.appendChild(makePill(item)); placed.add(item); });
        group.appendChild(pillsWrap);
        grid.appendChild(group);
      });
      const uncategorized = filtered.filter(item => !placed.has(item));
      if (uncategorized.length > 0) {
        const group = document.createElement('div');
        group.className = 'tag-category-group';
        group.appendChild(makeCategoryLabel('Custom', true));
        const pillsWrap = document.createElement('div');
        pillsWrap.className = 'tag-category-pills';
        setupDropZone(pillsWrap, null);
        uncategorized.forEach(item => pillsWrap.appendChild(makePill(item)));
        group.appendChild(pillsWrap);
        grid.appendChild(group);
      }
    }

    if (!deleteMode && filter && !allItems.some(n => n.toLowerCase() === filter)) {
      addRow.innerHTML = `+ Add "${search.value.trim()}"`;
      addRow.classList.add('visible');
    } else {
      addRow.classList.remove('visible');
    }
  }

  addRow.onclick = () => {
    const val = search.value.trim();
    if (!val) return;
    // Add to uncategorized
    const allItems = getAllItems();
    if (!allItems.includes(val)) {
      // It's new — just add it to the custom pool
    }
    search.value = '';
    renderGrid();
  };

  search.oninput = () => renderGrid();

  // Assemble panel
  panel.appendChild(header);
  panel.appendChild(searchRow);
  panel.appendChild(grid);
  panel.appendChild(addRow);
  panel.appendChild(footer);
  overlay.appendChild(panel);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);

  renderGrid();
  setTimeout(() => search.focus(), 50);
}

let markerClusterGroup = null;

function updateMapMarkers() {
  // Remove all existing markers
  if (markerClusterGroup) {
    markerClusterGroup.clearLayers();
  } else {
    // Simple layer group — all creator faces always visible, no clustering
    markerClusterGroup = L.layerGroup();
    map.addLayer(markerClusterGroup);
  }
  markers = {};

  // Show ALL creators on the map — dispatch scoring controls visual emphasis, not filtering
  const sortBy = document.getElementById('sortSelect').value;
  const creatorsToShow = getFilteredCreators('', sortBy, false);

  // Check if dispatch filters are active for scoring
  const hasDispatchFilters = dispatchFilters.platformTiers.length > 0 ||
                             dispatchFilters.niches.length > 0 ||
                             dispatchFilters.demographics.length > 0 ||
                             dispatchFilters.ageMin !== null ||
                             dispatchFilters.ageMax !== null;
  const isDispatch = document.body.classList.contains('dispatch-mode');

  const newMarkers = [];

  creatorsToShow.forEach((creator, idx) => {
    if (creator.lat && creator.lng) {
      // Score this creator if in dispatch mode
      let scoreLevel = '';
      let scoreText = '';
      let scorePct = 0;
      if (isDispatch && hasDispatchFilters) {
        const score = scoreCreatorFilters(creator);
        scorePct = score.pct;
        scoreText = `${score.matchCount}/${score.totalFilters}`;
        if (score.pct >= 1.0) scoreLevel = 'full';
        else if (score.pct >= 0.66) scoreLevel = 'most';
        else if (score.pct >= 0.34) scoreLevel = 'half';
        else scoreLevel = 'low';
      }

      // Build score ring SVG if in dispatch mode
      const scoreRingHtml = (isDispatch && hasDispatchFilters) ? `
        <svg class="marker-score-ring" viewBox="0 0 54 54">
          <circle class="marker-score-track" cx="27" cy="27" r="24"/>
          <circle class="marker-score-fill score-${scoreLevel}" cx="27" cy="27" r="24" transform="rotate(-90 27 27)"/>
        </svg>
        <div class="marker-score-badge score-${scoreLevel}">${scoreText}</div>
      ` : '';

      const iconHtml = `
        <div class="marker-inner">
          ${scoreRingHtml}
          <div class="marker-avatar-wrap">
            <div class="marker-glow"></div>
            <div class="marker-avatar">
              ${creator.photo ? `<img src="${creator.photo}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="marker-initials" style="display:none">${getInitials(creator.firstName, creator.lastName)}</span>` : `<span class="marker-initials">${getInitials(creator.firstName, creator.lastName)}</span>`}
            </div>
          </div>
          <div class="marker-label">${creator.firstName || getFullName(creator).split(' ')[0]}</div>
        </div>
      `;

      const markerClassName = 'creator-marker' + (isDispatch && hasDispatchFilters && scoreLevel === 'low' ? ' dispatch-faded' : '');

      const icon = L.divIcon({
        html: iconHtml,
        className: markerClassName,
        iconSize: [56, 72],
        iconAnchor: [28, 28]
      });

      const marker = L.marker([creator.lat, creator.lng], { icon });

      // Hover tooltip — shows creator name + score in dispatch mode
      const tooltipText = (isDispatch && hasDispatchFilters) ?
        `${getFullName(creator)} (${scoreText})` :
        getFullName(creator);
      marker.bindTooltip(tooltipText, {
        direction: 'top',
        offset: [0, -30],
        className: 'creator-tooltip',
        opacity: 1
      });

      // Click marker → open profile directly (no popup)
      marker.on('click', () => {
        showDetailPanel(creator.id);
      });

      // Stagger score ring + badge visibility after markers render
      if (isDispatch && hasDispatchFilters) {
        marker.once('add', () => {
          const el = marker.getElement();
          if (el) {
            setTimeout(() => {
              const ring = el.querySelector('.marker-score-ring');
              const badge = el.querySelector('.marker-score-badge');
              if (ring) ring.classList.add('visible');
              if (badge) badge.classList.add('visible');
            }, 100 + idx * 30);
          }
        });
      }

      markers[creator.id] = marker;
      newMarkers.push(marker);
    }
  });

  // Add all markers to layer group
  newMarkers.forEach(m => markerClusterGroup.addLayer(m));

  // Arrange overlapping markers into ring formations
  _arrangeMarkerRings();

  // Show/hide map legend based on dispatch scoring state
  if (isDispatch && hasDispatchFilters) {
    _showMapLegend();
  } else {
    _hideMapLegend();
  }
}

// ===========================
// ROSTER SEARCH → MAP PIN FADING
// ===========================
// Lightweight: toggles a CSS class on existing marker elements without rebuilding them.
function updateRosterMarkerFading() {
  const isDispatch = document.body.classList.contains('dispatch-mode');
  if (isDispatch) return; // dispatch has its own scoring system

  const searchTerm = (document.getElementById('searchInput').value || '').trim();

  if (!searchTerm) {
    // No search — remove fading from all markers
    Object.keys(markers).forEach(id => {
      const el = markers[id].getElement();
      if (el) el.classList.remove('roster-faded');
    });
    return;
  }

  // Get the set of creator IDs that match the search
  const sortBy = document.getElementById('sortSelect').value;
  const matched = getFilteredCreators(searchTerm, sortBy, false);
  const matchedIds = new Set(matched.map(c => c.id));

  Object.keys(markers).forEach(id => {
    const el = markers[id].getElement();
    if (!el) return;
    if (matchedIds.has(id)) {
      el.classList.remove('roster-faded');
    } else {
      el.classList.add('roster-faded');
    }
  });
}

// ===========================
// RING FORMATION — Fan overlapping markers into circles
// ===========================
let _ringFormations = []; // track offset markers for cleanup

function _arrangeMarkerRings() {
  // Reset any previous CSS offsets
  _ringFormations.forEach(info => {
    const el = info.marker.getElement();
    if (el) {
      const inner = el.querySelector('.marker-inner');
      if (inner) inner.style.transform = '';
    }
  });
  _ringFormations = [];

  const zoom = map.getZoom();
  const entries = [];
  for (const id in markers) {
    const m = markers[id];
    const ll = m.getLatLng();
    const px = map.latLngToLayerPoint(ll);
    entries.push({ id, marker: m, latLng: ll, px, grouped: false });
  }

  // Threshold: how close (in pixels) markers need to be to form a ring
  // Scales with zoom — tighter at high zoom, wider at low zoom
  const threshold = Math.max(30, 60 - (zoom - 4) * 4);

  // Find groups of overlapping markers
  const groups = [];
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].grouped) continue;
    const group = [entries[i]];
    entries[i].grouped = true;

    for (let j = i + 1; j < entries.length; j++) {
      if (entries[j].grouped) continue;
      const dx = entries[i].px.x - entries[j].px.x;
      const dy = entries[i].px.y - entries[j].px.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < threshold) {
        group.push(entries[j]);
        entries[j].grouped = true;
      }
    }

    if (group.length > 1) {
      groups.push(group);
    }
  }

  // For each group, arrange markers in a ring using CSS transforms (not lat/lng changes)
  // This prevents geographic displacement at any zoom level
  groups.forEach(group => {
    // Calculate centroid in pixel space
    let cx = 0, cy = 0;
    group.forEach(e => { cx += e.px.x; cy += e.px.y; });
    cx /= group.length;
    cy /= group.length;

    // Ring radius scales with group size — enough room for avatar circles
    const markerSize = 28 * (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--marker-scale')) || 1);
    const ringRadius = Math.max(markerSize + 4, group.length * (markerSize * 0.55));

    // Place each marker around the ring via CSS transform on inner element
    group.forEach((entry, i) => {
      const angle = (2 * Math.PI * i / group.length) - Math.PI / 2; // start from top
      const offsetX = Math.cos(angle) * ringRadius - (entry.px.x - cx);
      const offsetY = Math.sin(angle) * ringRadius - (entry.px.y - cy);

      _ringFormations.push({ marker: entry.marker });

      const el = entry.marker.getElement();
      if (el) {
        const inner = el.querySelector('.marker-inner');
        if (inner) {
          inner.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
        }
      }
    });
  });
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

  // No map zoom — just render the ring right where the pin is
  renderRing(creator);
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
    // Use the marker's current position (may be offset in a ring formation)
    const marker = markers[creator.id];
    const markerLatLng = marker ? marker.getLatLng() : L.latLng(creator.lat, creator.lng);
    const point = map.latLngToContainerPoint(markerLatLng);
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
      const engRate = getEngagementRate(creator, p);
      if (engRate !== null) {
        const engLine = document.createElement('span');
        engLine.className = 'ring-chip-engagement';
        engLine.textContent = formatEngagementRate(engRate) + ' eng';
        textWrap.appendChild(engLine);
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


  // --- Row 2: Avatar with close button + dispatch score ring ---
  const avatarWrap = document.createElement('div');
  avatarWrap.className = 'ring-avatar-wrap';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'ring-close-btn';
  closeBtn.innerHTML = '&times;';
  closeBtn.onclick = (e) => { e.stopPropagation(); closeDetailPanel(); };
  avatarWrap.appendChild(closeBtn);

  // Check if dispatch scoring should be shown
  const ringHasDispatch = document.body.classList.contains('dispatch-mode') && (
    dispatchFilters.platformTiers.length > 0 ||
    dispatchFilters.niches.length > 0 ||
    dispatchFilters.demographics.length > 0 ||
    dispatchFilters.ageMin !== null ||
    dispatchFilters.ageMax !== null
  );
  let ringScore = null;
  let ringScoreLevel = '';
  if (ringHasDispatch) {
    ringScore = scoreCreatorFilters(creator);
    if (ringScore.pct >= 1.0) ringScoreLevel = 'full';
    else if (ringScore.pct >= 0.66) ringScoreLevel = 'most';
    else if (ringScore.pct >= 0.34) ringScoreLevel = 'half';
    else ringScoreLevel = 'low';
  }

  const avatar = document.createElement('div');
  avatar.className = 'ring-avatar';
  if (creator.photo) {
    avatar.innerHTML = `<img src="${creator.photo}">`;
  } else {
    avatar.textContent = getInitials(creator.firstName, creator.lastName);
  }

  // Score ring SVG around avatar (dispatch only)
  if (ringHasDispatch && ringScore) {
    const scoreRingSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    scoreRingSvg.setAttribute('class', 'ring-score-ring');
    scoreRingSvg.setAttribute('viewBox', '0 0 106 106');
    const circumference = 2 * Math.PI * 47;
    const offset = circumference * (1 - ringScore.pct);
    const strokeColor = ringScoreLevel === 'half' ? 'var(--warning)' : (ringScoreLevel === 'low' ? 'var(--mocha)' : 'var(--success)');
    scoreRingSvg.innerHTML = `
      <circle cx="53" cy="53" r="47" fill="none" stroke="rgba(200,190,180,0.15)" stroke-width="3"/>
      <circle cx="53" cy="53" r="47" fill="none" stroke="${strokeColor}" stroke-width="3" stroke-linecap="round"
        stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
        transform="rotate(-90 53 53)" style="filter:drop-shadow(0 0 4px rgba(142,174,139,0.4));transition:stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1) 0.3s;"/>
    `;
    avatarWrap.appendChild(scoreRingSvg);

    // Score badge
    const scoreBadge = document.createElement('div');
    scoreBadge.className = 'ring-dispatch-badge';
    scoreBadge.textContent = `${ringScore.matchCount}/${ringScore.totalFilters}`;
    scoreBadge.style.background = strokeColor;
    avatarWrap.appendChild(scoreBadge);

    // Stagger in the score elements
    setTimeout(() => {
      scoreRingSvg.classList.add('visible');
      scoreBadge.classList.add('visible');
    }, 200);
  }

  avatarWrap.appendChild(avatar);
  ringColumn.appendChild(avatarWrap);

  // Dispatch pip gauge + distance (between avatar and info card)
  if (ringHasDispatch && ringScore && ringScore.totalFilters > 0) {
    const ringPipGauge = document.createElement('div');
    ringPipGauge.className = 'ring-pip-gauge';
    for (let p = 0; p < ringScore.totalFilters; p++) {
      const seg = document.createElement('div');
      const isFilled = p < ringScore.matchCount;
      const isAmber = ringScoreLevel === 'half' || ringScoreLevel === 'low';
      seg.className = 'ring-pip-seg' + (isFilled ? ' filled' + (isAmber ? ' amber' : '') : '');
      ringPipGauge.appendChild(seg);
    }
    ringColumn.appendChild(ringPipGauge);
    setTimeout(() => ringPipGauge.classList.add('visible'), 300);

    // Distance from dispatch destination
    if (dispatchDestination && creator.lat && creator.lng) {
      const dist = haversineDistance(creator.lat, creator.lng, dispatchDestination.lat, dispatchDestination.lng);
      const distEl = document.createElement('div');
      distEl.className = 'ring-dispatch-distance';
      distEl.textContent = `~${Math.round(dist)} mi from ${dispatchDestination.displayName || 'destination'}`;
      ringColumn.appendChild(distEl);
      setTimeout(() => distEl.classList.add('visible'), 400);
    }
  }

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
  locDiv.textContent = '📍 ' + (creator.location || 'No location');
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
    const sortedNiches = [...creator.niches].sort((a, b) => a.localeCompare(b));
    const many = sortedNiches.length > 7;
    nicheCol.className = 'ring-side-col ring-side-col-left' + (many ? ' ring-side-col-dense' : '');
    sortedNiches.forEach((niche, i) => {
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
      }, 100 + i * 30);
    });
    infoSection.appendChild(nicheCol);
  }

  // Right column: Demographics (absolutely positioned, top-aligned with contact card)
  if (hasDemographics) {
    const demoCol = document.createElement('div');
    const sortedDemos = [...creator.demographics].sort((a, b) => a.localeCompare(b));
    const manyDemos = sortedDemos.length > 7;
    demoCol.className = 'ring-side-col ring-side-col-right' + (manyDemos ? ' ring-side-col-dense' : '');
    const baseDelay = hasNiches ? Math.min(creator.niches.length, 7) : 0;
    sortedDemos.forEach((demographic, i) => {
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
      }, 100 + (baseDelay + i) * 30);
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
  const avatarRect = avatar.getBoundingClientRect();
  const columnRect = ringColumn.getBoundingClientRect();
  const avatarCenterInColumn = (avatarRect.top + avatarRect.height / 2) - columnRect.top;
  let finalTop = cy - avatarCenterInColumn;

  // ── Viewport clamping: keep ring within map bounds ──
  const overlayW = parseFloat(overlay.style.width);
  const overlayH = parseFloat(overlay.style.height);
  const colW = columnRect.width;
  const colH = columnRect.height;
  const padding = 12;

  // Clamp vertical
  if (finalTop < padding) finalTop = padding;
  if (finalTop + colH > overlayH - padding) finalTop = overlayH - colH - padding;

  // Clamp horizontal (ring is centered via translateX(-50%))
  let finalLeft = cx;
  const halfW = colW / 2;
  if (finalLeft - halfW < padding) finalLeft = halfW + padding;
  if (finalLeft + halfW > overlayW - padding) finalLeft = overlayW - halfW - padding;

  ringColumn.style.top = finalTop + 'px';
  ringColumn.style.left = finalLeft + 'px';

  // Show ring + scrim
  overlay.classList.add('open');
  scrim.classList.add('open');

  // Keyboard navigation — Escape to close
  function ringKeyHandler(e) {
    if (!document.getElementById('ringOverlay').classList.contains('open')) {
      document.removeEventListener('keydown', ringKeyHandler);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeDetailPanel();
      document.removeEventListener('keydown', ringKeyHandler);
    }
  }
  // Remove any previous listener, add fresh one
  document.removeEventListener('keydown', window._ringKeyHandler);
  window._ringKeyHandler = ringKeyHandler;
  document.addEventListener('keydown', ringKeyHandler);
}

// Make it global for marker click
window.showDetailPanel = showDetailPanel;

// ── Viewport resize handler: close ring to avoid stale positioning ──
window.addEventListener('resize', () => {
  const overlay = document.getElementById('ringOverlay');
  if (overlay && overlay.classList.contains('open') && currentEditingCreator) {
    // Re-render the ring at updated position
    const creator = creators.find(c => c.id === currentEditingCreator);
    if (creator) {
      // Reposition overlay and ring column to match new map bounds
      const mapContainer = document.getElementById('mapContainer');
      const mapRect = mapContainer.getBoundingClientRect();
      overlay.style.left = mapRect.left + 'px';
      overlay.style.top = mapRect.top + 'px';
      overlay.style.width = mapRect.width + 'px';
      overlay.style.height = mapRect.height + 'px';
      const scrim = document.getElementById('ringScrim');
      scrim.style.left = mapRect.left + 'px';
      scrim.style.top = mapRect.top + 'px';
      scrim.style.width = mapRect.width + 'px';
      scrim.style.height = mapRect.height + 'px';

      // Recalculate ring column position
      const ringColumn = overlay.querySelector('.ring-column');
      if (ringColumn && creator.lat && creator.lng) {
        const marker = markers[creator.id];
        const markerLatLng = marker ? marker.getLatLng() : L.latLng(creator.lat, creator.lng);
        const point = map.latLngToContainerPoint(markerLatLng);
        let cx = point.x, cy = point.y;
        const avatar = ringColumn.querySelector('.ring-avatar');
        if (avatar) {
          const avatarRect = avatar.getBoundingClientRect();
          const columnRect = ringColumn.getBoundingClientRect();
          const avatarCenterInColumn = (avatarRect.top + avatarRect.height / 2) - columnRect.top;
          let finalTop = cy - avatarCenterInColumn;
          const overlayW = mapRect.width;
          const overlayH = mapRect.height;
          const colW = columnRect.width;
          const colH = columnRect.height;
          const padding = 12;
          if (finalTop < padding) finalTop = padding;
          if (finalTop + colH > overlayH - padding) finalTop = overlayH - colH - padding;
          let finalLeft = cx;
          const halfW = colW / 2;
          if (finalLeft - halfW < padding) finalLeft = halfW + padding;
          if (finalLeft + halfW > overlayW - padding) finalLeft = overlayW - halfW - padding;
          ringColumn.style.top = finalTop + 'px';
          ringColumn.style.left = finalLeft + 'px';
        }
      }
    }
  }
});

function closeDetailPanel() {
  const overlay = document.getElementById('ringOverlay');
  const scrim = document.getElementById('ringScrim');
  overlay.classList.remove('open');
  scrim.classList.remove('open');
  currentEditingCreator = null;

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
  location.textContent = creator.location ? '📍 ' + creator.location : 'No location';

  info.appendChild(name);
  info.appendChild(location);
  head.appendChild(avatar);
  head.appendChild(info);
  card.appendChild(head);

  // Platform badges — reuse roster card style (new grid design)
  const platforms = getCreatorPlatforms(creator);
  if (platforms.length > 0) {
    const platformsGrid = document.createElement('div');
    platformsGrid.className = 'creator-platforms-grid';
    platforms.forEach(p => {
      const url = getUrl(creator, p);
      const badge = document.createElement(url ? 'a' : 'span');
      badge.className = 'creator-platform-badge platform-' + p.toLowerCase();
      if (url) {
        badge.href = url;
        badge.target = '_blank';
        badge.rel = 'noopener noreferrer';
        badge.title = `Open ${p} profile`;
        badge.addEventListener('click', e => e.stopPropagation());
      }

      const svg = PLATFORM_SVGS_SM[p];
      const followers = getFollowers(creator, p);

      // Build badge HTML: SVG icon + followers
      let badgeHTML = svg || '';
      if (followers !== null) {
        badgeHTML += `<div class="badge-followers">${formatFollowers(followers)}</div>`;
      }

      badge.innerHTML = badgeHTML;
      platformsGrid.appendChild(badge);
    });
    card.appendChild(platformsGrid);
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

    // Category picker for new custom tags
    function showCategoryPicker(tagName, callback) {
      // Remove any existing picker
      document.querySelector('.tag-category-picker-overlay')?.remove();

      const pickerOverlay = document.createElement('div');
      pickerOverlay.className = 'tag-category-picker-overlay';

      const picker = document.createElement('div');
      picker.className = 'tag-category-picker';

      const pickerTitle = document.createElement('div');
      pickerTitle.className = 'tag-category-picker-title';
      pickerTitle.innerHTML = `Add "<strong>${tagName}</strong>" to:`;
      picker.appendChild(pickerTitle);

      const catList = document.createElement('div');
      catList.className = 'tag-category-picker-list';

      Object.keys(categories).forEach(catName => {
        const btn = document.createElement('button');
        btn.className = 'tag-category-picker-btn';
        const icon = CATEGORY_ICONS[catName] || '📁';
        btn.innerHTML = `<span class="picker-icon">${icon}</span> ${catName}`;
        btn.onclick = () => {
          categories[catName].push(tagName);
          saveTagCategories(type, categories);
          pickerOverlay.remove();
          callback();
        };
        catList.appendChild(btn);
      });

      picker.appendChild(catList);

      // "+ New Category" option at bottom
      const newCatRow = document.createElement('button');
      newCatRow.className = 'tag-category-picker-btn new-cat';
      newCatRow.innerHTML = '<span class="picker-icon">✚</span> New Category';
      newCatRow.onclick = () => {
        const name = prompt('New category name:');
        if (name && name.trim()) {
          const trimmed = name.trim();
          if (!categories[trimmed]) categories[trimmed] = [];
          categories[trimmed].push(tagName);
          saveTagCategories(type, categories);
        }
        pickerOverlay.remove();
        callback();
      };
      picker.appendChild(newCatRow);

      pickerOverlay.onclick = (e) => { if (e.target === pickerOverlay) { pickerOverlay.remove(); search.focus(); } };
      pickerOverlay.appendChild(picker);
      document.body.appendChild(pickerOverlay);
    }

    function addCustomTag(val) {
      if (!val) return;
      if (!panelSelections.includes(val)) panelSelections.push(val);
      if (!panelCustomItems.includes(val)) panelCustomItems.push(val);

      // Check if this tag is already in a category
      const inCategory = Object.values(categories).some(arr => arr.includes(val));
      if (inCategory) {
        search.value = '';
        renderGrid();
        search.focus();
      } else {
        showCategoryPicker(val, () => {
          search.value = '';
          renderGrid();
          search.focus();
        });
      }
    }

    // Add custom tag
    addRow.onclick = () => {
      addCustomTag(search.value.trim());
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
          addCustomTag(val);
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
            // If it's a preset demographic, add to deleted presets list
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
    presets: [],  // no presets — all niches are equal (from July or manual)
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
  const existingCreator = currentEditingCreator ? creators.find(c => c.id === currentEditingCreator) : null;
  document.querySelectorAll('input[data-platform]:checked').forEach(el => {
    const p = el.value;
    const handle = (document.querySelector(`input[data-handle="${p}"]`)?.value || '').trim();
    const url = (document.querySelector(`input[data-url="${p}"]`)?.value || '').trim();
    const followersRaw = (document.querySelector(`input[data-followers="${p}"]`)?.value || '').replace(/[^\d]/g, '');
    const followers = followersRaw ? parseInt(followersRaw, 10) : null;
    // Preserve engagement rate from existing data (not editable in form)
    const existingEng = existingCreator?.platforms?.[p]?.engagementRate || null;
    platforms[p] = { handle, url, followers, engagementRate: existingEng };
  });
  const email = document.getElementById('emailInput').value.trim();
  const mediaKit = document.getElementById('mediaKitInput').value.trim();
  const birthday = document.getElementById('birthdayInput').value || null;
  const niches = document.getElementById('modalBody').modalNiches || [];
  const demographics = document.getElementById('modalBody').modalDemographics || [];
  const location = document.getElementById('locationInput').value.trim();
  const notes = document.getElementById('notesTextarea').value.trim();
  if (!currentEditingCreator) return; // Add mode removed — edits only
  const creator = creators.find(c => c.id === currentEditingCreator);
  if (!creator) return;
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
  renderRosterTab();
  renderDispatchTab();
  updateMapMarkers();
  showToast('Creator saved', 'success');
}

// ===========================
// STORAGE INDICATOR
// ===========================
function updateStorageIndicator() {
  const el = document.getElementById('creatorCount');
  if (!el) return;
  const count = creators.length;
  el.textContent = `${count} creator${count !== 1 ? 's' : ''}`;
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

async function renderRecycleBinTab() {
  const list = document.getElementById('recycleList');
  const emptyState = document.getElementById('recycleEmpty');
  const emptyBtn = document.getElementById('emptyBinBtn');
  list.innerHTML = '';

  const items = await recycleBin.load();
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
    if (item.location) meta.textContent += ' · ' + item.location;
    info.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'recycle-card-actions';

    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'recycle-btn restore';
    restoreBtn.textContent = 'Restore';
    restoreBtn.onclick = async () => {
      const restored = await recycleBin.restore(item.id);
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
// NATURAL LANGUAGE SEARCH
// ===========================

// Region bounding boxes: [latMin, latMax, lngMin, lngMax]
const NL_REGIONS = {
  'pnw':       { label: 'Pacific Northwest', bounds: [42, 49, -125, -111] },
  'pacific northwest': { label: 'Pacific Northwest', bounds: [42, 49, -125, -111] },
  'northwest': { label: 'Pacific Northwest', bounds: [42, 49, -125, -111] },
  'southwest': { label: 'Southwest', bounds: [31, 42, -120, -102] },
  'sw':        { label: 'Southwest', bounds: [31, 42, -120, -102] },
  'southeast': { label: 'Southeast', bounds: [24, 37, -95, -75] },
  'se':        { label: 'Southeast', bounds: [24, 37, -95, -75] },
  'northeast': { label: 'Northeast', bounds: [38, 47.5, -80, -67] },
  'ne':        { label: 'Northeast', bounds: [38, 47.5, -80, -67] },
  'new england': { label: 'Northeast', bounds: [41, 47.5, -73.5, -67] },
  'central':   { label: 'Central', bounds: [36, 49, -104, -80] },
  'midwest':   { label: 'Central', bounds: [36, 49, -104, -80] },
  'west coast': { label: 'West Coast', bounds: [32, 49, -125, -114] },
  'east coast': { label: 'East Coast', bounds: [25, 47.5, -85, -67] },
  'southern':  { label: 'Southeast', bounds: [24, 37, -95, -75] },
};

// Synonym → actual niche value (from DEFAULT_NICHE_CATEGORIES)
const NL_NICHE_SYNONYMS = {
  'lifestyle': 'Lifestyle', 'outdoor': 'Outdoors', 'outdoors': 'Outdoors', 'outdoorsy': 'Outdoors',
  'adventure': 'Adventure', 'hiking': 'Hiking', 'camping': 'Camping', 'van life': 'Van Life',
  'vanlife': 'Van Life', 'travel': 'Travel', 'traveler': 'Travel',
  'beauty': 'Beauty', 'skincare': 'Skincare', 'makeup': 'Beauty',
  'fitness': 'Fitness', 'gym': 'Fitness', 'workout': 'Fitness', 'running': 'Running', 'yoga': 'Yoga',
  'food': 'Food', 'foodie': 'Food', 'cooking': 'Cooking', 'chef': 'Cooking', 'vegan': 'Vegan',
  'fashion': 'Fashion', 'style': 'Fashion',
  'tech': 'Tech', 'technology': 'Tech', 'ai': 'Artificial Intelligence (AI)',
  'comedy': 'Comedy', 'funny': 'Comedy', 'comedian': 'Comedy', 'humor': 'Comedy',
  'music': 'Music', 'musician': 'Music',
  'photography': 'Photography', 'photographer': 'Photography', 'photo': 'Photography',
  'art': 'Art', 'artist': 'Art', 'creative': 'Art',
  'education': 'Education', 'educator': 'Education', 'teaching': 'Education',
  'entertainment': 'Entertainment', 'entertainer': 'Entertainment',
  'podcast': 'Podcast', 'podcaster': 'Podcast', 'podcasting': 'Podcast',
  'true crime': 'True Crime',
  'wellness': 'Wellness', 'mental health': 'Mental Health', 'self care': 'Wellness',
  'couple': 'Couple', 'couples': 'Couple', 'relationship': 'Relationship',
  'family': 'Family', 'parenting': 'Parenthood', 'parenthood': 'Parenthood', 'mom': 'Parenthood', 'dad': 'Parenthood',
  'pets': 'Pets', 'pet': 'Pets', 'dog': 'Pets', 'cat': 'Pets', 'animal': 'Pets',
  'sports': 'Sports', 'athlete': 'Athlete', 'athletic': 'Athlete',
  'cycling': 'Cycling', 'fishing': 'Fishing', 'rafting': 'Rafting',
  'extreme sports': 'Extreme Sports',
  'home': 'Home', 'diy': 'DIY', 'interior': 'Home',
  'model': 'Model', 'modeling': 'Model',
  'history': 'History',
  'entrepreneurship': 'Entrepreneurship', 'entrepreneur': 'Entrepreneurship',
  'finance': 'Personal Finance', 'personal finance': 'Personal Finance',
  'tourism': 'Tourism Board', 'luxury': 'Luxury Stays', 'spa': 'Spas',
  'domestic travel': 'Domestic Travel', 'international travel': 'International Travel',
  'productivity': 'Productivity',
};

// Synonym → demographic value
const NL_DEMO_SYNONYMS = {
  'female': 'Female', 'woman': 'Female', 'women': 'Female', 'girl': 'Female',
  'male': 'Male', 'man': 'Male', 'men': 'Male', 'guy': 'Male',
  'non-binary': 'Non-Binary', 'nonbinary': 'Non-Binary', 'nb': 'Non-Binary', 'enby': 'Non-Binary',
  'lgbtq': 'LGBTQ+', 'lgbtq+': 'LGBTQ+', 'queer': 'LGBTQ+',
  'poc': 'Person of Color', 'bipoc': 'Person of Color', 'person of color': 'Person of Color',
  'indigenous': 'Indigenous', 'native': 'Indigenous',
  'immigrant': 'Immigrant',
  'bilingual': 'Bilingual/Multilingual', 'multilingual': 'Bilingual/Multilingual',
  'veteran': 'Veteran', 'vet': 'Veteran',
  'gen z': 'Gen Z', 'genz': 'Gen Z',
  'over 40': 'Over 40', 'over40': 'Over 40',
  'body positive': 'Body Positive', 'body positivity': 'Body Positive',
  'disabled': 'Disabled/Accessibility', 'disability': 'Disabled/Accessibility', 'accessible': 'Disabled/Accessibility',
  'neurodivergent': 'Neurodivergent', 'adhd': 'Neurodivergent', 'autistic': 'Neurodivergent',
};

// Platform synonyms
const NL_PLATFORM_SYNONYMS = {
  'instagram': 'Instagram', 'ig': 'Instagram', 'insta': 'Instagram',
  'tiktok': 'TikTok', 'tik tok': 'TikTok', 'tt': 'TikTok',
  'youtube': 'YouTube', 'yt': 'YouTube',
};

// Tier synonyms
const NL_TIER_SYNONYMS = {
  'nano': 'Nano (<10K)', 'small': 'Nano (<10K)',
  'micro': 'Micro (10K-100K)',
  'mid': 'Mid (100K-500K)', 'mid-tier': 'Mid (100K-500K)', 'medium': 'Mid (100K-500K)',
  'macro': 'Macro (500K-1M)', 'large': 'Macro (500K-1M)', 'big': 'Macro (500K-1M)',
  'mega': 'Mega (1M+)', 'huge': 'Mega (1M+)', 'massive': 'Mega (1M+)',
};

// Noise words to strip before matching
const NL_NOISE = new Set([
  'i', 'need', 'a', 'an', 'the', 'in', 'on', 'at', 'for', 'from', 'near',
  'around', 'based', 'who', 'that', 'is', 'are', 'with', 'and', 'or',
  'creator', 'creators', 'influencer', 'influencers', 'content',
  'somebody', 'someone', 'find', 'me', 'looking', 'want', 'get',
  'us', 'we', 'our', 'brand', 'campaign', 'collab',
]);

function parseNLSearch(query) {
  const result = {
    niches: [],
    demographics: [],
    platforms: [],
    tiers: [],
    region: null,
    unmatched: [],
  };

  if (!query || !query.trim()) return result;

  const raw = query.toLowerCase().trim();

  // Try multi-word matches first (longest match wins)
  const allMultiWordKeys = [
    ...Object.keys(NL_REGIONS).filter(k => k.includes(' ')),
    ...Object.keys(NL_NICHE_SYNONYMS).filter(k => k.includes(' ')),
    ...Object.keys(NL_DEMO_SYNONYMS).filter(k => k.includes(' ')),
    ...Object.keys(NL_PLATFORM_SYNONYMS).filter(k => k.includes(' ')),
    ...Object.keys(NL_TIER_SYNONYMS).filter(k => k.includes(' ')),
  ].sort((a, b) => b.length - a.length); // longest first

  let remaining = raw;

  // Extract multi-word phrases
  for (const phrase of allMultiWordKeys) {
    const idx = remaining.indexOf(phrase);
    if (idx === -1) continue;

    // Check it's a word boundary match
    const before = idx > 0 ? remaining[idx - 1] : ' ';
    const after = idx + phrase.length < remaining.length ? remaining[idx + phrase.length] : ' ';
    if (!/[\s,]/.test(before) && before !== ' ' && idx !== 0) continue;
    if (!/[\s,]/.test(after) && after !== ' ' && idx + phrase.length !== remaining.length) continue;

    if (NL_REGIONS[phrase]) {
      result.region = NL_REGIONS[phrase];
    } else if (NL_NICHE_SYNONYMS[phrase]) {
      const val = NL_NICHE_SYNONYMS[phrase];
      if (!result.niches.includes(val)) result.niches.push(val);
    } else if (NL_DEMO_SYNONYMS[phrase]) {
      const val = NL_DEMO_SYNONYMS[phrase];
      if (!result.demographics.includes(val)) result.demographics.push(val);
    } else if (NL_PLATFORM_SYNONYMS[phrase]) {
      const val = NL_PLATFORM_SYNONYMS[phrase];
      if (!result.platforms.includes(val)) result.platforms.push(val);
    } else if (NL_TIER_SYNONYMS[phrase]) {
      const val = NL_TIER_SYNONYMS[phrase];
      if (!result.tiers.includes(val)) result.tiers.push(val);
    }

    // Remove matched phrase from remaining text
    remaining = remaining.slice(0, idx) + remaining.slice(idx + phrase.length);
  }

  // Now tokenize remaining single words
  const tokens = remaining.split(/[\s,]+/).filter(Boolean);

  for (const token of tokens) {
    if (NL_NOISE.has(token)) continue;

    if (NL_REGIONS[token]) {
      if (!result.region) result.region = NL_REGIONS[token];
    } else if (NL_NICHE_SYNONYMS[token]) {
      const val = NL_NICHE_SYNONYMS[token];
      if (!result.niches.includes(val)) result.niches.push(val);
    } else if (NL_DEMO_SYNONYMS[token]) {
      const val = NL_DEMO_SYNONYMS[token];
      if (!result.demographics.includes(val)) result.demographics.push(val);
    } else if (NL_PLATFORM_SYNONYMS[token]) {
      const val = NL_PLATFORM_SYNONYMS[token];
      if (!result.platforms.includes(val)) result.platforms.push(val);
    } else if (NL_TIER_SYNONYMS[token]) {
      const val = NL_TIER_SYNONYMS[token];
      if (!result.tiers.includes(val)) result.tiers.push(val);
    } else {
      // Try fuzzy match against actual niche/demo values
      const allNiches = getAllNiches();
      const allDemos = getAllDemographics();
      const fuzzyNiche = allNiches.find(n => n.toLowerCase().includes(token) || token.includes(n.toLowerCase()));
      const fuzzyDemo = allDemos.find(d => d.toLowerCase().includes(token) || token.includes(d.toLowerCase()));
      if (fuzzyNiche && !result.niches.includes(fuzzyNiche)) {
        result.niches.push(fuzzyNiche);
      } else if (fuzzyDemo && !result.demographics.includes(fuzzyDemo)) {
        result.demographics.push(fuzzyDemo);
      } else {
        result.unmatched.push(token);
      }
    }
  }

  return result;
}

function applyNLSearch(query) {
  const parsed = parseNLSearch(query);
  const hint = document.getElementById('nlSearchHint');

  // Clear existing filters first
  dispatchFilters.niches = [];
  dispatchFilters.demographics = [];
  dispatchFilters.platformTiers = [];
  dispatchFilters.ageMin = null;
  dispatchFilters.ageMax = null;
  nlRegionFilter = null;
  // Clear vibe search term so pill grid shows all items (not text-filtered)
  _vibeSearchTerm = '';

  // Apply parsed results
  if (parsed.niches.length > 0) {
    dispatchFilters.niches = parsed.niches;
  }
  if (parsed.demographics.length > 0) {
    dispatchFilters.demographics = parsed.demographics;
  }

  // For platform+tier: if both specified, combine them. If only platform, add all tiers. If only tier, add all platforms.
  if (parsed.platforms.length > 0 && parsed.tiers.length > 0) {
    parsed.platforms.forEach(p => {
      parsed.tiers.forEach(t => {
        dispatchFilters.platformTiers.push({ platform: p, tier: t });
      });
    });
  } else if (parsed.platforms.length > 0) {
    // Platform only — add all tiers for that platform
    parsed.platforms.forEach(p => {
      TIERS.forEach(t => {
        dispatchFilters.platformTiers.push({ platform: p, tier: t });
      });
    });
  } else if (parsed.tiers.length > 0) {
    // Tier only — add all platforms for that tier
    parsed.tiers.forEach(t => {
      PLATFORMS.forEach(p => {
        dispatchFilters.platformTiers.push({ platform: p, tier: t });
      });
    });
  }

  // Region
  if (parsed.region) {
    nlRegionFilter = parsed.region;
  }

  // Build hint text showing what was understood
  const parts = [];
  if (parsed.niches.length > 0) parts.push(parsed.niches.join(', '));
  if (parsed.demographics.length > 0) parts.push(parsed.demographics.join(', '));
  if (parsed.platforms.length > 0) parts.push(parsed.platforms.join(', '));
  if (parsed.tiers.length > 0) parts.push(parsed.tiers.map(t => TIER_SHORT[t] || t).join(', '));
  if (parsed.region) parts.push('📍 ' + parsed.region.label);

  if (parts.length > 0) {
    hint.textContent = 'Searching: ' + parts.join(' · ');
    hint.style.display = '';
  } else if (query.trim()) {
    hint.textContent = 'No filters recognized — try niches, platforms, tiers, or regions';
    hint.style.display = '';
  } else {
    hint.style.display = 'none';
  }

  // Re-render everything
  renderDispatchFilters();
  renderDispatchFilterPills();
  renderDispatchActiveStrip();
  renderDispatchTab();
  updateMapMarkers();
}

// Override getFilteredCreators to also apply region bounding box
const _origGetFilteredCreators = getFilteredCreators;

// We need to patch the dispatch tab rendering to include region filtering
// Instead of overriding getFilteredCreators (which is called in many places),
// we'll hook into renderDispatchTab

// ===========================
// EVENT LISTENERS
// ===========================
// Roster search — update list, map fading, and clear button visibility
const _searchInput = document.getElementById('searchInput');
const _searchClearBtn = document.getElementById('searchClearBtn');

function _syncSearchClearBtn() {
  _searchClearBtn.classList.toggle('visible', _searchInput.value.length > 0);
}

_searchInput.addEventListener('input', debounce(() => {
  renderRosterTab();
  updateRosterMarkerFading();
  _syncSearchClearBtn();
}, 120));

_searchClearBtn.addEventListener('click', () => {
  _searchInput.value = '';
  _syncSearchClearBtn();
  renderRosterTab();
  updateRosterMarkerFading();
  _searchInput.focus();
});

// Roster filter panel removed — search is simple name/location/email/handles only

// ── Natural Language Search with Live Filtering + Autocomplete ──
let _nlApplyTimeout = null;

(function setupNLSearch() {
  const input = document.getElementById('nlSearchInput');
  const clearBtn = document.getElementById('nlSearchClear');
  const sugBox = document.getElementById('nlSuggestions');
  if (!input) return;

  let _nlSelectedIdx = -1;

  function getSuggestions(query) {
    if (!query || query.length < 2) return [];
    const q = query.toLowerCase();
    const suggestions = [];
    const seen = new Set();
    const tokens = q.split(/[\s,]+/).filter(Boolean);
    const lastToken = tokens[tokens.length - 1] || '';
    if (lastToken.length < 2) return suggestions;

    // Exclude values that the parser already matched from earlier tokens
    // (so we only suggest NEW things for what the user is currently typing)
    const alreadyParsed = parseNLSearch(tokens.slice(0, -1).join(' '));
    const alreadyMatched = new Set([
      ...alreadyParsed.niches, ...alreadyParsed.demographics,
      ...alreadyParsed.platforms, ...alreadyParsed.tiers.map(t => TIER_SHORT[t] || t),
    ]);
    if (alreadyParsed.region) alreadyMatched.add(alreadyParsed.region.label);

    // Niches
    getAllNiches().forEach(n => {
      if (seen.has(n) || alreadyMatched.has(n)) return;
      if (n.toLowerCase().includes(lastToken)) { seen.add(n); suggestions.push({ value: n, type: 'niche' }); }
    });
    Object.entries(NL_NICHE_SYNONYMS).forEach(([syn, val]) => {
      if (seen.has(val) || alreadyMatched.has(val)) return;
      if (syn.includes(lastToken) || lastToken.includes(syn)) { seen.add(val); suggestions.push({ value: val, type: 'niche' }); }
    });

    // Demographics
    getAllDemographics().forEach(d => {
      if (seen.has(d) || alreadyMatched.has(d)) return;
      if (d.toLowerCase().includes(lastToken)) { seen.add(d); suggestions.push({ value: d, type: 'demographic' }); }
    });
    Object.entries(NL_DEMO_SYNONYMS).forEach(([syn, val]) => {
      if (seen.has(val) || alreadyMatched.has(val)) return;
      if (syn.includes(lastToken) || lastToken.includes(syn)) { seen.add(val); suggestions.push({ value: val, type: 'demographic' }); }
    });

    // Platforms
    Object.entries(NL_PLATFORM_SYNONYMS).forEach(([syn, val]) => {
      if (seen.has(val) || alreadyMatched.has(val)) return;
      if (syn.includes(lastToken) || lastToken.includes(syn)) { seen.add(val); suggestions.push({ value: val, type: 'platform' }); }
    });

    // Tiers
    Object.entries(NL_TIER_SYNONYMS).forEach(([syn, val]) => {
      if (seen.has(TIER_SHORT[val] || val) || alreadyMatched.has(TIER_SHORT[val] || val)) return;
      if (syn.includes(lastToken)) { seen.add(TIER_SHORT[val] || val); suggestions.push({ value: TIER_SHORT[val] || val, type: 'tier', rawValue: val }); }
    });

    // Regions
    Object.entries(NL_REGIONS).forEach(([key, reg]) => {
      if (seen.has(reg.label) || alreadyMatched.has(reg.label)) return;
      if (key.includes(lastToken)) { seen.add(reg.label); suggestions.push({ value: reg.label, type: 'region', regionKey: key }); }
    });

    return suggestions.slice(0, 8);
  }

  function renderSuggestions(suggestions) {
    sugBox.innerHTML = '';
    _nlSelectedIdx = -1;
    if (suggestions.length === 0) { sugBox.classList.remove('open'); return; }
    suggestions.forEach((s, i) => {
      const item = document.createElement('div');
      item.className = 'nl-suggestion-item';
      const typeLabel = s.type === 'niche' ? '✿' : s.type === 'demographic' ? '👤' : s.type === 'platform' ? '📱' : s.type === 'tier' ? '📊' : '📍';
      item.innerHTML = `<span class="nl-sug-type">${typeLabel}</span><span class="nl-sug-label">${s.value}</span><span class="nl-sug-cat">${s.type}</span>`;
      item.onmousedown = (e) => { e.preventDefault(); applySuggestion(s); };
      item.onmouseenter = () => { _nlSelectedIdx = i; highlightSuggestion(); };
      sugBox.appendChild(item);
    });
    sugBox.classList.add('open');
  }

  function highlightSuggestion() {
    sugBox.querySelectorAll('.nl-suggestion-item').forEach((el, i) => el.classList.toggle('highlighted', i === _nlSelectedIdx));
  }

  function applySuggestion(s) {
    // Replace the last partial token with the suggestion's canonical value
    const tokens = input.value.split(/\s+/);
    tokens.pop();
    tokens.push(s.value);
    input.value = tokens.join(' ') + ' ';
    sugBox.classList.remove('open');
    input.focus();
    // Immediately apply filters with the updated input
    applyNLSearch(input.value);
  }

  // Keyboard navigation
  input.addEventListener('keydown', (e) => {
    const items = sugBox.querySelectorAll('.nl-suggestion-item');
    if (e.key === 'ArrowDown' && sugBox.classList.contains('open')) {
      e.preventDefault();
      _nlSelectedIdx = Math.min(_nlSelectedIdx + 1, items.length - 1);
      highlightSuggestion();
    } else if (e.key === 'ArrowUp' && sugBox.classList.contains('open')) {
      e.preventDefault();
      _nlSelectedIdx = Math.max(_nlSelectedIdx - 1, 0);
      highlightSuggestion();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (_nlSelectedIdx >= 0 && sugBox.classList.contains('open')) {
        const suggestions = getSuggestions(input.value);
        if (suggestions[_nlSelectedIdx]) applySuggestion(suggestions[_nlSelectedIdx]);
      } else {
        sugBox.classList.remove('open');
        applyNLSearch(input.value);
      }
    } else if (e.key === 'Escape') {
      sugBox.classList.remove('open');
    }
  });

  // Live input — apply filters as you type (debounced) + show suggestions
  input.addEventListener('input', () => {
    const val = input.value.trim();
    clearBtn.style.display = val ? '' : 'none';

    // Show autocomplete suggestions immediately
    const suggestions = getSuggestions(val);
    renderSuggestions(suggestions);

    // Debounce the actual filter application (so typing feels snappy)
    clearTimeout(_nlApplyTimeout);
    if (val) {
      _nlApplyTimeout = setTimeout(() => {
        applyNLSearch(input.value);
      }, 300);
    } else {
      // Cleared — reset everything
      nlRegionFilter = null;
      _vibeSearchTerm = '';
      dispatchFilters.niches = [];
      dispatchFilters.demographics = [];
      dispatchFilters.platformTiers = [];
      dispatchFilters.ageMin = null;
      dispatchFilters.ageMax = null;
      document.getElementById('nlSearchHint').style.display = 'none';
      renderDispatchFilters();
      renderDispatchFilterPills();
      renderDispatchActiveStrip();
      renderDispatchTab();
      updateMapMarkers();
    }
  });

  // Hide suggestions on blur
  input.addEventListener('blur', () => {
    setTimeout(() => sugBox.classList.remove('open'), 150);
  });
  input.addEventListener('focus', () => {
    if (input.value.trim().length >= 2) {
      renderSuggestions(getSuggestions(input.value.trim()));
    }
  });

  // Clear button
  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.style.display = 'none';
    nlRegionFilter = null;
    _vibeSearchTerm = '';
    dispatchFilters.niches = [];
    dispatchFilters.demographics = [];
    dispatchFilters.platformTiers = [];
    dispatchFilters.ageMin = null;
    dispatchFilters.ageMax = null;
    document.getElementById('nlSearchHint').style.display = 'none';
    sugBox.classList.remove('open');
    renderDispatchFilters();
    renderDispatchFilterPills();
    renderDispatchActiveStrip();
    renderDispatchTab();
    updateMapMarkers();
    input.focus();
  });
})();

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
        const simplified = simplifyAddress(r);
        item.innerHTML = `<div>${simplified}</div>`;
        item.onmousedown = (e) => {
          e.preventDefault();
          input.value = simplified;
          suggestions.classList.remove('open');
          setDispatchDestination(parseFloat(r.lat), parseFloat(r.lon), simplified);
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
  // Close any open radial ring before running destination animation
  closeDetailPanel();

  dispatchDestination = { lat, lng, displayName };
  document.getElementById('locationFilterClear').style.display = 'flex';

  // Remove old destination marker + proximity rings
  if (dispatchDestinationMarker) {
    map.removeLayer(dispatchDestinationMarker);
  }
  _clearProximityRings();

  // Add rose destination pin with pulse animation
  const destIcon = L.divIcon({
    html: `<div class="dest-pin-inner">
      <div class="dest-pin-label">${displayName.split(',').slice(0, 2).join(',').trim()}</div>
    </div>`,
    className: 'destination-marker',
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });

  dispatchDestinationMarker = L.marker([lat, lng], { icon: destIcon, zIndexOffset: 1000, interactive: false }).addTo(map);

  // Add proximity rings (50mi, 150mi, 300mi)
  _addProximityRings(lat, lng);

  // Show map legend
  _showMapLegend();

  // Render nearest creators
  renderNearestCreators();
  renderDispatchActiveStrip();
}

function clearDispatchDestination() {
  dispatchDestination = null;
  if (dispatchDestinationMarker) {
    map.removeLayer(dispatchDestinationMarker);
    dispatchDestinationMarker = null;
  }
  _clearProximityRings();
  _hideMapLegend();
  document.getElementById('locationFilterClear').style.display = 'none';
  _hideNearestCompareCard();
  const panel = document.getElementById('dispatchNearest');
  panel.classList.remove('open');
  setTimeout(() => { panel.style.display = 'none'; }, 300);
  updateMapMarkers();
  renderDispatchActiveStrip();
}

// ===========================
// PROXIMITY RINGS + MAP LEGEND
// ===========================

function _addProximityRings(lat, lng) {
  const MI_TO_M = 1609.344;
  const rings = [
    { miles: 50, color: 'rgba(0,212,255,0.3)', dash: '8 6', weight: 1.5 },
    { miles: 150, color: 'rgba(0,212,255,0.18)', dash: '5 8', weight: 1 },
    { miles: 300, color: 'rgba(0,212,255,0.08)', dash: '4 10', weight: 1 }
  ];

  rings.forEach((ring, i) => {
    const circle = L.circle([lat, lng], {
      radius: ring.miles * MI_TO_M,
      color: ring.color,
      weight: ring.weight,
      dashArray: ring.dash,
      fill: false,
      interactive: false
    }).addTo(map);
    dispatchProximityRings.push(circle);

    // Label at the top of each ring
    const labelLatLng = _getPointAtBearing(lat, lng, 0, ring.miles * MI_TO_M); // north
    const label = L.marker(labelLatLng, {
      icon: L.divIcon({
        html: `<span class="proximity-ring-label">${ring.miles} mi</span>`,
        className: '',
        iconSize: [0, 0],
        iconAnchor: [0, 8]
      }),
      interactive: false,
      zIndexOffset: -100
    }).addTo(map);
    dispatchProximityLabels.push(label);
  });
}

function _clearProximityRings() {
  dispatchProximityRings.forEach(r => map.removeLayer(r));
  dispatchProximityRings = [];
  dispatchProximityLabels.forEach(l => map.removeLayer(l));
  dispatchProximityLabels = [];
}

// Calculate lat/lng at a given bearing and distance (meters) from a point
function _getPointAtBearing(lat, lng, bearingDeg, distM) {
  const R = 6371000; // Earth radius in meters
  const brng = bearingDeg * Math.PI / 180;
  const lat1 = lat * Math.PI / 180;
  const lng1 = lng * Math.PI / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(distM / R) + Math.cos(lat1) * Math.sin(distM / R) * Math.cos(brng));
  const lng2 = lng1 + Math.atan2(Math.sin(brng) * Math.sin(distM / R) * Math.cos(lat1), Math.cos(distM / R) - Math.sin(lat1) * Math.sin(lat2));
  return [lat2 * 180 / Math.PI, lng2 * 180 / Math.PI];
}

function _showMapLegend() {
  let legend = document.querySelector('.map-legend');
  if (!legend) {
    legend = document.createElement('div');
    legend.className = 'map-legend';
    legend.innerHTML = `
      <div class="map-legend-item"><div class="map-legend-dot" style="border-color: var(--success); background: rgba(142,174,139,0.3);"></div> Full match</div>
      <div class="map-legend-item"><div class="map-legend-dot" style="border-color: var(--success); background: rgba(142,174,139,0.15);"></div> High match</div>
      <div class="map-legend-item"><div class="map-legend-dot" style="border-color: var(--warning, #C4A85A); background: rgba(196,168,90,0.15);"></div> Partial</div>
      <div class="map-legend-item"><div class="map-legend-dot" style="border-color: var(--mocha); opacity: 0.5;"></div> Low / None</div>
    `;
    document.getElementById('mapContainer').appendChild(legend);
  }
  requestAnimationFrame(() => legend.classList.add('visible'));
}

function _hideMapLegend() {
  const legend = document.querySelector('.map-legend');
  if (legend) {
    legend.classList.remove('visible');
    setTimeout(() => legend.remove(), 500);
  }
}

// Bezier arc between two lat/lng points (for proximity hover lines)
function _bezierArc(p1, p2, numPoints) {
  const midLat = (p1[0] + p2[0]) / 2;
  const midLng = (p1[1] + p2[1]) / 2;
  const dx = p2[1] - p1[1], dy = p2[0] - p1[0];
  const dist = Math.sqrt(dx * dx + dy * dy);
  const offset = dist * 0.25;
  const cpLat = midLat + offset * 0.5;
  const cpLng = midLng - offset * 0.3;
  const points = [];
  for (let t = 0; t <= 1; t += 1 / numPoints) {
    const lat = (1 - t) * (1 - t) * p1[0] + 2 * (1 - t) * t * cpLat + t * t * p2[0];
    const lng = (1 - t) * (1 - t) * p1[1] + 2 * (1 - t) * t * cpLng + t * t * p2[1];
    points.push([lat, lng]);
  }
  return points;
}

// Compare card: floats above nearest panel on hover to show filter match breakdown
function _showNearestCompareCard(creator, distance, rankIndex, rankColors) {
  const score = scoreCreatorFilters(creator);
  if (score.totalFilters === 0) return; // No filters active, nothing to compare

  _hideNearestCompareCard(true); // Remove any existing immediately (no fade delay)

  const card = document.createElement('div');
  card.id = 'nearestCompareCard';
  card.className = 'nearest-compare-card';

  // Glow level
  let glowLevel = 'low';
  if (score.pct >= 1.0) glowLevel = 'high';
  else if (score.pct >= 0.66) glowLevel = 'medium';
  card.setAttribute('data-glow', glowLevel);

  // Header row: avatar + name + score
  const header = document.createElement('div');
  header.className = 'ncc-header';

  const avatar = document.createElement('div');
  avatar.className = 'ncc-avatar';
  if (creator.photo) {
    avatar.style.backgroundImage = `url(${creator.photo})`;
    avatar.style.backgroundSize = 'cover';
    avatar.style.backgroundPosition = 'center';
  } else {
    avatar.textContent = getInitials(creator.firstName, creator.lastName);
  }
  avatar.style.borderColor = rankColors[rankIndex] || 'var(--accent)';

  const headerInfo = document.createElement('div');
  headerInfo.className = 'ncc-header-info';

  const nameEl = document.createElement('div');
  nameEl.className = 'ncc-name';
  nameEl.textContent = getFullName(creator);

  const locationEl = document.createElement('div');
  locationEl.className = 'ncc-location';
  const distStr = distance < 1 ? '< 1 mi' : Math.round(distance).toLocaleString() + ' mi';
  locationEl.textContent = creator.location ? `${creator.location} · ${distStr}` : distStr;

  headerInfo.appendChild(nameEl);
  headerInfo.appendChild(locationEl);

  const scoreBadge = document.createElement('div');
  scoreBadge.className = `ncc-score ${glowLevel}`;
  scoreBadge.textContent = `${score.matchCount}/${score.totalFilters}`;

  header.appendChild(avatar);
  header.appendChild(headerInfo);
  header.appendChild(scoreBadge);
  card.appendChild(header);

  // Filter pills — matched and missed
  const pillsRow = document.createElement('div');
  pillsRow.className = 'ncc-pills';

  score.matchDetails.forEach(d => {
    const pill = document.createElement('span');
    pill.className = 'ncc-pill matched';
    pill.textContent = `✓ ${d.label}`;
    pillsRow.appendChild(pill);
  });
  score.missedDetails.forEach(d => {
    const pill = document.createElement('span');
    pill.className = 'ncc-pill missed';
    pill.textContent = `✗ ${d.label}`;
    pillsRow.appendChild(pill);
  });

  card.appendChild(pillsRow);

  // Insert above the nearest panel in the float stack
  const stack = document.getElementById('dispatchFloatStack');
  const nearest = document.getElementById('dispatchNearest');
  stack.insertBefore(card, nearest);

  // Animate in
  requestAnimationFrame(() => card.classList.add('open'));
}

let _hideCompareTimeout = null;
function _hideNearestCompareCard(immediate) {
  clearTimeout(_hideCompareTimeout);
  const existing = document.getElementById('nearestCompareCard');
  if (!existing) return;
  if (immediate) {
    existing.remove();
  } else {
    existing.classList.remove('open');
    _hideCompareTimeout = setTimeout(() => existing.remove(), 200);
  }
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

  // ── Panel-level hover management ──
  // Save map view once when mouse enters the panel, restore only when it leaves entirely.
  // Individual rows just fly + draw arcs without triggering restore.
  const RANK_COLORS = ['#c9a96e', '#a8a8a8', '#b87b5e'];
  let activeRowEnterTimeout = null;

  container.addEventListener('mouseleave', () => {
    // Cancel any pending row hover
    clearTimeout(activeRowEnterTimeout);
    // Clean up arc + compare card — but don't move the map
    if (container._hoverArc) { map.removeLayer(container._hoverArc); container._hoverArc = null; }
    _hideNearestCompareCard();
  });

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

    // Row hover: fly + arc + compare card (no view save/restore — panel handles that)
    row.addEventListener('mouseenter', () => {
      clearTimeout(activeRowEnterTimeout);
      activeRowEnterTimeout = setTimeout(() => {
        if (!c.lat || !c.lng || !dispatchDestination) return;
        map.stop();
        const bounds = L.latLngBounds(
          [c.lat, c.lng],
          [dispatchDestination.lat, dispatchDestination.lng]
        );
        map.flyToBounds(bounds.pad(0.35), { duration: 0.5, easeLinearity: 0.5 });

        // Clean up previous arc, draw new one
        if (container._hoverArc) { map.removeLayer(container._hoverArc); container._hoverArc = null; }
        const arcPts = _bezierArc([c.lat, c.lng], [dispatchDestination.lat, dispatchDestination.lng], 40);
        container._hoverArc = L.polyline(arcPts, {
          color: RANK_COLORS[i] || 'var(--accent)', weight: 2.5,
          dashArray: '8, 6', opacity: 0.85
        }).addTo(map);

        _showNearestCompareCard(c, item.distance, i, RANK_COLORS);
      }, 80);
    });
    row.addEventListener('mouseleave', () => {
      clearTimeout(activeRowEnterTimeout);
      // Clean up arc + compare card when leaving a row (but don't restore map — panel handles that)
      if (container._hoverArc) { map.removeLayer(container._hoverArc); container._hoverArc = null; }
      _hideNearestCompareCard();
    });

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

    // Close ring if open
    closeDetailPanel();

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
    // When switching to roster, remove dispatch-mode, clear all dispatch filters, and re-render
    if (tab === 'roster') {
      document.getElementById('matchFloatPanel').classList.remove('dispatch-mode');

      // Reset all dispatch filters
      dispatchFilters.platformTiers = [];
      dispatchFilters.niches = [];
      dispatchFilters.demographics = [];
      dispatchFilters.ageMin = null;
      dispatchFilters.ageMax = null;
      _vibeSearchTerm = '';

      // Clear NL search
      nlRegionFilter = null;
      const nlInput = document.getElementById('nlSearchInput');
      if (nlInput) nlInput.value = '';
      const nlHint = document.getElementById('nlSearchHint');
      if (nlHint) nlHint.style.display = 'none';
      const nlClear = document.getElementById('nlSearchClear');
      if (nlClear) nlClear.style.display = 'none';

      // Clear dispatch location
      document.getElementById('locationFilterInput').value = '';
      clearDispatchDestination();

      // Re-render dispatch internals so they're clean if user switches back
      renderDispatchFilters();
      renderDispatchFilterPills();
      renderDispatchActiveStrip();
      updateMapMarkers();

      renderRosterTab();
      updateRosterMarkerFading();
    }

    if (tab === 'dispatch') {
      // Clear roster search fading when entering dispatch
      Object.keys(markers).forEach(id => {
        const el = markers[id] && markers[id].getElement();
        if (el) el.classList.remove('roster-faded');
      });
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

// Match float panel close (dispatch only)
document.getElementById('matchFloatClose').addEventListener('click', () => {
  const panel = document.getElementById('matchFloatPanel');
  panel.classList.remove('visible', 'dispatch-mode');

  // Clear dispatch niche/demo/age filters
  dispatchFilters.niches = [];
  dispatchFilters.demographics = [];
  dispatchFilters.ageMin = null;
  dispatchFilters.ageMax = null;
  nlRegionFilter = null;
  // Clear NL search input
  const nlInput = document.getElementById('nlSearchInput');
  if (nlInput) nlInput.value = '';
  const nlHint = document.getElementById('nlSearchHint');
  if (nlHint) nlHint.style.display = 'none';
  const nlClear = document.getElementById('nlSearchClear');
  if (nlClear) nlClear.style.display = 'none';
  renderDispatchFilterPills();
  renderDispatchTab();
  updateMapMarkers();
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
    setSetting('deletedDemographics', []);
    setSetting('creator_roster_niche_categories', DEFAULT_NICHE_CATEGORIES);
    setSetting('creator_roster_demographic_categories', DEFAULT_DEMO_CATEGORIES);
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

// Modal
document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modalCancelBtn').addEventListener('click', closeModal);
document.getElementById('modalSaveBtn').addEventListener('click', saveCreator);
// Backdrop click no longer closes modal — use ×, Cancel, or Esc instead

// Ring scrim — click outside to close, stay at current map position
document.getElementById('ringScrim').addEventListener('click', () => closeDetailPanel());

// Tag modal scrim — click to close
document.getElementById('tagModalScrim').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    closeTagModal();
  }
});

// Esc key closes popups in priority order (innermost first)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    let closedSomething = false;

    const deleteConfirm = document.querySelector('.tag-delete-confirm-overlay');
    if (deleteConfirm) { deleteConfirm.remove(); closedSomething = true; }

    const tagPanel = document.querySelector('.tag-panel-overlay.open');
    if (tagPanel) { tagPanel.classList.remove('open'); closedSomething = true; }

    const modalBackdrop = document.getElementById('modalBackdrop');
    if (modalBackdrop && modalBackdrop.classList.contains('open')) { closeModal(); closedSomething = true; }

    const tagModal = document.getElementById('tagModalScrim');
    if (tagModal && tagModal.classList.contains('open')) { closeTagModal(); closedSomething = true; }

    const ring = document.getElementById('ringOverlay');
    if (ring && ring.classList.contains('open')) { closeDetailPanel(); closedSomething = true; }

    // If no popups were open and we're in dispatch mode, clear all filters
    if (!closedSomething && document.body.classList.contains('dispatch-mode')) {
      const hasFilters = dispatchFilters.platformTiers.length > 0 ||
                         dispatchFilters.niches.length > 0 ||
                         dispatchFilters.demographics.length > 0 ||
                         dispatchFilters.ageMin !== null ||
                         dispatchFilters.ageMax !== null ||
                         dispatchDestination !== null;
      if (hasFilters) {
        dispatchFilters.platformTiers = [];
        dispatchFilters.niches = [];
        dispatchFilters.demographics = [];
        dispatchFilters.ageMin = null;
        dispatchFilters.ageMax = null;
        _vibeSearchTerm = '';
        const nlInput2 = document.getElementById('nlSearchInput');
        if (nlInput2) nlInput2.value = '';
        document.getElementById('locationFilterInput').value = '';
        clearDispatchDestination();
        renderDispatchFilters();
        renderDispatchFilterPills();
        renderDispatchTab();
        updateMapMarkers();
        renderDispatchActiveStrip();
      }
    }
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
    noWrap: true,
    preferCanvas: true,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 150,
    zoomAnimation: true,
    fadeAnimation: true,
    markerZoomAnimation: true,
    boxZoom: false  // Disable Shift+drag box zoom — Shift+Click is used for city picker
  });

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '© Esri',
    maxZoom: 19,
    noWrap: true,
    updateWhenZooming: false,
    updateWhenIdle: true
  }).addTo(map);

  // Transparent labels + borders overlay on top of satellite imagery
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
    attribution: '',
    maxZoom: 19,
    noWrap: true,
    pane: 'overlayPane'
  }).addTo(map);

  // Ambient time-of-day overlay — shifts map mood based on local time
  (function initTimeOfDay() {
    const mapEl = document.getElementById('mapContainer');
    if (!mapEl) return;

    // Create gradient overlay element
    const ambient = document.createElement('div');
    ambient.id = 'ambientTimeOverlay';
    ambient.style.cssText = 'position:absolute;inset:0;z-index:401;pointer-events:none;transition:background 120s ease,opacity 120s ease;';
    mapEl.appendChild(ambient);

    function updateAmbient() {
      const hour = new Date().getHours();
      const min = new Date().getMinutes();
      const t = hour + min / 60; // decimal hour

      let bg, opacity;

      if (t >= 5 && t < 7) {
        // Dawn — warm pink/gold rising from horizon
        const p = (t - 5) / 2;
        bg = `radial-gradient(ellipse at 50% 100%, rgba(255,180,100,${0.35 * p}), rgba(200,120,160,${0.2 * p}) 40%, transparent 75%)`;
        opacity = 0.7 + p * 0.3;
      } else if (t >= 7 && t < 10) {
        // Morning — golden warmth fading
        const p = (t - 7) / 3;
        bg = `radial-gradient(ellipse at 50% 80%, rgba(255,200,120,${0.25 * (1 - p)}), transparent 60%)`;
        opacity = 0.8;
      } else if (t >= 10 && t < 16) {
        // Midday — clear, slight warm tint
        bg = `radial-gradient(ellipse at 50% 30%, rgba(255,245,220,0.08), transparent 70%)`;
        opacity = 0.5;
      } else if (t >= 16 && t < 18.5) {
        // Golden hour — dramatic warm amber
        const p = (t - 16) / 2.5;
        bg = `radial-gradient(ellipse at 50% 110%, rgba(255,160,60,${0.15 + p * 0.3}), rgba(220,100,80,${0.1 + p * 0.2}) 45%, rgba(120,60,100,${p * 0.15}) 75%, transparent 100%)`;
        opacity = 0.85 + p * 0.15;
      } else if (t >= 18.5 && t < 20.5) {
        // Sunset / blue hour — purple-blue transition
        const p = (t - 18.5) / 2;
        bg = `linear-gradient(to bottom, rgba(40,30,80,${0.1 + p * 0.25}), rgba(80,50,120,${0.15 + p * 0.2}) 40%, rgba(180,100,60,${0.15 * (1 - p)}) 80%, rgba(20,15,50,${p * 0.3}) 100%)`;
        opacity = 1;
      } else if (t >= 20.5 || t < 5) {
        // Night — deep blue/indigo wash
        const nightP = t >= 20.5 ? Math.min(1, (t - 20.5) / 2.5) : 1;
        bg = `linear-gradient(170deg, rgba(10,10,40,${0.35 * nightP}), rgba(20,15,60,${0.3 * nightP}) 50%, rgba(15,10,45,${0.4 * nightP}) 100%)`;
        opacity = 1;
      }

      ambient.style.background = bg;
      ambient.style.opacity = opacity;
    }

    updateAmbient();
    // Refresh every 5 minutes
    setInterval(updateAmbient, 300000);
  })();

  // Scale markers based on zoom level — smooth curve that keeps pins readable
  function updateMarkerScale() {
    const zoom = map.getZoom();
    // Smoother easing: never below 0.6, reaches 1.0 at zoom 8+
    // Uses ease-out curve so pins stay visible at wide zoom
    const t = Math.min(1, Math.max(0, (zoom - 2) / 6));
    const scale = 0.6 + 0.4 * (1 - Math.pow(1 - t, 2)); // ease-out quad
    document.documentElement.style.setProperty('--marker-scale', scale.toFixed(3));
    // Show/hide name labels based on zoom
    document.documentElement.style.setProperty('--label-opacity', zoom >= 6 ? '1' : '0');
  }
  map.on('zoomend', () => {
    updateMarkerScale();
    _arrangeMarkerRings();
  });
  map.on('zoom', updateMarkerScale);
  map.on('moveend', _arrangeMarkerRings);
  updateMarkerScale(); // set initial scale

  // ── Shift+Click on map → pick nearby city as dispatch destination ──
  map.on('click', _handleMapShiftClick);

  updateMapMarkers();
  fitMapToCreators();
}

// ===========================
// SHIFT+CLICK → CITY PICKER
// ===========================
let _mapPickerEl = null;
let _mapPickerCreatedAt = 0;

function _handleMapShiftClick(e) {
  if (!e.originalEvent.shiftKey) return;

  // Auto-switch to Dispatch tab if not already there
  const isDispatch = document.body.classList.contains('dispatch-mode');
  if (!isDispatch) {
    const dispatchBtn = document.querySelector('.tab-button[data-tab="dispatch"]');
    if (dispatchBtn) dispatchBtn.click();
  }

  const { lat, lng } = e.latlng;

  // Show a loading indicator at click position
  _showMapCityPicker(e.containerPoint, lat, lng);
}

async function _showMapCityPicker(point, lat, lng) {
  // Remove any existing picker
  _dismissMapCityPicker();

  const picker = document.createElement('div');
  picker.className = 'map-city-picker';
  picker.style.left = point.x + 'px';
  picker.style.top = point.y + 'px';
  picker.innerHTML = '<div class="mcp-loading">Finding nearby cities\u2026</div>';
  _mapPickerEl = picker;
  _mapPickerCreatedAt = Date.now();

  const mapContainer = document.getElementById('mapContainer');
  mapContainer.appendChild(picker);
  requestAnimationFrame(() => picker.classList.add('open'));

  try {
    // Single reverse geocode at city level via server proxy (avoids browser CORS issues)
    const res = await fetch(
      `/api/nominatim?endpoint=reverse&format=json&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`
    );
    if (!res.ok) throw new Error(`Geocode proxy returned ${res.status}`);
    const result = await res.json();

    if (!result || result.error || !result.address) {
      picker.innerHTML = '<div class="mcp-empty">No city found here</div>';
      setTimeout(_dismissMapCityPicker, 2000);
      return;
    }

    // Build the city name using simplifyAddress
    const cityName = simplifyAddress(result);
    const cityLat = parseFloat(result.lat);
    const cityLng = parseFloat(result.lon);
    const top = [{ name: cityName, lat: cityLat, lng: cityLng, dist: 0 }];

    if (top.length === 0) {
      picker.innerHTML = '<div class="mcp-empty">No cities found nearby</div>';
      setTimeout(_dismissMapCityPicker, 2000);
      return;
    }

    // Render picker options
    picker.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'mcp-header';
    header.textContent = 'Set destination';
    picker.appendChild(header);

    top.forEach(c => {
      const row = document.createElement('div');
      row.className = 'mcp-option';
      const label = document.createElement('span');
      label.className = 'mcp-option-name';
      label.textContent = c.name;
      row.appendChild(label);
      if (c.dist >= 1) {
        const distLabel = document.createElement('span');
        distLabel.className = 'mcp-option-dist';
        distLabel.textContent = Math.round(c.dist) + ' mi';
        row.appendChild(distLabel);
      }
      row.addEventListener('click', (ev) => {
        ev.stopPropagation();
        // Set as dispatch destination
        document.getElementById('locationFilterInput').value = c.name;
        setDispatchDestination(c.lat, c.lng, c.name);
        _dismissMapCityPicker();
      });
      picker.appendChild(row);
    });

  } catch (err) {
    console.error('City picker geocode error:', err);
    picker.innerHTML = '<div class="mcp-empty">Couldn\u2019t look up cities</div>';
    setTimeout(_dismissMapCityPicker, 2000);
  }
}

function _dismissMapCityPicker() {
  if (_mapPickerEl) {
    _mapPickerEl.classList.remove('open');
    const el = _mapPickerEl;
    setTimeout(() => el.remove(), 200);
    _mapPickerEl = null;
  }
}

// Dismiss picker on Escape or click outside
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') _dismissMapCityPicker();
  // Toggle crosshair cursor hint when Shift is held
  if (e.key === 'Shift') document.body.classList.add('shift-held');
});
document.addEventListener('keyup', (e) => {
  if (e.key === 'Shift') document.body.classList.remove('shift-held');
});
// Clean up if window loses focus while Shift is down
window.addEventListener('blur', () => document.body.classList.remove('shift-held'));

document.addEventListener('click', (e) => {
  // Skip dismiss if picker was just created on this same event loop tick
  if (_mapPickerEl && !_mapPickerEl.contains(e.target) && Date.now() - (_mapPickerCreatedAt || 0) > 300) {
    _dismissMapCityPicker();
  }
});

function fitMapToCreators() {
  const located = creators.filter(c => c.lat && c.lng);
  if (located.length === 0) return;
  if (located.length === 1) {
    map.flyTo([located[0].lat, located[0].lng], 6, { duration: 0.8, easeLinearity: 0.15 });
    return;
  }
  const bounds = L.latLngBounds(located.map(c => [c.lat, c.lng]));
  map.flyToBounds(bounds, { padding: [50, 50], maxZoom: 10, duration: 0.8, easeLinearity: 0.15 });
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
    YouTube: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>'
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
    const selectAllBtn = document.getElementById('julySelectAllBtn');
    const count = selectedIds.size;
    info.textContent = count === 0 ? '0 selected' : `${count} creator${count !== 1 ? 's' : ''} selected`;
    addBtn.disabled = count === 0;

    // Update Select All / Deselect All button
    if (selectAllBtn) {
      const selectable = getFilteredJulyCreators().filter((_, i) => !isAlreadyInRoster(julyCreators[julyCreators.indexOf(_)]));
      const allSelected = selectable.length > 0 && selectable.every((jc) => {
        const idx = julyCreators.indexOf(jc);
        return selectedIds.has(idx);
      });
      selectAllBtn.textContent = allSelected ? 'Deselect All' : 'Select All';
    }
  }

  function selectAll() {
    const filtered = getFilteredJulyCreators();
    // Check if all selectable are already selected
    const selectableIndices = [];
    filtered.forEach(jc => {
      const idx = julyCreators.indexOf(jc);
      if (!isAlreadyInRoster(jc)) selectableIndices.push(idx);
    });

    const allSelected = selectableIndices.length > 0 && selectableIndices.every(i => selectedIds.has(i));

    if (allSelected) {
      // Deselect all visible
      selectableIndices.forEach(i => selectedIds.delete(i));
    } else {
      // Select all visible
      selectableIndices.forEach(i => selectedIds.add(i));
    }
    renderGrid();
    updateFooter();
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
        // Debug: log first creator to see what fields July provides
        if (julyCreators.length > 0) {
          const sample = julyCreators[0];
          console.log('[july-import] Sample creator from scraper:', JSON.stringify(sample, null, 2));
          console.log('[july-import] Has coords?', sample.lat, sample.lng);
          console.log('[july-import] Platform keys:', sample.platforms ? Object.entries(sample.platforms).map(([p, d]) => `${p}: ${Object.keys(d).join(',')}`) : 'none');
        }
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
          followers: data.followers ?? null,
          engagementRate: data.engagementRate ?? null
        };
      });
      // Debug: log first creator's platform data to verify engagement rates
      if (toAdd.length === 0) {
        console.log('[july-import] First creator platform data from scraper:', JSON.stringify(jc.platforms, null, 2));
        console.log('[july-import] Mapped to app format:', JSON.stringify(platforms, null, 2));
      }

      const creator = {
        id: generateId(),
        firstName,
        lastName,
        photo: jc.photo || null,
        email: null,
        mediaKit: null,
        birthday: null,
        platforms,
        niches: jc.niches || [],
        demographics: [],
        location: jc.location || null,
        lat: (jc.lat != null && !isNaN(jc.lat)) ? parseFloat(jc.lat) : null,
        lng: (jc.lng != null && !isNaN(jc.lng)) ? parseFloat(jc.lng) : null,
        notes: jc.bio ? `Imported from July · ${jc.bio.substring(0, 200)}` : 'Imported from July',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      toAdd.push(creator);
    });

    if (toAdd.length === 0) return;

    // Add creators to roster immediately
    creators.push(...toAdd);
    db.persist(creators);
    renderRosterTab();
    updateMapMarkers();
    updateStorageIndicator();

    const withCoords = toAdd.filter(c => c.lat && c.lng).length;
    const needGeocode = toAdd.filter(c => c.location && !c.lat);
    console.log(`[july-import] ${withCoords}/${toAdd.length} have coords from July, ${needGeocode.length} need geocoding`);

    // Close panel
    close();

    if (withCoords > 0) {
      fitMapToCreators();
    }

    if (needGeocode.length > 0) {
      showToast(`📍 Geocoding ${needGeocode.length} remaining locations…`, 'success');
      // Geocode sequentially with 1.1s delay to respect Nominatim's 1 req/sec limit
      let geocoded = 0;
      for (let i = 0; i < needGeocode.length; i++) {
        const creator = needGeocode[i];
        try {
          const results = await searchLocations(creator.location);
          if (results.length > 0) {
            creator.lat = parseFloat(results[0].lat);
            creator.lng = parseFloat(results[0].lon);
            migrateLocation(creator);
            geocoded++;
            if (geocoded % 3 === 0 || i === needGeocode.length - 1) {
              db.persist(creators);
              updateMapMarkers();
            }
          }
        } catch (e) {
          // Skip failed geocodes
        }
        if (i < needGeocode.length - 1) {
          await new Promise(r => setTimeout(r, 1100));
        }
      }
      db.persist(creators);
      updateMapMarkers();
      fitMapToCreators();
      if (geocoded > 0) {
        showToast(`📍 ${geocoded}/${needGeocode.length} locations mapped`, 'success');
      }
    } else {
      showToast(`${toAdd.length} creators added to roster`, 'success');
    }
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
  document.getElementById('julySelectAllBtn').addEventListener('click', selectAll);
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
    creators = await db.load();
    console.log('[init] Loaded', creators.length, 'creators');

    creators.forEach(migratePlatforms);
    creators.forEach(migrateDemographics);
    creators.forEach(migrateLocation);
    db.persist(creators);

    console.log('[init] Rendering UI...');
    renderRosterTab();
    renderDispatchFilters();
    renderDispatchFilterPills();
    console.log('[init] Initializing map...');
    initMap();

    updateRecycleBinBadge();
    updateStorageIndicator();
    migratePhotos(); // compress any oversized legacy photos in the background
    console.log('[init] Done!');

    // Auto-geocode any creators with locations but no coordinates
    geocodeMissing();
  } catch (e) {
    console.error('App initialization failed:', e);
    showToast('Failed to load app data — check console', 'error');
    initMap(); // still show the map
  }
}

// ===========================
// AUTO-GEOCODE RECOVERY
// ===========================
// Finds creators with location text but no lat/lng and geocodes them
// sequentially to respect Nominatim's 1 req/sec rate limit.
async function geocodeMissing() {
  const missing = creators.filter(c => c.location && (!c.lat || !c.lng));
  if (missing.length === 0) return;

  console.log(`[geocode] ${missing.length} creators missing coordinates — geocoding...`);
  showToast(`📍 Geocoding ${missing.length} locations…`, 'success');

  let geocoded = 0;
  for (let i = 0; i < missing.length; i++) {
    const creator = missing[i];
    try {
      const results = await searchLocations(creator.location);
      if (results.length > 0) {
        creator.lat = parseFloat(results[0].lat);
        creator.lng = parseFloat(results[0].lon);
        geocoded++;
        // Update map every 3 geocodes or on last one
        if (geocoded % 3 === 0 || i === missing.length - 1) {
          db.persist(creators);
          updateMapMarkers();
        }
      }
    } catch (e) {
      console.warn(`[geocode] Failed for "${creator.location}":`, e.message);
    }
    // Nominatim: 1 req/sec
    if (i < missing.length - 1) {
      await new Promise(r => setTimeout(r, 1100));
    }
  }

  db.persist(creators);
  updateMapMarkers();
  fitMapToCreators();
  if (geocoded > 0) {
    showToast(`📍 ${geocoded}/${missing.length} locations mapped`, 'success');
  } else if (missing.length > 0) {
    showToast(`Could not geocode ${missing.length} locations`, 'error');
  }
  console.log(`[geocode] Done — ${geocoded}/${missing.length} resolved`);
}

init().catch(e => console.error('Unhandled init error:', e));
