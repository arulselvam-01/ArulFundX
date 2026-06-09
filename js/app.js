/**
 * ArulFundX – Main App Module
 * State management, UI wiring, search, fund loading, tab rendering
 */

import {
  searchFunds,
  preloadFundRegistry,
  fetchFundData,
  fetchAllFundCodes,
  loadProjectBenchmarks,
  getBenchmarkCode,
  getBenchmarkFundMeta,
} from './api.js';
import {
  sortNavChronological,
  filterNavByPeriod,
  parseNavDate,
  formatDisplayDate,
  computeCAGR,
  computeAllCAGRs,
  computeAnnualReturns,
  computeRollingReturns,
  computeRollingPeriods,
  computeRollingStats,
  computeAlpha,
  computeAlphaStats,
  computeRiskMetrics,
  computeDrawdownSeries,
  fmtPct,
  fmtNav,
  fmt,
  computeOverviewStats,
  computeDetailedPeriodReturns,
  computeRiskMetricsBreakdown,
  sliceNavByDateRange,
  RISK_WINDOW_SPECS,
  RANKING_PERIOD_SPECS,
  computeAllRankingPeriodReturns,
  computeAverageAlpha,
  getTrailingNavSlice,
  CMP_RISK_PERIOD_SPECS,
} from './calculations.js';

import {
  destroyAll,
  resizeAllCharts,
  renderNavChart,
  renderAnnualBarChart,
  renderCagrChart,
  renderRollingChart,
  renderAlphaChart,
  renderDrawdownChart,
  renderRiskGauges,
  renderPeriodReturnsChart,
  renderYearlyReturnsChart,
} from './charts.js';

// ── App State ─────────────────────────────────────────────────────────────────

const state = {
  theme: 'dark',
  currentCode: null,
  fundData: null,    // raw API response { meta, data }
  sortedNav: null,    // sorted chronologically
  benchmarkData: null,
  sortedBenchNav: null,
  sortedBenchNavUti: null,
  sortedBenchNavHdfc: null,
  annualReturns: null,
  riskMetrics: null,
  activeTab: 'overview',
  navPeriod: '1y',
  rollingWindow: 3,
  riskPeriod: 'all',
  rankingPeriod: 'all',
  rankingCategory: 'all',
  cmpRiskPeriod: 'all',
  lastSchemeCode: null,
  rankedFunds: [],
  rankingLoading: false,
  rankingDisplayLimit: 100,
  periodRankingLoading: false,
  periodRankedFunds: null,
  rankingPeriodKey: 'all',
  periodRankingStopped: false,
  cachedPeriodRankings: {},
  lastSuccessfulPeriodKey: 'all',
};

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);

function init() {
  setupTheme();
  setupSearch('home-search', 'home-dropdown', 'home-spinner');
  setupSearch('header-search', 'header-dropdown', 'header-spinner');
  setupPopularChips();
  setupBackButton();
  setupHeaderLogo();
  setupTabs();
  setupNavPeriodButtons();
  setupRollingWindowButtons();
  setupRiskPeriodButtons();
  setupRankingControls();
  setupCompareSearch();
  setupCompareRollingButtons();
  setupCompareRiskPeriodButtons();
  setupMobileSearch();
  setupResponsiveLayout();
  setupTableScrollHints();
  setupMobileTableHeaderWrap();

  // Measure sticky heights immediately so --ticker-h / --header-h are correct
  // before any page navigation occurs. This prevents the gap under the ticker.
  requestAnimationFrame(updateStickyLayoutOffsets);

  // Keep --ticker-h in sync if the ticker's rendered height ever changes
  // (e.g. OS text-size change, window resize, browser zoom).
  const ticker = document.getElementById('market-ticker');
  if (ticker && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => requestAnimationFrame(updateStickyLayoutOffsets))
      .observe(ticker);
  }

  // Preload fund registry for fast local search
  preloadFundRegistry().catch(() => {});

  // Load UTI + HDFC Nifty 50 benchmarks in background (don't block UI)
  loadProjectBenchmarks()
    .then(applyProjectBenchmarks)
    .catch(err => console.warn('Benchmark unavailable:', err.message));

  // Preload and initialize ranking leaderboard
  preloadRankingLeaderboard();

  // Set up hash-based routing (back/forward + shareable URLs)
  setupRouter();

  // Start live market ticker (Nifty 50, Sensex, S&P 500)
  startMarketTicker();
}


// ── Session Persistence ───────────────────────────────────────────────────────

// ── Market Ticker ─────────────────────────────────────────────────────────────
//
// Fetches live quotes from Yahoo Finance every 5 seconds — but ONLY during
// IST market hours (08:30–16:30). Outside that window the interval fires but
// immediately returns without making any network request.
// Displays: current price, point change (▲/▼), and % change vs previous close.

const TICKER_INDICES = [
  { id: 'nifty',  url: 'https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI',  name: 'NIFTY 50' },
  { id: 'sensex', url: 'https://query1.finance.yahoo.com/v8/finance/chart/%5EBSESN', name: 'SENSEX'   },
  { id: 'sp500',  url: 'https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC',  name: 'S&P 500'  },
];

async function fetchIndexQuote(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta?.regularMarketPrice) throw new Error('No market price in response');
  return {
    price:     meta.regularMarketPrice,  // live current market price
    prevClose: meta.previousClose,       // yesterday's closing price
  };
}

function updateTickerItem(id, data) {
  const itemEl   = document.getElementById(`ticker-${id}`);
  const priceEl  = document.getElementById(`ticker-${id}-price`);
  const changeEl = document.getElementById(`ticker-${id}-change`);
  if (!priceEl || !changeEl || !itemEl) return;

  // ── How ticker values are calculated ──────────────────────────────────────
  // price      = current market price from Yahoo Finance API
  // prevClose  = previous day's closing price from Yahoo Finance API
  // change     = price − prevClose              (absolute point change)
  // changePct  = (price / prevClose × 100) − 100  (percentage change vs prev close)
  // We display: ▲/▼ |change| (±changePct%)
  // ──────────────────────────────────────────────────────────────────────────
  const { price, prevClose } = data;
  const change    = price - prevClose;
  const changePct = (price / prevClose * 100) - 100;
  const isPos     = change >= 0;
  const arrow     = isPos ? '▲' : '▼';

  const fmt = (n, d) => n.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });

  // Step 1: Update price text immediately
  priceEl.textContent = fmt(price, 2);

  // Step 2: Set inner HTML with base arrow span (NO animation class yet)
  changeEl.innerHTML = `<span class="ticker-arrow">${arrow}</span> ${fmt(Math.abs(change), 2)} (${isPos ? '+' : ''}${changePct.toFixed(2)}%)`;
  changeEl.className = `ticker-change ${isPos ? 'positive' : 'negative'}`;

  // Step 3: Use double requestAnimationFrame — the most reliable cross-browser technique
  // First rAF: browser processes new DOM and lays it out
  // Second rAF: browser has painted the base state, safe to add animation class
  // This works on all browsers (Chrome, Firefox, Safari, Edge) and all screen sizes
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const arrowEl = changeEl.querySelector('.ticker-arrow');
      if (arrowEl) {
        // Force a fresh animation: remove class, reflow, re-add
        arrowEl.classList.remove('float-up', 'float-down');
        void arrowEl.getBoundingClientRect(); // trigger reflow (cross-browser safe)
        arrowEl.classList.add(isPos ? 'float-up' : 'float-down');
      }
    });
  });
}


function setTickerError(id) {
  const changeEl = document.getElementById(`ticker-${id}-change`);
  const priceEl  = document.getElementById(`ticker-${id}-price`);
  if (priceEl)  priceEl.textContent  = '—';
  if (changeEl) { changeEl.textContent = 'N/A'; changeEl.className = 'ticker-change'; }
}

// ── Market-hours helper ───────────────────────────────────────────────────────
// Returns true if the current IST time is between 8:30 AM and 4:30 PM.
// IST = UTC + 5h 30m.  All calculations done in UTC minutes to avoid
// DST / locale issues on the user's machine.

function isMarketHours() {
  const now        = new Date();
  const utcMs      = now.getTime() + now.getTimezoneOffset() * 60_000; // normalise to UTC ms
  const istMs      = utcMs + (5 * 60 + 30) * 60_000;                  // shift to IST
  const ist        = new Date(istMs);
  const istMinutes = ist.getHours() * 60 + ist.getMinutes();           // minutes since midnight IST

  const OPEN  = 8 * 60 + 30;   // 08:30  → 510 min
  const CLOSE = 16 * 60 + 30;  // 16:30  → 990 min
  return istMinutes >= OPEN && istMinutes < CLOSE;
}

// ── Ticker loop ───────────────────────────────────────────────────────────────
// Protocol:
//   MARKET HOURS (08:30–16:30 IST):
//     Recursive, sequential loop — the next request is only sent AFTER the
//     previous one fully completes (fetch + DOM update). This guarantees zero
//     overlapping / piled-up requests regardless of how long each fetch takes.
//     No artificial delay between cycles; the network round-trip itself is the
//     natural throttle.
//
//   NON-MARKET HOURS:
//     A setInterval fires once per minute to keep the displayed values fresh
//     (e.g. after-hours / pre-market data). No recursive scheduling outside
//     market hours.

let _tickerRunning  = false;  // prevents the market-hours recursive loop from
                               // being entered twice if startMarketTicker is
                               // called more than once
let _offHoursTimer  = null;   // setInterval handle for non-market-hours polling

// Core fetch-and-update: fetches all 3 tickers in parallel, then updates DOM.
// Returns a promise that resolves once everything is done.
async function refreshMarketTicker() {
  const settledResults = await Promise.allSettled(
    TICKER_INDICES.map(index =>
      fetchIndexQuote(index.url).then(data => ({ id: index.id, data }))
    )
  );

  const successful = settledResults
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);

  if (successful.length === TICKER_INDICES.length) {
    // ALL three fetched — update DOM and animate arrows simultaneously
    successful.forEach(res => updateTickerItem(res.id, res.data));
  } else {
    // Partial failure — show error placeholder only if cell is still empty
    settledResults.forEach((r, i) => {
      if (r.status === 'rejected') {
        const id = TICKER_INDICES[i].id;
        console.warn(`Ticker fetch failed for ${id}:`, r.reason?.message);
        const priceEl = document.getElementById(`ticker-${id}-price`);
        if (!priceEl || priceEl.textContent === '—' || priceEl.textContent === '') {
          setTickerError(id);
        }
      }
    });
  }
}

// Recursive sequential loop used only during market hours.
// Each iteration awaits the previous fetch+update before scheduling the next.
async function _runMarketLoop() {
  if (!_tickerRunning) return; // loop was stopped externally

  if (!isMarketHours()) {
    // Market just closed mid-loop — hand off to the non-market interval
    _tickerRunning = false;
    _startOffHoursPolling();
    return;
  }

  await refreshMarketTicker(); // wait for ALL three fetches to fully complete

  // Wait 3 seconds after the completed fetch before starting the next cycle
  setTimeout(_runMarketLoop, 3_000);
}

function _startOffHoursPolling() {
  if (_offHoursTimer !== null) return; // already polling
  _offHoursTimer = setInterval(() => {
    if (isMarketHours()) {
      // Market just opened — stop the interval and hand off to recursive loop
      clearInterval(_offHoursTimer);
      _offHoursTimer = null;
      _tickerRunning = true;
      _runMarketLoop();
    } else {
      refreshMarketTicker(); // one quiet off-hours update
    }
  }, 60_000); // every 1 minute when market is closed
}

function startMarketTicker() {
  if (_tickerRunning || _offHoursTimer !== null) return; // guard double-start

  // Immediate fetch on page load regardless of market hours
  refreshMarketTicker();

  if (isMarketHours()) {
    // Kick off the sequential recursive loop
    _tickerRunning = true;
    setTimeout(_runMarketLoop, 0); // defer so the initial fetch above isn't overlapped
  } else {
    // Outside market hours — use the quiet interval
    _startOffHoursPolling();
  }
}



// ── Session Persistence ───────────────────────────────────────────────────────

const SESSION_KEY = 'fl-session';

function saveSession() {
  try {
    const session = {
      currentCode: state.currentCode,
      schemeName: document.getElementById('header-search')?.value || '',
      activeTab: state.activeTab,
      navPeriod: state.navPeriod,
      rollingWindow: state.rollingWindow,
      riskPeriod: state.riskPeriod,
      compareA: state.compareA ? { code: state.compareA.code, name: state.compareA.name } : null,
      compareB: state.compareB ? { code: state.compareB.code, name: state.compareB.name } : null,
      compareResultsShown: document.getElementById('cmp-results')?.style.display === 'block',
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (e) {
    // sessionStorage might be unavailable in some contexts
  }
}

async function restoreSession() {
  let session;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return;
    session = JSON.parse(raw);
  } catch (e) { return; }

  if (!session || !session.currentCode) return;

  // Restore period / rolling window selections in UI first
  if (session.navPeriod) {
    state.navPeriod = session.navPeriod;
    document.querySelectorAll('#nav-period-btns .period-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.period === session.navPeriod);
    });
  }
  if (session.rollingWindow) {
    state.rollingWindow = session.rollingWindow;
    document.querySelectorAll('#rolling-window-btns .period-btn').forEach(b => {
      b.classList.toggle('active', parseInt(b.dataset.window) === session.rollingWindow);
    });
  }
  if (session.riskPeriod) {
    state.riskPeriod = session.riskPeriod;
    document.querySelectorAll('#risk-period-btns .period-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.riskPeriod === session.riskPeriod);
    });
  }

  // Re-load the main fund
  await loadFund(session.currentCode, session.schemeName);

  // Switch to the saved tab (loadFund defaults to 'overview')
  if (session.activeTab && session.activeTab !== 'overview') {
    switchTab(session.activeTab);
  }

  // Restore compare selections
  if (session.compareA || session.compareB) {
    const restoreSide = async (sideKey, sideChar) => {
      const saved = session[sideKey];
      if (!saved) return;
      try {
        const data = await fetchFundData(saved.code);
        state[`compare${sideChar.toUpperCase()}`] = {
          code: saved.code,
          name: saved.name,
          fundData: data,
          sortedNav: sortNavChronological(data.data),
        };
        // Show chip UI
        const chip = document.getElementById(`cmp-chip-${sideChar}`);
        const chipName = document.getElementById(`cmp-chip-name-${sideChar}`);
        const inputWrap = document.getElementById(`cmp-search-${sideChar}`)?.parentElement;
        if (chip) chip.style.display = 'flex';
        if (chipName) chipName.textContent = saved.name;
        if (inputWrap) inputWrap.style.display = 'none';
      } catch (e) {
        console.warn('Could not restore compare fund:', saved.name, e);
      }
    };

    await Promise.all([
      restoreSide('compareA', 'a'),
      restoreSide('compareB', 'b'),
    ]);

    updateCmpButton();

    // If compare results were showing, re-render them
    if (session.compareResultsShown && state.compareA && state.compareB) {
      renderCompareTab();
      document.getElementById('cmp-results').style.display = 'block';
      document.getElementById('cmp-reset-btn').style.display = 'inline-block';
      document.getElementById('cmp-run-btn').textContent = 'Update Comparison';
    }
  }

  if (state.currentCode) {
    replaceRoute({ page: 'fund', code: state.currentCode, tab: state.activeTab || 'overview' });
  }
}

