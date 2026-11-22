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

function importAndroidLuniaBackup(parsed) {
  const base = defaultState();
  const raw = parsed.data || {};
  const logs = {};

  const ensure = (date) => {
    if (!logs[date]) {
      logs[date] = { flow: null, clots: false, marks: [], note: '', bbt: '', otest: null, ptest: null };
    }
    return logs[date];
  };

  for (const b of (raw.bleeding || [])) {
    if (!b?.date) continue;
    const l = ensure(b.date);
    l.flow = b.flow === 'UNSPECIFIED' ? 'MEDIUM' : (b.flow || 'MEDIUM');
    l.clots = Boolean(b.clots);
  }

  for (const s of (raw.symptoms || [])) {
    if (!s?.date || !s?.optionKey) continue;
    const l = ensure(s.date);
    if (!l.marks.includes(s.optionKey)) l.marks.push(s.optionKey);
  }

  for (const n of (raw.notes || [])) {
    if (!n?.date || !n?.text) continue;
    const l = ensure(n.date);
    l.note = l.note ? `${l.note}\n${n.text}` : n.text;
  }

  for (const t of (raw.bbt || [])) {
    if (!t?.date || t.centiCelsius == null) continue;
    const l = ensure(t.date);
    l.bbt = (Number(t.centiCelsius) / 100).toFixed(2);
  }

  for (const o of (raw.ovulationTests || [])) {
    if (!o?.date || !o?.result) continue;
    ensure(o.date).otest = o.result;
  }

  for (const p of (raw.pregnancyTests || [])) {
    if (!p?.date || !p?.result) continue;
    ensure(p.date).ptest = p.result;
  }

  for (const sx of (raw.sex || [])) {
    if (!sx?.date) continue;
    const l = ensure(sx.date);
    if (sx.type === 'MASTURBATION') {
      if (!l.marks.includes('sex.masturbation')) l.marks.push('sex.masturbation');
    } else if (sx.protection === 'NONE' || sx.protection === 'WITHDRAWAL') {
      if (!l.marks.includes('sex.unprotected')) l.marks.push('sex.unprotected');
    } else {
      if (!l.marks.includes('sex.protected')) l.marks.push('sex.protected');
    }
    if (sx.orgasm && !l.marks.includes('sex.orgasm')) l.marks.push('sex.orgasm');
  }

  const periodEndedDates = {};
  for (const f of (raw.flags || [])) {
    if (f?.cycleStart && f?.type === 'PERIOD_ENDED') {
      periodEndedDates[f.cycleStart] = true;
    }
  }

  const cs = raw.cycleSettings || {};
  if (cs.typicalCycleLength) base.profile.typicalCycle = Number(cs.typicalCycleLength);
  if (cs.typicalPeriodLength) base.profile.typicalPeriod = Number(cs.typicalPeriodLength);

  const prof = raw.profile || {};
  if (prof.goal === 'CONCEIVE') base.profile.mode = 'CONCEIVE';
  else if (prof.goal === 'PREGNANCY') base.profile.mode = 'PREGNANCY';

  const activePreg = (raw.pregnancies || []).slice().reverse().find((p) => !p.endDate);
  if (activePreg) {
    base.profile.mode = 'PREGNANCY';
    if (activePreg.lmp) base.profile.pregnancyLmp = activePreg.lmp;
  }

  const activeContra = (raw.contraception || []).slice().reverse().find((c) => !c.endDate);
  if (activeContra && activeContra.method && !['CONDOM', 'COPPER_IUD', 'NONE'].includes(activeContra.method)) {
    base.profile.mode = 'CONTRACEPTION';
    base.profile.contraceptionPack = true;
  }

  const settings = parsed.settings || {};
  if (settings.theme === 'LIGHT') base.profile.theme = 'light';
  else if (settings.theme === 'DARK') base.profile.theme = 'dark';
  else base.profile.theme = 'system';

  return {
    ...base,
    onboarded: true,
    logs,
    periodEndedDates,
    savedArticles: Array.isArray(settings.articleBookmarks) ? settings.articleBookmarks : [],
    viewedStories: Array.isArray(settings.viewedStories)
      ? settings.viewedStories.map((s) => String(s).split('@')[0])
      : [],
  };
}

export function parseBackupJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Файл не читается как JSON. Если ты задавал пароль при экспорте из Android — экспортируй копию заново без пароля.');
  }

  // 1. Native Android Lunia backup format (Backup.kt: format === "lunia-backup")
  if (parsed?.format === 'lunia-backup' && parsed?.data && typeof parsed.data === 'object') {
    return importAndroidLuniaBackup(parsed);
  }

  // 2. iOS PWA native format
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
