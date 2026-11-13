# CommanderForge

CommanderForge is a browser-based Magic: The Gathering Commander deck builder and collection/community app.

## Features

- Commander deck building, import/export, and deck analysis
- Local persistence with IndexedDB and localStorage
- Optional Supabase authentication, cloud sync, sharing, comments, reactions, and community tools
- Scryfall card data through a Cloudflare Pages Function proxy
- Optional Moxfield deck import proxy
- Offline support through a service worker and cached card images
- Responsive desktop and mobile interface

## Technology

- Frontend: vanilla HTML, CSS, and JavaScript
- Hosting and API proxy: Cloudflare Pages Functions
- Authentication and database: Supabase
- Card data: Scryfall API
- External deck import: Moxfield API

## Repository layout

```text
/
|-- index.html
|-- tracker/
|   `-- index.html
|-- css/
|   |-- main.css
|   |-- tracker-live.css
|   `-- tracker-multiplayer.css
|-- js/
|   |-- auth.js
|   |-- community.js
|   |-- core.js
|   |-- deck-health.js
|   |-- features.js
|   |-- forge.js
|   |-- mobile-nav.js
|   |-- price-proxy.js
|   |-- settings.js
|   |-- share.js
|   |-- trade-match.js
|   |-- ui.js
|   `-- vault.js
|-- functions/api/
|   |-- auth/callback.js
|   |-- moxfield/[id].js
|   `-- scryfall/[[path]].js
|-- supabase_schema.sql
|-- supabase_security_hardening.sql
|-- sw.js
|-- manifest.json
|-- _headers
|-- _redirects
|-- wrangler.toml
`-- README.md
```

## Deploy with Cloudflare Pages

1. Connect this repository to Cloudflare Pages.
2. Choose **None** as the framework preset.
3. Leave the build command empty.
4. Set the build output directory to `.`.
5. Deploy the `main` branch (or your chosen release branch).

The project uses Pages Functions under `functions/api`; deploy the repository root as the Pages output directory so those functions are included.

## Local development

Install Wrangler and authenticate with Cloudflare:

```bash
npm install --global wrangler
wrangler login
wrangler pages dev . --port 8788
```

Open `http://localhost:8788`.

## Supabase configuration

1. Create or select the Supabase project.
2. Review and apply `supabase_schema.sql` to the project's SQL editor.
3. Apply `supabase_security_hardening.sql` immediately after the base schema. It restricts profile email access, hardens community RLS policies, and adds supporting indexes. Tracker (`mp_*`) tables are intentionally excluded.
4. In **Authentication → URL Configuration**, add the deployed app's `/api/auth/callback` URL and your local callback URL.
5. In **Authentication → Security and Protection**, enable leaked-password protection.
6. Confirm Row Level Security policies are enabled and appropriate for every table used by the app.

The frontend uses a Supabase publishable key. Publishable keys are intended for browser use; database access must be protected by RLS policies. Never put a Supabase secret/service-role key in frontend code.

## Quality checks

The repository includes dependency-free checks for JavaScript syntax and the Cloudflare Pages API proxies:

```bash
npm run verify
```

GitHub Actions runs the same checks for pushes to `main` and pull requests targeting `main`. The tracker JavaScript is intentionally excluded from the app syntax pass.

## Notes

- The Scryfall proxy allows read requests and the `/cards/collection` batch endpoint.
- Moxfield import is a best-effort integration because upstream API endpoints can change.
- Third-party price comparisons are shown only when a real provider response is available. The app does not generate placeholder market prices.
- The multiplayer tracker is maintained separately from the main application changes.