// ── Theme ─────────────────────────────────────────────────────────────────────

function setupTheme() {
  const saved = localStorage.getItem('fl-theme') || 'dark';
  applyTheme(saved);

  document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);
  document.getElementById('theme-toggle-2')?.addEventListener('click', toggleTheme);
}

function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('fl-theme', theme);
  updateThemeIcons(theme);
}

function toggleTheme() {
  const next = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  // Re-render all active charts with new theme colors
  if (state.sortedNav) {
    destroyAll();
    renderActiveTab();
  }
}

function updateThemeIcons(theme) {
  document.querySelectorAll('.icon-moon').forEach(el => el.style.display = theme === 'dark' ? 'block' : 'none');
  document.querySelectorAll('.icon-sun').forEach(el => el.style.display = theme === 'light' ? 'block' : 'none');
}

// ── Search ────────────────────────────────────────────────────────────────────

const SEARCH_DEBOUNCE_MS = 180;

function setupSearch(inputId, dropdownId, spinnerId) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);
  const spinner = document.getElementById(spinnerId);
  if (!input || !dropdown) return;

  bindFundSearchInput({
    input,
    dropdown,
    spinner,
    closeSelector: '.search-container, .header-search-container',
    onSelect: (fund) => {
      input.value = fund.schemeName;
      loadFund(fund.schemeCode, fund.schemeName);
    },
  });
}

function bindFundSearchInput({ input, dropdown, spinner, onSelect, closeSelector }) {
  let debounceTimer = null;
  let focusedIndex = -1;

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (q.length < 2) { closeDropdown(dropdown); return; }

    debounceTimer = setTimeout(async () => {
      showSpinner(spinner);
      try {
        const results = await searchFunds(q);
        focusedIndex = -1;
        renderSearchDropdown(dropdown, results, input, onSelect);
      } catch (e) {
        renderDropdownError(dropdown, e.message);
      } finally {
        hideSpinner(spinner);
      }
    }, SEARCH_DEBOUNCE_MS);
  });

  input.addEventListener('keydown', e => {
    const items = dropdown.querySelectorAll('.dropdown-item');
    if (!items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusedIndex = Math.min(focusedIndex + 1, items.length - 1);
      updateFocus(items, focusedIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusedIndex = Math.max(focusedIndex - 1, 0);
      updateFocus(items, focusedIndex);
    } else if (e.key === 'Enter') {
      if (focusedIndex >= 0 && items[focusedIndex]) {
        items[focusedIndex].click();
      } else if (items.length === 1) {
        items[0].click();
      }
    } else if (e.key === 'Escape') {
      closeDropdown(dropdown);
    }
  });

  document.addEventListener('click', e => {
    if (!input.closest(closeSelector || '.search-container, .header-search-container, .compare-search-container')?.contains(e.target)) {
      closeDropdown(dropdown);
    }
  });
}

function renderSearchDropdown(dropdown, results, input, onSelect) {
  dropdown.innerHTML = '';
  if (!results.length) {
    dropdown.innerHTML = `<div class="dropdown-no-results">No funds found for "<strong>${escapeHtml(input.value)}</strong>"</div>`;
    openDropdown(dropdown);
    return;
  }
  results.forEach(fund => {
    const item = document.createElement('div');
    item.className = 'dropdown-item';
    item.setAttribute('role', 'option');
    item.innerHTML = `
      <span class="dropdown-scheme-code">${fund.schemeCode}</span>
      <span class="dropdown-name">${highlightMatch(fund.schemeName, input.value)}</span>
    `;
    item.addEventListener('click', () => {
      closeDropdown(dropdown);
      onSelect(fund);
    });
    dropdown.appendChild(item);
  });
  openDropdown(dropdown);
}

function renderDropdown(dropdown, results, input) {
  renderSearchDropdown(dropdown, results, input, (fund) => {
    input.value = fund.schemeName;
    loadFund(fund.schemeCode, fund.schemeName);
  });
}

function renderDropdownError(dropdown, msg) {
  dropdown.innerHTML = `<div class="dropdown-no-results" style="color:var(--accent-red)">⚠️ ${escapeHtml(msg)}</div>`;
  openDropdown(dropdown);
}

function openDropdown(dropdown) { dropdown.classList.add('open'); }
function closeDropdown(dropdown) { dropdown.classList.remove('open'); }

function showSpinner(el) { if (el) el.classList.add('active'); }
function hideSpinner(el) { if (el) el.classList.remove('active'); }

function updateFocus(items, idx) {
  items.forEach((item, i) => item.classList.toggle('focused', i === idx));
  items[idx]?.scrollIntoView({ block: 'nearest' });
}

function highlightMatch(name, query) {
  let result = escapeHtml(name);
  const parts = query.trim().split(/\s+/).filter(p => p.length >= 2);
  for (const part of parts) {
    const regex = new RegExp(`(${escapeRegex(part)})`, 'gi');
    result = result.replace(regex, '<strong style="color:var(--accent-blue)">$1</strong>');
  }
  return result;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeRegex(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ── Popular Chips ─────────────────────────────────────────────────────────────

function setupPopularChips() {
  document.querySelectorAll('#popular-chips .chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      const homeInput = document.getElementById('home-search');
      const homeDropdown = document.getElementById('home-dropdown');
      const homeSpinner = document.getElementById('home-spinner');
      if (!homeInput) return;

      const query = chip.dataset.query || chip.textContent.trim();
      const schemeCode = chip.dataset.code ? Number(chip.dataset.code) : null;

      if (schemeCode) {
        homeInput.value = query;
        loadFund(schemeCode, query);
        return;
      }

      homeInput.value = query;
      homeInput.focus();
      showSpinner(homeSpinner);
      try {
        const results = await searchFunds(query);
        if (results.length > 0) {
          renderDropdown(homeDropdown, results, homeInput);
          if (results.length === 1) {
            loadFund(results[0].schemeCode, results[0].schemeName);
          }
        } else {
          renderDropdownError(homeDropdown, 'No results found');
        }
      } catch (e) {
        renderDropdownError(homeDropdown, e.message);
      } finally {
        hideSpinner(homeSpinner);
      }
    });
  });
}

// ── Router (Hash-based URL Navigation) ───────────────────────────────────────
//
// URL scheme (hash segment after the origin):
//   #                        → Home
//   #ranking                 → Ranking tab (standalone)
//   #compare                 → Compare tab (standalone)
//   #{schemeCode}/overview   → Fund overview
//   #{schemeCode}/performance → Fund performance
//   … etc.

let _routerReady = false;
let _suppressNextPush = false;  // set true while popstate restores state
let _currentHistoryIndex = 0;

function setupRouter() {
  window.addEventListener('popstate', (e) => {
    _suppressNextPush = true;
    if (e.state && typeof e.state.usrIdx === 'number') {
      _currentHistoryIndex = e.state.usrIdx;
    }
    handleRouteChange(e.state || parseHashRoute());
  });

  // On first load, read the hash URL and navigate accordingly
  handleInitialRoute();
  _routerReady = true;
}

function parseHashRoute() {
  const hash = location.hash.replace(/^#\/?/, '').trim();
  if (!hash || hash === '/') return { page: 'home' };

  const parts = hash.split('/');
  const first = parts[0];

  // Standalone top-level tabs (no fund code)
  if (first === 'ranking')  return { page: 'ranking' };
  if (first === 'compare')  return { page: 'compare' };

  // Fund + tab:  {schemeCode}/{tab}
  const code = parseInt(first, 10);
  if (!isNaN(code) && code > 0) {
    const tab = parts[1] || 'overview';
    return { page: 'fund', code, tab };
  }

  return { page: 'home' };
}

function pushRoute(routeObj) {
  if (!_routerReady || _suppressNextPush) {
    _suppressNextPush = false;
    return;
  }
  const hash = routeToHash(routeObj);
  const current = location.hash.replace(/^#\/?/, '').trim();
  if (hash === current) return; // already there, don't push duplicate

  _currentHistoryIndex++;
  const stateObj = { ...routeObj, usrIdx: _currentHistoryIndex };
  history.pushState(stateObj, '', '#' + hash);
}

function replaceRoute(routeObj) {
  const hash = routeToHash(routeObj);
  const usrIdx = (history.state && typeof history.state.usrIdx === 'number') ? history.state.usrIdx : _currentHistoryIndex;
  const stateObj = { ...routeObj, usrIdx };
  history.replaceState(stateObj, '', '#' + hash);
}

function routeToHash(r) {
  if (!r || r.page === 'home')    return '';
  if (r.page === 'ranking')       return 'ranking';
  if (r.page === 'compare')       return 'compare';
  if (r.page === 'fund')          return `${r.code}/${r.tab || 'overview'}`;
  return '';
}

async function handleRouteChange(route) {
  if (!route) return;

  if (route.page === 'home') {
    showPage('home-page');
    destroyAll();
    const hi = document.getElementById('header-search');
    if (hi) hi.value = '';
    state.currentCode = null;
    _suppressNextPush = false;
    return;
  }

  if (route.page === 'ranking') {
    showPage('analysis-page');  // analysis-page hosts all tabs including standalone ranking
    showTabs();
    // Make sure the correct tab is active without pushing again
    _suppressNextPush = true;
    switchTab('ranking');
    _suppressNextPush = false;
    return;
  }

  if (route.page === 'compare') {
    showPage('analysis-page');
    showTabs();
    _suppressNextPush = true;
    switchTab('compare');
    _suppressNextPush = false;
    return;
  }

  if (route.page === 'fund' && route.code) {
    if (state.currentCode !== route.code) {
      // Need to load the fund first (don't push a new history entry)
      _suppressNextPush = true;
      await loadFund(route.code, '');
    } else {
      showPage('analysis-page');
      showTabs();
    }
    // Switch to the requested tab
    if (route.tab && route.tab !== state.activeTab) {
      _suppressNextPush = true;
      switchTab(route.tab);
    }
    _suppressNextPush = false;
  }
}

async function handleInitialRoute() {
  // If there's a meaningful hash, route to it; else fall back to session restore
  const hash = location.hash.replace(/^#\/?/, '').trim();
  if (hash && hash !== '') {
    const route = parseHashRoute();
    // Replace (not push) so the initial load doesn't add an extra history entry
    replaceRoute(route);
    _suppressNextPush = true;
    await handleRouteChange(route);
  } else {
    // No hash: restore previous session as before
    replaceRoute({ page: 'home' });
    await restoreSession();
  }
}

// ── Back Button ───────────────────────────────────────────────────────────────

function setupBackButton() {
  document.getElementById('back-btn')?.addEventListener('click', () => {
    // If the current history state has a usrIdx > 0, we have history within the app
    if (history.state && typeof history.state.usrIdx === 'number' && history.state.usrIdx > 0) {
      history.back();
    } else {
      pushRoute({ page: 'home' });
      showPage('home-page');
      destroyAll();
      const headerInput = document.getElementById('header-search');
      if (headerInput) headerInput.value = '';
      state.currentCode = null;
    }
  });
}

function setupHeaderLogo() {
  document.querySelectorAll('.logo-wrap').forEach(el => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      pushRoute({ page: 'home' });
      showPage('home-page');
      destroyAll();
      const headerInput = document.getElementById('header-search');
      if (headerInput) headerInput.value = '';
      state.currentCode = null;
    });
  });
}

// ── Page Navigation ───────────────────────────────────────────────────────────

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(pageId)?.classList.add('active');
}

// ── Load Fund ─────────────────────────────────────────────────────────────────

async function loadFund(schemeCode, schemeName) {
  const code = parseInt(schemeCode, 10) || schemeCode;

  if (state.currentCode === code) {
    showPage('analysis-page');
    return;
  }

  showPage('analysis-page');
  showLoading();

  // Sync header search input name
  const hi = document.getElementById('header-search');
  if (hi) hi.value = schemeName || '';

  try {
    const fundData = await fetchFundData(code);
    state.currentCode = code;
    state.fundData = fundData;
    state.sortedNav = sortNavChronological(fundData.data);
    state.annualReturns = computeAnnualReturns(state.sortedNav);

    // Re-compute risk if benchmark is available
    if (state.sortedBenchNav) {
      state.riskMetrics = computeRiskMetrics(state.sortedNav, state.sortedBenchNav);
    } else {
      try {
        await ensureBenchmarksLoaded();
      } catch (_) {
        state.riskMetrics = computeRiskMetrics(state.sortedNav, null);
      }
    }

    populateFundInfoStrip(fundData, state.sortedNav);
    addFundToRanking(code, fundData.meta.scheme_name, fundData.meta.scheme_category || fundData.meta.scheme_type, state.sortedNav);
    showTabs();
    switchTab('overview');
    saveSession();

  } catch (err) {
    showError(err.message);
  }
}

// ── Fund Info Strip ───────────────────────────────────────────────────────────

