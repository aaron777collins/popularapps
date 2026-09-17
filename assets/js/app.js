/* Rankwatch bootstrap: owns app state, fetches data, wires events, calls render. */

import {
  fetchAll,
  getList,
  applySearch,
  sortList,
  computeMovers,
  getAppHistory,
} from './data.js';
import {
  applyChartDefaults,
  createDonut,
  destroyDonut,
} from './charts.js';
import {
  el,
  renderSkeleton,
  renderError,
  renderStats,
  renderList,
  renderMovers,
  openModal,
  refreshModalChart,
} from './render.js';

const state = {
  country: null,
  chart: 'top-free',
  category: 'all',
  query: '',
  sort: { key: 'rank', dir: 'asc' },
};

let latest = null;
let history = null;
let donutChart = null;
let lastDonutCounts = null;

const comboState = {
  open: false,
  options: [],
  activeIndex: -1,
  categories: [],
};

const els = {};

function cacheEls() {
  els.app = document.getElementById('app');
  els.stats = document.getElementById('stats');
  els.list = document.getElementById('list');
  els.movers = document.getElementById('movers');
  els.countrySelect = document.getElementById('country-select');
  els.chartSegments = document.getElementById('chart-segments');
  els.segmentIndicator = els.chartSegments?.querySelector('.segmented-indicator');
  els.categoryCombobox = document.getElementById('category-combobox');
  els.categoryInput = document.getElementById('category-input');
  els.categoryListbox = document.getElementById('category-listbox');
  els.searchInput = document.getElementById('search-input');
  els.themeToggle = document.getElementById('theme-toggle');
  els.iconSun = els.themeToggle?.querySelector('.icon-sun');
  els.iconMoon = els.themeToggle?.querySelector('.icon-moon');
  els.metaThemeLight = document.getElementById('meta-theme-light');
  els.metaThemeDark = document.getElementById('meta-theme-dark');
}

/* The error panel replaces the stat + main area, so the shell may need
   rebuilding before the next load attempt. */
function ensureShell() {
  if (document.getElementById('stats')) return;
  els.app.textContent = '';
  const stats = document.createElement('div');
  stats.id = 'stats';
  stats.setAttribute('aria-busy', 'true');
  const split = document.createElement('div');
  split.className = 'main-split';
  const listPanel = document.createElement('section');
  listPanel.className = 'panel panel-list';
  listPanel.setAttribute('aria-label', 'Ranked apps');
  const list = document.createElement('div');
  list.id = 'list';
  list.setAttribute('aria-busy', 'true');
  listPanel.appendChild(list);
  const moversPanel = document.createElement('aside');
  moversPanel.className = 'panel panel-movers';
  moversPanel.setAttribute('aria-label', 'Movers');
  const movers = document.createElement('div');
  movers.id = 'movers';
  movers.setAttribute('aria-busy', 'true');
  moversPanel.appendChild(movers);
  split.append(listPanel, moversPanel);
  els.app.append(stats, split);
  cacheEls();
}

async function load() {
  ensureShell();
  renderSkeleton(els.stats, 'stats');
  renderSkeleton(els.list, 'list');
  renderSkeleton(els.movers, 'movers');
  try {
    ({ latest, history } = await fetchAll());
  } catch (err) {
    renderError(els.app, errorReason(err), load);
    return;
  }
  populateControls();
  updateAll();
}

function errorReason(err) {
  const message = err && err.message ? err.message : '';
  return message || 'The data files could not be fetched.';
}

function populateControls() {
  state.country = latest.countries?.[0]?.code ?? state.country ?? 'us';
  buildCountrySelect();
  buildSegments();
  comboState.categories = latest.categories ?? [];
  setComboboxInput();
}

function buildCountrySelect() {
  const select = els.countrySelect;
  select.textContent = '';
  for (const country of latest.countries ?? []) {
    const option = document.createElement('option');
    option.value = country.code;
    option.textContent = country.name;
    select.appendChild(option);
  }
  const hasCurrent = [...select.options].some((option) => option.value === state.country);
  if (hasCurrent) {
    select.value = state.country;
  } else {
    select.value = select.options[0]?.value ?? '';
    state.country = select.value;
  }
}

function buildSegments() {
  const track = els.chartSegments;
  track.querySelectorAll('.segment-btn').forEach((btn) => btn.remove());
  const charts = latest.charts ?? [];
  track.style.setProperty('--seg-count', String(charts.length || 1));
  for (const chartDef of charts) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'segment-btn';
    btn.dataset.chart = chartDef.id;
    btn.textContent = chartDef.name;
    btn.setAttribute('aria-pressed', 'false');
    track.appendChild(btn);
  }
  if (!charts.some((chartDef) => chartDef.id === state.chart)) {
    state.chart = charts[0]?.id ?? state.chart;
  }
  setActiveSegment();
}

