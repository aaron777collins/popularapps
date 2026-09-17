/* Rankwatch rendering layer: every DOM structure the app shows.
   External strings (app names, developers, categories) are only ever
   inserted through createElement/textContent, never innerHTML. */

import {
  categoryHueIndex,
  formatPrice,
  formatRelativeTime,
  formatReleaseDate,
  formatShortDate,
} from './data.js';
import { createRankLine, destroyRankLine } from './charts.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PATH_EXTERNAL = 'M7 17 17 7M9 7h8v8';
const PATH_CLOSE = 'm6 6 12 12M18 6 6 18';
const PATH_ARROW_UP = 'M12 19V5m-7 7 7-7 7 7';
const PATH_ARROW_DOWN = 'M12 5v14m7-7-7 7-7-7';

let modalOverlay = null;
let modalChart = null;
let modalTrigger = null;
let modalPoints = [];

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function svgIcon(pathD, className) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (className) svg.setAttribute('class', className);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', pathD);
  svg.appendChild(path);
  return svg;
}

function hueStyle(node, categoryId) {
  node.style.setProperty('--cat-hue', `var(--cat-${categoryHueIndex(categoryId)})`);
}

/* Loading skeletons */

export function renderSkeleton(container, variant = 'list') {
  container.textContent = '';
  container.setAttribute('aria-busy', 'true');
  if (variant === 'stats') {
    const row = el('div', 'stat-row');
    for (let i = 0; i < 4; i++) {
      const card = el('div', 'stat-card');
      card.appendChild(el('div', 'skeleton skel-label'));
      card.appendChild(el('div', 'skeleton skel-value'));
      row.appendChild(card);
    }
    container.appendChild(row);
    return;
  }
  if (variant === 'movers') {
    const wrap = el('div', 'skel-movers');
    wrap.appendChild(el('div', 'skeleton skel-title'));
    for (let i = 0; i < 5; i++) wrap.appendChild(el('div', 'skeleton skel-item'));
    container.appendChild(wrap);
    return;
  }
  const wrap = el('div', 'skel-list');
  wrap.appendChild(el('div', 'skeleton skel-head'));
  for (let i = 0; i < 8; i++) {
    const row = el('div', 'skel-row');
    row.appendChild(el('div', 'skeleton skel-dot'));
    row.appendChild(el('div', 'skeleton skel-line'));
    row.appendChild(el('div', 'skeleton skel-line skel-line-short'));
    wrap.appendChild(row);
  }
  container.appendChild(wrap);
}

/* Error panel */

export function renderError(container, message, onRetry) {
  container.textContent = '';
  container.setAttribute('aria-busy', 'false');
  const panel = el('div', 'error-panel');
  panel.setAttribute('role', 'alert');
  panel.appendChild(el('p', 'error-title', 'Could not load the chart data.'));
  panel.appendChild(el('p', 'error-detail', message || 'The data files could not be fetched.'));
  const retry = el('button', 'btn-retry', 'Retry');
  retry.type = 'button';
  retry.addEventListener('click', () => {
    if (typeof onRetry === 'function') onRetry();
  });
  panel.appendChild(retry);
  container.appendChild(panel);
}

/* Stat cards */

function statCard(label) {
  const card = el('div', 'stat-card');
  card.appendChild(el('p', 'stat-label', label));
  return card;
}

function legendRow(hueVar, label, count, total) {
  const row = el('li', 'legend-row');
  const swatch = el('span', 'swatch');
  swatch.style.background = `var(${hueVar})`;
  row.appendChild(swatch);
  row.appendChild(el('span', 'legend-name', label));
  row.appendChild(el('span', 'legend-count', `${count} of ${total}`));
  row.appendChild(el('span', 'legend-pct', `${Math.round((count / total) * 100)}%`));
  return row;
}