function populateFundInfoStrip(fundData, sortedNav) {
  const meta = fundData.meta || {};
  const latestItem = sortedNav[sortedNav.length - 1];
  const inceptionItem = sortedNav[0];

  // Name & AMC + scheme id (e.g. "UTI Mutual Fund - 120716")
  setText('fund-name', meta.scheme_name || '—');
  const schemeId = meta.scheme_code ?? state.currentCode;
  const sidStr = schemeId != null && schemeId !== '' ? String(schemeId) : '';
  const amc = meta.fund_house || '—';
  setText('fund-amc', sidStr ? `${amc} - ${sidStr}` : amc);

  // Category badge
  const cat = (meta.scheme_category || meta.scheme_type || '').toLowerCase();
  let badge = 'EQ', color = 'linear-gradient(135deg,#3b82f6,#06b6d4)';
  if (cat.includes('debt') || cat.includes('liquid') || cat.includes('bond')) {
    badge = 'DEBT'; color = 'linear-gradient(135deg,#8b5cf6,#06b6d4)';
  } else if (cat.includes('hybrid') || cat.includes('balanced')) {
    badge = 'HYB'; color = 'linear-gradient(135deg,#f59e0b,#10b981)';
  } else if (cat.includes('index') || cat.includes('etf')) {
    badge = 'IDX'; color = 'linear-gradient(135deg,#10b981,#06b6d4)';
  } else if (cat.includes('elss') || cat.includes('tax')) {
    badge = 'ELSS'; color = 'linear-gradient(135deg,#ef4444,#f59e0b)';
  }
  const badgeEl = document.getElementById('fund-type-badge');
  if (badgeEl) { badgeEl.textContent = badge; badgeEl.style.background = color; }
  setText('fund-category', meta.scheme_category || meta.scheme_type || '—');

  // NAV
  setText('latest-nav', fmtNav(latestItem.nav));

  // Inception
  setText('inception-date', formatDisplayDate(inceptionItem.date));

  // CAGRs
  const cagrs = computeAllCAGRs(sortedNav);
  const find = label => cagrs.find(c => c.label === label);
  const c3 = find('3 Years');
  const c5 = find('5 Years');
  const c7 = find('7 Years');
  const cI = find('Since Inception');

  setText('cagr-3y', c3?.cagr != null ? fmtPct(c3.cagr) : 'N/A');
  setText('cagr-5y', c5?.cagr != null ? fmtPct(c5.cagr) : 'N/A');
  setText('cagr-7y', c7?.cagr != null ? fmtPct(c7.cagr) : 'N/A');
  setText('inception-cagr', cI?.cagr != null ? fmtPct(cI.cagr) : 'N/A');

  // Color CAGRs dynamically
  const c3El = document.getElementById('cagr-3y');
  if (c3El && c3?.cagr != null) {
    c3El.style.color = c3.cagr >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
    c3El.style.fontWeight = '600';
  }
  const c5El = document.getElementById('cagr-5y');
  if (c5El && c5?.cagr != null) {
    c5El.style.color = c5.cagr >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
    c5El.style.fontWeight = '600';
  }
  const c7El = document.getElementById('cagr-7y');
  if (c7El && c7?.cagr != null) {
    c7El.style.color = c7.cagr >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
    c7El.style.fontWeight = '600';
  }
  const cEl = document.getElementById('inception-cagr');
  if (cEl && cI?.cagr != null) {
    cEl.style.color = cI.cagr >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
    cEl.style.fontWeight = '600';
  }

  show('fund-info-strip');
}

// ── UI States ─────────────────────────────────────────────────────────────────

function showLoading() {
  show('loading-state');
  hide('error-state');
  hide('tabs-section');
  hide('fund-info-strip');
}

function showError(msg) {
  hide('loading-state');
  show('error-state');
  hide('tabs-section');
  setText('error-text', msg || 'Something went wrong');
  document.getElementById('retry-btn')?.addEventListener('click', () => {
    if (state.currentCode) loadFund(state.currentCode);
  }, { once: true });
}

function showTabs() {
  hide('loading-state');
  hide('error-state');
  show('tabs-section');
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    btn.setAttribute('aria-selected', btn.classList.contains('active') ? 'true' : 'false');
  });
}

function switchTab(tabName) {
  state.activeTab = tabName;

  // Update button styles
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const isActive = btn.dataset.tab === tabName;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  // Show correct pane
  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.toggle('active', pane.id === `tab-${tabName}`);
  });

  destroyAll();
  renderActiveTab();

  // Auto-fetch ranking when tab is opened if not already loading and:
  // 1. We don't have a record of a successful complete fetch (fl-ranking-success !== 'true')
  // 2. Or the list of loaded funds is empty / less than 500 (e.g. cleared cache)
  const isFetched = localStorage.getItem('fl-ranking-success') === 'true';
  if (tabName === 'ranking' && !state.rankingLoading && (!isFetched || !state.rankedFunds || state.rankedFunds.length < 500)) {
    startRankingFetchProcess();
  }

  // Push URL route for this tab
  if (state.currentCode) {
    // Fund-specific tab
    pushRoute({ page: 'fund', code: state.currentCode, tab: tabName });
  } else if (tabName === 'ranking' || tabName === 'compare') {
    // Standalone tabs
    pushRoute({ page: tabName });
  }

  // Persist the active tab so refresh lands here
  saveSession();

  // Scroll tab into view on mobile
  document.querySelector(`[data-tab="${tabName}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });

  requestAnimationFrame(() => {
    enhanceResponsiveTables();
    updateStickyLayoutOffsets();
    resizeAllCharts();
  });
}

function renderActiveTab() {
  if (state.activeTab === 'ranking') {
    renderRankingTab();
    return;
  }
  if (!state.sortedNav) return;
  switch (state.activeTab) {
    case 'overview': renderOverviewTab(); break;
    case 'performance': renderPerformanceTab(); break;
    case 'returns': renderReturnsTab(); break;
    case 'yearly': renderYearlyTab(); break;
    case 'rolling': renderRollingTab(); break;
    case 'risk': renderRiskTab(); break;
    case 'alpha': renderAlphaTab(); break;
    case 'compare': renderCompareTab(); break;
  }

  requestAnimationFrame(() => {
    enhanceResponsiveTables();
    updateStickyLayoutOffsets();
  });
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

function renderOverviewTab() {
  const filtered = filterNavByPeriod(state.sortedNav, state.navPeriod);
  if (!filtered.length) return;

  renderNavChart(filtered, parseNavDate);

  // NAV change pill
  const first = parseFloat(filtered[0].nav);
  const last = parseFloat(filtered[filtered.length - 1].nav);
  const chg = ((last - first) / first) * 100;
  const pill = document.getElementById('nav-change-pill');
  if (pill) {
    pill.textContent = `${chg >= 0 ? '▲' : '▼'} ${Math.abs(chg).toFixed(2)}% ${periodLabel(state.navPeriod)}`;
    pill.className = `change-pill ${chg >= 0 ? 'positive' : 'negative'}`;
  }

  // All-time return highs and lows
  const oStats = computeOverviewStats(state.sortedNav);
  if (oStats) {
    setText('overview-ath-nav', fmtNav(oStats.athNav));
    setText('overview-ath-nav-date', oStats.athNavDate ? formatDisplayDate(oStats.athNavDate) : '—');
    setText('overview-atl-nav', fmtNav(oStats.atlNav));
    setText('overview-atl-nav-date', oStats.atlNavDate ? formatDisplayDate(oStats.atlNavDate) : '—');

    // Dynamic color coding for Ath/Atl daily returns
    const athReturnEl = document.getElementById('overview-ath-return');
    if (athReturnEl && oStats.athDailyReturn !== null) {
      athReturnEl.textContent = fmtPct(oStats.athDailyReturn);
      athReturnEl.className = `stat-val ${oStats.athDailyReturn >= 0 ? 'green' : 'red'}`;
    } else if (athReturnEl) {
      athReturnEl.textContent = '—';
      athReturnEl.className = 'stat-val';
    }
    setText('overview-ath-return-date', oStats.athDailyReturnDate ? formatDisplayDate(oStats.athDailyReturnDate) : '—');

    const atlReturnEl = document.getElementById('overview-atl-return');
    if (atlReturnEl && oStats.atlDailyReturn !== null) {
      atlReturnEl.textContent = fmtPct(oStats.atlDailyReturn);
      atlReturnEl.className = `stat-val ${oStats.atlDailyReturn >= 0 ? 'green' : 'red'}`;
    } else if (atlReturnEl) {
      atlReturnEl.textContent = '—';
      atlReturnEl.className = 'stat-val';
    }
    setText('overview-atl-return-date', oStats.atlDailyReturnDate ? formatDisplayDate(oStats.atlDailyReturnDate) : '—');
  }

  // Annual bar chart
  if (state.annualReturns?.length) {
    renderAnnualBarChart(state.annualReturns);
    const avg = state.annualReturns.reduce((s, r) => s + r.returnPct, 0) / state.annualReturns.length;
    const avgEl = document.getElementById('annual-avg-badge');
    if (avgEl) {
      avgEl.textContent = `Avg Annual: ${fmtPct(avg)}`;
      avgEl.className = `change-pill ${avg >= 0 ? 'positive' : 'negative'}`;
    }
  }
}

function setupNavPeriodButtons() {
  document.querySelectorAll('#nav-period-btns .period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#nav-period-btns .period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.navPeriod = btn.dataset.period;
      if (state.activeTab === 'overview') renderOverviewTab();
    });
  });
}

function periodLabel(p) {
  const map = { '1m': '(1 Month)', '3m': '(3 Months)', '6m': '(6 Months)', '1y': '(1 Year)', '3y': '(3 Years)', '5y': '(5 Years)', '7y': '(7 Years)', 'all': '(All Time)' };
  return map[p] || '';
}

// ── Performance Tab ───────────────────────────────────────────────────────────

function renderPerformanceTab() {
  const cagrs = computeAllCAGRs(state.sortedNav);

  // CAGR Table
  const tbody = document.getElementById('cagr-tbody');
  if (tbody) {
    tbody.innerHTML = cagrs.map(r => {
      const val = r.cagr !== null ? fmtPct(r.cagr) : '<span class="return-neutral">NA</span>';
      const color = r.cagr !== null ? (r.cagr >= 0 ? 'return-positive' : 'return-negative') : '';
      let assess = '—';
      if (r.cagr !== null) {
        if (r.cagr >= 15) assess = '🔥 Excellent';
        else if (r.cagr >= 12) assess = '✅ Very Good';
        else if (r.cagr >= 8) assess = '👍 Good';
        else if (r.cagr >= 4) assess = '⚠️ Moderate';
        else assess = '📉 Below Average';
      }
      return `<tr>
        <td><strong>${r.label}</strong></td>
        <td class="${color}">${val}</td>
        <td>${assess}</td>
      </tr>`;
    }).join('');
  }

  // CAGR Chart
  renderCagrChart(cagrs);

  // Annual returns full table
  const tbody2 = document.getElementById('annual-returns-tbody');
  if (tbody2 && state.annualReturns?.length) {
    const rows = [...state.annualReturns]; // chronological (ascending) order
    tbody2.innerHTML = rows.map(r => {
      const cls = r.returnPct >= 0 ? 'return-positive' : 'return-negative';
      return `<tr>
        <td><strong>${r.year}</strong></td>
        <td>${fmtNav(r.startNav)}</td>
        <td>${fmtNav(r.endNav)}</td>
        <td class="${cls}">${fmtPct(r.returnPct)}</td>
      </tr>`;
    }).join('');

    // Average row
    const avg = state.annualReturns.reduce((s, r) => s + r.returnPct, 0) / state.annualReturns.length;
    const tfoot = document.querySelector('#annual-returns-full tfoot');
    if (!tfoot) {
      const tf = document.createElement('tfoot');
      tf.innerHTML = `<tr>
        <td colspan="3"><strong>Average Annual Return</strong></td>
        <td class="${avg >= 0 ? 'return-positive' : 'return-negative'}"><strong>${fmtPct(avg)}</strong></td>
      </tr>`;
      document.getElementById('annual-returns-full')?.appendChild(tf);
    } else {
      tfoot.innerHTML = `<tr>
        <td colspan="3"><strong>Average Annual Return</strong></td>
        <td class="${avg >= 0 ? 'return-positive' : 'return-negative'}"><strong>${fmtPct(avg)}</strong></td>
      </tr>`;
    }
  }
}

// ── Rolling Returns Tab ───────────────────────────────────────────────────────

function setupRollingWindowButtons() {
  document.querySelectorAll('#rolling-window-btns .period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#rolling-window-btns .period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.rollingWindow = parseInt(btn.dataset.window);
      if (state.activeTab === 'rolling') renderRollingTab();
    });
  });
}

function setupCompareRollingButtons() {
  document.querySelectorAll('#cmp-rolling-btns .period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#cmp-rolling-btns .period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.rollingWindow = parseInt(btn.dataset.cmpwindow);
      if (state.compareA && state.compareB) {
        renderCompareTab();
      }
    });
  });
}

function setupCompareRiskPeriodButtons() {
  document.querySelectorAll('#cmp-risk-btns .period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#cmp-risk-btns .period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.cmpRiskPeriod = btn.dataset.cmprisk;
      if (state.compareA && state.compareB && document.getElementById('cmp-results')?.style.display === 'block') {
        renderCompareRiskTable();
      }
    });
  });
}

function cmpWinnerClasses(valA, valB, lowerBetter = false) {
  if (valA == null || valB == null || !isFinite(valA) || !isFinite(valB)) {
    return { classA: '', classB: '' };
  }
  if (valA === valB) return { classA: '', classB: '' };
  const aWins = lowerBetter ? valA < valB : valA > valB;
  return {
    classA: aWins ? 'winner-cell' : 'loser-cell',
    classB: aWins ? 'loser-cell' : 'winner-cell',
  };
}

/** Green highlight on winner only; no red on loser */
function cmpGreenWinnerOnly(valA, valB, lowerBetter = false) {
  if (valA == null || valB == null || !isFinite(valA) || !isFinite(valB)) {
    return { classA: '', classB: '' };
  }
  if (valA === valB) return { classA: '', classB: '' };
  const aWins = lowerBetter ? valA < valB : valA > valB;
  return {
    classA: aWins ? 'winner-cell' : '',
    classB: aWins ? '' : 'winner-cell',
  };
}

function renderCompareRiskTable() {
  if (!state.compareA || !state.compareB) return;

  document.querySelectorAll('#cmp-risk-btns .period-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.cmprisk === (state.cmpRiskPeriod || 'all'));
  });

  const a = state.compareA;
  const b = state.compareB;
  const periodKey = state.cmpRiskPeriod || 'all';
  const spec = CMP_RISK_PERIOD_SPECS[periodKey];

  setText('cmp-risk-label', spec ? `(${spec.shortLabel})` : '');
  setText('cmp-risk-h-a', a.name);
  setText('cmp-risk-h-b', b.name);

  const navA = getTrailingNavSlice(a.sortedNav, periodKey);
  const navB = getTrailingNavSlice(b.sortedNav, periodKey);
  const benchNav = state.sortedBenchNav
    ? getTrailingNavSlice(state.sortedBenchNav, periodKey)
    : null;

  const rA = computeRiskMetrics(navA, benchNav);
  const rB = computeRiskMetrics(navB, benchNav);

  const riskMetrics = [
    { label: 'Beta (Lower better)', valA: rA?.beta, valB: rB?.beta, lowerBetter: true, fmt: v => v?.toFixed(2) ?? 'N/A' },
    { label: 'Sharpe (Higher better)', valA: rA?.sharpe, valB: rB?.sharpe, lowerBetter: false, fmt: v => v?.toFixed(2) ?? 'N/A' },
    { label: 'Sortino (Higher better)', valA: rA?.sortino, valB: rB?.sortino, lowerBetter: false, fmt: v => v?.toFixed(2) ?? 'N/A' },
    { label: 'Std Deviation (Ann.)', valA: rA?.stdDevAnnual, valB: rB?.stdDevAnnual, lowerBetter: true, fmt: v => v != null ? `${v.toFixed(2)}%` : 'N/A' },
    { label: 'Max Drawdown (Lower better)', valA: rA?.maxDrawdown != null ? Math.abs(rA.maxDrawdown) : null, valB: rB?.maxDrawdown != null ? Math.abs(rB.maxDrawdown) : null, lowerBetter: true, fmt: v => v != null ? `${v.toFixed(2)}%` : 'N/A' },
  ];

  const tbody = document.getElementById('cmp-risk-tbody');
  if (!tbody) return;

  tbody.innerHTML = riskMetrics.map(rm => {
    const { classA, classB } = cmpWinnerClasses(rm.valA, rm.valB, rm.lowerBetter);
    return `<tr>
      <td class="cmp-metric-label"><span>${rm.label}</span></td>
      <td class="${classA}">${rm.fmt(rm.valA)}</td>
      <td class="${classB}">${rm.fmt(rm.valB)}</td>
    </tr>`;
  }).join('');
}

function renderCompareAlphaTable() {
  const tbody = document.getElementById('cmp-alpha-tbody');
  if (!tbody || !state.compareA || !state.compareB) return;

  const a = state.compareA;
  const b = state.compareB;

  setText('cmp-alpha-t-h-a', `${a.name} (α)`);
  setText('cmp-alpha-t-h-b', `${b.name} (α)`);

  if (!state.sortedBenchNav) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:32px">Benchmark data not available (UTI 120716).</td></tr>`;
    return;
  }

  const alphaA = computeAlpha(a.sortedNav, state.sortedBenchNav);
  const alphaB = computeAlpha(b.sortedNav, state.sortedBenchNav);

  const years = [...new Set([...alphaA.map(r => r.year), ...alphaB.map(r => r.year)])].sort((y1, y2) => y2 - y1);

  tbody.innerHTML = years.map(y => {
    const ra = alphaA.find(r => r.year === y);
    const rb = alphaB.find(r => r.year === y);
    const utiBench = ra?.benchReturn ?? rb?.benchReturn ?? null;
    const alphaValA = ra?.alpha ?? null;
    const alphaValB = rb?.alpha ?? null;
    const alphaClsA = alphaValA != null ? (alphaValA >= 0 ? 'return-positive' : 'return-negative') : '';
    const alphaClsB = alphaValB != null ? (alphaValB >= 0 ? 'return-positive' : 'return-negative') : '';
    const { classA: winnerA, classB: winnerB } = cmpGreenWinnerOnly(alphaValA, alphaValB, false);

    return `<tr>
      <td><strong>${y}</strong></td>
      <td class="${alphaClsA} ${winnerA}"><strong>${fmtPct(alphaValA)}</strong></td>
      <td class="${alphaClsB} ${winnerB}"><strong>${fmtPct(alphaValB)}</strong></td>
      <td>${fmtPct(utiBench)}</td>
    </tr>`;
  }).join('');
}

