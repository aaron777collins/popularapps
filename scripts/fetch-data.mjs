#!/usr/bin/env node
// Fetch Apple iTunes RSS app charts and write data/latest.json + data/history.json.
// Zero-dependency, Node 20+. Run: node scripts/fetch-data.mjs

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const COUNTRIES = [
  { code: "us", name: "United States" },
];

const CHARTS = [
  { id: "top-free", name: "Top Free" },
  { id: "top-paid", name: "Top Paid" },
  { id: "top-grossing", name: "Top Grossing" },
];

const CHART_SLUGS = {
  "top-free": "topfreeapplications",
  "top-paid": "toppaidapplications",
  "top-grossing": "topgrossingapplications",
};

// "all" is synthetic: it means "no genre param", i.e. the overall chart.
const CATEGORIES = [
  { id: "all", name: "All Categories" },
  { id: "6000", name: "Business" },
  { id: "6001", name: "Weather" },
  { id: "6002", name: "Utilities" },
  { id: "6003", name: "Travel" },
  { id: "6004", name: "Sports" },
  { id: "6005", name: "Social Networking" },
  { id: "6006", name: "Reference" },
  { id: "6007", name: "Productivity" },
  { id: "6008", name: "Photo & Video" },
  { id: "6009", name: "News" },
  { id: "6010", name: "Navigation" },
  { id: "6011", name: "Music" },
  { id: "6012", name: "Lifestyle" },
  { id: "6013", name: "Kids" },
  { id: "6014", name: "Games" },
  { id: "6015", name: "Finance" },
  { id: "6016", name: "Entertainment" },
  { id: "6017", name: "Education" },
  { id: "6018", name: "Books" },
  { id: "6020", name: "Medical" },
  { id: "6021", name: "Magazines & Newspapers" },
  { id: "6023", name: "Food & Drink" },
  { id: "6024", name: "Shopping" },
  { id: "6026", name: "Developer Tools" },
  { id: "6027", name: "Graphics & Design" },
];

const REQUEST_PAUSE_MS = 900;
const RETRY_PAUSE_MS = 5000;
const HISTORY_TOP_N = 100;
const HISTORY_MAX_ENTRIES = 30;

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const latestPath = path.join(dataDir, "latest.json");
const historyPath = path.join(dataDir, "history.json");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Dev-only filters (CATEGORIES / CHARTS env vars). They restrict what gets
// fetched; the full COUNTRIES/CHARTS/CATEGORIES definitions still go into the
// output JSON unchanged.
function selectIdsFromEnv(envValue, validIds, label) {
  if (!envValue) return validIds;
  const requested = envValue.split(",").map((s) => s.trim()).filter(Boolean);
  for (const id of requested) {
    if (!validIds.includes(id)) console.error(`Warning: ignoring unknown ${label} id "${id}"`);
  }
  return requested.filter((id) => validIds.includes(id));
}

let requestCount = 0;

async function fetchJson(url) {
  requestCount += 1;
  const res = await fetch(url);
  const text = await res.text();
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(text);
}

// One retry after a longer pause. On final failure return null so the caller
// records an empty list for that combination instead of crashing the run.
async function fetchJsonWithRetry(url) {
  try {
    return await fetchJson(url);
  } catch (firstError) {
    console.error(`Warning: ${url} failed (${firstError.message}), retrying once`);
    await sleep(RETRY_PAUSE_MS);
    try {
      return await fetchJson(url);
    } catch (secondError) {
      console.error(`Warning: giving up on ${url}: ${secondError.message}`);
      return null;
    }
  }
}

let madeFirstRequest = false;

async function throttledFetchJson(url) {
  if (madeFirstRequest) await sleep(REQUEST_PAUSE_MS);
  madeFirstRequest = true;
  return fetchJsonWithRetry(url);
}

// The RSS feed returns a single object (not an array) when there is exactly
// one result, and omits the key entirely when there are none.
function asArray(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeEntry(entry, rank) {
  const images = asArray(entry["im:image"]);
  const largest = images[images.length - 1];
  return {
    rank,
    id: entry.id.attributes["im:id"],
    name: entry["im:name"].label,
    artist: entry["im:artist"].label,
    price: parseFloat(entry["im:price"].attributes.amount),
    currency: entry["im:price"].attributes.currency,
    releaseDate: String(entry["im:releaseDate"].label).slice(0, 10),
    icon: largest ? largest.label : "",
    url: entry.id.label,
    categoryId: entry.category.attributes["im:id"],
    categoryName: entry.category.attributes.label,
  };
}

function normalizeList(json) {
  const feed = json && typeof json === "object" && json.feed ? json.feed : {};
  return asArray(feed.entry).map((entry, index) => normalizeEntry(entry, index + 1));
}

function loadHistory() {
  try {
    return JSON.parse(readFileSync(historyPath, "utf8"));
  } catch {
    return {};
  }
}

function utcDateToday() {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const selectedCategoryIds = selectIdsFromEnv(process.env.CATEGORIES, CATEGORIES.map((c) => c.id), "category");
  const selectedChartIds = selectIdsFromEnv(process.env.CHARTS, CHARTS.map((c) => c.id), "chart");
  const selectedCategories = CATEGORIES.filter((c) => selectedCategoryIds.includes(c.id));
  const selectedCharts = CHARTS.filter((c) => selectedChartIds.includes(c.id));

  const startedAt = Date.now();
  const rankings = {};

  for (const country of COUNTRIES) {
    rankings[country.code] = {};
    for (const chart of selectedCharts) {
      rankings[country.code][chart.id] = {};
      for (const category of selectedCategories) {
        // "all" has no genre segment; real categories add /genre=<id>.
        const genreSegment = category.id === "all" ? "" : `/genre=${category.id}`;
        const url = `https://itunes.apple.com/${country.code}/rss/${CHART_SLUGS[chart.id]}/limit=100${genreSegment}/json`;
        const json = await throttledFetchJson(url);
        const list = json === null ? [] : normalizeList(json);
        rankings[country.code][chart.id][category.id] = list;
        console.log(`country=${country.code} chart=${chart.id} category=${category.id} -> ${list.length} results`);
      }
    }
  }

  const today = utcDateToday();
  const history = loadHistory();

  for (const country of COUNTRIES) {
    for (const chart of selectedCharts) {
      for (const category of selectedCategories) {
        const key = `${country.code}|${chart.id}|${category.id}`;
        const list = rankings[country.code][chart.id][category.id];
        const snapshot = {
          date: today,
          top: list.slice(0, HISTORY_TOP_N).map((app) => ({ id: app.id, rank: app.rank })),
        };
        const entries = Array.isArray(history[key]) ? history[key] : [];
        const existingIndex = entries.findIndex((e) => e.date === today);
        if (existingIndex >= 0) entries[existingIndex] = snapshot;
        else entries.push(snapshot);
        history[key] = entries.slice(-HISTORY_MAX_ENTRIES);
      }
    }
  }

  const latest = {
    generatedAt: new Date().toISOString(),
    countries: COUNTRIES,
    charts: CHARTS,
    categories: CATEGORIES,
    rankings,
  };

  mkdirSync(dataDir, { recursive: true });
  try {
    writeFileSync(latestPath, JSON.stringify(latest, null, 2) + "\n");
    writeFileSync(historyPath, JSON.stringify(history, null, 2) + "\n");
  } catch (err) {
    console.error(`Fatal: could not write output files: ${err.message}`);
    process.exit(1);
  }

  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`Done: ${requestCount} request(s) in ${elapsedSeconds}s, wrote ${latestPath} and ${historyPath}`);
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
