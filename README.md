# CommanderForge — Cloudflare Pages Deployment

Commander MTG Deckbuilder mit Supabase Cloud-Sync, Scryfall-Karten-API und Offline-Support.

## Dateistruktur

```
/
├── index.html              ← App (Single-File, ~500KB)
├── manifest.json           ← PWA Manifest
├── sw.js                   ← Service Worker (Offline + Bild-Cache)
├── _headers                ← Cloudflare: Security & Cache-Control Header
├── _redirects              ← Cloudflare: SPA-Fallback-Route
├── wrangler.toml           ← Cloudflare Pages Konfiguration
├── .dev.vars.example       ← Vorlage für lokale Secrets (→ .dev.vars)
├── .gitignore
├── README.md
└── functions/
    ├── api/scryfall/
    │   └── [[path]].js     ← Edge Proxy für Scryfall API (mit Caching)
    └── auth/
        └── callback.js     ← Supabase OAuth Callback Handler
```

---

## Deployment auf Cloudflare Pages

### Option A — Git-Integration (empfohlen)

1. Repo auf GitHub/GitLab pushen
2. [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
3. Repo auswählen
4. Build-Einstellungen:
   - **Framework preset:** `None`
   - **Build command:** *(leer lassen)*
   - **Build output directory:** `/` oder `.`
5. **Save and Deploy**

### Option B — Wrangler CLI (direkt)

```bash
# Wrangler installieren
npm install -g wrangler

# Einloggen
wrangler login

# Deployen
wrangler pages deploy . --project-name commanderforge
```

---

## Supabase-Konfiguration

### Redirect URLs eintragen

Im [Supabase Dashboard](https://supabase.com/dashboard) unter  
**Authentication → URL Configuration → Redirect URLs** folgendes eintragen:

```
https://commanderforge.pages.dev/auth/callback
https://DEINE-CUSTOM-DOMAIN.com/auth/callback
http://localhost:8788/auth/callback
```

### Erforderliche Tabellen (SQL)

```sql
-- Decks
create table decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text not null,
  commander text default '',
  partner text default '',
  cards text default '[]',
  public boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table decks enable row level security;
create policy "Users own their decks" on decks
  for all using (auth.uid() = user_id);

-- Profile
create table profiles (
  id uuid primary key references auth.users,
  email text,
  username text
);
alter table profiles enable row level security;
create policy "Profiles are public" on profiles for select using (true);
create policy "Users manage own profile" on profiles for all using (auth.uid() = id);

-- Shared Decks
create table shared_decks (
  token text primary key,
  deck_name text,
  commander text,
  partner text,
  cards text,
  created_at timestamptz default now()
);
alter table shared_decks enable row level security;
create policy "Shared decks are public" on shared_decks for select using (true);
create policy "Authenticated can share" on shared_decks for insert with check (auth.role() = 'authenticated');

-- Trade List
create table trade_list (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  user_email text,
  card_name text,
  condition text,
  note text,
  created_at timestamptz default now()
);
alter table trade_list enable row level security;
create policy "Trade list is public" on trade_list for select using (true);
create policy "Users manage own trades" on trade_list for all using (auth.uid() = user_id);

-- Wishlist
create table wishlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  user_email text,
  card_name text,
  note text,
  created_at timestamptz default now()
);
alter table wishlist enable row level security;
create policy "Users own their wishlist" on wishlist for all using (auth.uid() = user_id);

-- Bulk Pool
create table bulk_pool (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  user_email text,
  card_name text,
  qty integer default 1,
  condition text default 'NM',
  note text,
  price_usd numeric(10,2) default 0,
  created_at timestamptz default now()
);
alter table bulk_pool enable row level security;
create policy "Bulk pool is public" on bulk_pool for select using (true);
create policy "Users manage own pool entries" on bulk_pool for all using (auth.uid() = user_id);

-- Friendships
create table friendships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  friend_id uuid references auth.users not null,
  unique(user_id, friend_id)
);
alter table friendships enable row level security;
create policy "Users manage own friendships" on friendships for all using (auth.uid() = user_id);

-- Deck Comments
create table deck_comments (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid references decks,
  user_id uuid references auth.users not null,
  user_email text,
  text text not null,
  created_at timestamptz default now()
);
alter table deck_comments enable row level security;
create policy "Comments on public decks are public" on deck_comments for select using (true);
create policy "Authenticated users can comment" on deck_comments for insert with check (auth.role() = 'authenticated');
create policy "Users delete own comments" on deck_comments for delete using (auth.uid() = user_id);
```

---

## Lokale Entwicklung

```bash
# .dev.vars anlegen
cp .dev.vars.example .dev.vars
# (Werte ggf. anpassen)

# Dev-Server starten (Port 8788)
wrangler pages dev . --port 8788
```

Öffne dann [http://localhost:8788](http://localhost:8788)

---

## Was der Cloudflare Edge Proxy bringt

| Ohne Proxy | Mit `/api/scryfall/` Proxy |
|---|---|
| Browser → Scryfall direkt | Browser → Cloudflare Edge → Scryfall |
| Kein Edge-Caching | Antworten bis 24h gecacht |
| Rate-Limit trifft jeden User | Rate-Limit aufgeteilt auf Cloudflare IPs |
| Kein User-Agent (Scryfall ToS) | Korrekter User-Agent gesetzt |
| Bulk-Download belastet User-Bandbreite | Bulk-Download über Cloudflare CDN |

---

## Technologie

- **Frontend:** Vanilla HTML/CSS/JS, Single-File-App (~500KB)
- **Datenbank:** [Supabase](https://supabase.com) (PostgreSQL + Auth + Realtime)
- **Karten-API:** [Scryfall](https://scryfall.com/docs/api) (via Cloudflare Edge Proxy)
- **Hosting:** [Cloudflare Pages](https://pages.cloudflare.com)
- **Offline:** Service Worker + IndexedDB (~20MB Kartendatenbank)