export function renderStats(container, {
  appsInView = 0,
  categoryCount = 0,
  generatedAt = null,
  freeCount = 0,
  paidCount = 0,
} = {}) {
  container.textContent = '';
  container.setAttribute('aria-busy', 'false');
  const row = el('div', 'stat-row');

  const apps = statCard('Apps in view');
  apps.appendChild(el('p', 'stat-value', String(appsInView)));
  row.appendChild(apps);

  const cats = statCard('Categories');
  cats.appendChild(el('p', 'stat-value', String(categoryCount)));
  row.appendChild(cats);

  const updated = statCard('Updated');
  const updatedValue = el('p', 'stat-value', formatRelativeTime(generatedAt));
  if (generatedAt) updatedValue.title = new Date(generatedAt).toLocaleString();
  updated.appendChild(updatedValue);
  row.appendChild(updated);

  const donutCard = el('div', 'stat-card stat-card--donut');
  donutCard.appendChild(el('p', 'stat-label', 'Free vs paid'));
  const total = freeCount + paidCount;
  let donutCanvas = null;
  if (total === 0) {
    donutCard.appendChild(el('p', 'stat-empty', 'No apps in this selection.'));
  } else {
    const top = el('div', 'donut-top');
    top.appendChild(el('p', 'stat-value', `${Math.round((freeCount / total) * 100)}%`));
    const box = el('div', 'donut-box');
    donutCanvas = document.createElement('canvas');
    donutCanvas.setAttribute('role', 'img');
    donutCanvas.setAttribute('aria-label', `Donut chart: ${freeCount} free and ${paidCount} paid apps`);
    box.appendChild(donutCanvas);
    top.appendChild(box);
    donutCard.appendChild(top);
    const legend = el('ul', 'donut-legend');
    legend.appendChild(legendRow('--series-free', 'Free', freeCount, total));
    legend.appendChild(legendRow('--series-paid', 'Paid', paidCount, total));
    donutCard.appendChild(legend);
  }
  row.appendChild(donutCard);

  container.appendChild(row);
  return { donutCanvas };
}

/* Ranked list */

function headerSortCell(label, key, sort, extraClass) {
  const cell = el('div', `list-hcell${extraClass ? ` ${extraClass}` : ''}`);
  cell.setAttribute('role', 'columnheader');
  const btn = el('button', 'sort-btn', label);
  btn.type = 'button';
  btn.dataset.key = key;
  if (sort.key === key) {
    btn.classList.add('is-active');
    btn.appendChild(svgIcon(sort.dir === 'asc' ? PATH_ARROW_UP : PATH_ARROW_DOWN, 'sort-arrow'));
    cell.setAttribute('aria-sort', sort.dir === 'asc' ? 'ascending' : 'descending');
  }
  cell.appendChild(btn);
  return cell;
}

function buildHeader(sort) {
  const head = el('div', 'list-head');
  head.setAttribute('role', 'row');
  head.appendChild(headerSortCell('Rank', 'rank', sort, 'list-hcell--rank'));

  const appCell = headerSortCell('App', 'name', sort, 'list-hcell--app');
  head.appendChild(appCell);

  const devCell = el('div', 'list-hcell list-hcell--dev', 'Developer');
  devCell.setAttribute('role', 'columnheader');
  head.appendChild(devCell);

  const catCell = el('div', 'list-hcell list-hcell--cat', 'Category');
  catCell.setAttribute('role', 'columnheader');
  head.appendChild(catCell);

  head.appendChild(headerSortCell('Price', 'price', sort, 'list-hcell--price'));

  const actionCell = el('div', 'list-hcell list-hcell--action');
  actionCell.setAttribute('role', 'columnheader');
  actionCell.appendChild(el('span', 'visually-hidden', 'Actions'));
  head.appendChild(actionCell);
  return head;
}

export function createAppIcon(app) {
  const wrap = el('span', 'app-icon');
  const img = document.createElement('img');
  img.className = 'app-icon-img';
  img.src = app?.icon ?? '';
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  const swapToTile = () => {
    if (wrap.querySelector('.icon-fallback')) return;
    const tile = el('span', 'icon-fallback', String(app?.name ?? '?').charAt(0).toUpperCase());
    hueStyle(tile, app?.categoryId);
    img.replaceWith(tile);
  };
  img.addEventListener('error', swapToTile);
  if (img.complete && img.naturalWidth === 0) swapToTile();
  wrap.appendChild(img);
  return wrap;
}

export function categoryBadge(categoryId, categoryName) {
  const badge = el('span', 'cat-badge', categoryName || String(categoryId ?? ''));
  hueStyle(badge, categoryId);
  return badge;
}

