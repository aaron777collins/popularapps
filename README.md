# Rankwatch

Live App Store chart positions, by country and category — filterable, at a glance.

**[Open the live site →](https://aaron777collins.github.io/popularapps/)**

## What it does

Rankwatch pulls the public iTunes charts feed daily and shows the current
Top Free, Top Paid, and Top Grossing apps for the US App Store, broken out across
26 categories, up to 100 apps deep per list (Apple's feed hard-caps at 100 — no
key or workaround gets you further). You can filter by chart type and category,
search by app or developer name, sort by rank/name/price, and see:

- **Overview stats** — apps in view, category count, last updated time, free vs.
  paid split.
- **Movers** — the biggest rank risers and fallers since the previous data
  refresh, once at least two days of history exist.
- **Rank history** — click any app to see its chart position over time.

No backend, no build step. It's a static site that reads two JSON files.

## How it's built

```
scripts/fetch-data.mjs          Fetches the charts, writes data/latest.json and data/history.json
Jenkinsfile                     Runs the fetch daily on Jenkins (dev3), commits the result
.github/workflows/update-data.yml   Manual fallback (workflow_dispatch only) if Jenkins is down
.github/workflows/deploy-pages.yml  Deploys the repo to GitHub Pages on every push to main
index.html, assets/             The dashboard itself — plain HTML/CSS/JS, Chart.js for charts
```

Data source: Apple's public iTunes RSS charts
(`itunes.apple.com/{country}/rss/{chart}/limit=100/genre={id}/json`). No API key
needed. `data/history.json` keeps the last 30 daily snapshots per country/chart/
category, top 100 apps per snapshot — that's what powers the movers panel and
rank-history charts.

## Jenkins setup (one-time, on dev3)

The daily fetch runs on Jenkins instead of GitHub Actions, because dev3 is
Aaron's own box and it's free to run there. To wire it up:

1. **Add the deploy key as a Jenkins credential.**
   A dedicated, write-scoped SSH deploy key for this repo already exists (public
   half registered on GitHub — or waiting to be, if that step hasn't been
   approved yet). Grab the private half wherever it was generated, then in
   Jenkins: **Manage Jenkins → Credentials → (System) → Global credentials →
   Add Credentials**
   - Kind: `SSH Username with private key`
   - ID: `popularapps-deploy-key` (must match exactly — the Jenkinsfile
     references this ID)
   - Username: `git`
   - Private key: paste the private key contents
2. **Create the job.** New Item → Pipeline (or Multibranch Pipeline) →
   - Pipeline script from SCM
   - SCM: Git, repo URL `git@github.com:aaron777collins/popularapps.git`,
     credential: the one from step 1
   - Script path: `Jenkinsfile`
3. **Check the agent has Node 20+.** The Jenkinsfile runs `node
   scripts/fetch-data.mjs` directly on whatever agent picks up the job (`agent
   any`). If that agent is a stripped-down container without Node installed,
   either install Node in that image or change the `agent` block in
   `Jenkinsfile` to a Docker agent (e.g. `agent { docker { image 'node:22' }
   }`) — this wasn't verified end-to-end, confirm on the first run.
4. Trigger a build manually once to confirm it pushes correctly, then let the
   `cron('H 6 * * *')` schedule in the Jenkinsfile take over.

## Running it locally

```bash
python3 -m http.server 8000
```

then open `http://localhost:8000`. (Opening `index.html` directly via `file://`
won't work — the browser blocks `fetch()` of local JSON files under that
protocol.)

To refresh the data yourself:

```bash
node scripts/fetch-data.mjs
```

## Extending it

- **More countries**: add entries to the `COUNTRIES` array in
  `scripts/fetch-data.mjs`. The frontend already reads the country list from the
  data file, so no UI changes are needed.
- **More categories**: Apple's genre IDs are listed at the top of
  `scripts/fetch-data.mjs`.
