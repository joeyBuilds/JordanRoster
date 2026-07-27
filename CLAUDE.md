# Creator Roster & Dispatch

## Overview
A single-page HTML web app for managing a roster of creators and quickly dispatching them to brand requests. Core workflow: brand requests a creator profile (e.g., "Instagram lifestyle creator near Seattle") → use dispatch filters → map highlights matching creators → pick best fits.

**Files:** `index.html` (entry point), `app.js` (frontend logic), `styles.css` (styling), `db.js` (Supabase data layer)

## Tech Stack
- **Leaflet.js** — interactive map with CartoDB light tiles + sepia filter
- **Nominatim API** — free OpenStreetMap geocoding with debounced autocomplete
- **Supabase** — cloud persistence via `db.js` abstraction layer (creators, creator_platforms, creator_niches, creator_demographics, creator_collabs tables)
- **Google Fonts** — DM Sans (body) + Playfair Display (headings)
- **Aesthetic** — "lo-fi cozy girl chic" warm palette

## Data Model

### Creator Object
```javascript
{
  id, firstName, lastName, photo,
  platforms: ['Instagram', 'TikTok'],   // multi-select
  niches: ['Lifestyle', 'Outdoor & Adventure'],  // multi-select
  tier: 'Micro (10K-100K)',             // single-select or null
  tags: [],  // legacy, unused
  location, lat, lng, notes, createdAt, updatedAt
}
```

### Constants
```javascript
const PLATFORMS = ['Instagram', 'TikTok', 'YouTube'];
const PLATFORM_ICONS = { 'Instagram': '📸', 'TikTok': '🎵', 'YouTube': '▶️' };
const PRESET_NICHES = [
  'Lifestyle', 'Beauty', 'Fitness', 'Food & Drink', 'Fashion', 'Travel',
  'Tech', 'Gaming', 'Parenting', 'Pets', 'Comedy', 'Education', 'Music',
  'Outdoor & Adventure', 'Couples', 'International', 'Van Life'
];
const TIERS = ['Nano (<10K)', 'Micro (10K-100K)', 'Mid (100K-500K)', 'Macro (500K-1M)', 'Mega (1M+)'];
function getAllNiches() { /* returns PRESET_NICHES + any custom niches found in roster */ }
```

### Key Design Decisions
- **Name split**: `firstName` + `lastName` fields, with `getFullName(c)` helper (falls back to legacy `c.name`)
- **No partnerships/status/VIP**: Removed in favor of dispatch-focused workflow
- **Data layer**: `db.load()`, `db.save()`, `db.persist()` provide Supabase CRUD operations with optimistic local caching.

### Data Safety Rules (db.js)
- `db.load()` **throws** on query error or 15s timeout — it never silently returns `[]`. A failed load sets an internal `_loadFailed` flag that **blocks all writes** (`persist`/`save`/`_syncAll`) until a load succeeds, so a bad session can never wipe the cloud roster.
- `db.save([])` (full wipe) requires an explicit `{ allowEmpty: true }` — only the Reset All flow passes it. Import uses `db.save(creators)` for intentional full replaces.
- `db._syncAll()` refuses suspicious bulk deletes: an empty in-memory array against a populated DB, or deleting >10 creators when that's more than half the DB.
- `init()` renders a visible "Couldn't load your roster" + Retry state on load failure, and a "Roster is empty — Sync from July" CTA when the DB is healthy but empty.

## Features

### Sidebar Tabs
- **Roster tab**: Creator list with search, sort (A-Z, newest), and creator cards showing compact meta line (`📸 🎵 | Lifestyle | Micro`)
- **Dispatch tab**: Dropdown-style multi-select filters for Platform, Niche, Tier + text location filter. OR logic within each filter category. Filters also control which markers appear on the map. Results count shown.

### Map
- Leaflet with sepia filter, bounded scrolling (`maxBounds + noWrap`)
- Clicking a marker directly opens the creator's radial info ring (no popup)
- Map saves zoom state before flying to a creator; restores on ring close

### Radial Info Ring
- `renderRing(creator)` — overlay positioned over map with:
  - Creator avatar (center)
  - Platform pills orbiting upper-left
  - Tier pill orbiting bottom
  - Niches stacked vertically on right side
  - Frosted-glass name card below
  - Edit / Delete action buttons
  - Close button (×) upper-right of avatar
- `closeDetailPanel()` — fades ring, restores map zoom via `mapStateBeforeDetail`
- Map scrim click also closes

### Add/Edit Creator Modal
- Ergonomic vertical flow: Photo → Name (first+last side-by-side) → Platforms (vertical checkboxes with custom check icons) → Niches (dropdown with preset suggestions + custom freeform via Enter) → Tier (vertical radio with custom dots) → Location (Nominatim autocomplete) → Notes
- Niche dropdown: click-to-open, filterable text input, selected pills with × remove, custom niche entry via typing + Enter

### Other
- **Import/Export**: JSON data portability
- **Async save**: Falls back to geocoding on save if user typed location without selecting from autocomplete

## API Layer (Vercel Serverless Functions)
- `api/scrape-july.js` — scrapes july.bio/iamsocial roster, returns normalized creator data (called by frontend Import panel)
- `api/sync-july.js` — scrapes July + syncs to Supabase (daily cron at 8am UTC)
- `api/july-helpers.js` — shared scraping/parsing utilities used by both July functions
- `api/nominatim.js` — proxy for Nominatim geocoding (avoids browser CORS)

## Automated Sync
- Vercel cron runs `api/sync-july` daily at 08:00 UTC (configured in vercel.json)
- Function timeout: scrape-july=120s, sync-july=180s, memory=512MB (do NOT lower sync-july below ~180s — a cold-cache run of ~50 creators needs it)
- **Differential sync**: roster-page fingerprints (`sync_cache` table, keyed on `july_username`) mean unchanged creators are skipped; typical warm runs are 2-3s
- **Time budget**: enrichment/photo work stops at 120s elapsed and the run proceeds to DB writes, returning `partial: true`; budget-skipped creators get no cache row so the next run finishes them. Creator rows always land before the timeout.
- **No server-side geocoding** in the sync path — new/moved creators are written with `lat/lng: null` and the frontend's `geocodeMissing()` fills coordinates client-side (~1.1s/creator, Nominatim rate limit)
- **`?force=true`**: full refresh that also *restores* creators present in `sync_cache` but missing from the DB (recovery after accidental data loss). Normal syncs respect user deletions.
- Sync response shape: `{ success, added, updated, unchanged, partial, cacheWarning, total, syncedAt }`

## Known Security Posture (accepted risk, follow-up recommended)
- The Supabase anon key is public in `db.js` and RLS policies are fully permissive — anyone with the site URL can read/write/delete the roster. Real fix: restrictive RLS + auth, or route writes through serverless functions holding a service key.
- `/api/sync-july` is publicly callable (no CRON_SECRET).

## CSS Color Palette
```css
:root {
  --bg-primary: #F7F0E8;  --bg-secondary: #FFF9F4;  --accent: #C8907E;
  --text-primary: #4E3D36; --text-secondary: #7D6B63;
  --success: #8EAE8B;  --danger: #C97B7B;
  --lavender: #BBA7CF; --sage: #9BB5A0; --rose: #D4A0A0; --mocha: #A67F72;
  --tag-platform: #6E9A76; --tag-niche: #B09556; --tag-tier: #8E78A6;
}
```

## Future Plans
- Visual analytics upgrade (donut charts, heatmap, timeline) for dashboard
