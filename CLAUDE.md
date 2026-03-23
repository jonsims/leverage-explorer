# Leverage Explorer

Interactive classroom tool for SES2000 Session 16 — Distribution & Storage. Students classify interventions into Fischer's four realms (Parameters, Feedbacks, Design, Intent) and explore documented "chains of leverage."

## Commands

```bash
npm start          # Run server
npm run dev        # Run with --watch for auto-reload
```

## Quick Start (Class Day)

```bash
cd "/Users/jonsims/Desktop/Working drafts/SES Working/Session 16 - Distribution and Storage/leverage-explorer"
node server.js &
cloudflared tunnel --url http://localhost:3007 --no-autoupdate
```

Then:
1. Copy the `trycloudflare.com` URL from the tunnel output
2. Go to `<tunnel-url>/admin` — PIN is `1234`
3. Paste the tunnel URL into the QR field if it didn't auto-detect, click Regenerate
4. Open `<tunnel-url>/display` on the projector
5. Run through phases: Waiting → Food → Data → Chains → Discussion

## Architecture

Single-file Express server (`server.js`) with all state in memory. No database — data resets on server restart.

**Three pages served from `public/`:**
- `index.html` — Student mobile view. Shows only the active phase. Classifications and visitorId persist in localStorage.
- `admin.html` — Instructor control panel with PIN gate. Controls phases, chain selection, QR code, and which student submissions appear on display.
- `display.html` — Full-screen projector view. Polls `/api/state` every 2 seconds. Shows classification bar charts (food/data separately), chain diagrams, and highlighted student submissions.

**Phases:** `waiting` → `classify-food` → `classify-data` → `chains` → `discuss`

**Admin controls which chain students see** during the chains phase. Students don't browse freely.

## Environment

Requires `.env` with: `ADMIN_PIN` (default: 1234), `PORT` (default: 3007 locally, 10000 on Render).

## Deployment

- **Local dev:** `https://local.leverage-explorer` via Caddy (port 3007)
- **Classroom:** Cloudflare quick tunnel (new URL each time — copy from output)
- **Backup:** Render at `leverage-explorer.onrender.com` (auto-deploys on push to master, free tier, cold starts ~30s)
- **GitHub:** github.com/jonsims/leverage-explorer

## Testing

Admin panel has a "Load Test Data" button that generates 44 simulated students with realistic classification distributions and 12 team chain submissions.

## Key Reliability Features

- Student visitorId and classifications persist in localStorage (survives iOS Safari reloads, phone sleep)
- Chain submissions deduped per visitor (reload won't create duplicates)
- Admin login doesn't reset phase (safe to refresh admin mid-class)
- Polling pauses when page is hidden (reduces load from locked phones)
- Connection warning banner shows after 3 consecutive poll failures
- Server stays alive on uncaught exceptions (protects in-memory data)
- QR SVG only included in poll response during waiting phase (reduces payload)

## Files

```
server.js              — Express server, all routes, data, dummy data generator
public/index.html      — Student mobile view
public/admin.html      — Instructor control panel
public/display.html    — Projector display
.env                   — PIN + port config
render.yaml            — Render deployment config
```
