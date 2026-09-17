/* Rankwatch data layer: fetching, pure helpers, and formatters.
   All lookups tolerate sparse data: missing keys fall back to empty values. */

export async function fetchAll() {
  const [latestRes, historyRes] = await Promise.all([
    fetch('data/latest.json'),
    fetch('data/history.json'),
  ]);
  if (!latestRes.ok) {
    throw new Error(`data/latest.json returned HTTP ${latestRes.status}`);
  }
  if (!historyRes.ok) {
    throw new Error(`data/history.json returned HTTP ${historyRes.status}`);
  }
  let latest;
  let history;
  try {
    [latest, history] = await Promise.all([latestRes.json(), historyRes.json()]);
  } catch (err) {
    throw new Error('A data file could not be parsed as JSON.');
  }
  return { latest, history };
}

export function getList(latest, { country, chart, category }) {
  return latest?.rankings?.[country]?.[chart]?.[category] ?? [];
}

export function applySearch(list, query) {
  if (!Array.isArray(list)) return [];
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return list;
  return list.filter((app) =>
    String(app?.name ?? '').toLowerCase().includes(q) ||
    String(app?.artist ?? '').toLowerCase().includes(q));
}

export function sortList(list, { key = 'rank', dir = 'asc' } = {}) {
  if (!Array.isArray(list)) return [];
  const mul = dir === 'desc' ? -1 : 1;
  return [...list].sort((a, b) => {
    let cmp = 0;
    if (key === 'name') {
      cmp = String(a?.name ?? '').localeCompare(String(b?.name ?? ''), undefined, { sensitivity: 'base' });
    } else if (key === 'price') {
      cmp = (Number(a?.price ?? 0) || 0) - (Number(b?.price ?? 0) || 0);
    } else {
      cmp = (Number(a?.rank ?? 0) || 0) - (Number(b?.rank ?? 0) || 0);
    }
    if (cmp !== 0) return cmp * mul;
    cmp = (Number(a?.rank ?? 0) || 0) - (Number(b?.rank ?? 0) || 0);
    if (cmp !== 0) return cmp;
    return String(a?.name ?? '').localeCompare(String(b?.name ?? ''));
  });
}

/* Movers: compare the two most recent snapshots for one history key.
   delta = oldRank - newRank, so positive means the app moved up. */
export function computeMovers(history, latest, { country, chart, category }) {
  const base = {
    state: 'missing',
    risers: [],
    fallers: [],
    oldDate: null,
    newDate: null,
    movedCount: 0,
  };
  const snapshots = history?.[`${country}|${chart}|${category}`];
  if (!Array.isArray(snapshots) || snapshots.length === 0) return base;

  const sorted = [...snapshots].sort((a, b) =>
    String(a?.date ?? '').localeCompare(String(b?.date ?? '')));

  if (sorted.length < 2) {
    const onlyDate = sorted[0]?.date ?? null;
    return { ...base, state: 'single', oldDate: onlyDate, newDate: onlyDate };
  }

  const older = sorted[sorted.length - 2];
  const newer = sorted[sorted.length - 1];
  const oldRanks = new Map((older?.top ?? []).map((entry) => [String(entry?.id), entry?.rank]));
  const newRanks = new Map((newer?.top ?? []).map((entry) => [String(entry?.id), entry?.rank]));
  const names = nameIndexFor(latest, { country, chart });

  const moved = [];
  for (const [id, newRank] of newRanks) {
    if (!oldRanks.has(id)) continue;
    const oldRank = oldRanks.get(id);
    const delta = (Number(oldRank) || 0) - (Number(newRank) || 0);
    if (delta === 0) continue;
    moved.push({
      id,
      name: names.get(id)?.name ?? 'Unknown app',
      delta,
      oldRank,
      newRank,
    });
  }

  const risers = moved
    .filter((m) => m.delta > 0)
    .sort((a, b) => b.delta - a.delta || a.newRank - b.newRank)
    .slice(0, 5);
  const fallers = moved
    .filter((m) => m.delta < 0)
    .sort((a, b) => a.delta - b.delta || a.newRank - b.newRank)
    .slice(0, 5);

  return {
    state: 'ready',
    risers,
    fallers,
    oldDate: older?.date ?? null,
    newDate: newer?.date ?? null,
    movedCount: moved.length,
  };
}

/* Every dated snapshot under one history key where appId appears in top[],
   sorted date ascending. */
export function getAppHistory(history, { country, chart, category }, appId) {
  const snapshots = history?.[`${country}|${chart}|${category}`];
  if (!Array.isArray(snapshots)) return [];
  const target = String(appId);
  const sorted = [...snapshots].sort((a, b) =>
    String(a?.date ?? '').localeCompare(String(b?.date ?? '')));
  const points = [];
  for (const snapshot of sorted) {
    const entry = (snapshot?.top ?? []).find((item) => String(item?.id) === target);
    if (entry) points.push({ date: snapshot.date, rank: entry.rank });
  }
  return points;
}

/* id -> app map over the union of ALL category arrays under one chart. */
export function nameIndexFor(latest, { country, chart }) {
  const map = new Map();
  const chartRankings = latest?.rankings?.[country]?.[chart];
  if (!chartRankings || typeof chartRankings !== 'object') return map;
  for (const list of Object.values(chartRankings)) {
    if (!Array.isArray(list)) continue;
    for (const app of list) {
      if (app && app.id != null) map.set(String(app.id), app);
    }
  }
  return map;
}

/* Stable djb2 hash of the category id, folded into 0-7. */
export function categoryHueIndex(categoryId) {
  const s = String(categoryId ?? '');
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 8;
}

export function formatPrice(app) {
  if (!app || !app.price) return 'Free';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: app.currency || 'USD',
    }).format(app.price);
  } catch (err) {
    return `${app.currency ?? ''}${app.price}`;
  }
}

export function formatRelativeTime(iso) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diffSec = (Date.now() - then) / 1000;
  if (diffSec < 60) return 'just now';
  const units = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, secs] of units) {
    if (diffSec >= secs) return rtf.format(-Math.floor(diffSec / secs), unit);
  }
  return 'just now';
}

export function formatReleaseDate(iso) {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(iso ?? '');
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function formatShortDate(iso) {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(iso ?? '');
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}