function renderRollingTab() {
  const W = state.rollingWindow;
  const rollingData = computeRollingReturns(state.sortedNav, W);
  const periods = computeRollingPeriods(state.sortedNav, W);
  const stats = computeRollingStats(rollingData);

  // Update chart label
  setText('rolling-chart-label', `(All overlapping ${W}Y windows, monthly sampled)`);
  setText('rolling-table-label', `(Non-overlapping ${W}Y periods from inception)`);

  // Stats cards
  if (stats) {
    setText('roll-best', fmtPct(stats.best));
    setText('roll-worst', fmtPct(stats.worst));
    setText('roll-avg', fmtPct(stats.avg));
    setText('roll-positive', `${stats.positiveCount}/${stats.total} (${stats.positivePct.toFixed(0)}%)`);
    setText('roll-beat12', `${stats.beat12Count}/${stats.total} (${stats.beat12Pct.toFixed(0)}%)`);

    // Color best/worst and percentage scores
    styleReturn('roll-best', stats.best);
    styleReturn('roll-worst', stats.worst);
    styleReturn('roll-avg', stats.avg);
    styleReturn('roll-positive', stats.positivePct >= 50 ? 1 : -1);
    styleReturn('roll-beat12', stats.beat12Pct >= 50 ? 1 : -1);
  } else {
    ['roll-best', 'roll-worst', 'roll-avg', 'roll-positive', 'roll-beat12'].forEach(id => {
      setText(id, 'N/A');
      const el = document.getElementById(id);
      if (el) el.className = 'stat-val';
    });
  }

  // Rolling Chart
  if (rollingData.length) {
    renderRollingChart(rollingData, W);
  } else {
    const canvas = document.getElementById('rollingChart');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'var(--text-muted)';
      ctx.font = '14px Inter';
      ctx.textAlign = 'center';
      ctx.fillText(`Not enough data for ${W}Y rolling returns`, canvas.width / 2, 60);
    }
  }

  // Period Breakdown Table
  const tbody = document.getElementById('rolling-tbody');
  const tfoot = document.getElementById('rolling-tfoot');
  if (!tbody) return;

  if (!periods.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px">
      Not enough historical data for ${W}-year rolling periods.
    </td></tr>`;
    return;
  }

  tbody.innerHTML = periods.map((p, i) => {
    const cls = p.cagr !== null ? (p.cagr >= 0 ? 'return-positive' : 'return-negative') : '';
    const bar = generateMiniBar(p.cagr, stats?.best || 50);
    return `<tr>
      <td>${i + 1}</td>
      <td><strong>${p.periodLabel}</strong></td>
      <td>${formatDisplayDate(p.startDate)}</td>
      <td>${formatDisplayDate(p.endDate)}</td>
      <td>${fmtNav(p.startNav)}</td>
      <td>${fmtNav(p.endNav)}</td>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="${cls}" style="min-width:60px">${fmtPct(p.cagr)}</span>
          ${bar}
        </div>
      </td>
    </tr>`;
  }).join('');

  // Average row
  if (stats && tfoot) {
    const avgCls = stats.avg !== null ? (stats.avg >= 0 ? 'return-positive' : 'return-negative') : '';
    tfoot.innerHTML = `<tr>
      <td colspan="6"><strong>Average of all ${periods.length} periods</strong></td>
      <td class="${avgCls}"><strong>${fmtPct(stats.avg)}</strong></td>
    </tr>`;
  }
}

function generateMiniBar(value, maxVal) {
  const pct = Math.min(100, Math.max(0, (value / maxVal) * 100));
  const color = value >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
  const absValue = Math.abs(value);
  const absPct = Math.min(100, (absValue / Math.abs(maxVal)) * 100);
  return `<div style="flex:1;height:6px;background:var(--border);border-radius:99px;overflow:hidden;max-width:80px">
    <div style="height:100%;width:${absPct}%;background:${color};border-radius:99px;transition:width 0.4s ease"></div>
  </div>`;
}

// ── Benchmark ready (re-render risk/alpha when async load completes) ─────────

async function ensureBenchmarksLoaded() {
  if (state.sortedBenchNav) return;
  const benches = await loadProjectBenchmarks();
  applyProjectBenchmarks(benches);
}

function applyProjectBenchmarks({ primary, uti, hdfc }) {
  state.benchmarkData = primary.data;
  state.sortedBenchNav = sortNavChronological(primary.data.data);
  state.sortedBenchNavUti = uti ? sortNavChronological(uti.data.data) : null;
  state.sortedBenchNavHdfc = hdfc ? sortNavChronological(hdfc.data.data) : null;

  updateBenchmarkLabels();

  if (state.sortedNav) {
    state.riskMetrics = computeRiskMetrics(state.sortedNav, state.sortedBenchNav);
    if (state.activeTab === 'risk') renderRiskTab();
    if (state.activeTab === 'alpha') renderAlphaTab();
  }
  if (state.compareA && state.compareB && document.getElementById('cmp-results')?.style.display === 'block') {
    renderCompareTab();
  }
  refreshRankedFundsAlpha();
}

function getActiveBenchmarkName() {
  const fromApi = state.benchmarkData?.meta?.scheme_name;
  if (fromApi) return fromApi;
  const meta = getBenchmarkFundMeta(getBenchmarkCode());
  return meta?.shortName || '—';
}

function updateBenchmarkLabels() {
  const chip = document.getElementById('benchmark-chip-label');
  if (chip) {
    chip.textContent = `📊 Benchmark: ${getActiveBenchmarkName()}`;
  }
  const riskNote = document.getElementById('risk-note-text');
  if (riskNote) {
    riskNote.textContent =
      'Risk metrics use monthly returns vs UTI Nifty 50 Index Fund - Growth (Direct) · 120716. HDFC Nifty 50 · 119063 is the alternate benchmark. Risk-free rate: 6.5% p.a.';
  }
}

// ── Risk Tab ──────────────────────────────────────────────────────────────────

const RISK_TABLE_METRICS = [
  { key: 'beta', label: 'Beta (β)', format: v => (v != null && isFinite(v)) ? v.toFixed(2) : 'N/A' },
  { key: 'sharpe', label: 'Sharpe Ratio', format: v => (v != null && isFinite(v)) ? v.toFixed(2) : 'N/A' },
  { key: 'sortino', label: 'Sortino Ratio', format: v => (v != null && isFinite(v)) ? v.toFixed(2) : 'N/A' },
  { key: 'stdDevAnnual', label: 'Std Deviation (Ann.)', format: v => (v != null && isFinite(v)) ? `${v.toFixed(2)}%` : 'N/A' },
  { key: 'maxDrawdown', label: 'Max Drawdown', format: v => (v != null && isFinite(v)) ? fmtPct(v) : 'N/A' },
];

function setupRiskPeriodButtons() {
  document.querySelectorAll('#risk-period-btns .period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#risk-period-btns .period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.riskPeriod = btn.dataset.riskPeriod;
      if (state.activeTab === 'risk') renderRiskTab();
      saveSession();
    });
  });
}

function renderRiskTab() {
  if (!state.sortedNav?.length) return;

  const windowKey = state.riskPeriod || 'all';
  const spec = RISK_WINDOW_SPECS[windowKey];
  const { breakdown, gaugeMetrics, gaugePeriodLabel, gaugePeriodRange } =
    computeRiskMetricsBreakdown(state.sortedNav, state.sortedBenchNav, windowKey);

  // Gauge caption
  const captionEl = document.getElementById('risk-gauge-caption');
  if (captionEl) {
    if (windowKey === 'all') {
      captionEl.textContent = 'Gauges: All Time (since inception)';
    } else if (gaugePeriodRange) {
      captionEl.textContent = `Gauges: Latest ${spec?.shortLabel || windowKey} window · ${gaugePeriodLabel} (${gaugePeriodRange})`;
    } else {
      captionEl.textContent = `Gauges: ${spec?.shortLabel || windowKey} — insufficient complete windows`;
    }
  }

  setText('risk-table-label', spec
    ? `(non-overlapping ${spec.shortLabel} windows)`
    : '');

  // Gauges
  if (gaugeMetrics) {
    setTimeout(() => renderRiskGauges(gaugeMetrics), 80);
  } else {
    setTimeout(() => renderRiskGauges({
      beta: null, sharpe: null, sortino: null, stdDevAnnual: null, maxDrawdown: null,
    }), 80);
  }

  // Drawdown (matches gauge window)
  const gaugeSlice = breakdown.length
    ? sliceNavByDateRange(state.sortedNav, breakdown[breakdown.length - 1].startDate, breakdown[breakdown.length - 1].endDate)
    : state.sortedNav;
  const ddMetrics = gaugeMetrics || state.riskMetrics;
  const ddVal = ddMetrics?.maxDrawdown;
  if (ddVal !== null && isFinite(ddVal)) {
    setText('drawdown-value', fmtPct(ddVal));
    if (ddMetrics.maxDrawdownStart && ddMetrics.maxDrawdownEnd) {
      setText('drawdown-period', `  Peak: ${formatDisplayDate(ddMetrics.maxDrawdownStart)} → Trough: ${formatDisplayDate(ddMetrics.maxDrawdownEnd)}`);
    }
  } else {
    setText('drawdown-value', 'N/A');
    setText('drawdown-period', '');
  }

  const ddSeries = computeDrawdownSeries(
    windowKey === 'all' ? state.sortedNav : gaugeSlice
  );
  renderDrawdownChart(ddSeries);

  // Period breakdown table: periods on the left (rows), risk metrics across the top (columns)
  const thead = document.getElementById('risk-period-thead');
  const tbody = document.getElementById('risk-period-tbody');
  if (!thead || !tbody) return;

  const colCount = RISK_TABLE_METRICS.length + 1;

  if (!breakdown.length) {
    thead.innerHTML = `<tr><th>Period</th>${RISK_TABLE_METRICS.map(m => `<th>${m.label}</th>`).join('')}</tr>`;
    tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center;color:var(--text-muted);padding:24px">
      Not enough history for complete ${spec?.shortLabel || windowKey} windows.
    </td></tr>`;
    requestAnimationFrame(enhanceResponsiveTables);
    return;
  }

  thead.innerHTML = `<tr>
    <th>Period</th>
    ${RISK_TABLE_METRICS.map(m => `<th>${m.label}</th>`).join('')}
  </tr>`;

  tbody.innerHTML = breakdown.map((p, idx) => {
    const isLatest = windowKey !== 'all' && idx === breakdown.length - 1;
    const cells = RISK_TABLE_METRICS.map(row => {
      const val = p.metrics?.[row.key];
      const text = row.format(val);
      let cls = '';
      if (row.key === 'maxDrawdown' && val != null && isFinite(val)) {
        cls = 'return-negative';
      } else if (['sharpe', 'sortino'].includes(row.key) && val != null && isFinite(val)) {
        cls = val >= 1 ? 'return-positive' : val >= 0 ? '' : 'return-negative';
      } else if (row.key === 'beta' && val != null && isFinite(val)) {
        cls = val < 0.8 ? 'return-positive' : val > 1.2 ? 'return-negative' : '';
      }
      return `<td class="${cls}">${text}</td>`;
    }).join('');
    const latestTag = isLatest ? ' <span class="risk-latest-tag">Latest</span>' : '';
    return `<tr class="${isLatest ? 'risk-period-latest' : ''}">
      <td class="cell-nowrap"><strong>${escapeHtml(p.periodLabel)}</strong>${latestTag}</td>
      ${cells}
    </tr>`;
  }).join('');

  requestAnimationFrame(enhanceResponsiveTables);
}