function buildRow(app, opts) {
  const row = el('div', 'list-row');
  row.setAttribute('role', 'row');
  row.tabIndex = 0;
  row.dataset.appId = String(app.id);

  const rankCell = el('div', 'cell cell-rank', String(app.rank));
  rankCell.setAttribute('role', 'cell');
  if (Number(app.rank) === 1) rankCell.classList.add('rank-1');
  row.appendChild(rankCell);

  const iconCell = el('div', 'cell cell-icon');
  iconCell.setAttribute('role', 'cell');
  iconCell.appendChild(createAppIcon(app));
  row.appendChild(iconCell);

  const appCell = el('div', 'cell cell-app');
  appCell.setAttribute('role', 'cell');
  appCell.appendChild(el('span', 'app-name', app.name));
  row.appendChild(appCell);

  const devCell = el('div', 'cell cell-dev', app.artist);
  devCell.setAttribute('role', 'cell');
  row.appendChild(devCell);

  const catCell = el('div', 'cell cell-cat');
  catCell.setAttribute('role', 'cell');
  catCell.appendChild(categoryBadge(app.categoryId, app.categoryName));
  row.appendChild(catCell);

  const priceCell = el('div', 'cell cell-price');
  priceCell.setAttribute('role', 'cell');
  if (!app.price) {
    priceCell.appendChild(el('span', 'pill pill-free', 'Free'));
  } else {
    priceCell.textContent = formatPrice(app);
  }
  row.appendChild(priceCell);

  const actionCell = el('div', 'cell cell-action');
  actionCell.setAttribute('role', 'cell');
  const link = document.createElement('a');
  link.className = 'icon-btn row-link';
  link.href = app.url;
  link.target = '_blank';
  link.rel = 'noopener';
  link.setAttribute('aria-label', `Open ${app.name} in the App Store`);
  link.appendChild(svgIcon(PATH_EXTERNAL));
  link.addEventListener('click', (event) => event.stopPropagation());
  actionCell.appendChild(link);
  row.appendChild(actionCell);

  const open = () => {
    if (typeof opts.onOpen === 'function') opts.onOpen(app, row);
  };
  row.addEventListener('click', open);
  row.addEventListener('keydown', (event) => {
    if (event.target !== row) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  });
  return row;
}

function renderListEmpty(container, opts = {}) {
  const box = el('div', 'empty-state');
  const query = opts.query;
  if (query) {
    box.appendChild(el('p', 'empty-title', `No apps match "${query}".`));
    box.appendChild(el('p', 'empty-hint', 'Clear the search to see the full ranked list.'));
  } else if (opts.hasDataKey === false) {
    box.appendChild(el('p', 'empty-title', 'No ranking data yet for this category and chart.'));
    const names = opts.availableNames ?? [];
    if (names.length) {
      box.appendChild(el('p', 'empty-hint', `Categories with data for this chart: ${names.join(', ')}.`));
    } else {
      box.appendChild(el('p', 'empty-hint', 'Choose another chart or country.'));
    }
  } else {
    box.appendChild(el('p', 'empty-title', 'No apps in this selection.'));
  }
  container.appendChild(box);
}

export function renderList(container, apps, opts = {}) {
  container.textContent = '';
  container.setAttribute('aria-busy', 'false');
  if (!Array.isArray(apps) || apps.length === 0) {
    renderListEmpty(container, opts);
    return;
  }
  const frame = el('div', 'list-frame');
  frame.setAttribute('role', 'table');
  frame.appendChild(buildHeader(opts.sort ?? { key: 'rank', dir: 'asc' }));
  const body = el('div', 'list-body');
  body.setAttribute('role', 'rowgroup');
  for (const app of apps) body.appendChild(buildRow(app, opts));
  frame.appendChild(body);
  container.appendChild(frame);
}

/* Movers panel */

function moversSection(title, rows, direction) {
  const section = el('div', 'movers-section');
  section.appendChild(el('h3', 'movers-section-title', title));
  const list = el('ul', 'movers-list');
  for (const item of rows) {
    const row = el('li', 'movers-row');
    row.appendChild(el('span', 'movers-name', item.name));
    const sign = item.delta > 0 ? '+' : '-';
    const glyph = direction === 'up' ? '▲' : '▼';
    const delta = el('span', `movers-delta ${direction === 'up' ? 'riser' : 'faller'}`,
      `${glyph} ${sign}${Math.abs(item.delta)}`);
    row.appendChild(delta);
    list.appendChild(row);
  }
  section.appendChild(list);
  return section;
}

