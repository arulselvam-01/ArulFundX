/**
 * ArulFundX – API Module
 * Source: https://api.mfapi.in (free, no auth, CORS-enabled)
 */

const BASE_URL = 'https://api.mfapi.in';

// In-memory cache: avoid redundant fetches within the session
const cache = new Map();

/** Only these Nifty 50 index funds may be used as project benchmarks */
export const BENCHMARK_FUNDS = [
  {
    code: 120716,
    shortName: 'UTI Nifty 50',
    label: 'UTI Nifty 50 Index Fund - Growth (Direct) · 120716',
  },
  {
    code: 119063,
    shortName: 'HDFC Nifty 50',
    label: 'HDFC Nifty 50 Index Fund - Direct Plan · 119063',
  },
];

const BENCHMARK_CODES = BENCHMARK_FUNDS.map(f => f.code);
let resolvedBenchmarkCode = null;

/**
 * Search mutual funds by name
 * @param {string} query
 * @returns {Promise<Array<{schemeCode: number, schemeName: string}>>}
 */
export async function searchFunds(query) {
  if (!query || query.trim().length < 2) return [];
  const url = `${BASE_URL}/mf/search?q=${encodeURIComponent(query.trim())}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data.slice(0, 12) : [];
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Search timed out. Please try again.');
    console.warn('Search error:', err);
    return [];
  }
}

/**
 * Fetch ALL mutual fund scheme codes from the registry
 * Filters to only Direct Growth plans to avoid duplicates
 * @returns {Promise<Array<{schemeCode: number, schemeName: string}>>}
 */
export async function fetchAllFundCodes() {
  const key = 'all_fund_codes';
  if (cache.has(key)) return cache.get(key);

  const url = `${BASE_URL}/mf`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Failed to fetch fund list: HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Invalid fund list response');

  // Filter to only Direct Growth plans (avoids Regular, Dividend, IDCW duplicates)
  const directGrowth = data.filter(f => {
    const n = (f.schemeName || '').toLowerCase();
    return n.includes('direct') && (n.includes('growth') || n.includes('gr'));
  });

  cache.set(key, directGrowth);
  return directGrowth;
}

/**
 * Fetch full NAV history + meta for a scheme
 * @param {number|string} schemeCode
 * @returns {Promise<{meta: object, data: Array<{date:string, nav:string}>}>}
 */
export async function fetchFundData(schemeCode) {
  const key = `fund_${schemeCode}`;
  if (cache.has(key)) return cache.get(key);

  const url = `${BASE_URL}/mf/${schemeCode}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Failed to fetch fund (code ${schemeCode}): HTTP ${res.status}`);

  const data = await res.json();
  if (!data || !data.data || data.data.length === 0) {
    throw new Error(`No NAV data found for scheme code ${schemeCode}`);
  }

  cache.set(key, data);
  return data;
}

/**
 * Load both approved Nifty 50 benchmark funds (UTI + HDFC).
 * @returns {Promise<{ primary: object, uti: object|null, hdfc: object|null }>}
 */
export async function loadProjectBenchmarks() {
  const loaded = [];

  for (const fund of BENCHMARK_FUNDS) {
    try {
      const data = await fetchFundData(fund.code);
      if (data?.data?.length > 100) {
        loaded.push({ ...fund, data });
      }
    } catch (_) {}
  }

  if (!loaded.length) {
    throw new Error(
      'Benchmark data unavailable (UTI 120716 / HDFC 119063). Alpha and Beta calculations will be skipped.'
    );
  }

  const uti = loaded.find(f => f.code === 120716) || null;
  const hdfc = loaded.find(f => f.code === 119063) || null;
  const primary = uti || hdfc;

  resolvedBenchmarkCode = primary.code;

  return { primary, uti, hdfc };
}

/**
 * Fetch primary benchmark NAV data (UTI Nifty 50, else HDFC Nifty 50)
 * @returns {Promise<{meta: object, data: Array}>}
 */
export async function fetchBenchmarkData() {
  if (resolvedBenchmarkCode !== null) {
    return fetchFundData(resolvedBenchmarkCode);
  }

  const { primary } = await loadProjectBenchmarks();
  return primary.data;
}

/**
 * Get the resolved primary benchmark scheme code (after benchmarks load)
 */
export function getBenchmarkCode() {
  return resolvedBenchmarkCode;
}

export function getBenchmarkFundMeta(code) {
  return BENCHMARK_FUNDS.find(f => f.code === code) || null;
}

/**
 * Clear the cache (useful for testing)
 */
export function clearCache() {
  cache.clear();
  resolvedBenchmarkCode = null;
}