// ── Alpha Tab ─────────────────────────────────────────────────────────────────

function renderAlphaTab() {
  if (!state.sortedBenchNav) {
    showAlphaUnavailable('Benchmark data not available. Alpha requires UTI Nifty 50 (120716) or HDFC Nifty 50 (119063).');
    return;
  }

  updateBenchmarkLabels();

  const alphaData = computeAlpha(state.sortedNav, state.sortedBenchNav);
  if (!alphaData.length) {
    showAlphaUnavailable('No overlapping data between this fund and the benchmark for alpha calculation.');
    return;
  }

  const stats = computeAlphaStats(alphaData);

  // Summary stats
  if (stats) {
    const avgEl = document.getElementById('avg-alpha');
    if (avgEl) {
      avgEl.textContent = fmtPct(stats.avg);
      avgEl.className = `stat-val ${stats.avg >= 0 ? 'green' : 'red'}`;
    }
    const yrsEl = document.getElementById('years-outperformed');
    if (yrsEl) {
      yrsEl.textContent = `${stats.positiveYears}/${stats.totalYears} yrs`;
      yrsEl.className = `stat-val ${(stats.positiveYears / stats.totalYears) >= 0.5 ? 'green' : 'red'}`;
    }
    const conEl = document.getElementById('consistency-score');
    if (conEl) {
      conEl.textContent = `${stats.consistency.toFixed(0)}%`;
      conEl.className = `stat-val ${stats.consistency >= 50 ? 'green' : 'red'}`;
    }
    const bestEl = document.getElementById('best-alpha-year');
    if (bestEl && stats.bestYear) {
      bestEl.textContent = `${stats.bestYear.year} (${fmtPct(stats.bestYear.alpha)})`;
      bestEl.className = `stat-val ${stats.bestYear.alpha >= 0 ? 'green' : 'red'}`;
    }
  }

  // Chart
  renderAlphaChart(alphaData);

  // Table
  const tbody = document.getElementById('alpha-tbody');
  const tfoot = document.getElementById('alpha-tfoot');
  if (!tbody) return;

  // Chronological (ascending) order
  const rows = [...alphaData];
  tbody.innerHTML = rows.map(a => {
    const alphaCls = a.alpha >= 0 ? 'return-positive' : 'return-negative';
    const signalHtml = a.alpha >= 0
      ? `<span class="signal-pill out">▲ Outperformed</span>`
      : `<span class="signal-pill under">▼ Underperformed</span>`;
    return `<tr>
      <td><strong>${a.year}</strong></td>
      <td class="${a.fundReturn >= 0 ? 'return-positive' : 'return-negative'}">${fmtPct(a.fundReturn)}</td>
      <td class="${a.benchReturn >= 0 ? 'return-positive' : 'return-negative'}">${fmtPct(a.benchReturn)}</td>
      <td class="${alphaCls}"><strong>${fmtPct(a.alpha)}</strong></td>
      <td>${signalHtml}</td>
    </tr>`;
  }).join('');

  // Average row
  if (stats && tfoot) {
    const avgFund = alphaData.reduce((s, a) => s + a.fundReturn, 0) / alphaData.length;
    const avgBench = alphaData.reduce((s, a) => s + a.benchReturn, 0) / alphaData.length;
    const avgAlpha = alphaData.reduce((s, a) => s + a.alpha, 0) / alphaData.length;
    tfoot.innerHTML = `<tr>
      <td><strong>Average</strong></td>
      <td class="${avgFund >= 0 ? 'return-positive' : 'return-negative'}"><strong>${fmtPct(avgFund)}</strong></td>
      <td class="${avgBench >= 0 ? 'return-positive' : 'return-negative'}"><strong>${fmtPct(avgBench)}</strong></td>
      <td class="${avgAlpha >= 0 ? 'return-positive' : 'return-negative'}"><strong>${fmtPct(avgAlpha)}</strong></td>
      <td><span class="signal-pill ${avgAlpha >= 0 ? 'out' : 'under'}">${avgAlpha >= 0 ? '▲ Net Outperformer' : '▼ Net Underperformer'}</span></td>
    </tr>`;
  }
}

function showAlphaUnavailable(msg) {
  const container = document.getElementById('tab-alpha');
  if (!container) return;
  ['avg-alpha', 'years-outperformed', 'consistency-score', 'best-alpha-year'].forEach(id => setText(id, 'N/A'));
  const tbody = document.getElementById('alpha-tbody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:32px">${msg}</td></tr>`;
}

// ── Utility Helpers ───────────────────────────────────────────────────────────

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function show(id) {
  const el = document.getElementById(id);
  if (el) {
    el.style.display = '';
    el.removeAttribute('hidden');
  }
  if (id === 'fund-info-strip') {
    requestAnimationFrame(updateStickyLayoutOffsets);
  }
}

function hide(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
  if (id === 'fund-info-strip') {
    requestAnimationFrame(updateStickyLayoutOffsets);
  }
}

// ── Responsive layout helpers ─────────────────────────────────────────────────

function setupMobileSearch() {
  const toggle = document.getElementById('header-search-toggle');
  const panel = document.getElementById('header-search-container');
  const input = document.getElementById('header-search');
  if (!toggle || !panel) return;

  const closePanel = () => {
    panel.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
  };

  toggle.addEventListener('click', () => {
    const open = panel.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      requestAnimationFrame(() => input?.focus());
    }
  });

  document.addEventListener('click', (e) => {
    if (!panel.classList.contains('is-open')) return;
    if (toggle.contains(e.target) || panel.contains(e.target)) return;
    closePanel();
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) closePanel();
  });
}

function setupResponsiveLayout() {
  let resizeTimer;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      updateStickyLayoutOffsets();
      resizeAllCharts();
    }, 150);
  };
  window.addEventListener('resize', onResize, { passive: true });
  window.addEventListener('orientationchange', onResize, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onResize, { passive: true });
  }
  requestAnimationFrame(updateStickyLayoutOffsets);
}

function updateStickyLayoutOffsets() {
  const header  = document.querySelector('.analysis-header');
  const strip   = document.getElementById('fund-info-strip');
  const tabNav  = document.querySelector('.tab-nav-scroll');
  const ticker  = document.getElementById('market-ticker');
  const page    = document.getElementById('analysis-page');
  if (!page) return;

  // ── 1. Measure ACTUAL ticker height and sync --ticker-h ──────────────────
  // Static --ticker-h: 36px can differ from the real rendered height due to
  // browser font scaling or OS text size. We measure & update it so all
  // dependent sticky offsets and padding-top are pixel-perfect.
  if (ticker) {
    const tickerH = Math.round(ticker.getBoundingClientRect().height);
    document.documentElement.style.setProperty('--ticker-h', `${tickerH}px`);
    // Since ticker and headers are relative, we don't need any top padding on the page.
    page.style.paddingTop = '0px';
  }

  // ── 2. Measure analysis header height ────────────────────────────────────
  if (header) {
    document.documentElement.style.setProperty(
      '--header-h',
      `${Math.round(header.getBoundingClientRect().height)}px`
    );
  }

  // ── 3. Measure fund info strip height ────────────────────────────────────
  const stripVisible = strip
    && strip.style.display !== 'none'
    && getComputedStyle(strip).display !== 'none';

  page.classList.toggle('has-fund-strip', Boolean(stripVisible));

  if (stripVisible && strip) {
    document.documentElement.style.setProperty(
      '--strip-h',
      `${Math.round(strip.getBoundingClientRect().height)}px`
    );
  } else {
    document.documentElement.style.setProperty('--strip-h', '0px');
  }

  // ── 4. Measure tab nav height and set --tabs-h ────────────────────────────
  // Used by scroll-margin-top on chart cards so period-year buttons are never
  // obscured by the sticky tab bar when the user scrolls to a chart.
  if (tabNav) {
    document.documentElement.style.setProperty(
      '--tabs-h',
      `${Math.round(tabNav.getBoundingClientRect().height)}px`
    );
  } else {
    document.documentElement.style.setProperty('--tabs-h', '0px');
  }
}


function setupTableScrollHints() {
  document.querySelectorAll('.table-scroll').forEach((scroll) => {
    if (scroll.querySelector('.table-scroll-hint')) return;
    const hint = document.createElement('p');
    hint.className = 'table-scroll-hint';
    hint.setAttribute('aria-hidden', 'true');
    hint.textContent = 'Swipe horizontally to see more columns';
    scroll.insertBefore(hint, scroll.firstChild);
  });
}

