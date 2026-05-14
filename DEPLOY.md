# Deploying SAR Tracker Web to Vercel

## Overview

SAR Tracker Web is a Vite + React SPA that deploys as a **pre-built static site** to Vercel. The build produces a `dist/` folder containing the full client-side application. There are no serverless functions or API routes — the app connects to an external Traccar server at runtime.

## Prerequisites

- Node.js 18+ and npm installed
- Vercel CLI installed (`npm i -g vercel`)
- Vercel token with appropriate scope (see Environment section below)

## Build

```bash
cd ~/workspace/vibes/sartracker-web
npm install
npm run build
```

This runs `tsc -b && vite build && node scripts/check-bundle-size.mjs` and outputs to `dist/`.

Verify the build succeeded:
```bash
ls dist/index.html  # should exist
```

## Vercel Configuration

The project uses a minimal `vercel.json`:

```json
{
  "outputDirectory": "dist",
  "buildCommand": null,
  "installCommand": null
}
```

**What this means:**
- `buildCommand: null` — the project is intended to deploy from local prebuilt output.
- `installCommand: null` — dependencies are not needed at deploy time after the local Vercel build output exists.
- `outputDirectory: "dist"` — Vercel serves the Vite static build output.

This is the Vercel prebuilt deployment pattern. Use `vercel build` to create `.vercel/output`, then deploy that output with `vercel deploy --prebuilt`.

## Deploy Commands

### Production deployment
```bash
cd ~/workspace/vibes/sartracker-web
npm run build
vercel pull --yes --environment production --token=$VERCEL_TOKEN --scope=ocallaghandonal2-1437s-projects
vercel build --prod --token=$VERCEL_TOKEN --scope=ocallaghandonal2-1437s-projects
vercel deploy --prebuilt --prod --token=$VERCEL_TOKEN --yes --scope=ocallaghandonal2-1437s-projects
```

### Preview deployment (staging)
```bash
cd ~/workspace/vibes/sartracker-web
npm run build
vercel pull --yes --environment preview --token=$VERCEL_TOKEN --scope=ocallaghandonal2-1437s-projects
vercel build --token=$VERCEL_TOKEN --scope=ocallaghandonal2-1437s-projects
vercel deploy --prebuilt --token=$VERCEL_TOKEN --yes --scope=ocallaghandonal2-1437s-projects
```

### One-liner (build + deploy)
```bash
cd ~/workspace/vibes/sartracker-web && npm run build && vercel pull --yes --environment production --token=$VERCEL_TOKEN --scope=ocallaghandonal2-1437s-projects && vercel build --prod --token=$VERCEL_TOKEN --scope=ocallaghandonal2-1437s-projects && vercel deploy --prebuilt --prod --token=$VERCEL_TOKEN --yes --scope=ocallaghandonal2-1437s-projects
```

## Environment Variables

### Runtime (Vercel proxy)

The hosted app includes a narrow HTTPS proxy for the team-managed Traccar HTTP server. This avoids browser mixed-content blocking when the Vercel app is served over HTTPS but the upstream Traccar server is still HTTP-only.

| Variable | Purpose | Default |
|---|---|---|
| `TRACCAR_UPSTREAM_URL` | HTTP Traccar upstream used by `/api/session`, `/api/devices`, and `/api/positions` | `http://kmrtsar.ddns.net:8082` |

Operators should enter the hosted app origin, for example `https://sartracker-web.vercel.app`, as the Traccar provider base URL in Settings. The app then calls same-origin HTTPS `/api/...` endpoints and Vercel forwards the allowed requests to the HTTP upstream.

### Build-time (Vite)
These are baked into the bundle at build time via `import.meta.env`:

| Variable | Purpose | Example |
|---|---|---|
| `VITE_TRACCAR_BASE_URL` | Traccar server URL | `https://traccar.yourdomain.com` |
| `VITE_TRACCAR_EMAIL` | Traccar auth email | `admin@example.com` |
| `VITE_TRACCAR_PASSWORD` | Traccar auth password | `secretpassword` |

**For production builds**, override the `.env` defaults before building:
```bash
VITE_TRACCAR_BASE_URL=https://your-production-traccar.com \
VITE_TRACCAR_EMAIL=your@email.com \
VITE_TRACCAR_PASSWORD=yourpassword \
npm run build
```

Or create a `.env.production` file (NOT committed to git):
```
VITE_TRACCAR_BASE_URL=https://your-production-traccar.com
VITE_TRACCAR_EMAIL=your@email.com
VITE_TRACCAR_PASSWORD=yourpassword
```

### Deploy-time (Vercel token)
```bash
export VERCEL_TOKEN=your-vercel-token
```

This token is scoped to `ocallaghandonal2-1437s-projects`.

## .vercelignore

The `.vercelignore` file ensures only the necessary files are uploaded:

```
node_modules/
src-tauri/
src/
tests/
specs/
spikes/
scripts/
docs/
handoff/
tmp/
test-results/
build/
tools/
*.log
*.md
tsconfig*.json
vite.config.ts
vitest.config.ts
playwright.config.ts
postcss.config.js
tailwind.config.js
eslint.config.js
package-lock.json
```

**Note:** `*.md` is in `.vercelignore`, so this DEPLOY.md file itself won't be uploaded. The prebuilt deployment uploads `.vercel/output`, not the source tree.

Do not replace the prebuilt flow with a direct `vercel deploy --prod` source upload unless `.vercelignore` is also changed. A direct remote build excludes `scripts/`, which breaks `npm run build` because `scripts/generate-app-version.mjs` is required.

## SPA Routing

Since this is a single-page app with client-side routing, add a rewrite rule to `vercel.json` if you get 404s on page refresh:

```json
{
  "outputDirectory": "dist",
  "buildCommand": null,
  "installCommand": null,
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

Check if this is already needed by testing deep links after deployment.

## Troubleshooting

### "Framework not detected" or wrong framework
If Vercel ever auto-detects as Vite and tries to build:
- The `buildCommand: null` in vercel.json should prevent this
- If cached project settings override, fix via Vercel dashboard or API:
  ```bash
  curl -X PATCH "https://api.vercel.com/v9/projects/PROJECT_ID?teamId=ocallaghandonal2-1437s-projects" \
    -H "Authorization: Bearer $VERCEL_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"framework": null, "buildCommand": null, "outputDirectory": "dist"}'
  ```

### Build fails locally
```bash
# Check TypeScript errors first
npx tsc --noEmit

# Then build
npm run build
```

### Bundle too large
The build script includes `check-bundle-size.mjs`. If it warns, check for accidentally bundled dependencies.

## CI/CD Integration

For GitHub Actions or similar:
```yaml
- name: Build
  run: npm ci && npm run build
  env:
    VITE_TRACCAR_BASE_URL: ${{ secrets.TRACCAR_URL }}
    VITE_TRACCAR_EMAIL: ${{ secrets.TRACCAR_EMAIL }}
    VITE_TRACCAR_PASSWORD: ${{ secrets.TRACCAR_PASSWORD }}

- name: Deploy to Vercel
  run: vercel deploy --prebuilt --prod --token=${{ secrets.VERCEL_TOKEN }} --yes --scope=ocallaghandonal2-1437s-projects
```
