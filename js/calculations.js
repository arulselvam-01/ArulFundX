/**
 * ArulFundX – Calculations Module
 * All financial math: CAGR, Rolling Returns, Alpha, Beta, Sharpe, Sortino, Drawdown
 */

// ── Date Helpers ─────────────────────────────────────────────────────────────

/**
 * Parse DD-MM-YYYY → JS Date (local time)
 */
export function parseNavDate(dateStr) {
  const [d, m, y] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Format a Date to "DD-MM-YYYY"
 */
export function formatDate(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${d}-${m}-${date.getFullYear()}`;
}

/**
 * Format a Date to "MMM YYYY"
 */
export function formatMonthYear(date) {
  return date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

/**
 * Format a Date to "DD MMM YYYY"
 */
export function formatDisplayDate(dateStr) {
  const d = parseNavDate(dateStr);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── NAV Data Processing ───────────────────────────────────────────────────────

/**
 * Sort NAV data chronologically (oldest first)
 * API returns newest first by default
 */
export function sortNavChronological(navData) {
  return [...navData].sort((a, b) => parseNavDate(a.date) - parseNavDate(b.date));
}

/**
 * Find the NAV item whose date is closest to (but not after) targetDate
 */
function getNavOnOrBefore(sortedNav, targetDate) {
  let result = null;
  for (const item of sortedNav) {
    const d = parseNavDate(item.date);
    if (d <= targetDate) result = item;
    else break;
  }
  return result;
}

/**
 * Find the NAV item whose date is closest to (but not before) targetDate
 */
function getNavOnOrAfter(sortedNav, targetDate) {
  for (const item of sortedNav) {
    if (parseNavDate(item.date) >= targetDate) return item;
  }
  return null;
}

/**
 * Filter NAV data to a period relative to today
 * period: '1m','3m','6m','1y','3y','5y','7y','all'
 */
export function filterNavByPeriod(sortedNav, period) {
  if (period === 'all') return sortedNav;
  const now = new Date();
  const cutoff = new Date(now);
  switch (period) {
    case '1m': cutoff.setMonth(now.getMonth() - 1); break;
    case '3m': cutoff.setMonth(now.getMonth() - 3); break;
    case '6m': cutoff.setMonth(now.getMonth() - 6); break;
    case '1y': cutoff.setFullYear(now.getFullYear() - 1); break;
    case '3y': cutoff.setFullYear(now.getFullYear() - 3); break;
    case '5y': cutoff.setFullYear(now.getFullYear() - 5); break;
    case '7y': cutoff.setFullYear(now.getFullYear() - 7); break;
    default: return sortedNav;
  }
  return sortedNav.filter(item => parseNavDate(item.date) >= cutoff);
}

/**
 * Downsample NAV array to at most `maxPoints` evenly spaced items
 */
export function downsample(sortedNav, maxPoints = 300) {
  if (sortedNav.length <= maxPoints) return sortedNav;
  const step = sortedNav.length / maxPoints;
  const result = [];
  for (let i = 0; i < maxPoints; i++) {
    result.push(sortedNav[Math.floor(i * step)]);
  }
  // Always include last item
  if (result[result.length - 1] !== sortedNav[sortedNav.length - 1]) {
    result.push(sortedNav[sortedNav.length - 1]);
  }
  return result;
}

// ── Core Calculations ─────────────────────────────────────────────────────────

/**
 * CAGR between two NAV values over `years` years
 * Returns value as percentage (e.g. 12.5 for 12.5%)
 */
export function computeCAGR(startNav, endNav, years) {
  if (!startNav || !endNav || years <= 0 || startNav <= 0) return null;
  const ratio = endNav / startNav;
  if (ratio <= 0) return null;
  return (Math.pow(ratio, 1 / years) - 1) * 100;
}

/**
 * Absolute return % between two NAV values
 */
export function absoluteReturn(startNav, endNav) {
  if (!startNav || startNav <= 0) return null;
  return ((endNav / startNav) - 1) * 100;
}

/**
 * Compute CAGR for standard periods: 1Y, 3Y, 5Y, 7Y, 10Y, since inception
 */
export function computeAllCAGRs(sortedNav) {
  if (!sortedNav.length) return [];
  const latestItem = sortedNav[sortedNav.length - 1];
  const latestDate = parseNavDate(latestItem.date);
  const latestNav = parseFloat(latestItem.nav);

  const periods = [
    { label: '1 Year', years: 1 },
    { label: '3 Years', years: 3 },
    { label: '5 Years', years: 5 },
    { label: '7 Years', years: 7 },
    { label: '10 Years', years: 10 },
  ];

  const results = [];
  for (const { label, years } of periods) {
    const startTarget = new Date(latestDate);
    startTarget.setFullYear(startTarget.getFullYear() - years);
    if (startTarget < parseNavDate(sortedNav[0].date)) {
      results.push({ label, cagr: null, note: 'Insufficient history' });
      continue;
    }
    const startItem = getNavOnOrAfter(sortedNav, startTarget);
    if (!startItem) {
      results.push({ label, cagr: null, note: 'Insufficient history' });
      continue;
    }
    const startNav = parseFloat(startItem.nav);
    const actualYears = (latestDate - parseNavDate(startItem.date)) / (365.25 * 24 * 3600 * 1000);
    const cagr = computeCAGR(startNav, latestNav, actualYears);
    results.push({ label, cagr, startNav, endNav: latestNav, years: actualYears });
  }

  // Since inception
  const inceptionItem = sortedNav[0];
  const inceptionNav = parseFloat(inceptionItem.nav);
  const inceptionDate = parseNavDate(inceptionItem.date);
  const totalYears = (latestDate - inceptionDate) / (365.25 * 24 * 3600 * 1000);
  const inceptionCagr = computeCAGR(inceptionNav, latestNav, totalYears);
  results.push({ label: 'Since Inception', cagr: inceptionCagr, startNav: inceptionNav, endNav: latestNav, years: totalYears });

  return results;
}

// ── Annual Returns ────────────────────────────────────────────────────────────

/**
 * Compute calendar year returns from inception to today
 * Returns array of { year, startNav, endNav, returnPct }
 */
export function computeAnnualReturns(sortedNav) {
  if (!sortedNav.length) return [];

  const inceptionYear = parseNavDate(sortedNav[0].date).getFullYear();
  const currentYear = new Date().getFullYear();
  const results = [];

  for (let year = inceptionYear; year <= currentYear; year++) {
    // Start: first trading day of the year (Jan 1 or next available)
    const startTarget = new Date(year, 0, 1);
    // End: last trading day of the year (Dec 31 or closest before)
    const endTarget = year === currentYear
      ? parseNavDate(sortedNav[sortedNav.length - 1].date)
      : new Date(year, 11, 31);

    const startItem = getNavOnOrAfter(sortedNav, startTarget);
    const endItem = getNavOnOrBefore(sortedNav, endTarget);

    if (!startItem || !endItem) continue;
    const startDate = parseNavDate(startItem.date);
    const endDate = parseNavDate(endItem.date);
    if (startDate >= endDate) continue;

    const startNav = parseFloat(startItem.nav);
    const endNav = parseFloat(endItem.nav);
    const ret = absoluteReturn(startNav, endNav);

    // Compound Annual Return for this period
    const days = (endDate - startDate) / (1000 * 3600 * 24);
    const years = days / 365.25;
    const avgRet = computeCAGR(startNav, endNav, years);

    results.push({
      year,
      startDate: startItem.date,
      endDate: endItem.date,
      startNav,
      endNav,
      returnPct: ret,
      avgReturnPct: avgRet,
    });
  }
  return results;
}

// ── Rolling Returns ───────────────────────────────────────────────────────────

/**
 * Compute rolling returns (overlapping windows, monthly samples)
 * Used for the line chart
 * @param {Array} sortedNav
 * @param {number} windowYears - e.g. 3 for 3-year rolling
 * @returns {Array<{endDate, startDate, startNav, endNav, cagr}>}
 */
export function computeRollingReturns(sortedNav, windowYears) {
  if (!sortedNav.length) return [];

  const inceptionDate = parseNavDate(sortedNav[0].date);
  const latestDate = parseNavDate(sortedNav[sortedNav.length - 1].date);

  // First possible end date = inception + windowYears
  const firstEnd = new Date(inceptionDate);
  firstEnd.setFullYear(firstEnd.getFullYear() + windowYears);

  if (firstEnd > latestDate) return []; // Not enough history

  const results = [];
  const cursor = new Date(firstEnd);

  while (cursor <= latestDate) {
    const endDate = new Date(cursor);
    const startDate = new Date(cursor);
    startDate.setFullYear(startDate.getFullYear() - windowYears);

    const endItem = getNavOnOrBefore(sortedNav, endDate);
    const startItem = getNavOnOrAfter(sortedNav, startDate);

    if (endItem && startItem) {
      const startNav = parseFloat(startItem.nav);
      const endNav = parseFloat(endItem.nav);
      const actualYears = (parseNavDate(endItem.date) - parseNavDate(startItem.date)) / (365.25 * 24 * 3600 * 1000);
      if (actualYears > 0) {
        const cagr = computeCAGR(startNav, endNav, actualYears);
        if (cagr !== null && isFinite(cagr) && Math.abs(cagr) < 500) {
          results.push({
            endDate: endItem.date,
            startDate: startItem.date,
            startNav,
            endNav,
            cagr,
          });
        }
      }
    }

    // Move forward ~1 month (30 days)
    cursor.setDate(cursor.getDate() + 30);
  }

  return results;
}

/**
 * Compute ALL rolling W-year windows sliding one year at a time.
 * Each window CAGR = computeCAGR(first NAV of startY, last NAV of (startY + W - 1), W)
 */
export function computeRollingPeriods(sortedNav, windowYears) {
  if (!sortedNav || !sortedNav.length) return [];

  const inceptionDate = parseNavDate(sortedNav[0].date);
  const latestDate    = parseNavDate(sortedNav[sortedNav.length - 1].date);
  
  // Find all possible start/end dates based on yearly progression
  const results = [];
  
  for (let startY = inceptionDate.getFullYear(); ; startY++) {
    const startTarget = new Date(startY, 0, 1);
    const endTarget = new Date(startY + windowYears - 1, 11, 31);
    
    if (endTarget > latestDate) break;
    
    const startItem = getNavOnOrAfter(sortedNav, startTarget);
    const endItem = getNavOnOrBefore(sortedNav, endTarget);
    
    if (startItem && endItem) {
      const startNav = parseFloat(startItem.nav);
      const endNav = parseFloat(endItem.nav);
      const actualYears = (parseNavDate(endItem.date) - parseNavDate(startItem.date)) / (365.25 * 24 * 3600 * 1000);
      
      if (actualYears > 0) {
        const cagr = computeCAGR(startNav, endNav, actualYears);
        results.push({
          periodLabel: startY === startY + windowYears - 1 ? `${startY}` : `${startY}–${startY + windowYears - 1}`,
          startDate: startItem.date,
          endDate: endItem.date,
          startNav,
          endNav,
          cagr
        });
      }
    }
  }

  return results;
}

/**
 * Compute rolling return stats from a rolling returns array
 */
export function computeRollingStats(rollingData) {
  if (!rollingData.length) return null;
  const cagrs = rollingData.map(r => r.cagr);
  const best = Math.max(...cagrs);
  const worst = Math.min(...cagrs);
  const avg = cagrs.reduce((a, b) => a + b, 0) / cagrs.length;
  const positive = cagrs.filter(c => c > 0).length;
  const beat12 = cagrs.filter(c => c >= 12).length;
  return {
    best,
    worst,
    avg,
    positiveCount: positive,
    positivePct: (positive / cagrs.length) * 100,
    beat12Count: beat12,
    beat12Pct: (beat12 / cagrs.length) * 100,
    total: cagrs.length,
    bestPeriod: rollingData.find(r => r.cagr === best),
    worstPeriod: rollingData.find(r => r.cagr === worst),
  };
}

// ── Alpha Analysis ────────────────────────────────────────────────────────────

/**
 * Compute year-by-year alpha vs benchmark
 * Alpha(year) = Fund Annual Return(year) − Benchmark Annual Return(year)
 */
export function computeAlpha(sortedFundNav, sortedBenchNav) {
  const fundAnnual = computeAnnualReturns(sortedFundNav);
  const benchAnnual = computeAnnualReturns(sortedBenchNav);

  const benchMap = {};
  for (const b of benchAnnual) benchMap[b.year] = b;

  const results = [];
  for (const f of fundAnnual) {
    const b = benchMap[f.year];
    if (!b || b.returnPct === null || f.returnPct === null) continue;
    results.push({
      year: f.year,
      fundReturn: f.returnPct,
      benchReturn: b.returnPct,
      alpha: f.returnPct - b.returnPct,
    });
  }
  return results;
}

/**
 * Compute alpha summary stats
 */
export function computeAlphaStats(alphaData) {
  if (!alphaData.length) return null;
  const alphas = alphaData.map(a => a.alpha);
  const avg = alphas.reduce((s, a) => s + a, 0) / alphas.length;
  const positive = alphas.filter(a => a > 0).length;
  const best = alphaData.reduce((prev, curr) => curr.alpha > prev.alpha ? curr : prev);
  const consistency = (positive / alphas.length) * 100;
  return { avg, positiveYears: positive, totalYears: alphas.length, consistency, bestYear: best };
}

// ── Risk Metrics ──────────────────────────────────────────────────────────────

/** Annual risk-free rate (Indian T-bill / FD proxy) used for Sharpe & Sortino */
export const RISK_FREE_ANNUAL = 0.065;

const TRADING_DAYS_PER_YEAR = 252;
const MONTHS_PER_YEAR = 12;
/** Use daily returns when the window spans less than this many calendar days */
const DAILY_RETURN_THRESHOLD_DAYS = 450;

/**
 * Extract month-end NAV values from sorted NAV data
 * Returns { period: 'YYYY-MM', nav: number }[]
 */
function getMonthlyNavs(sortedNav) {
  const monthly = {};
  for (const item of sortedNav) {
    const d = parseNavDate(item.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthly[key] = parseFloat(item.nav); // last NAV of each calendar month
  }
  return Object.entries(monthly)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, nav]) => ({ period, nav }));
}

function periodReturnsFromNavs(navSeries) {
  const rets = [];
  for (let i = 1; i < navSeries.length; i++) {
    const prev = navSeries[i - 1].nav;
    if (prev > 0) rets.push(navSeries[i].nav / prev - 1);
  }
  return rets;
}

function mean(arr) {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/** Sample variance (n − 1), standard for portfolio analytics */
function sampleVariance(arr) {
  const n = arr.length;
  if (n < 2) return null;
  const m = mean(arr);
  return arr.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1);
}

function sampleStdDev(arr) {
  const v = sampleVariance(arr);
  return v !== null && v >= 0 ? Math.sqrt(v) : null;
}

/** Sample covariance (n − 1) */
function sampleCovariance(a, b) {
  const n = a.length;
  if (n < 2 || b.length !== n) return null;
  const ma = mean(a);
  const mb = mean(b);
  return a.reduce((s, v, i) => s + (v - ma) * (b[i] - mb), 0) / (n - 1);
}

function navSpanDays(sortedNav) {
  if (!sortedNav?.length) return 0;
  const start = parseNavDate(sortedNav[0].date);
  const end = parseNavDate(sortedNav[sortedNav.length - 1].date);
  return (end - start) / (24 * 3600 * 1000);
}

/**
 * Periodic returns for risk ratios; monthly when the window is long enough for stable stats.
 * Fund returns use every observation; benchmark alignment is applied only for beta.
 */
function selectReturnSeries(sortedFundNav, sortedBenchNav) {
  const useDaily = navSpanDays(sortedFundNav) < DAILY_RETURN_THRESHOLD_DAYS;

  if (useDaily) {
    const fundRets = [];
    for (let i = 1; i < sortedFundNav.length; i++) {
      const prev = parseFloat(sortedFundNav[i - 1].nav);
      const curr = parseFloat(sortedFundNav[i].nav);
      if (prev > 0) fundRets.push(curr / prev - 1);
    }
    const aligned = sortedBenchNav?.length
      ? getAlignedDailyReturns(sortedFundNav, sortedBenchNav)
      : null;
    return {
      frequency: 'daily',
      periodsPerYear: TRADING_DAYS_PER_YEAR,
      fundRets,
      alignedFundRets: aligned?.fundRets ?? null,
      alignedBenchRets: aligned?.benchRets ?? null,
      minObs: 30,
    };
  }

  const fundMonthly = getMonthlyNavs(sortedFundNav);
  const fundRets = periodReturnsFromNavs(fundMonthly);
  const aligned = sortedBenchNav?.length
    ? getAlignedMonthlyReturns(fundMonthly, getMonthlyNavs(sortedBenchNav))
    : null;
  return {
    frequency: 'monthly',
    periodsPerYear: MONTHS_PER_YEAR,
    fundRets,
    alignedFundRets: aligned?.fundRets ?? null,
    alignedBenchRets: aligned?.benchRets ?? null,
    minObs: 6,
  };
}

/** Consecutive fund-date pairs with benchmark NAV on or before each date */
function getAlignedDailyReturns(sortedFundNav, sortedBenchNav) {
  const fundRets = [];
  const benchRets = [];
  for (let i = 1; i < sortedFundNav.length; i++) {
    const d0 = parseNavDate(sortedFundNav[i - 1].date);
    const d1 = parseNavDate(sortedFundNav[i].date);
    const f0 = parseFloat(sortedFundNav[i - 1].nav);
    const f1 = parseFloat(sortedFundNav[i].nav);
    const b0Item = getNavOnOrBefore(sortedBenchNav, d0);
    const b1Item = getNavOnOrBefore(sortedBenchNav, d1);
    if (!b0Item || !b1Item) continue;
    const b0 = parseFloat(b0Item.nav);
    const b1 = parseFloat(b1Item.nav);
    if (f0 > 0 && f1 > 0 && b0 > 0 && b1 > 0) {
      fundRets.push(f1 / f0 - 1);
      benchRets.push(b1 / b0 - 1);
    }
  }
  return { fundRets, benchRets };
}

/** Calendar-month returns aligned on shared YYYY-MM periods */
function getAlignedMonthlyReturns(fundMonthly, benchMonthly) {
  const fundRetsAll = periodReturnsFromNavs(fundMonthly);
  const benchRetsAll = periodReturnsFromNavs(benchMonthly);
  const benchByPeriod = {};
  benchMonthly.slice(1).forEach((m, i) => { benchByPeriod[m.period] = benchRetsAll[i]; });

  const fundRets = [];
  const benchRets = [];
  fundMonthly.slice(1).forEach((m, i) => {
    const b = benchByPeriod[m.period];
    if (b !== undefined) {
      fundRets.push(fundRetsAll[i]);
      benchRets.push(b);
    }
  });
  return { fundRets, benchRets };
}

/**
 * Sharpe = (annualized excess return) / (annualized volatility)
 * Arithmetic annualization on periodic simple returns (industry standard).
 */
function computeSharpeRatio(fundRets, periodsPerYear, riskFreeAnnual = RISK_FREE_ANNUAL) {
  const n = fundRets.length;
  if (n < 2) return null;
  const rfPeriod = riskFreeAnnual / periodsPerYear;
  const meanRet = mean(fundRets);
  const vol = sampleStdDev(fundRets);
  if (vol === null || vol === 0) return null;
  const excessAnnual = (meanRet - rfPeriod) * periodsPerYear;
  const volAnnual = vol * Math.sqrt(periodsPerYear);
  return excessAnnual / volAnnual;
}

/**
 * Sortino = (annualized excess return) / (annualized downside deviation)
 * Downside deviation uses MAR = risk-free periodic return; all observations count.
 */
function computeSortinoRatio(fundRets, periodsPerYear, riskFreeAnnual = RISK_FREE_ANNUAL) {
  const n = fundRets.length;
  if (n < 2) return null;
  const rfPeriod = riskFreeAnnual / periodsPerYear;
  const meanRet = mean(fundRets);
  const excessAnnual = (meanRet - rfPeriod) * periodsPerYear;

  const downsideVar = fundRets.reduce((s, r) => {
    const shortfall = Math.min(r - rfPeriod, 0);
    return s + shortfall * shortfall;
  }, 0) / n;

  if (downsideVar <= 0) return null;
  const downsideDevAnnual = Math.sqrt(downsideVar) * Math.sqrt(periodsPerYear);
  return downsideDevAnnual > 0 ? excessAnnual / downsideDevAnnual : null;
}

/** OLS beta: Cov(fund, bench) / Var(bench) using sample moments */
function computeBeta(fundRets, benchRets) {
  if (fundRets.length < 2 || benchRets.length !== fundRets.length) return null;
  const cov = sampleCovariance(fundRets, benchRets);
  const varBench = sampleVariance(benchRets);
  if (cov === null || varBench === null || varBench === 0) return null;
  return cov / varBench;
}

function computeMaxDrawdown(sortedNav) {
  let peak = -Infinity;
  let maxDD = 0;
  let maxDDStart = null;
  let maxDDEnd = null;
  let peakDate = null;

  for (const item of sortedNav) {
    const nav = parseFloat(item.nav);
    if (!isFinite(nav) || nav <= 0) continue;
    if (nav > peak) {
      peak = nav;
      peakDate = item.date;
    }
    const dd = (nav - peak) / peak;
    if (dd < maxDD) {
      maxDD = dd;
      maxDDStart = peakDate;
      maxDDEnd = item.date;
    }
  }

  return {
    maxDrawdown: maxDD * 100,
    maxDrawdownStart: maxDDStart,
    maxDrawdownEnd: maxDDEnd,
  };
}

/**
 * Compute all risk metrics for a NAV slice (fund ± benchmark)
 * @returns {{ beta, sharpe, sortino, stdDevAnnual, annualReturn, maxDrawdown, maxDrawdownStart, maxDrawdownEnd, returnFrequency }}
 */
export function computeRiskMetrics(sortedFundNav, sortedBenchNav) {
  const empty = {
    beta: null,
    sharpe: null,
    sortino: null,
    stdDevAnnual: null,
    annualReturn: null,
    maxDrawdown: null,
    maxDrawdownStart: null,
    maxDrawdownEnd: null,
    returnFrequency: null,
  };

  if (!sortedFundNav?.length) return empty;

  const {
    frequency,
    periodsPerYear,
    fundRets,
    alignedFundRets,
    alignedBenchRets,
    minObs,
  } = selectReturnSeries(sortedFundNav, sortedBenchNav);

  if (fundRets.length < minObs) {
    const ddOnly = computeMaxDrawdown(sortedFundNav);
    return { ...empty, ...ddOnly, returnFrequency: frequency };
  }

  const meanRet = mean(fundRets);
  const periodicStd = sampleStdDev(fundRets);
  const annualReturn = meanRet * periodsPerYear * 100;
  const stdDevAnnual = periodicStd !== null ? periodicStd * Math.sqrt(periodsPerYear) * 100 : null;

  const sharpe = computeSharpeRatio(fundRets, periodsPerYear);
  const sortino = computeSortinoRatio(fundRets, periodsPerYear);

  let beta = null;
  if (
    alignedFundRets?.length >= minObs &&
    alignedBenchRets?.length === alignedFundRets.length
  ) {
    beta = computeBeta(alignedFundRets, alignedBenchRets);
  }

  const dd = computeMaxDrawdown(sortedFundNav);

  return {
    beta,
    sharpe,
    sortino,
    stdDevAnnual,
    annualReturn,
    returnFrequency: frequency,
    ...dd,
  };
}

// ── Risk metrics by rolling window (3Y–7Y) ───────────────────────────────────

export const RISK_DEFAULT_PERIOD = '3y';

export const RISK_WINDOW_SPECS = {
  '3y': { unit: 'year', value: 3, shortLabel: '3Y' },
  '5y': { unit: 'year', value: 5, shortLabel: '5Y' },
  '7y': { unit: 'year', value: 7, shortLabel: '7Y' },
};

/**
 * Slice sorted NAV to an inclusive date range (DD-MM-YYYY strings)
 */
export function sliceNavByDateRange(sortedNav, startDate, endDate) {
  const start = parseNavDate(startDate);
  const end = parseNavDate(endDate);
  return sortedNav.filter(item => {
    const d = parseNavDate(item.date);
    return d >= start && d <= end;
  });
}

/**
 * Overlapping multi-year windows on calendar-year boundaries, sliding 1 year at a time
 * (e.g. 3Y → 2010–2012, 2011–2013, 2012–2014 …)
 */
function computeOverlappingCalendarYearPeriods(sortedNav, windowYears) {
  const inceptionDate = parseNavDate(sortedNav[0].date);
  const latestDate = parseNavDate(sortedNav[sortedNav.length - 1].date);
  const results = [];

  for (let startY = inceptionDate.getFullYear(); ; startY++) {
    const startTarget = new Date(startY, 0, 1);
    const endTarget = new Date(startY + windowYears - 1, 11, 31);
    if (endTarget > latestDate) break;

    const startItem = getNavOnOrAfter(sortedNav, startTarget);
    const endItem = getNavOnOrBefore(sortedNav, endTarget);

    if (startItem && endItem && parseNavDate(startItem.date) < parseNavDate(endItem.date)) {
      const periodLabel = windowYears === 1
        ? `${startY}`
        : `${startY}–${startY + windowYears - 1}`;
      results.push({
        periodLabel,
        startDate: startItem.date,
        endDate: endItem.date,
      });
    }
  }

  return results;
}

/**
 * Overlapping windows for risk breakdown
 */
export function computeRiskWindowPeriods(sortedNav, windowKey) {
  if (!sortedNav.length) return [];

  const spec = RISK_WINDOW_SPECS[windowKey];
  if (!spec) return [];

  return computeOverlappingCalendarYearPeriods(sortedNav, spec.value);
}

const RISK_METRIC_AVG_KEYS = ['beta', 'sharpe', 'sortino', 'stdDevAnnual', 'maxDrawdown'];

/**
 * Arithmetic mean of each risk metric across window rows (ignores null / non-finite)
 */
export function computeAverageRiskMetrics(breakdown) {
  const result = {
    beta: null,
    sharpe: null,
    sortino: null,
    stdDevAnnual: null,
    maxDrawdown: null,
    maxDrawdownStart: null,
    maxDrawdownEnd: null,
    annualReturn: null,
    returnFrequency: null,
  };

  if (!breakdown?.length) return result;

  for (const key of RISK_METRIC_AVG_KEYS) {
    const vals = breakdown
      .map(row => row.metrics?.[key])
      .filter(v => v != null && isFinite(v));
    result[key] = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  }

  return result;
}

/**
 * Risk metrics per overlapping window; gauges use the average across windows
 */
export function computeRiskMetricsBreakdown(sortedFundNav, sortedBenchNav, windowKey) {
  const periods = computeRiskWindowPeriods(sortedFundNav, windowKey);
  const breakdown = periods.map(p => {
    const fundSlice = sliceNavByDateRange(sortedFundNav, p.startDate, p.endDate);
    const benchSlice = sortedBenchNav
      ? sliceNavByDateRange(sortedBenchNav, p.startDate, p.endDate)
      : null;
    return {
      ...p,
      metrics: computeRiskMetrics(fundSlice, benchSlice),
    };
  });

  const averageMetrics = computeAverageRiskMetrics(breakdown);

  return {
    breakdown,
    averageMetrics,
    gaugeMetrics: averageMetrics,
    gaugePeriodLabel: 'Average',
    windowCount: breakdown.length,
  };
}

/**
 * Compare-tab risk: aligned overlapping windows on Fund A dates, metrics for both funds
 */
export function computeCompareRiskMetricsBreakdown(sortedFundA, sortedFundB, sortedBenchNav, windowKey) {
  const periods = computeRiskWindowPeriods(sortedFundA, windowKey);
  const breakdown = periods.map(p => {
    const fundSliceA = sliceNavByDateRange(sortedFundA, p.startDate, p.endDate);
    const fundSliceB = sliceNavByDateRange(sortedFundB, p.startDate, p.endDate);
    const benchSlice = sortedBenchNav
      ? sliceNavByDateRange(sortedBenchNav, p.startDate, p.endDate)
      : null;
    return {
      ...p,
      metricsA: computeRiskMetrics(fundSliceA, benchSlice),
      metricsB: computeRiskMetrics(fundSliceB, benchSlice),
    };
  });

  const averageA = computeAverageRiskMetrics(breakdown.map(r => ({ metrics: r.metricsA })));
  const averageB = computeAverageRiskMetrics(breakdown.map(r => ({ metrics: r.metricsB })));

  return {
    breakdown,
    averageA,
    averageB,
    windowCount: breakdown.length,
  };
}

/**
 * Compute running drawdown series for chart
 */
export function computeDrawdownSeries(sortedNav) {
  let peak = -Infinity;
  return sortedNav.map(item => {
    const nav = parseFloat(item.nav);
    if (nav > peak) peak = nav;
    const dd = peak > 0 ? ((nav - peak) / peak) * 100 : 0;
    return { date: item.date, drawdown: dd };
  });
}

// ── Formatting Helpers ────────────────────────────────────────────────────────

export function fmt(value, decimals = 2) {
  if (value === null || value === undefined || !isFinite(value)) return 'N/A';
  return value.toFixed(decimals);
}

export function fmtPct(value, decimals = 2, showSign = true) {
  if (value === null || value === undefined || !isFinite(value)) return 'N/A';
  const sign = showSign && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

export function fmtNav(value) {
  if (value === null || value === undefined) return 'N/A';
  const num = parseFloat(value);
  return `₹${num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

// ── Overview Return Highs and Lows ───────────────────────────────────────────

export function computeOverviewStats(sortedNav) {
  if (!sortedNav || !sortedNav.length) return null;

  let athNav = -Infinity;
  let athNavDate = '';
  let atlNav = Infinity;
  let atlNavDate = '';

  let athDailyReturn = -Infinity;
  let athDailyReturnDate = '';
  let atlDailyReturn = Infinity;
  let atlDailyReturnDate = '';

  for (let i = 0; i < sortedNav.length; i++) {
    const item = sortedNav[i];
    const nav = parseFloat(item.nav);

    if (nav > athNav) {
      athNav = nav;
      athNavDate = item.date;
    }
    if (nav < atlNav) {
      atlNav = nav;
      atlNavDate = item.date;
    }

    if (i > 0) {
      const prevNav = parseFloat(sortedNav[i - 1].nav);
      if (prevNav > 0) {
        const dailyRet = ((nav - prevNav) / prevNav) * 100;
        if (dailyRet > athDailyReturn) {
          athDailyReturn = dailyRet;
          athDailyReturnDate = item.date;
        }
        if (dailyRet < atlDailyReturn) {
          atlDailyReturn = dailyRet;
          atlDailyReturnDate = item.date;
        }
      }
    }
  }

  return {
    athNav,
    athNavDate,
    atlNav,
    atlNavDate,
    athDailyReturn: athDailyReturn === -Infinity ? null : athDailyReturn,
    athDailyReturnDate,
    atlDailyReturn: atlDailyReturn === Infinity ? null : atlDailyReturn,
    atlDailyReturnDate,
  };
}

// ── Ranking period returns (1M … 10Y, All) ────────────────────────────────────

export const RANKING_PERIOD_SPECS = {
  '1m': { label: '1 Month', shortLabel: '1M', sortColumn: '1 Month Return' },
  '3m': { label: '3 Months', shortLabel: '3M', sortColumn: '3 Month Return' },
  '6m': { label: '6 Months', shortLabel: '6M', sortColumn: '6 Month Return' },
  '1y': { label: '1 Year', shortLabel: '1Y', sortColumn: '1 Year CAGR' },
  '3y': { label: '3 Years', shortLabel: '3Y', sortColumn: '3 Year CAGR' },
  '5y': { label: '5 Years', shortLabel: '5Y', sortColumn: '5 Year CAGR' },
  '7y': { label: '7 Years', shortLabel: '7Y', sortColumn: '7 Year CAGR' },
  '10y': { label: '10 Years', shortLabel: '10Y', sortColumn: '10 Year CAGR' },
  all: { label: 'All Time', shortLabel: 'All', sortColumn: 'All Time CAGR' },
  alpha: { label: 'Avg Alpha', shortLabel: 'Alpha', sortColumn: 'Avg Alpha vs Nifty' },
};

/**
 * Average yearly alpha vs benchmark (mean of calendar-year fund return − index return)
 */
export function computeAverageAlpha(sortedFundNav, sortedBenchNav) {
  if (!sortedFundNav?.length || !sortedBenchNav?.length) return null;
  const alphaData = computeAlpha(sortedFundNav, sortedBenchNav);
  if (!alphaData.length) return null;
  return alphaData.reduce((sum, row) => sum + row.alpha, 0) / alphaData.length;
}

/**
 * Trailing return for leaderboard ranking (CAGR for ≥1Y and All; absolute % for shorter windows)
 */
export function computeRankingPeriodReturn(sortedNav, periodKey) {
  if (!sortedNav?.length) return null;

  const spec = RANKING_PERIOD_SPECS[periodKey];
  if (!spec) return null;

  const latestItem = sortedNav[sortedNav.length - 1];
  const latestDate = parseNavDate(latestItem.date);
  const latestNav = parseFloat(latestItem.nav);
  const inceptionDate = parseNavDate(sortedNav[0].date);

  let startItem = null;

  if (periodKey === 'all') {
    startItem = sortedNav[0];
  } else {
    const windowMap = {
      '1m': { unit: 'month', value: 1 },
      '3m': { unit: 'month', value: 3 },
      '6m': { unit: 'month', value: 6 },
      '1y': { unit: 'year', value: 1 },
      '3y': { unit: 'year', value: 3 },
      '5y': { unit: 'year', value: 5 },
      '7y': { unit: 'year', value: 7 },
      '10y': { unit: 'year', value: 10 },
    };
    const w = windowMap[periodKey];
    if (!w) return null;

    const startTarget = new Date(latestDate);
    if (w.unit === 'month') {
      startTarget.setMonth(startTarget.getMonth() - w.value);
    } else {
      startTarget.setFullYear(startTarget.getFullYear() - w.value);
    }

    if (startTarget < inceptionDate) return null;
    startItem = getNavOnOrAfter(sortedNav, startTarget);
  }

  if (!startItem) return null;

  const startNav = parseFloat(startItem.nav);
  const startDate = parseNavDate(startItem.date);
  const days = (latestDate - startDate) / (1000 * 3600 * 24);
  const years = days / 365.25;
  if (years <= 0) return null;

  const useCagr = periodKey === 'all' || periodKey.endsWith('y');
  if (useCagr) {
    return computeCAGR(startNav, latestNav, years);
  }
  return absoluteReturn(startNav, latestNav);
}

export function computeAllRankingPeriodReturns(sortedNav) {
  const periodReturns = {};
  for (const key of Object.keys(RANKING_PERIOD_SPECS)) {
    periodReturns[key] = computeRankingPeriodReturn(sortedNav, key);
  }
  return periodReturns;
}

// ── Detailed Period Returns (1D, 1W, 1M, 3M, 6M, 3Y, 5Y, 10Y, All) ─────────────

export function computeDetailedPeriodReturns(sortedNav) {
  if (!sortedNav.length) return [];
  const latestItem = sortedNav[sortedNav.length - 1];
  const latestDate = parseNavDate(latestItem.date);
  const latestNav = parseFloat(latestItem.nav);
  const inceptionDate = parseNavDate(sortedNav[0].date);

  const periods = [
    { label: '1 Day', unit: 'day', value: 1 },
    { label: '1 Week', unit: 'week', value: 1 },
    { label: '1 Month', unit: 'month', value: 1 },
    { label: '3 Months', unit: 'month', value: 3 },
    { label: '6 Months', unit: 'month', value: 6 },
    { label: '1 Year', unit: 'year', value: 1 },
    { label: '3 Years', unit: 'year', value: 3 },
    { label: '5 Years', unit: 'year', value: 5 },
    { label: '7 Years', unit: 'year', value: 7 },
    { label: '10 Years', unit: 'year', value: 10 },
    { label: 'All Time', unit: 'all', value: 0 },
  ];

  const results = [];
  for (const p of periods) {
    let startItem = null;
    let isInsufficient = false;

    if (p.unit === 'all') {
      startItem = sortedNav[0];
    } else {
      const startTarget = new Date(latestDate);
      if (p.unit === 'day') {
        if (p.value === 1) {
          startItem = sortedNav.length >= 2 ? sortedNav[sortedNav.length - 2] : null;
        } else {
          startTarget.setDate(startTarget.getDate() - p.value);
        }
      } else if (p.unit === 'week') {
        startTarget.setDate(startTarget.getDate() - p.value * 7);
      } else if (p.unit === 'month') {
        startTarget.setMonth(startTarget.getMonth() - p.value);
      } else if (p.unit === 'year') {
        startTarget.setFullYear(startTarget.getFullYear() - p.value);
      }

      if (p.unit !== 'day' || p.value !== 1) {
        if (startTarget < inceptionDate) {
          isInsufficient = true;
        } else {
          startItem = getNavOnOrAfter(sortedNav, startTarget);
        }
      }
    }

    if (isInsufficient || !startItem) {
      results.push({
        label: p.label,
        startDate: null,
        endDate: latestItem.date,
        startNav: null,
        endNav: latestNav,
        absReturn: null,
        avgReturn: null,
        note: 'Insufficient history',
      });
      continue;
    }

    const startNav = parseFloat(startItem.nav);
    const startDate = parseNavDate(startItem.date);
    const days = (latestDate - startDate) / (1000 * 3600 * 24);
    const years = days / 365.25;

    let absRet = absoluteReturn(startNav, latestNav);
    const avgRet = computeCAGR(startNav, latestNav, years);

    // If the period is 1 year or more, show the average simple yearly return
    if (absRet !== null && years > 0 && ((p.unit === 'year' && p.value >= 1) || p.unit === 'all')) {
      absRet = absRet / years;
    }

    results.push({
      label: p.label,
      startDate: startItem.date,
      endDate: latestItem.date,
      startNav,
      endNav: latestNav,
      absReturn: absRet,
      avgReturn: avgRet,
      years,
      days,
    });
  }
  return results;
}
