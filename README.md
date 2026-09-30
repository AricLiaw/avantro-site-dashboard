# Avantro Project – Construction Progress Dashboard

A working web application for tracking construction progress across **Tower A, Tower B and SAMM**
(Architectural, C&S and M&E), from **Project → Tower → Floor → Zone/Unit → Trade → Activity**.

* Site engineers and supervisors submit daily progress from a phone.
* The Project Manager approves updates and sees what is complete, what is late, where the blockers are, who is responsible and what needs attention today.
* Everything is stored in a local SQLite database (`data/avantro.db`), photos in `data/uploads/`.
* **No installation step and no external services**: the server uses only what ships with Node.js.

---

## 1. Run it

Requires **Node.js 22.5 or newer** (24 recommended) – <https://nodejs.org>.

**Windows:** double-click `start.bat`
**Any OS:** `node server/index.js`

Then open <http://localhost:3000>. The console also prints a `http://192.168.x.x:3000` address – open that on phones/tablets
on the same Wi-Fi.

| Setting | How |
|---|---|
| Port / host | `PORT=8080 HOST=0.0.0.0 node server/index.js` (defaults `3000`, `0.0.0.0`) |
| Data folder | `AVANTRO_DATA=D:\avantro-data node server/index.js` |
| Start with an empty project (no demo) | `AVANTRO_SEED=empty node server/index.js` – creates one `admin` account; a random temporary password is printed once and must be changed at first sign-in |
| Regenerate the demo data | `node server/index.js --reseed` (**deletes everything**) |
| Run the automated checks | `node server/selftest.js` (uses a temporary database) |

### Demonstration data
On the first start (unless `AVANTRO_SEED=empty`) the app loads **clearly labelled demonstration data**: 3 towers with
different floor counts and layouts, 680 activities, ~3,200 progress updates (approved, pending, rejected and draft), 21 issues, 12 milestones and ~50 photos.
A **DEMONSTRATION DATA** badge is shown in the header. Dates are generated relative to today.

Demo accounts (all share the password `Avantro#Demo25`; the sign-in page lists them):

| Username | Role |
|---|---|
| `pm.demo` | Project Manager |
| `admin.demo` | Administrator |
| `eng.a.arch`, `eng.a.cs`, `eng.a.me` (also `.b.` and `.samm.`) | Site Engineer (one per tower × trade) |
| `sup.a.arch` … | Supervisor |

**Before real use:** Administration → *Project data* → type `RESET`. That removes all demo towers, activities, updates,
photos and demo users (keeping your own account) and turns demo mode off. Then create your own users and structure.

---

## 2. Roles and what the server enforces

Permissions are checked **in the backend on every request** (not just hidden in the UI).

| | Project Manager | Site Engineer / Supervisor | Administrator |
|---|---|---|---|
| Overview, towers, heat map, reports (PDF/Excel) | ✔ | – (sees *My work* only) | ✔ |
| See activities, updates, issues, photos | all | **only activities assigned to them** | all |
| Enter progress, manpower, photos, issues | – | ✔ (assigned areas only) | – |
| Approve / reject / withdraw approval | ✔ | – | – |
| Raise / comment on issues | ✔ | ✔ | ✔ |
| Close issues | ✔ | – (can mark *Resolved* with evidence) | ✔ |
| Towers, floors, zones, activities, weights, baselines, users, catalog, settings | view status + audit | – | ✔ |

Engineer and Supervisor have the same rights; both are limited to activities where they are the responsible engineer or supervisor
(set by the Administrator).

---

## 3. How progress is calculated

* **Activity progress** = *approved* cumulative quantity ÷ total scope quantity. Activities that cannot be measured by quantity use
  **milestones** (each with a weight); progress = approved milestone weight ÷ total milestone weight.
* **Roll-up** uses agreed weights, never a simple average. Each activity's effective weight is
  `tower weight × trade weight (within tower) × activity weight (within tower + trade)`, each normalised. Every trade, floor, tower,
  project or filtered view is one weighted mean of activity progress, so filters always stay consistent.
* **Pending is separate.** A submitted update is *pending* and shown in "awaiting approval" – it does **not** change progress until approved.
  Withdrawing an approval removes it again.
* **Planned** progress is linear between an activity's baseline start and finish dates. **Variance** = actual − planned, in percentage points.
* **Schedule health** (thresholds in Administration → Settings; defaults 5 / 15 pp): *On Track*, *At Risk* (variance ≤ −5 pp or on hold),
  *Delayed* (variance ≤ −15 pp, or past planned finish and not complete), *Completed*. Always shown as icon + text, not colour alone.
* **Not configured.** Missing scope, milestones, weights or baseline dates produce **"Not configured"** instead of a misleading number.
  Activities without a weight are excluded from roll-ups and reported (Administration → *Configuration status*).