export function renderMovers(container, result) {
  container.textContent = '';
  container.setAttribute('aria-busy', 'false');
  const panel = el('div', 'movers-panel');
  panel.appendChild(el('h2', 'movers-title', 'Movers'));

  if (result.state === 'missing') {
    panel.appendChild(el('p', 'movers-note',
      'No history yet for this chart. It starts building after the next data refresh.'));
    container.appendChild(panel);
    return;
  }
  if (result.state === 'single') {
    panel.appendChild(el('p', 'movers-note',
      'Only one day of history so far. Check back tomorrow to see who\'s rising and falling.'));
    container.appendChild(panel);
    return;
  }

  panel.appendChild(el('p', 'movers-sub',
    `${formatShortDate(result.oldDate)} to ${formatShortDate(result.newDate)}`));

  if (!result.movedCount) {
    panel.appendChild(el('p', 'movers-note', 'No apps moved between the two latest snapshots.'));
    container.appendChild(panel);
    return;
  }

  panel.appendChild(moversSection('Risers', result.risers, 'up'));
  panel.appendChild(moversSection('Fallers', result.fallers, 'down'));
  container.appendChild(panel);
}

/* Detail modal */

export function openModal(app, historyPoints = [], trigger = null) {
  closeModal();
  modalTrigger = trigger && trigger.isConnected
    ? trigger
    : (document.activeElement && document.activeElement.isConnected ? document.activeElement : null);
  modalPoints = Array.isArray(historyPoints) ? historyPoints : [];

  const overlay = el('div', 'modal-overlay');
  const dialog = el('div', 'modal');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'app-modal-title');

  const closeBtn = el('button', 'icon-btn modal-close');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.appendChild(svgIcon(PATH_CLOSE));
  closeBtn.addEventListener('click', () => closeModal());
  dialog.appendChild(closeBtn);

  const head = el('div', 'modal-head');
  head.appendChild(createAppIcon(app));
  const headText = el('div', 'modal-head-text');
  const title = el('h2', 'modal-title', app.name);
  title.id = 'app-modal-title';
  headText.appendChild(title);
  headText.appendChild(el('p', 'modal-dev', app.artist));
  const meta = el('div', 'modal-meta');
  if (!app.price) {
    meta.appendChild(el('span', 'pill pill-free', 'Free'));
  } else {
    meta.appendChild(el('span', 'modal-price', formatPrice(app)));
  }
  meta.appendChild(categoryBadge(app.categoryId, app.categoryName));
  meta.appendChild(el('span', 'modal-released', `Released ${formatReleaseDate(app.releaseDate)}`));
  headText.appendChild(meta);
  head.appendChild(headText);
  dialog.appendChild(head);

  const storeLink = document.createElement('a');
  storeLink.className = 'store-link';
  storeLink.href = app.url;
  storeLink.target = '_blank';
  storeLink.rel = 'noopener';
  storeLink.appendChild(svgIcon(PATH_EXTERNAL));
  storeLink.appendChild(document.createTextNode('Open in App Store'));
  dialog.appendChild(storeLink);

  const chartSection = el('div', 'modal-chart');
  chartSection.appendChild(el('h3', 'modal-chart-title', 'Rank over time'));
  if (!modalPoints.length) {
    chartSection.appendChild(el('p', 'modal-nohistory', 'No rank history yet for this app'));
  } else {
    const box = el('div', 'chart-box');
    const canvas = document.createElement('canvas');
    box.appendChild(canvas);
    chartSection.appendChild(box);
    requestAnimationFrame(() => {
      if (modalOverlay !== overlay) return;
      modalChart = createRankLine(canvas, modalPoints);
    });
  }
  dialog.appendChild(chartSection);

  overlay.appendChild(dialog);
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) closeModal();
  });
  overlay.addEventListener('keydown', onModalKeydown);
  document.body.appendChild(overlay);
  document.body.classList.add('modal-open');
  modalOverlay = overlay;
  closeBtn.focus();
}

function onModalKeydown(event) {
  if (event.key === 'Escape') {
    event.stopPropagation();
    closeModal();
    return;
  }
  if (event.key !== 'Tab' || !modalOverlay) return;
  const focusables = Array.from(
    modalOverlay.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
  ).filter((node) => node.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function closeModal() {
  if (!modalOverlay) return;
  destroyRankLine(modalChart);
  modalChart = null;
  const trigger = modalTrigger;
  modalOverlay.remove();
  modalOverlay = null;
  modalTrigger = null;
  modalPoints = [];
  document.body.classList.remove('modal-open');
  if (trigger && trigger.isConnected) trigger.focus();
}

/* Recreate the open modal's chart after a theme change. */
export function refreshModalChart() {
  if (!modalOverlay || !modalPoints.length) return;
  destroyRankLine(modalChart);
  modalChart = null;
  const canvas = modalOverlay.querySelector('.chart-box canvas');
  if (canvas) modalChart = createRankLine(canvas, modalPoints);
}