function setActiveSegment() {
  const buttons = Array.from(els.chartSegments.querySelectorAll('.segment-btn'));
  let index = 0;
  buttons.forEach((btn, i) => {
    const active = btn.dataset.chart === state.chart;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    if (active) index = i;
  });
  els.segmentIndicator.style.transform = `translateX(${index * 100}%)`;
}

function updateAll() {
  applyChartDefaults();
  refreshStatsAndList();
  updateMovers();
}

function hasRankingsKey() {
  const chartRankings = latest?.rankings?.[state.country]?.[state.chart];
  return Boolean(chartRankings) &&
    Object.prototype.hasOwnProperty.call(chartRankings, state.category);
}

function availableCategoryNames() {
  const chartRankings = latest?.rankings?.[state.country]?.[state.chart];
  if (!chartRankings) return [];
  return Object.keys(chartRankings).map((id) => {
    const cat = (latest.categories ?? []).find((entry) => String(entry.id) === String(id));
    return cat ? cat.name : id;
  });
}

/* base -> stats (pre-search) -> searched -> sorted -> list */
function refreshStatsAndList() {
  const base = getList(latest, state);
  const searched = applySearch(base, state.query);
  const free = base.reduce((count, app) => count + (app.price ? 0 : 1), 0);
  const paid = base.length - free;
  lastDonutCounts = { free, paid };

  destroyDonut(donutChart);
  donutChart = null;
  const { donutCanvas } = renderStats(els.stats, {
    appsInView: searched.length,
    categoryCount: (latest.categories ?? []).length,
    generatedAt: latest.generatedAt ?? null,
    freeCount: free,
    paidCount: paid,
  });
  if (donutCanvas) donutChart = createDonut(donutCanvas, lastDonutCounts);

  renderList(els.list, sortList(searched, state.sort), {
    sort: state.sort,
    query: state.query.trim(),
    hasDataKey: hasRankingsKey(),
    availableNames: availableCategoryNames(),
    onOpen: openAppModal,
  });
}

function updateMovers() {
  renderMovers(els.movers, computeMovers(history, latest, state));
}

function openAppModal(app, row) {
  const points = getAppHistory(history, state, String(app.id));
  openModal(app, points, row);
}

/* Theme */

function currentTheme() {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'light' || attr === 'dark') return attr;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function updateThemeToggle() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  els.themeToggle.setAttribute('aria-label', `Switch to ${next} theme`);
  els.iconSun.hidden = next === 'dark';
  els.iconMoon.hidden = next === 'light';
}

function updateThemeColorMeta() {
  if (!els.metaThemeLight || !els.metaThemeDark) return;
  const theme = currentTheme();
  els.metaThemeLight.media = theme === 'light' ? 'all' : 'not all';
  els.metaThemeDark.media = theme === 'dark' ? 'all' : 'not all';
}

function refreshDonutForTheme() {
  if (!donutChart) return;
  destroyDonut(donutChart);
  donutChart = null;
  if (!lastDonutCounts || lastDonutCounts.free + lastDonutCounts.paid === 0) return;
  const canvas = els.stats?.querySelector('.donut-box canvas');
  if (canvas) donutChart = createDonut(canvas, lastDonutCounts);
}

function setTheme(theme) {
  try {
    localStorage.setItem('rankwatch-theme', theme);
  } catch (err) {
    /* localStorage unavailable, theme still applies for this visit */
  }
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeToggle();
  updateThemeColorMeta();
  applyChartDefaults();
  refreshDonutForTheme();
  refreshModalChart();
}

/* Category combobox */

function selectedCategoryName() {
  const found = comboState.categories.find((cat) => cat.id === state.category);
  return found ? found.name : '';
}

function setComboboxInput() {
  els.categoryInput.value = selectedCategoryName();
}

function comboOptions(query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return comboState.categories;
  return comboState.categories.filter((cat) => cat.name.toLowerCase().includes(q));
}

