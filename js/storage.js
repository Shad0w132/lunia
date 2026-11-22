// Local-only persistence (no server, no network, 100% offline like Android Lunia).
const STORAGE_KEY = 'lunia_ios_pwa_v2_state';

export function defaultState() {
  return {
    version: 2,
    onboarded: false,
    profile: {
      mode: 'TRACK_CYCLE', // TRACK_CYCLE | CONCEIVE | PREGNANCY | CONTRACEPTION
      typicalCycle: 28,
      typicalPeriod: 5,
      theme: 'system', // system | light | dark
      contraceptionPack: false,
      pillActiveDays: 21,
      pillBreakDays: 7,
      pregnancyLmp: null,
      pinHash: null,
    },
    logs: {
      // "YYYY-MM-DD": { flow: null|'SPOTTING'|'LIGHT'|'MEDIUM'|'HEAVY', clots: false, marks: [], note: '', bbt: null, otest: null, ptest: null }
    },
    periodEndedDates: {},
    savedArticles: [],
    viewedStories: [],
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const base = defaultState();
    return {
      ...base,
      ...parsed,
      profile: { ...base.profile, ...(parsed.profile || {}) },
      logs: parsed.logs || {},
      periodEndedDates: parsed.periodEndedDates || {},
      savedArticles: Array.isArray(parsed.savedArticles) ? parsed.savedArticles : [],
      viewedStories: Array.isArray(parsed.viewedStories) ? parsed.viewedStories : [],
    };
  } catch {
    return defaultState();
  }
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export async function hashPin(pin) {
  const data = new TextEncoder().encode('lunia-pin-v2:' + pin);
  if (crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback deterministic hash if non-HTTPS local origin
  let h = 2166136261;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i];
    h = Math.imul(h, 16777619);
  }
  return 'fnv-' + (h >>> 0).toString(16);
}

export function exportBackupJson(state) {
  const payload = {
    app: 'lunia-ios-pwa',
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    data: state,
  };
  return JSON.stringify(payload, null, 2);
}

export function parseBackupJson(text) {
  const parsed = JSON.parse(text);
  const candidate = parsed?.data && parsed?.app === 'lunia-ios-pwa' ? parsed.data : parsed;
  if (!candidate || typeof candidate !== 'object' || typeof candidate.logs !== 'object') {
    throw new Error('Файл не похож на резервную копию Лунии.');
  }
  const base = defaultState();
  return {
    ...base,
    ...candidate,
    onboarded: true,
    profile: { ...base.profile, ...(candidate.profile || {}) },
    logs: candidate.logs || {},
    periodEndedDates: candidate.periodEndedDates || {},
  };
}