* **Quantity safeguards:** one entry per activity per day; quantities above the defined scope cannot be submitted and cannot be approved
  (revise the scope first – it is audited); "copy previous day" copies people/manpower/status but **never quantities, photos or issues**.
* **Audit trail:** every create, edit, submit, recall, approve, reject, withdrawal, issue change, photo upload, baseline change (scope,
  weights, dates – a reason is required to change an agreed value), user change and sign-in is recorded (Administration → *Audit trail*, and per record).

---

## 4. Setting up your real project

1. **Administration → Structure & weights** – add each tower/building with its own floors and zones (`Level 1-12, Roof` style ranges work), then set tower and trade weights.
2. **Administration → Activities & baseline** – *Generate from catalog* creates activities for chosen floors/zones (or add one), then fill in scope, weights, baseline dates and responsible people in the grid.
   Use *Bulk edit* to assign people or shift dates. Customise the standard activities in *Activity catalog*.
3. **Administration → Users** – create users (a temporary password is shown once), then assign them to activities.
4. Add project **milestones** on the Schedule page. Check **Configuration status** for anything still "Not configured".

---

## 5. Daily use

**Site (phone):** *My Work* → tap an activity that is due (or *New progress update*) → enter today's quantity → *Submit*. The form shows
scope, approved to date, awaiting approval and a live cumulative % / over-scope warning, with big buttons, searchable pickers, a manpower stepper, camera/gallery photos with captions
and an issue/blocker block. *Save draft* any time. *Quick entry* enters several activities on one screen; *Copy previous day* pre-fills them.

**Project Manager (desktop):** *Overview* answers "what needs my attention today" first (approvals, delays, blockers, overdue, outdated updates, decisions),
then completion by project/tower/trade, planned-vs-actual curves, a floor-by-floor heat map and lists. Every tile, bar, curve point, heat-map cell and count
opens the underlying records. *Progress Updates* approves/rejects singly or in bulk.

**Reports:** daily / weekly / monthly, on screen or as **PDF** and **Excel** (progress summaries, trade planned-vs-actual, work completed, delays, blockers and decisions,
manpower, photos, upcoming activities and milestones).

---

## 6. Security notes

* Passwords hashed with scrypt; server-side sessions in an `HttpOnly`, `SameSite=Strict` cookie (`Secure` behind HTTPS); 6 failed sign-ins per 15 minutes are throttled.
* CSRF: custom-header requirement plus `Origin` check on every state-changing request. Strict Content-Security-Policy; all dynamic text is HTML-escaped.
* Uploads are content-sniffed (JPEG/PNG/WebP only), size-limited, stored under random names and served only to authorised users.
* The app speaks plain HTTP. For access outside your site network put it behind an HTTPS reverse proxy (Caddy, nginx, IIS) – the cookie becomes `Secure` automatically
  when `X-Forwarded-Proto: https` is sent.
* Back up by copying the `data/` folder while the server is stopped.

## 6b. Putting it on a public domain

Vercel/Netlify-style serverless hosting will **not** work (no persistent disk; this app stores SQLite + photos on disk).
Use a host that runs a normal container with a persistent volume: **Render**, **Railway**, **Fly.io**, or any VPS.
A `Dockerfile` and a Render `render.yaml` are included.

1. Put this folder in a Git repository (GitHub) and connect it to the host (Render: *New > Blueprint*).
2. Mount a persistent volume at `/data` (already declared in `render.yaml`; on Railway/Fly add a volume with mount path `/data`).
3. Set `AVANTRO_SEED=empty` so the public site starts blank. The one-time `admin` password is printed in the service logs; you must change it at first sign-in.
   (If you do want the demo online, also set `AVANTRO_DEMO_PASSWORD` to a long random value; otherwise the published default in this README would let anyone in.)
4. Add your custom domain in the host's dashboard; HTTPS is automatic and the session cookie becomes `Secure`.
5. Back up the `/data` volume (host snapshots, or copy `avantro.db` + `uploads/`).

## 7. Not included / good to know

* No e-mail/push notifications, no offline mode (needs a connection; drafts are saved on the server), no Excel *import* (activities can be exported to Excel; edit them in the grid).
* Calendar-day planning (no working-day calendars); planned progress is linear between start and finish.
* Photos are resized on the phone (max 1600 px, JPEG) before upload.

## 8. Layout

```
server/   index.js (HTTP)  db.js (SQLite schema)  calc.js (progress engine)  routes-*.js (API + permissions)
          reports.js  pdf.js  xlsx.js (exports)  seed.js (demo data)  selftest.js (checks)
public/   index.html  css/app.css  js/core.js charts.js app.js  js/pages/*.js
data/     avantro.db, uploads/   (created on first run)
```