const NOWRAP_HEADER_RE = /^(year|#|rank|code|cagr|nav|action|metric)$/i;
const NOWRAP_HEADER_PARTIAL_RE = /\byear\b/i;
const MOBILE_TABLE_MQ = window.matchMedia('(max-width: 768px)');

function headerHasMultipleWords(label) {
  return (label || '').trim().split(/\s+/).filter(Boolean).length >= 2;
}

function headerWrapClass(label) {
  const text = (label || '').trim();
  if (!text) return 'cell-nowrap';
  if (NOWRAP_HEADER_RE.test(text) || NOWRAP_HEADER_PARTIAL_RE.test(text)) {
    return 'cell-nowrap';
  }
  const words = text.split(/\s+/).filter(Boolean);
  return words.length <= 1 ? 'cell-nowrap' : 'cell-wrap-words';
}

function cellLooksLikeYear(text) {
  const t = (text || '').trim();
  return /^\d{4}$/.test(t) || /^\d{4}[-/]\d{2}$/.test(t) || /^\d{1,2}[Yy]$/.test(t);
}

function applyTableWrapClasses(table) {
  const headerEls = [...table.querySelectorAll('thead th')];
  const headers = headerEls.map((th) => th.textContent.trim());
  const mobile = MOBILE_TABLE_MQ.matches;
  const inCompareTab = Boolean(table.closest('#tab-compare'));

  headerEls.forEach((th, i) => {
    th.classList.remove('cell-nowrap', 'cell-wrap-words');
    const label = th.textContent.trim();
    // Compare tab: wrap fund-name columns (all except first label column)
    if (inCompareTab && i > 0) {
      th.classList.add('cell-wrap-words');
    } else if (mobile && headerHasMultipleWords(label)) {
      th.classList.add('cell-wrap-words');
    } else if (table.id === 'ranking-table' && i === 2) {
      th.classList.add('cell-wrap-words');
    } else {
      th.classList.add(headerWrapClass(label));
    }
  });

  const nowrapColIndexes = new Set();
  headers.forEach((label, i) => {
    const lower = label.toLowerCase();
    if (
      NOWRAP_HEADER_RE.test(label)
      || NOWRAP_HEADER_PARTIAL_RE.test(label)
      || lower === 'code'
      || lower.includes('cagr')
      || lower.includes('nav')
      || lower.includes('alpha')
      || lower.includes('%')
      || lower === 'action'
      || lower === '#'
      || lower === 'rank'
    ) {
      nowrapColIndexes.add(i);
    }
  });

  table.querySelectorAll('tbody tr').forEach((tr) => {
    [...tr.children].forEach((td, i) => {
      if (headers[i] && !td.hasAttribute('data-label')) {
        td.setAttribute('data-label', headers[i]);
      }

      td.classList.remove('cell-nowrap', 'cell-wrap-words');
      const headerClass = headerEls[i]?.classList.contains('cell-wrap-words')
        ? 'cell-wrap-words'
        : 'cell-nowrap';

      if (table.id === 'ranking-table' && i === 2) {
        td.classList.add('cell-wrap-words');
      } else if (table.id === 'ranking-table' && i === 3) {
        td.classList.add('cell-wrap-words');
      } else if (nowrapColIndexes.has(i) || cellLooksLikeYear(td.textContent)) {
        td.classList.add('cell-nowrap');
      } else if (table.id === 'cmp-risk-table' && i === 0) {
        td.classList.add('cell-wrap-words');
      } else {
        td.classList.add(headerClass);
      }
    });
  });

  if (table.classList.contains('risk-period-table')) {
    table.querySelectorAll('tbody td:first-child').forEach((td) => {
      td.classList.add('cell-nowrap');
    });
  }
}

function enhanceResponsiveTables() {
  document.querySelectorAll('.data-table').forEach((table) => {
    applyTableWrapClasses(table);
  });
}

function setupMobileTableHeaderWrap() {
  const refresh = () => enhanceResponsiveTables();
  if (typeof MOBILE_TABLE_MQ.addEventListener === 'function') {
    MOBILE_TABLE_MQ.addEventListener('change', refresh);
  } else if (typeof MOBILE_TABLE_MQ.addListener === 'function') {
    MOBILE_TABLE_MQ.addListener(refresh);
  }
}

function styleReturn(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `stat-val ${value >= 0 ? 'green' : 'red'}`;
}

// ── Period Returns Tab ────────────────────────────────────────────────────────

function renderReturnsTab() {
  const periodData = computeDetailedPeriodReturns(state.sortedNav);

  const absBody = document.getElementById('period-returns-abs-tbody');
  const avgBody = document.getElementById('period-returns-avg-tbody');

  if (absBody || avgBody) {
    // Use the same human-readable labels as computeDetailedPeriodReturns
    const ABS_LABELS = ['1 Day', '1 Week', '1 Month', '3 Months', '6 Months', '1 Year'];
    const AVG_LABELS = ['3 Years', '5 Years', '7 Years', '10 Years', 'All Time'];

    const labelIn = (labels, text) => {
      const t = (text || '').trim().toLowerCase();
      return labels.some(l => t === l.toLowerCase());
    };

    const absRows = [];
    const avgRows = [];

    periodData.forEach(item => {
      const label = item.label || '';
      const isOk = item.startNav !== null;
      const absVal = isOk ? fmtPct(item.absReturn) : '<span class="return-neutral">N/A</span>';
      const avgVal = isOk ? fmtPct(item.avgReturn) : '<span class="return-neutral">N/A</span>';

      const absCls = isOk ? (item.absReturn >= 0 ? 'return-positive' : 'return-negative') : '';
      const avgCls = isOk ? (item.avgReturn >= 0 ? 'return-positive' : 'return-negative') : '';

      if (labelIn(ABS_LABELS, label)) {
        absRows.push(`<tr>
          <td><strong>${label}</strong></td>
          <td>${isOk ? formatDisplayDate(item.startDate) : '—'}</td>
          <td>${isOk ? fmtNav(item.startNav) : '—'}</td>
          <td>${fmtNav(item.endNav)}</td>
          <td class="${absCls}">${absVal}</td>
        </tr>`);
      }

      if (labelIn(AVG_LABELS, label)) {
        avgRows.push(`<tr>
          <td><strong>${label}</strong></td>
          <td>${isOk ? formatDisplayDate(item.startDate) : '—'}</td>
          <td>${isOk ? fmtNav(item.startNav) : '—'}</td>
          <td>${fmtNav(item.endNav)}</td>
          <td class="${avgCls}">${avgVal}</td>
        </tr>`);
      }
    });

    if (absBody) absBody.innerHTML = absRows.join('');
    if (avgBody) avgBody.innerHTML = avgRows.join('');
  }

  renderPeriodReturnsChart(periodData);
}

// ── Yearly Returns Tab ────────────────────────────────────────────────────────

function renderYearlyTab() {
  const yearlyData = state.annualReturns;

  const tbody = document.getElementById('yearly-returns-tbody');
  if (tbody && yearlyData?.length) {
    const rows = [...yearlyData]; // chronological (ascending) order
    tbody.innerHTML = rows.map(item => {
      const absVal = item.returnPct !== null ? fmtPct(item.returnPct) : 'N/A';
      const avgVal = item.avgReturnPct !== null ? fmtPct(item.avgReturnPct) : 'N/A';

      const absCls = item.returnPct !== null ? (item.returnPct >= 0 ? 'return-positive' : 'return-negative') : '';
      const avgCls = item.avgReturnPct !== null ? (item.avgReturnPct >= 0 ? 'return-positive' : 'return-negative') : '';

      return `<tr>
        <td><strong>${item.year}</strong></td>
        <td>${formatDisplayDate(item.startDate)}</td>
        <td>${formatDisplayDate(item.endDate)}</td>
        <td>${fmtNav(item.startNav)}</td>
        <td>${fmtNav(item.endNav)}</td>
        <td class="${absCls}">${absVal}</td>
        <td class="${avgCls}">${avgVal}</td>
      </tr>`;
    }).join('');
  }

  if (yearlyData?.length) {
    renderYearlyReturnsChart(yearlyData);
  }
}

// ── Ranking Leaderboard Tab ──────────────────────────────────────────────────

async function preloadRankingLeaderboard() {
  const stored = localStorage.getItem('fl-ranked-funds-v2');
  if (stored) {
    state.rankedFunds = JSON.parse(stored);
    sortLeaderboard();
  } else {
    state.rankedFunds = [];
  }
  if (state.activeTab === 'ranking') renderRankingTab();
}

function persistRankedFunds() {
  localStorage.setItem('fl-ranked-funds-v2', JSON.stringify(state.rankedFunds));
}

function sortLeaderboard() {
  state.rankedFunds.sort((a, b) => {
    // 1. Primary: yearsBeaten (descending)
    const ybDiff = (b.yearsBeaten || 0) - (a.yearsBeaten || 0);
    if (ybDiff !== 0) return ybDiff;

    // 2. Secondary: If yearsBeaten > 0, break ties using avgAlpha (descending)
    if ((a.yearsBeaten || 0) > 0) {
      const alphaDiff = (b.avgAlpha || 0) - (a.avgAlpha || 0);
      if (alphaDiff !== 0) return alphaDiff;
    }

    // 3. Tertiary: beatenPercentage (descending)
    const bpDiff = (b.beatenPercentage || 0) - (a.beatenPercentage || 0);
    if (bpDiff !== 0) return bpDiff;

    // 4. Fallback: allTimeCagr (descending)
    return (b.allTimeCagr || 0) - (a.allTimeCagr || 0);
  });
}

function addFundToRanking(schemeCode, schemeName, category, sortedNav) {
  if (!sortedNav || !sortedNav.length) return;
  if (!state.sortedBenchNav) return; // Need benchmark to compare
  
  const annualReturns = computeAnnualReturns(sortedNav);
  if (!annualReturns.length) return;
  
  const benchAnnual = computeAnnualReturns(state.sortedBenchNav);
  const benchMap = {};
  for (const b of benchAnnual) {
    benchMap[b.year] = b.returnPct;
  }
  
  let yearsBeaten = 0;
  let totalYears = 0;
  let sumAlpha = 0;
  let alphaCount = 0;
  
  for (const f of annualReturns) {
    const benchRet = benchMap[f.year];
    if (benchRet !== undefined && benchRet !== null && f.returnPct !== null) {
      totalYears++;
      const alpha = f.returnPct - benchRet;
      sumAlpha += alpha;
      alphaCount++;
      if (alpha > 0) {
        yearsBeaten++;
      }
    }
  }
  
  if (totalYears === 0) return;
  
  const avgAlpha = alphaCount > 0 ? sumAlpha / alphaCount : 0;
  const beatenPercentage = (yearsBeaten / totalYears) * 100;
  
  const inceptionItem = sortedNav[0];
  const latestItem = sortedNav[sortedNav.length - 1];
  const inceptionNav = parseFloat(inceptionItem.nav);
  const latestNav = parseFloat(latestItem.nav);
  const totalDays = (parseNavDate(latestItem.date) - parseNavDate(inceptionItem.date)) / (1000 * 3600 * 24);
  const totalYearsForCagr = totalDays / 365.25;
  const allTimeCagr = computeCAGR(inceptionNav, latestNav, totalYearsForCagr) || 0;
  
  const existingIdx = state.rankedFunds.findIndex(f => String(f.schemeCode) === String(schemeCode));
  const fundInfo = {
    schemeCode: parseInt(schemeCode),
    schemeName,
    category: category || 'Equity',
    allTimeCagr,
    avgAlpha,
    yearsBeaten,
    totalYears,
    beatenPercentage,
  };
  
  if (existingIdx >= 0) {
    state.rankedFunds[existingIdx] = fundInfo;
  } else {
    state.rankedFunds.push(fundInfo);
  }
  
  sortLeaderboard();
  persistRankedFunds();
  if (state.activeTab === 'ranking') renderRankingTab();
}

async function refreshRankedFundsAlpha() {
  // In the new system, we can backfill any missing alphas if benchmark becomes available
  if (!state.sortedBenchNav || !state.rankedFunds.length) return;
  
  const benchAnnual = computeAnnualReturns(state.sortedBenchNav);
  const benchMap = {};
  for (const b of benchAnnual) {
    benchMap[b.year] = b.returnPct;
  }

  let updated = false;
  for (const fund of state.rankedFunds) {
    if (fund.yearsBeaten === undefined || fund.beatenPercentage === undefined) {
      try {
        const data = await fetchFundData(fund.schemeCode);
        const sortedNav = sortNavChronological(data.data);
        const annualReturns = computeAnnualReturns(sortedNav);
        
        let yearsBeaten = 0;
        let totalYears = 0;
        let sumAlpha = 0;
        let alphaCount = 0;
        
        for (const f of annualReturns) {
          const benchRet = benchMap[f.year];
          if (benchRet !== undefined && benchRet !== null && f.returnPct !== null) {
            totalYears++;
            const alpha = f.returnPct - benchRet;
            sumAlpha += alpha;
            alphaCount++;
            if (alpha > 0) {
              yearsBeaten++;
            }
          }
        }
        
        if (totalYears > 0) {
          fund.yearsBeaten = yearsBeaten;
          fund.totalYears = totalYears;
          fund.beatenPercentage = (yearsBeaten / totalYears) * 100;
          fund.avgAlpha = alphaCount > 0 ? sumAlpha / alphaCount : 0;
          updated = true;
        }
      } catch (err) {
        console.warn(`Could not refresh alpha for ${fund.schemeName}:`, err.message);
      }
    }
  }

  if (updated) {
    sortLeaderboard();
    persistRankedFunds();
    if (state.activeTab === 'ranking') renderRankingTab();
  }
}

async function startRankingFetchProcess() {
  if (state.rankingLoading) return; // Already running

  state.rankingLoading = true;
  state.rankingCancelled = false;
  state.rankedFunds = [];
  state.rankingDisplayLimit = 100;
  // Reset any period-specific ranking so we start fresh
  state.periodRankedFunds = null;
  state.rankingPeriodKey  = 'all';
  state.cachedPeriodRankings = {};
  state.lastSuccessfulPeriodKey = 'all';
  // Restore "All Time" button as active
  document.querySelectorAll('#ranking-period-btns .period-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.rankperiod === 'all');
  });
  localStorage.removeItem('fl-ranking-success');
  renderRankingTab();

  const progressArea = document.getElementById('ranking-progress-area');
  const progressText = document.getElementById('ranking-progress-text');
  const progressBar = document.getElementById('ranking-progress-bar');
  const progressCount = document.getElementById('ranking-progress-count');
  const progressRanked = document.getElementById('ranking-progress-ranked');

  if (progressArea) {
    progressArea.style.display = '';
    progressArea.removeAttribute('hidden');
  }
  if (progressBar) progressBar.style.width = '0%';
  if (progressCount) progressCount.textContent = 'Initializing...';
  if (progressRanked) progressRanked.textContent = '0 ranked';
  if (progressText) progressText.textContent = 'Fetching registry list...';

  try {
    // Ensure Nifty 50 benchmark is loaded
    if (!state.sortedBenchNav) {
      if (progressText) progressText.textContent = 'Fetching UTI & HDFC Nifty 50 benchmarks...';
      await ensureBenchmarksLoaded();
    }

    const benchAnnual = computeAnnualReturns(state.sortedBenchNav);
    const benchMap = {};
    for (const b of benchAnnual) {
      benchMap[b.year] = b.returnPct;
    }

    const fundCodes = await fetchAllFundCodes();
    const total = fundCodes.length;
    if (total === 0) throw new Error('No Direct Growth funds found in registry');

    if (progressText) progressText.textContent = `Processing ${total} Direct Growth funds...`;

    let index = 0;
    let fetchedCount = 0;
    let rankedCount = 0;
    const concurrency = 35;

    async function worker() {
      while (index < total) {
        if (state.rankingCancelled) break;
        const currentIdx = index++;
        const fund = fundCodes[currentIdx];
        if (!fund) continue;
        if (fund.schemeCode === 120716 || fund.schemeCode === 119063) continue;

        try {
          const data = await fetchFundData(fund.schemeCode);
          fetchedCount++;

          const sortedNav = sortNavChronological(data.data);
          if (sortedNav.length > 0) {
            const annualReturns = computeAnnualReturns(sortedNav);
            if (annualReturns.length > 0) {
              let yearsBeaten = 0;
              let totalYears = 0;
              let sumAlpha = 0;
              let alphaCount = 0;

              for (const f of annualReturns) {
                const benchRet = benchMap[f.year];
                if (benchRet !== undefined && benchRet !== null && f.returnPct !== null) {
                  totalYears++;
                  const alpha = f.returnPct - benchRet;
                  sumAlpha += alpha;
                  alphaCount++;
                  if (alpha > 0) yearsBeaten++;
                }
              }

              if (totalYears > 0) {
                const avgAlpha = alphaCount > 0 ? sumAlpha / alphaCount : 0;
                const beatenPercentage = (yearsBeaten / totalYears) * 100;
                const inceptionItem = sortedNav[0];
                const latestItem = sortedNav[sortedNav.length - 1];
                const inceptionNav = parseFloat(inceptionItem.nav);
                const latestNav = parseFloat(latestItem.nav);
                const totalDays = (parseNavDate(latestItem.date) - parseNavDate(inceptionItem.date)) / (1000 * 3600 * 24);
                const totalYearsForCagr = totalDays / 365.25;
                const allTimeCagr = computeCAGR(inceptionNav, latestNav, totalYearsForCagr) || 0;
                const category = data.meta.scheme_category || data.meta.scheme_type || 'Equity';

                state.rankedFunds.push({
                  schemeCode: fund.schemeCode,
                  schemeName: data.meta.scheme_name || fund.schemeName,
                  category,
                  allTimeCagr,
                  avgAlpha,
                  yearsBeaten,
                  totalYears,
                  beatenPercentage,
                });
                rankedCount++;
              }
            }
          }
        } catch (err) {
          console.warn(`Failed to process scheme code ${fund.schemeCode}:`, err.message);
          fetchedCount++;
        }

        // Real-time batch rendering every 10 funds
        if (fetchedCount % 10 === 0 || fetchedCount === total) {
          const pct = ((fetchedCount / total) * 100).toFixed(1);
          if (progressBar) progressBar.style.width = `${pct}%`;
          if (progressCount) progressCount.textContent = `${fetchedCount} / ${total} funds processed`;
          if (progressRanked) progressRanked.textContent = `${rankedCount} ranked`;
          if (progressText) progressText.textContent = `Ranking all funds... (${pct}%)`;
          sortLeaderboard();
          renderRankingTab();
        }
      }
    }

    const workers = [];
    for (let i = 0; i < Math.min(concurrency, total); i++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    if (progressBar) progressBar.style.width = '100%';
    sortLeaderboard();
    persistRankedFunds();
    localStorage.setItem('fl-ranking-success', 'true');
    renderRankingTab();

  } catch (err) {
    console.error(err);
    if (progressText) progressText.textContent = `Error: ${err.message}`;
  } finally {
    state.rankingLoading = false;
    state.rankingCancelled = false;
    // Hide the entire progress area once done
    const progressArea = document.getElementById('ranking-progress-area');
    if (progressArea) {
      progressArea.style.display = 'none';
      progressArea.setAttribute('hidden', '');
    }
  }
}


// ── Period-based Re-ranking ────────────────────────────────────────────────────

function setPeriodButtonsDisabled(disabled) {
  document.querySelectorAll('#ranking-period-btns .period-btn').forEach(btn => {
    btn.disabled = disabled;
    btn.style.opacity = disabled ? '0.5' : '';
    btn.style.cursor  = disabled ? 'not-allowed' : '';
  });
  const sel = document.getElementById('ranking-category-select');
  if (sel) sel.disabled = disabled;
}

async function startPeriodRanking(periodKey) {
  if (state.rankingLoading) return;        // block while initial fetch runs
  if (state.periodRankingLoading) return;  // block double-click

  // "All Time" → simply restore original ranking
  if (periodKey === 'all') {
    state.periodRankedFunds = null;
    state.rankingPeriodKey = 'all';
    state.lastSuccessfulPeriodKey = 'all';
    state.rankingDisplayLimit = 100;
    renderRankingTab();
    return;
  }

  // Caching: if already calculated, instantly render from cache
  if (state.cachedPeriodRankings && state.cachedPeriodRankings[periodKey]) {
    state.periodRankedFunds = state.cachedPeriodRankings[periodKey];
    state.rankingPeriodKey = periodKey;
    state.lastSuccessfulPeriodKey = periodKey;
    state.rankingDisplayLimit = 100;
    renderRankingTab();
    return;
  }

  if (!state.rankedFunds || !state.rankedFunds.length) return;

  state.rankingPeriodKey = periodKey;
  state.periodRankingLoading = true;
  state.periodRankingStopped  = false;
  state.rankingDisplayLimit   = 100;
  setPeriodButtonsDisabled(true);

  // Show period overlay & wire Stop button
  const overlay      = document.getElementById('ranking-period-area');
  const overlayText  = document.getElementById('ranking-period-text');
  const overlayBar   = document.getElementById('ranking-period-bar');
  const overlayCount = document.getElementById('ranking-period-count');
  const stopBtn      = document.getElementById('ranking-period-stop-btn');
  if (overlay)  { overlay.style.display = ''; overlay.removeAttribute('hidden'); }
  if (overlayBar) overlayBar.style.width = '0%';
  if (overlayText)  overlayText.textContent  = `Preparing ${periodKey.toUpperCase()} ranking…`;
  if (overlayCount) overlayCount.textContent = '0 / 0 funds';

  // Stop button — sets the cancellation flag; finally block does the cleanup
  const onStop = () => {
    state.periodRankingStopped  = true;
    state.periodRankingLoading  = false;
    if (stopBtn) stopBtn.disabled = true;
    if (overlayText) overlayText.textContent = 'Stopping…';
  };
  if (stopBtn) {
    stopBtn.disabled = false;
    stopBtn.addEventListener('click', onStop, { once: true });
  }

  try {
    // Ensure benchmark loaded
    if (!state.sortedBenchNav) await ensureBenchmarksLoaded();

    const years      = parseInt(periodKey.replace('y', ''), 10);
    const now        = new Date();
    const currentYear = now.getFullYear();
    const lastCompletedYear = currentYear - 1;

    // Filter benchmark NAV series to only contain data before the current year
    const completedBenchNav = state.sortedBenchNav.filter(n => parseNavDate(n.date).getFullYear() < currentYear);

    const cutoffYear = lastCompletedYear - years + 1;
    // We define a cutoffDate for the CAGR calculation, going back years from the end of the previous year
    const cutoffDate = new Date(lastCompletedYear - years, 11, 31);

    // Build benchmark year-return map limited to the chosen completed years period
    const benchAnnual = computeAnnualReturns(completedBenchNav);
    const benchMap = {};
    for (const b of benchAnnual) {
      if (b.year >= cutoffYear && b.year < currentYear) {
        benchMap[b.year] = b.returnPct;
      }
    }

    const allFunds   = [...state.rankedFunds];
    const total      = allFunds.length;
    let   index      = 0;
    let   processed  = 0;
    const periodResults = [];
    const concurrency   = 35;

    // Control DOM update frequency to completely eliminate page lag
    let lastProgressUpdate = 0;

    async function periodWorker() {
      while (index < total) {
        if (!state.periodRankingLoading) break;
        const i    = index++;
        const fund = allFunds[i];
        if (!fund) continue;

        try {
          const data      = await fetchFundData(fund.schemeCode); // in-memory cache
          const sortedNav = sortNavChronological(data.data);

          if (sortedNav.length > 0) {
            // Filter fund NAV series to only contain data before the current year
            const completedNav = sortedNav.filter(n => parseNavDate(n.date).getFullYear() < currentYear);

            if (completedNav.length > 0) {
              // Calendar-year returns filtered to the selected completed period
              const allReturns    = computeAnnualReturns(completedNav);
              const periodReturns = allReturns.filter(r => r.year >= cutoffYear && r.year < currentYear);

              if (periodReturns.length > 0) {
                let yearsBeaten = 0, totalYears = 0, sumAlpha = 0, alphaCount = 0;

                for (const f of periodReturns) {
                  const benchRet = benchMap[f.year];
                  if (benchRet !== undefined && benchRet !== null && f.returnPct !== null) {
                    totalYears++;
                    const alpha = f.returnPct - benchRet;
                    sumAlpha += alpha;
                    alphaCount++;
                    if (alpha > 0) yearsBeaten++;
                  }
                }

                if (totalYears > 0) {
                  // Period CAGR: find first NAV on/after cutoffDate up to the end of last completed year
                  const latestItem = completedNav[completedNav.length - 1];
                  const latestNav  = parseFloat(latestItem.nav);
                  const latestDate = parseNavDate(latestItem.date);
                  let periodCagr   = fund.allTimeCagr;

                  for (const item of completedNav) {
                    if (parseNavDate(item.date) >= cutoffDate) {
                      const startNav  = parseFloat(item.nav);
                      const actualYrs = (latestDate - parseNavDate(item.date)) / (365.25 * 24 * 3600 * 1000);
                      if (actualYrs > 0) periodCagr = computeCAGR(startNav, latestNav, actualYrs) || 0;
                      break;
                    }
                  }

                  periodResults.push({
                    schemeCode:       fund.schemeCode,
                    schemeName:       fund.schemeName,
                    category:         fund.category,
                    allTimeCagr:      periodCagr,
                    avgAlpha:         alphaCount > 0 ? sumAlpha / alphaCount : 0,
                    yearsBeaten,
                    totalYears,
                    beatenPercentage: (yearsBeaten / totalYears) * 100,
                  });
                }
              }
            }
          }
        } catch (err) {
          console.warn(`Period ranking skipped ${fund.schemeCode}:`, err.message);
        }

        processed++;

        // Throttle progress updates to at most once per 120ms
        const nowMs = Date.now();
        if (nowMs - lastProgressUpdate > 120 || processed === total) {
          lastProgressUpdate = nowMs;
          const pct = ((processed / total) * 100).toFixed(0);
          if (overlayBar)   overlayBar.style.width    = `${pct}%`;
          if (overlayCount) overlayCount.textContent   = `${processed} / ${total} funds`;
          if (overlayText)  overlayText.textContent    = `Computing ${years}Y alpha ranking… (${pct}%)`;
        }
      }
    }

    // Spawn concurrent workers
    const workers = [];
    for (let w = 0; w < Math.min(concurrency, total); w++) workers.push(periodWorker());
    await Promise.all(workers);

    // Sort with the same multi-criteria algorithm as the main leaderboard
    periodResults.sort((a, b) => {
      const ybDiff = (b.yearsBeaten || 0) - (a.yearsBeaten || 0);
      if (ybDiff !== 0) return ybDiff;
      if ((a.yearsBeaten || 0) > 0) {
        const alphaDiff = (b.avgAlpha || 0) - (a.avgAlpha || 0);
        if (alphaDiff !== 0) return alphaDiff;
      }
      const bpDiff = (b.beatenPercentage || 0) - (a.beatenPercentage || 0);
      if (bpDiff !== 0) return bpDiff;
      return (b.allTimeCagr || 0) - (a.allTimeCagr || 0);
    });

    if (!state.periodRankingStopped) {
      state.cachedPeriodRankings[periodKey] = periodResults;
      state.periodRankedFunds = periodResults;
      state.lastSuccessfulPeriodKey = periodKey;
    }

  } catch (err) {
    console.error('Period ranking error:', err);
    if (overlayText) overlayText.textContent = `Error: ${err.message}`;
  } finally {
    state.periodRankingLoading = false;

    if (state.periodRankingStopped) {
      // Revert states to the previously successfully ranked period key
      state.rankingPeriodKey = state.lastSuccessfulPeriodKey || 'all';
      state.periodRankedFunds = state.rankingPeriodKey === 'all' ? null : (state.cachedPeriodRankings[state.rankingPeriodKey] || null);
      state.periodRankingStopped = false;
    }

    if (overlay) { overlay.style.display = 'none'; overlay.setAttribute('hidden', ''); }
    setPeriodButtonsDisabled(false);
    renderRankingTab();
  }
}


function setupRankingControls() {
  const categorySelect = document.getElementById('ranking-category-select');
  if (categorySelect) {
    categorySelect.addEventListener('change', () => {
      state.rankingCategory = categorySelect.value;
      state.rankingDisplayLimit = 100; // Reset display limit on filter change
      renderRankingTab();
    });
  }

  // Period filter buttons
  document.querySelectorAll('#ranking-period-btns .period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const periodKey = btn.dataset.rankperiod;
      state.rankingDisplayLimit = 100;
      startPeriodRanking(periodKey);
    });
  });

  const loadMoreBtn = document.getElementById('ranking-load-more-btn');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => {
      state.rankingDisplayLimit = (state.rankingDisplayLimit || 100) + 100;
      renderRankingTab();
    });

    // Sleek IntersectionObserver for infinite scroll: auto-load more when scrolled into view
    if (typeof IntersectionObserver !== 'undefined') {
      const observer = new IntersectionObserver((entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && state.activeTab === 'ranking' && !state.rankingLoading) {
          const container = document.getElementById('ranking-load-more-container');
          if (container && !container.hasAttribute('hidden')) {
            loadMoreBtn.click();
          }
        }
      }, { rootMargin: '150px' });
      observer.observe(loadMoreBtn);
    }
  }
}

