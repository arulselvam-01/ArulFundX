/**
 * ArulFundX – API Module
 * Source: https://api.mfapi.in (free, no auth, CORS-enabled)
 */

const BASE_URL = 'https://api.mfapi.in';

// In-memory cache: avoid redundant fetches within the session
const cache = new Map();

// Known Nifty 50 index fund codes to try as benchmark (in order of preference)
const BENCHMARK_FALLBACK_CODES = [120716, 118834, 101305, 125354];
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
 * Fetch benchmark NAV data (Nifty 50 proxy)
 * Tries multiple known codes until one works
 * @returns {Promise<{meta: object, data: Array}>}
 */
export async function fetchBenchmarkData() {
  // If we already resolved a working benchmark, use it
  if (resolvedBenchmarkCode !== null) {
    return fetchFundData(resolvedBenchmarkCode);
  }

  // Try to search first for best match
  try {
    const results = await searchFunds('UTI Nifty 50 Index Direct Growth');
    if (results && results.length > 0) {
      // Find a direct growth plan
      const direct = results.find(r =>
        r.schemeName.toLowerCase().includes('direct') &&
        r.schemeName.toLowerCase().includes('growth') &&
        r.schemeName.toLowerCase().includes('nifty 50')
      ) || results[0];

      const data = await fetchFundData(direct.schemeCode);
      if (data && data.data && data.data.length > 200) {
        resolvedBenchmarkCode = direct.schemeCode;
        return data;
      }
    }
  } catch (_) {}

  // Fallback to hardcoded codes
  for (const code of BENCHMARK_FALLBACK_CODES) {
    try {
      const data = await fetchFundData(code);
      if (data && data.data && data.data.length > 100) {
        resolvedBenchmarkCode = code;
        return data;
      }
    } catch (_) {}
  }

  throw new Error('Benchmark (Nifty 50 proxy) data unavailable. Alpha and Beta calculations will be skipped.');
}

/**
 * Get the resolved benchmark scheme info (after fetchBenchmarkData runs)
 */
export function getBenchmarkCode() {
  return resolvedBenchmarkCode;
}

/**
 * Clear the cache (useful for testing)
 */
export function clearCache() {
  cache.clear();
  resolvedBenchmarkCode = null;
}
