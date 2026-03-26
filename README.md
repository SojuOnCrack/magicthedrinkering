# CommanderForge

Commander deck builder with Supabase sync, a Scryfall proxy, and offline support.

## Structure

```text
/
|-- index.html
|-- manifest.json
|-- sw.js
|-- _headers
|-- _redirects
|-- wrangler.toml
|-- .dev.vars.example
|-- README.md
|-- supabase_schema.sql
|-- functions/
|   |-- api/
|   |   |-- auth/
|   |   |   `-- callback.js
|   |   |-- moxfield/
|   |   |   `-- [id].js
|   |   `-- scryfall/
|   |       `-- [[path]].js
|-- css/
|   `-- main.css
`-- js/
    |-- auth.js
    |-- community.js
    |-- core.js
    |-- features.js
    |-- forge.js
    |-- ui.js
    `-- vault.js
```

## Cloudflare Pages

### Option A: Git integration

1. Push the repo to GitHub or GitLab.
2. Open Cloudflare Dashboard.
3. Go to `Workers & Pages` -> `Create application` -> `Pages` -> `Connect to Git`.
4. Select the repository.
5. Use these settings:
   - Framework preset: `None`
   - Build command: leave empty
   - Build output directory: `.` or `/`
6. Deploy.

### Option B: Wrangler CLI

```bash
npm install -g wrangler
wrangler login
wrangler pages deploy . --project-name commanderforge
```

## Supabase setup

Add these redirect URLs in Supabase under `Authentication -> URL Configuration -> Redirect URLs`:

```text
https://commanderforge.pages.dev/api/auth/callback
https://YOUR-CUSTOM-DOMAIN.com/api/auth/callback
http://localhost:8788/api/auth/callback
```

Run the schema in [supabase_schema.sql](/c:/Users/batikan.kayar/Desktop/MagicTheDrinkering/magicthedrinkering/supabase_schema.sql).

## Local development

```bash
cp .dev.vars.example .dev.vars
wrangler pages dev . --port 8788
```

Then open `http://localhost:8788`.

## Notes

- Frontend: vanilla HTML, CSS, and JS
- Database and auth: Supabase
- Card data: Scryfall via `/api/scryfall`
- Hosting: Cloudflare Pages
- Offline: service worker plus IndexedDB