function matchesCategoryFilter(fund, filter) {
  if (!filter || filter === 'all') return true;
  
  const cat = (fund.category || '').toLowerCase();
  const name = (fund.schemeName || '').toLowerCase();
  
  switch (filter) {
    case 'all equity':
      return cat.includes('equity') && !cat.includes('debt') && !cat.includes('hybrid') && !cat.includes('index') && !name.includes('index') && !name.includes('etf');
    case 'flexi':
      return cat.includes('flexi') || name.includes('flexi');
    case 'large':
      return cat.includes('large') || name.includes('large');
    case 'mid':
      return cat.includes('mid') || name.includes('mid');
    case 'small':
      return cat.includes('small') || name.includes('small');
    case 'elss':
      return cat.includes('elss') || name.includes('elss');
    case 'hybrid':
      return cat.includes('hybrid') || name.includes('hybrid');
    case 'debt':
      return cat.includes('debt') || name.includes('debt');
    case 'index':
      return cat.includes('index') || name.includes('index') || name.includes('nifty') || name.includes('sensex') || name.includes('etf') || name.includes('spdr') || name.includes('s&p');
    default:
      return true;
  }
}

function renderRankingTab() {
  const tbody = document.getElementById('ranking-tbody');
  if (!tbody) return;

  // Sync active class on the period filter buttons
  const activePeriod = state.rankingPeriodKey || 'all';
  document.querySelectorAll('#ranking-period-btns .period-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.rankperiod === activePeriod);
  });

  // Determine which fund list to use: period-specific or all-time
  const periodKey = state.rankingPeriodKey || 'all';
  const isAllTime = periodKey === 'all';
  const activeFunds = isAllTime ? state.rankedFunds : (state.periodRankedFunds || state.rankedFunds);

  // Update table headers dynamically
  const periodLabels = { all: 'All Time', '1y': '1Y', '3y': '3Y', '5y': '5Y', '7y': '7Y', '10y': '10Y', '15y': '15Y' };
  const periodLabel = periodLabels[periodKey] || 'All Time';
  const cagrHeader   = document.getElementById('ranking-cagr-header');
  const alphaHeader  = document.getElementById('ranking-alpha-header');
  const beatenHeader = document.getElementById('ranking-beaten-header');
  const tableLabel   = document.getElementById('ranking-table-label');
  const introDesc    = document.getElementById('ranking-intro-desc');
  if (cagrHeader)   cagrHeader.textContent   = isAllTime ? 'CAGR' : `${periodLabel} CAGR`;
  if (alphaHeader)  alphaHeader.textContent  = isAllTime ? 'Avg Alpha' : `${periodLabel} Avg Alpha`;
  if (beatenHeader) beatenHeader.textContent = isAllTime ? 'Beaten %' : `${periodLabel} Beaten %`;
  if (tableLabel)   tableLabel.textContent   = isAllTime
    ? '(Ranked by Nifty 50 Beat Count)'
    : `(Ranked by ${periodLabel} Nifty 50 Beat Count)`;
  if (introDesc) {
    introDesc.innerHTML = isAllTime
      ? 'All Direct Growth mutual funds ranked by <strong>Nifty 50 beat count</strong> — how many calendar years the fund beat the index. Ties broken by average alpha.'
      : `All Direct Growth mutual funds ranked by <strong>${periodLabel} Nifty 50 beat count</strong> — years beaten within the last ${periodLabel}. Ties broken by ${periodLabel} average alpha.`;
  }

  if (!activeFunds || !activeFunds.length) {
    if (state.rankingLoading || state.periodRankingLoading) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:48px">
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px">
          <div class="spinner-ring" style="width:36px;height:36px;border-width:3px;margin:0 auto;"></div>
          <div style="font-size:14px;color:var(--text-secondary)">${state.periodRankingLoading ? 'Calculating period stats...' : 'Initializing database scan…'}</div>
        </div>
      </td></tr>`;
    } else {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:32px">Switch to the Ranking tab to automatically fetch and rank all Direct Growth mutual funds.</td></tr>`;
    }
    return;
  }

  const categoryFilter = state.rankingCategory || 'all';
  const filteredFunds = activeFunds.filter(fund => matchesCategoryFilter(fund, categoryFilter));

  if (!filteredFunds.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:32px">No funds in this category found. Try another category.</td></tr>`;
    return;
  }

  const displayLimit = state.rankingDisplayLimit || 100;
  const fundsToRender = filteredFunds.slice(0, displayLimit);

  tbody.innerHTML = fundsToRender.map((fund, idx) => {
    const rank = idx + 1;
    let rankHtml = `<span class="rank-badge">${rank}</span>`;
    if (rank === 1) rankHtml = `<span class="rank-badge gold">1</span>`;
    else if (rank === 2) rankHtml = `<span class="rank-badge silver">2</span>`;
    else if (rank === 3) rankHtml = `<span class="rank-badge bronze">3</span>`;

    const cagrCls = fund.allTimeCagr >= 0 ? 'return-positive' : 'return-negative';
    const avgAlphaCls = fund.avgAlpha >= 0 ? 'return-positive' : 'return-negative';
    const beatenPctCls = fund.beatenPercentage >= 50 ? 'return-positive' : (fund.beatenPercentage > 0 ? '' : 'return-negative');

    return `<tr>
      <td data-label="Rank">${rankHtml}</td>
      <td data-label="Code"><span class="dropdown-scheme-code">${fund.schemeCode}</span></td>
      <td data-label="Fund Name" class="ranking-fund-name cell-wrap-words"><strong class="ranking-fund-name-text">${escapeHtml(fund.schemeName)}</strong></td>
      <td data-label="Type"><span class="ranking-category-tag">${escapeHtml(fund.category)}</span></td>
      <td data-label="CAGR" class="${cagrCls}"><strong>${fmtPct(fund.allTimeCagr)}</strong></td>
      <td data-label="Avg Alpha" class="${avgAlphaCls}"><strong>${fmtPct(fund.avgAlpha)}</strong></td>
      <td data-label="Beaten %" class="${beatenPctCls}">
        <strong>${fund.beatenPercentage.toFixed(1)}%</strong>&nbsp;<span class="ranking-years-tag">(${fund.yearsBeaten}/${fund.totalYears}Y)</span>
      </td>
      <td data-label="Action">
        <button type="button" class="chip compact-chip rank-analyze-btn" data-code="${fund.schemeCode}" data-name="${escapeHtml(fund.schemeName)}">Analyze</button>
      </td>
    </tr>`;
  }).join('');

  // Control visibility of "Load More" container
  const loadMoreContainer = document.getElementById('ranking-load-more-container');
  if (loadMoreContainer) {
    if (!state.rankingLoading && filteredFunds.length > displayLimit) {
      loadMoreContainer.style.display = '';
      loadMoreContainer.removeAttribute('hidden');
    } else {
      loadMoreContainer.style.display = 'none';
      loadMoreContainer.setAttribute('hidden', '');
    }
  }

  enhanceResponsiveTables();

  // Add click event listener to "Analyze" buttons
  tbody.querySelectorAll('.rank-analyze-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.dataset.code;
      const name = btn.dataset.name;
      loadFund(code, name);
    });
  });
}