function renderComboList() {
  comboState.options = comboOptions(els.categoryInput.value);
  comboState.activeIndex = -1;
  const list = els.categoryListbox;
  list.textContent = '';
  if (!comboState.options.length) {
    const empty = el('li', 'combo-empty', 'No categories match');
    empty.id = 'cat-opt-none';
    empty.setAttribute('role', 'option');
    empty.setAttribute('aria-disabled', 'true');
    list.appendChild(empty);
    els.categoryInput.removeAttribute('aria-activedescendant');
    return;
  }
  comboState.options.forEach((cat, i) => {
    const option = el('li', 'combo-option', cat.name);
    option.id = `cat-opt-${i}`;
    option.dataset.id = String(cat.id);
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(cat.id === state.category));
    list.appendChild(option);
  });
  els.categoryInput.removeAttribute('aria-activedescendant');
}

function openCombo() {
  renderComboList();
  els.categoryListbox.hidden = false;
  els.categoryInput.setAttribute('aria-expanded', 'true');
  els.categoryInput.select();
  comboState.open = true;
}

function closeCombo(restoreName) {
  if (restoreName) setComboboxInput();
  els.categoryListbox.hidden = true;
  els.categoryInput.setAttribute('aria-expanded', 'false');
  els.categoryInput.removeAttribute('aria-activedescendant');
  comboState.open = false;
  comboState.activeIndex = -1;
}

function setActiveComboOption(index) {
  const items = els.categoryListbox.querySelectorAll('.combo-option');
  if (!items.length) return;
  comboState.activeIndex = (index + items.length) % items.length;
  items.forEach((item, i) => item.classList.toggle('is-active', i === comboState.activeIndex));
  const active = items[comboState.activeIndex];
  els.categoryInput.setAttribute('aria-activedescendant', active.id);
  active.scrollIntoView({ block: 'nearest' });
}

function chooseCategory(cat) {
  if (!cat) return;
  state.category = cat.id;
  els.categoryInput.value = cat.name;
  closeCombo(false);
  updateAll();
}

function wireCombobox() {
  els.categoryInput.addEventListener('focus', () => {
    if (!comboState.open) openCombo();
    requestAnimationFrame(() => els.categoryInput.select());
  });
  els.categoryInput.addEventListener('click', () => {
    if (document.activeElement === els.categoryInput) els.categoryInput.select();
  });
  els.categoryInput.addEventListener('input', () => {
    if (!comboState.open) {
      openCombo();
    } else {
      renderComboList();
    }
  });
  els.categoryInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!comboState.open) openCombo();
      const count = comboState.options.length;
      if (count) setActiveComboOption(comboState.activeIndex < 0 ? 0 : comboState.activeIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!comboState.open) openCombo();
      const count = comboState.options.length;
      if (count) {
        setActiveComboOption(comboState.activeIndex < 0 ? count - 1 : comboState.activeIndex - 1);
      }
    } else if (event.key === 'Enter') {
      if (!comboState.open) return;
      event.preventDefault();
      const index = comboState.activeIndex >= 0 ? comboState.activeIndex : 0;
      chooseCategory(comboState.options[index]);
    } else if (event.key === 'Escape') {
      if (!comboState.open) return;
      event.stopPropagation();
      closeCombo(true);
    }
  });
  els.categoryListbox.addEventListener('click', (event) => {
    const option = event.target.closest('.combo-option');
    if (!option) return;
    const cat = comboState.options.find((entry) => String(entry.id) === option.dataset.id);
    chooseCategory(cat);
  });
  document.addEventListener('mousedown', (event) => {
    if (comboState.open && !els.categoryCombobox.contains(event.target)) {
      closeCombo(true);
    }
  });
}

/* Events */

let searchTimer = 0;

function onSortClick(event) {
  const btn = event.target.closest('.sort-btn');
  if (!btn || !btn.dataset.key) return;
  const key = btn.dataset.key;
  if (key === 'rank') {
    state.sort = { key: 'rank', dir: 'asc' };
  } else if (state.sort.key === key) {
    state.sort = { key, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' };
  } else {
    state.sort = { key, dir: 'asc' };
  }
  refreshStatsAndList();
}

function wireEvents() {
  els.countrySelect.addEventListener('change', () => {
    state.country = els.countrySelect.value || state.country;
    updateAll();
  });

  els.chartSegments.addEventListener('click', (event) => {
    const btn = event.target.closest('.segment-btn');
    if (!btn || btn.dataset.chart === state.chart) return;
    state.chart = btn.dataset.chart;
    setActiveSegment();
    updateAll();
  });

  document.addEventListener('click', onSortClick);

  els.searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = els.searchInput.value;
      refreshStatsAndList();
    }, 150);
  });

  els.themeToggle.addEventListener('click', () => {
    setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  });

  wireCombobox();
}

function init() {
  cacheEls();
  updateThemeToggle();
  updateThemeColorMeta();
  wireEvents();
  load();
}

init();
