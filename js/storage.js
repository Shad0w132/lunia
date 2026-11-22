// Full local-only persistence + bidirectional Android Lunia ("lunia-backup") & PWA JSON + CSV export.
const STORAGE_KEY = 'lunia_ios_pwa_v2_state';

export function defaultState() {
  return {
    version: 2,
    onboarded: false,
    profile: {
      mode: 'TRACK_CYCLE', // TRACK_CYCLE | CONCEIVE | PREGNANCY | CONTRACEPTION
      birthYear: null,
      typicalCycle: 28,
      typicalPeriod: 5,
      typicalLuteal: 14,
      theme: 'system', // system | light | dark
      discreetMode: false,
      pdfIncludeIntimate: false,
      pinHash: null,
      hiddenCategories: [],
    },
    contraception: {
      method: 'COC_21_7',
      startDate: null,
      activeDays: 21,
      breakDays: 7,
    },
    pregnancy: {
      dating: 'LMP', // LMP | CONCEPTION | IVF_TRANSFER | ULTRASOUND
      lmp: null,
      cycleLengthCorrection: false,
      conception: null,
      transfer: null,
      embryoAgeDays: 5,
      ultrasoundDate: null,
      ultrasoundGaDays: null,
      checklist: {},
    },
    logs: {},
    periodDecisions: {},
    cycleFlags: {},
    periodEndedDates: {},
    dismissedPeriodEnd: {},
    customCategories: [],
    forecastSnapshot: null,
    savedArticles: [],
    viewedStories: [],
    readChapters: [],
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
      contraception: { ...base.contraception, ...(parsed.contraception || {}) },
      pregnancy: { ...base.pregnancy, ...(parsed.pregnancy || {}) },
      logs: parsed.logs || {},
      periodDecisions: parsed.periodDecisions || {},
      cycleFlags: parsed.cycleFlags || {},
      periodEndedDates: parsed.periodEndedDates || {},
      dismissedPeriodEnd: parsed.dismissedPeriodEnd || {},
      customCategories: Array.isArray(parsed.customCategories) ? parsed.customCategories : [],
      savedArticles: Array.isArray(parsed.savedArticles) ? parsed.savedArticles : [],
      viewedStories: Array.isArray(parsed.viewedStories) ? parsed.viewedStories : [],
      readChapters: Array.isArray(parsed.readChapters) ? parsed.readChapters : [],
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
  for (let i = 0; i < data.length; i++) { h ^= data[i]; h = Math.imul(h, 16777619); }
  return 'fnv-' + (h >>> 0).toString(16);
}

// Export in Android-compatible "lunia-backup" format + full PWA metadata
export function exportBackupJson(state) {
  const bleeding = [];
  const symptoms = [];
  const notes = [];
  const bbt = [];
  const ovulationTests = [];
  const manualOvulations = [];
  const pregnancyTests = [];
  const sex = [];
  const libido = [];
  const pills = [];
  const metrics = [];
  const customEntries = [];

  for (const [date, l] of Object.entries(state.logs || {})) {
    if (l.flow) bleeding.push({ date, flow: l.flow, clots: Boolean(l.clots) });
    for (const k of (l.marks || [])) symptoms.push({ date, optionKey: k });
    if (l.note && l.note.trim()) notes.push({ date, text: l.note });
    if (l.bbt && !isNaN(Number(l.bbt))) {
      bbt.push({ date, centiCelsius: Math.round(Number(l.bbt) * 100), time: l.bbtTime || null, flags: (l.bbtFlags || []).join(',') });
    }
    if (l.otest) ovulationTests.push({ date, result: l.otest });
    if (l.manualOvulation) manualOvulations.push({ date, method: l.manualOvulation });
    if (l.ptest) pregnancyTests.push({ date, result: l.ptest });
    if (l.libido) libido.push({ date, level: Number(l.libido) });
    if (l.pillStatus) pills.push({ date, status: l.pillStatus });
    for (const ev of (l.sexEvents || [])) sex.push({ date, ...ev });
    if (l.metrics) {
      for (const [type, value] of Object.entries(l.metrics)) {
        if (value !== '' && value != null) metrics.push({ date, type, value: Number(value) });
      }
    }
    if (l.custom) {
      for (const [categoryId, value] of Object.entries(l.custom)) {
        if (value !== '' && value != null) customEntries.push({ date, categoryId, value: String(value) });
      }
    }
  }

  const decisions = Object.entries(state.periodDecisions || {}).map(([startDate, type]) => ({ startDate, type }));
  const flags = [];
  for (const [cycleStart, list] of Object.entries(state.cycleFlags || {})) {
    for (const type of list) flags.push({ cycleStart, type });
  }
  for (const [cycleStart, ended] of Object.entries(state.periodEndedDates || {})) {
    if (ended && !flags.some((f) => f.cycleStart === cycleStart && f.type === 'PERIOD_ENDED')) {
      flags.push({ cycleStart, type: 'PERIOD_ENDED' });
    }
  }

  const payload = {
    format: 'lunia-backup',
    schemaVersion: 1,
    appVersion: '0.2.0-ios-pwa',
    engineVersion: 2,
    exportedAt: new Date().toISOString(),
    data: {
      profile: {
        goal: state.profile.mode === 'CONTRACEPTION' ? 'TRACK_CYCLE' : state.profile.mode,
        birthYear: state.profile.birthYear ? Number(state.profile.birthYear) : null,
      },
      cycleSettings: {
        typicalCycleLength: Number(state.profile.typicalCycle) || 28,
        typicalPeriodLength: Number(state.profile.typicalPeriod) || 5,
        typicalLutealLength: Number(state.profile.typicalLuteal) || 14,
      },
      bleeding, decisions, flags, notes, symptoms, sex, libido, bbt,
      ovulationTests, manualOvulations, pregnancyTests, metrics, pills,
      contraception: state.profile.mode === 'CONTRACEPTION' ? [{
        method: state.contraception?.method || 'COC_21_7',
        startDate: state.contraception?.startDate || null,
        endDate: null,
      }] : [],
      pregnancies: state.profile.mode === 'PREGNANCY' ? [{
        dating: state.pregnancy?.dating || 'LMP',
        lmp: state.pregnancy?.lmp || null,
        conception: state.pregnancy?.conception || null,
        transfer: state.pregnancy?.transfer || null,
        embryoAge: state.pregnancy?.embryoAgeDays || 5,
        usDate: state.pregnancy?.ultrasoundDate || null,
        usGaDays: state.pregnancy?.ultrasoundGaDays || null,
        endDate: null,
      }] : [],
      customCategories: state.customCategories || [],
      customEntries,
      checklist: Object.entries(state.pregnancy?.checklist || {}).filter(([, v]) => v).map(([key]) => ({ key })),
    },
    settings: {
      onboardingDone: true,
      theme: (state.profile.theme || 'system').toUpperCase(),
      articleBookmarks: state.savedArticles || [],
      viewedStories: state.viewedStories || [],
      readChapters: state.readChapters || [],
    },
    pwaState: state,
  };
  return JSON.stringify(payload, null, 2);
}

export function exportCsv(state) {
  const rows = [['date', 'flow', 'clots', 'bbt', 'otest', 'ptest', 'libido', 'pill', 'symptoms', 'note']];
  const dates = Object.keys(state.logs || {}).sort();
  const q = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  for (const d of dates) {
    const l = state.logs[d];
    rows.push([
      d, l.flow || '', l.clots ? '1' : '', l.bbt || '', l.otest || '', l.ptest || '',
      l.libido || '', l.pillStatus || '', (l.marks || []).join(';'), l.note || '',
    ]);
  }
  return '\uFEFF' + rows.map((r) => r.map(q).join(',')).join('\r\n');
}

function importAndroidLuniaBackup(parsed) {
  const base = defaultState();
  const raw = parsed.data || {};
  const logs = {};

  const ensure = (date) => {
    if (!logs[date]) {
      logs[date] = {
        flow: null, clots: false, marks: [], sexEvents: [], libido: null,
        note: '', bbt: '', bbtTime: '', bbtFlags: [], otest: null, manualOvulation: null,
        ptest: null, pillStatus: null, metrics: {}, custom: {},
      };
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
    if (t.time) l.bbtTime = String(t.time).slice(0, 5);
    if (t.flags) l.bbtFlags = Array.isArray(t.flags) ? t.flags : String(t.flags).split(',').filter(Boolean);
  }
  for (const o of (raw.ovulationTests || [])) if (o?.date && o?.result) ensure(o.date).otest = o.result;
  for (const m of (raw.manualOvulations || [])) if (m?.date) ensure(m.date).manualOvulation = m.method || 'Свой метод';
  for (const p of (raw.pregnancyTests || [])) if (p?.date && p?.result) ensure(p.date).ptest = p.result;
  for (const lb of (raw.libido || [])) if (lb?.date && lb?.level) ensure(lb.date).libido = Number(lb.level);
  for (const pl of (raw.pills || [])) if (pl?.date && pl?.status) ensure(pl.date).pillStatus = pl.status;
  for (const mt of (raw.metrics || [])) if (mt?.date && mt?.type) ensure(mt.date).metrics[String(mt.type).toLowerCase()] = mt.value;
  for (const ce of (raw.customEntries || [])) if (ce?.date && ce?.categoryId != null) ensure(ce.date).custom[String(ce.categoryId)] = ce.value;

  for (const sx of (raw.sex || [])) {
    if (!sx?.date) continue;
    const l = ensure(sx.date);
    l.sexEvents.push({
      type: sx.type || 'VAGINAL',
      protection: sx.protection || 'NONE',
      orgasm: Boolean(sx.orgasm),
      pain: Boolean(sx.pain),
      bleedingAfter: Boolean(sx.bleedingAfter),
      condomFailure: Boolean(sx.condomFailure),
      emergencyContraception: Boolean(sx.ecTaken || sx.emergencyContraception),
    });
  }

  const periodDecisions = {};
  for (const d of (raw.decisions || [])) if (d?.startDate && d?.type) periodDecisions[d.startDate] = d.type;

  const cycleFlags = {};
  const periodEndedDates = {};
  for (const f of (raw.flags || [])) {
    if (!f?.cycleStart || !f?.type) continue;
    if (f.type === 'PERIOD_ENDED') periodEndedDates[f.cycleStart] = true;
    else {
      if (!cycleFlags[f.cycleStart]) cycleFlags[f.cycleStart] = [];
      if (!cycleFlags[f.cycleStart].includes(f.type)) cycleFlags[f.cycleStart].push(f.type);
    }
  }

  const cs = raw.cycleSettings || {};
  if (cs.typicalCycleLength) base.profile.typicalCycle = Number(cs.typicalCycleLength);
  if (cs.typicalPeriodLength) base.profile.typicalPeriod = Number(cs.typicalPeriodLength);
  if (cs.typicalLutealLength) base.profile.typicalLuteal = Number(cs.typicalLutealLength);

  const prof = raw.profile || {};
  if (prof.birthYear) base.profile.birthYear = Number(prof.birthYear);
  if (prof.goal === 'CONCEIVE') base.profile.mode = 'CONCEIVE';
  else if (prof.goal === 'PREGNANCY') base.profile.mode = 'PREGNANCY';

  const activePreg = (raw.pregnancies || []).slice().reverse().find((p) => !p.endDate);
  if (activePreg) {
    base.profile.mode = 'PREGNANCY';
    base.pregnancy.dating = activePreg.dating || 'LMP';
    base.pregnancy.lmp = activePreg.lmp || null;
    base.pregnancy.conception = activePreg.conception || null;
    base.pregnancy.transfer = activePreg.transfer || null;
    base.pregnancy.embryoAgeDays = activePreg.embryoAge || 5;
    base.pregnancy.ultrasoundDate = activePreg.usDate || null;
    base.pregnancy.ultrasoundGaDays = activePreg.usGaDays || null;
  }
  for (const ch of (raw.checklist || [])) if (ch?.key) base.pregnancy.checklist[ch.key] = true;

  const activeContra = (raw.contraception || []).slice().reverse().find((c) => !c.endDate);
  if (activeContra?.method && !['CONDOM', 'COPPER_IUD', 'NONE'].includes(activeContra.method)) {
    base.profile.mode = 'CONTRACEPTION';
    base.contraception.method = activeContra.method;
    base.contraception.startDate = activeContra.startDate || null;
  }

  const settings = parsed.settings || {};
  if (settings.theme === 'LIGHT') base.profile.theme = 'light';
  else if (settings.theme === 'DARK') base.profile.theme = 'dark';
  else base.profile.theme = 'system';

  return {
    ...base,
    onboarded: true,
    logs,
    periodDecisions,
    cycleFlags,
    periodEndedDates,
    customCategories: (raw.customCategories || []).map((c) => ({ id: String(c.id), name: c.name })),
    savedArticles: Array.isArray(settings.articleBookmarks) ? settings.articleBookmarks : [],
    viewedStories: Array.isArray(settings.viewedStories) ? settings.viewedStories.map((s) => String(s).split('@')[0]) : [],
    readChapters: Array.isArray(settings.readChapters) ? settings.readChapters : [],
  };
}

export function parseBackupJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Файл не читается как JSON. Если при экспорте из Android был задан пароль — экспортируй копию заново без пароля.');
  }
  if (parsed?.pwaState && typeof parsed.pwaState === 'object') {
    const base = defaultState();
    return { ...base, ...parsed.pwaState, onboarded: true };
  }
  if (parsed?.format === 'lunia-backup' && parsed?.data && typeof parsed.data === 'object') {
    return importAndroidLuniaBackup(parsed);
  }
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
  };
}