// ── Compare Tab Logic ─────────────────────────────────────────────────────────

function setupCompareSearch() {
  const setupOne = (side) => {
    const input = document.getElementById(`cmp-search-${side}`);
    const dropdown = document.getElementById(`cmp-dropdown-${side}`);
    const spinner = document.getElementById(`cmp-spinner-${side}`);
    const chip = document.getElementById(`cmp-chip-${side}`);
    const chipName = document.getElementById(`cmp-chip-name-${side}`);
    const clearBtn = document.getElementById(`cmp-clear-${side}`);

    if (!input || !dropdown) return;

    const selectCompareFund = async (fund) => {
      input.value = '';
      closeDropdown(dropdown);
      input.parentElement.style.display = 'none';
      chip.style.display = 'flex';
      chipName.textContent = fund.schemeName;

      try {
        showSpinner(spinner);
        const data = await fetchFundData(fund.schemeCode);
        state[`compare${side.toUpperCase()}`] = {
          code: fund.schemeCode,
          name: fund.schemeName,
          fundData: data,
          sortedNav: sortNavChronological(data.data),
        };
        updateCmpButton();
        if (document.getElementById('cmp-results').style.display === 'block') {
          document.getElementById('cmp-run-btn').textContent = 'Update Comparison';
        }
      } catch (e) {
        console.error(e);
        alert('Error fetching fund data. Please try again.');
      } finally {
        hideSpinner(spinner);
      }
    };

    bindFundSearchInput({
      input,
      dropdown,
      spinner,
      closeSelector: '.compare-search-container',
      onSelect: selectCompareFund,
    });

    clearBtn.onclick = () => {
      state[`compare${side.toUpperCase()}`] = null;
      chip.style.display = 'none';
      input.parentElement.style.display = 'flex';
      input.value = '';
      updateCmpButton();
      // If we clear a fund, we should hide the current results to avoid confusion
      document.getElementById('cmp-results').style.display = 'none';
      document.getElementById('cmp-run-btn').textContent = 'Compare Funds';
      document.getElementById('cmp-reset-btn').style.display = 'none';
    };
  };

  setupOne('a');
  setupOne('b');

  document.getElementById('cmp-run-btn')?.addEventListener('click', () => {
    // Show loading
    document.getElementById('cmp-results').style.display = 'none';
    document.getElementById('cmp-loading').style.display = 'flex';
    document.getElementById('cmp-run-btn').disabled = true;

    setTimeout(() => {
      renderCompareTab();
      document.getElementById('cmp-loading').style.display = 'none';
      document.getElementById('cmp-results').style.display = 'block';
      document.getElementById('cmp-reset-btn').style.display = 'inline-block';
      document.getElementById('cmp-run-btn').disabled = false;
      document.getElementById('cmp-run-btn').textContent = 'Update Comparison';
      saveSession();
    }, 800);
  });

  document.getElementById('cmp-reset-btn')?.addEventListener('click', () => {
    // Full reset
    ['a', 'b'].forEach(side => {
      state[`compare${side.toUpperCase()}`] = null;
      document.getElementById(`cmp-chip-${side}`).style.display = 'none';
      const inputWrap = document.getElementById(`cmp-search-wrap-${side}`);
      if (inputWrap) inputWrap.style.display = 'flex';
      const input = document.getElementById(`cmp-search-${side}`);
      if (input) input.value = '';
    });
    document.getElementById('cmp-results').style.display = 'none';
    document.getElementById('cmp-reset-btn').style.display = 'none';
    document.getElementById('cmp-run-btn').textContent = 'Compare Funds';
    updateCmpButton();
    saveSession();
  });
}


function updateCmpButton() {
  const btn = document.getElementById('cmp-run-btn');
  const hint = document.getElementById('cmp-hint');
  if (state.compareA && state.compareB) {
    btn.disabled = false;
    hint.style.display = 'none';
  } else {
    btn.disabled = true;
    hint.style.display = 'block';
  }
}

async function renderCompareTab() {
  if (!state.compareA || !state.compareB) return;

  const a = state.compareA;
  const b = state.compareB;

  // Legends
  setText('cmp-legend-a', a.name); setText('cmp-legend-b', b.name);
  setText('cmp-cagr-h-a', a.name); setText('cmp-cagr-h-b', b.name);
  setText('cmp-annual-legend-a', a.name); setText('cmp-annual-legend-b', b.name);
  setText('cmp-alpha-legend-a', a.name); setText('cmp-alpha-legend-b', b.name);
  setText('cmp-dd-legend-a', a.name); setText('cmp-dd-legend-b', b.name);
  setText('cmp-period-h-a', a.name); setText('cmp-period-h-b', b.name);
  setText('cmp-risk-h-a', a.name); setText('cmp-risk-h-b', b.name);
  enhanceResponsiveTables();

  // Info Cards
  const renderInfoCard = (f) => {
    const last = f.sortedNav[f.sortedNav.length - 1];
    const c = computeAllCAGRs(f.sortedNav);
    const incCagr = c.find(r => r.label === 'Since Inception')?.cagr;
    return `
      <div class="cmp-info-card">
        <div class="cmp-fund-tag">Mutual Fund</div>
        <div class="cmp-fund-name">${f.name}</div>
        <div class="cmp-stat-grid">
          <div class="cmp-stat-item"><span class="cmp-stat-label">Latest NAV</span><span class="cmp-stat-val">₹${fmtNav(last.nav)}</span></div>
          <div class="cmp-stat-item"><span class="cmp-stat-label">Inception CAGR</span><span class="cmp-stat-val" style="color:var(--text-primary)">${fmtPct(incCagr)}</span></div>
          <div class="cmp-stat-item"><span class="cmp-stat-label">Category</span><span class="cmp-stat-val" style="font-size:12px">${f.fundData.meta.scheme_category || '—'}</span></div>
          <div class="cmp-stat-item"><span class="cmp-stat-label">AMC</span><span class="cmp-stat-val" style="font-size:12px">${f.fundData.meta.fund_house || '—'}</span></div>
        </div>
      </div>
    `;
  };
  document.getElementById('cmp-info-cards').innerHTML = renderInfoCard(a) + renderInfoCard(b);

  // Charts
  import('./charts.js').then(m => {
    m.renderCompareNavChart(a.sortedNav, b.sortedNav, a.name, b.name, parseNavDate);

    // CAGR Comparison Table
    const cagrsA = computeAllCAGRs(a.sortedNav);
    const cagrsB = computeAllCAGRs(b.sortedNav);
    m.renderCompareCagrChart(cagrsA, cagrsB, a.name, b.name);
    const allLabels = [...new Set([...cagrsA.map(r => r.label), ...cagrsB.map(r => r.label)])];
    document.getElementById('cmp-cagr-tbody').innerHTML = allLabels.map(lbl => {
      const ra = cagrsA.find(r => r.label === lbl);
      const rb = cagrsB.find(r => r.label === lbl);
      const valA = ra?.cagr ?? null;
      const valB = rb?.cagr ?? null;
      return `<tr>
        <td><strong>${lbl}</strong></td>
        <td class="${(valA !== null && valB !== null && valA > valB) ? 'winner-cell' : ''}">${fmtPct(valA)}</td>
        <td class="${(valA !== null && valB !== null && valB > valA) ? 'winner-cell' : ''}">${fmtPct(valB)}</td>
      </tr>`;
    }).join('');

    // Rolling Chart
    const rollA = computeRollingReturns(a.sortedNav, state.rollingWindow || 3);
    const rollB = computeRollingReturns(b.sortedNav, state.rollingWindow || 3);
    m.renderCompareRollingChart(rollA, rollB, state.rollingWindow || 3, a.name, b.name);
    setText('cmp-rolling-label', `(${state.rollingWindow || 3}Y windows)`);

    // Period Returns Table (Annualized/Averaged for >1yr)
    const pA = computeDetailedPeriodReturns(a.sortedNav);
    const pB = computeDetailedPeriodReturns(b.sortedNav);
    document.getElementById('cmp-period-tbody').innerHTML = pA.map((r, i) => {
      const rb = pB[i];
      const isLongTerm = r.label.includes('Year') || r.label.includes('All');
      const valA = isLongTerm ? r.avgReturn : r.absReturn;
      const valB = isLongTerm ? rb?.avgReturn : rb?.absReturn;
      const { classA, classB } = cmpGreenWinnerOnly(valA, valB, false);
      return `<tr>
        <td><strong>${r.label}${isLongTerm ? ' (Avg)' : ''}</strong></td>
        <td class="${classA}">${fmtPct(valA)}</td>
        <td class="${classB}">${fmtPct(valB)}</td>
      </tr>`;
    }).join('');

    // Annual Comparison Table — green = higher return that year only
    const annualA = computeAnnualReturns(a.sortedNav);
    const annualB = computeAnnualReturns(b.sortedNav);
    const years = [...new Set([...annualA.map(r => r.year), ...annualB.map(r => r.year)])].sort((y1, y2) => y2 - y1);
    setText('cmp-annual-h-a', a.name);
    setText('cmp-annual-h-b', b.name);
    document.getElementById('cmp-annual-tbody').innerHTML = years.map(y => {
      const ra = annualA.find(r => r.year === y);
      const rb = annualB.find(r => r.year === y);
      const vA = ra?.returnPct ?? null;
      const vB = rb?.returnPct ?? null;
      const { classA, classB } = cmpGreenWinnerOnly(vA, vB, false);
      return `<tr>
        <td><strong>${y}</strong></td>
        <td class="${classA}">${fmtPct(vA)}</td>
        <td class="${classB}">${fmtPct(vB)}</td>
      </tr>`;
    }).join('');

    renderCompareAlphaTable();

    if (state.sortedBenchNav) {
      const alphaA = computeAlpha(a.sortedNav, state.sortedBenchNav);
      const alphaB = computeAlpha(b.sortedNav, state.sortedBenchNav);
      m.renderCompareAlphaChart(alphaA, alphaB, a.name, b.name);
    }

    // Drawdown Chart
    const ddA = computeDrawdownSeries(a.sortedNav);
    const ddB = computeDrawdownSeries(b.sortedNav);
    m.renderCompareDrawdownChart(ddA, ddB, a.name, b.name);

    renderCompareRiskTable();
    enhanceResponsiveTables();
  });
}



