// Full port of Lunia Engine v2 (Bayes.kt, Ovulation.kt, Pregnancy.kt, CycleEngine.kt, EngineConstants.kt)
export const ENGINE_VERSION = 2;

export const EngineConstants = Object.freeze({
  CYCLE_PRIOR: { mu0: 29.086, tau: 2.0755, nu: 3.0, alpha0: 1.5506, beta0: 4.75 },
  PERIOD_PRIOR: { mu0: 4.0, tau: 0.6843, nu: 3.0, alpha0: 2.0266, beta0: 0.8045 },
  LUTEAL_PRIOR: { mu0: 14.08, tau: 1.137, nu: 3.0, alpha0: 0.9944, beta0: 1.1325 },
  DEFAULT_CYCLE_LENGTH: 28,
  CYCLE_SUPPORT_MIN: 15,
  CYCLE_SUPPORT_MAX: 90,
  PERIOD_SUPPORT_MIN: 1,
  PERIOD_SUPPORT_MAX: 15,
  LUTEAL_SUPPORT_MIN: 5,
  LUTEAL_SUPPORT_MAX: 20,
  RANGE_LOW_Q: 0.1,
  RANGE_HIGH_Q: 0.9,
  MERGE_GAP: 2,
  MIN_AUTO_CYCLE: 15,
  HISTORY_CYCLES: 12,
  RECENT_CYCLES: 6,
  OUTLIER_MIN_N: 5,
  OUTLIER_K: 3.0,
  MAD_SCALE: 1.4826,
  MAD_FLOOR_DAYS: 1.0,
  MISSED_LOG_RATIO: 1.7,
  EXPECT_WINDOW_MIN: 1,
  EXPECT_WINDOW_MAX: 7,
  OVULATION_VISIBLE_MIN: 21,
  OVULATION_VISIBLE_MAX: 60,
  BBT_LOW_COUNT: 6,
  BBT_SHIFT_MIN_CENTI: 20,
  BBT_TIME_TOLERANCE_MINUTES: 60,
  LH_BBT_DIVERGENCE_DAYS: 2,
  LH_SERIES_GAP_DAYS: 2,
  IRREGULAR_V: 8,
  ADULT_MIN_CYCLE: 21,
  ADULT_MAX_CYCLE: 35,
  TEEN_MAX_CYCLE: 45,
  TEEN_AGE: 18,
  LONG_PERIOD_DAYS: 8,
  NO_PERIOD_DAYS: 90,
  SHORT_LUTEAL: 10,
  NAEGELE_DAYS: 280,
  CONCEPTION_TO_EDD: 266,
  PMS_WINDOW_DAYS: 7,
  ACCURACY_CYCLES: 6,
  ACCURACY_MIN_CHECKS: 2,
  PERIOD_END_QUESTION_DAYS: 60,
  FERTILITY_KERNEL: [0.10, 0.16, 0.14, 0.27, 0.31, 0.33, 0.05],
  KERNEL_FIRST_OFFSET: -5,
  CHANCE_HIGH: 0.20,
  CHANCE_MEDIUM: 0.05,
  WINDOW_PEAK_FRACTION: 0.5,
  FLOW_LAST_DAY_LR: {
    4: [2.106, 0.099, 0.026],
    5: [1.547, 0.113, 0.089],
    6: [1.344, 0.076, 0.032],
  },
});

export function parseDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function formatDate(ms) {
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function addDays(iso, days) {
  return formatDate(parseDate(iso) + days * 86400000);
}

export function diffDays(aIso, bIso) {
  return Math.round((parseDate(bIso) - parseDate(aIso)) / 86400000);
}

// ---- SpecialFunctions (Bayes.kt) ----
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

export function lnGamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1.0 - x);
  const z = x - 1.0;
  let a = LANCZOS[0];
  const t = z + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

function betaCf(x, a, b) {
  const tiny = 1e-300;
  let c = 1.0;
  let d = 1.0 - (a + b) * x / (a + 1.0);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1.0 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((a + m2 - 1) * (a + m2));
    d = 1.0 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1.0 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1.0 / d; h *= d * c;
    aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1));
    d = 1.0 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1.0 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1.0 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1.0) < 1e-14) break;
  }
  return h;
}

export function regIncBeta(x, a, b, lnBetaInv) {
  if (x <= 0.0) return 0.0;
  if (x >= 1.0) return 1.0;
  const lbi = lnBetaInv !== undefined ? lnBetaInv : lnGamma(a + b) - lnGamma(a) - lnGamma(b);
  const front = Math.exp(lbi + a * Math.log(x) + b * Math.log(1.0 - x));
  return x < (a + 1.0) / (a + b + 2.0)
    ? front * betaCf(x, a, b) / a
    : 1.0 - front * betaCf(1.0 - x, b, a) / b;
}

export function makeStudentTCdf(dof) {
  const a = dof / 2.0;
  const lnBetaInv = lnGamma(a + 0.5) - lnGamma(a) - lnGamma(0.5);
  return (t) => {
    const x = dof / (dof + t * t);
    const tail = 0.5 * regIncBeta(x, a, 0.5, lnBetaInv);
    return t >= 0 ? 1.0 - tail : tail;
  };
}

export class DayDistribution {
  constructor(lo, probs) {
    this.lo = lo;
    const sum = probs.reduce((acc, v) => acc + v, 0);
    if (sum <= 0) throw new Error('empty distribution');
    this.p = probs.map((v) => v / sum);
  }
  get hi() { return this.lo + this.p.length - 1; }
  pmf(k) { return (k < this.lo || k > this.hi) ? 0.0 : this.p[k - this.lo]; }
  quantile(q) {
    let c = 0.0;
    for (let i = 0; i < this.p.length; i++) {
      c += this.p[i];
      if (c >= q - 1e-12) return this.lo + i;
    }
    return this.hi;
  }
  get median() { return this.quantile(0.5); }
  get mean() {
    let s = 0.0;
    for (let i = 0; i < this.p.length; i++) s += (this.lo + i) * this.p[i];
    return s;
  }
  atLeast(k) {
    const q = this.p.map((v, i) => (this.lo + i >= k ? v : 0.0));
    const s = q.reduce((a, b) => a + b, 0);
    return s <= 0 ? this : new DayDistribution(this.lo, q);
  }
  updateLastDay(k, lr) {
    const pk = this.pmf(k);
    let above = 0.0;
    for (let i = 0; i < this.p.length; i++) if (this.lo + i > k) above += this.p[i];
    if (pk <= 0 || above <= 0) return this;
    const postK = pk * lr / (pk * lr + above);
    const q = this.p.map((v, i) => {
      const day = this.lo + i;
      if (day < k) return 0.0;
      if (day === k) return postK;
      return v / above * (1.0 - postK);
    });
    return new DayDistribution(this.lo, q);
  }
  static point(k) { return new DayDistribution(k, [1.0]); }
}

export function predictLength(prior, x, lo, hi) {
  const GRID_STEP = 0.25;
  const PRUNE = 1e-9;
  const n = x.length;
  const mean = n === 0 ? 0.0 : x.reduce((a, b) => a + b, 0) / n;
  let ss = 0.0;
  for (const v of x) ss += (v - mean) * (v - mean);

  const points = Math.floor((hi - lo) / GRID_STEP) + 1;
  const mu = new Float64Array(points);
  const logW = new Float64Array(points);
  let maxLog = -Infinity;
  for (let i = 0; i < points; i++) {
    mu[i] = lo + i * GRID_STEP;
    const z = (mu[i] - prior.mu0) / prior.tau;
    let lw = -(prior.nu + 1.0) / 2.0 * Math.log(1.0 + (z * z) / prior.nu);
    if (n > 0) {
      const q = ss + n * (mean - mu[i]) * (mean - mu[i]);
      lw -= (prior.alpha0 + n / 2.0) * Math.log(prior.beta0 + q / 2.0);
    }
    logW[i] = lw;
    if (lw > maxLog) maxLog = lw;
  }
  const w = new Float64Array(points);
  let total = 0.0;
  for (let i = 0; i < points; i++) {
    w[i] = Math.exp(logW[i] - maxLog);
    total += w[i];
  }
  const dof = 2.0 * prior.alpha0 + n;
  const cdf = makeStudentTCdf(dof);
  const p = new Array(hi - lo + 1).fill(0.0);
  let muMean = 0.0;
  for (let i = 0; i < points; i++) {
    const wi = w[i] / total;
    muMean += wi * mu[i];
    if (wi < PRUNE) continue;
    const q = n === 0 ? 0.0 : ss + n * (mean - mu[i]) * (mean - mu[i]);
    const scale = Math.sqrt((prior.beta0 + q / 2.0) / (prior.alpha0 + n / 2.0));
    let prev = cdf((lo - 0.5 - mu[i]) / scale);
    for (let k = 0; k < p.length; k++) {
      const next = cdf((lo + k + 0.5 - mu[i]) / scale);
      p[k] += wi * Math.max(0.0, next - prev);
      prev = next;
    }
  }
  return { dist: new DayDistribution(lo, p), posteriorMean: muMean, n };
}

export function ovulationOffsets(cycleDist, lutealDist) {
  const lo = cycleDist.lo - lutealDist.hi;
  const hi = cycleDist.hi - lutealDist.lo;
  const p = new Array(hi - lo + 1).fill(0.0);
  for (let c = cycleDist.lo; c <= cycleDist.hi; c++) {
    const pc = cycleDist.pmf(c);
    if (pc === 0) continue;
    for (let l = lutealDist.lo; l <= lutealDist.hi; l++) {
      p[c - l - lo] += pc * lutealDist.pmf(l);
    }
  }
  return new DayDistribution(lo, p);
}

export function fertilityChances(ovulationDist) {
  const out = new Map();
  const k = EngineConstants.FERTILITY_KERNEL;
  for (let o = ovulationDist.lo; o <= ovulationDist.hi; o++) {
    const po = ovulationDist.pmf(o);
    if (po === 0) continue;
    for (let i = 0; i < k.length; i++) {
      const t = o + EngineConstants.KERNEL_FIRST_OFFSET + i;
      out.set(t, (out.get(t) || 0.0) + po * k[i]);
    }
  }
  return out;
}

// ---- Ovulation.kt: LH + Sensiplan 3-over-6 BBT ----
export function detectLhOvulation(tests) {
  if (!tests.length) return null;
  const sorted = [...tests].sort((a, b) => a.date.localeCompare(b.date));
  const series = [];
  let open = false;
  let lastPositive = null;
  for (const t of sorted) {
    const pos = t.result === 'POSITIVE' || t.result === 'PEAK';
    const neg = t.result === 'NEGATIVE';
    if (pos) {
      const gapTooBig = lastPositive && diffDays(lastPositive, t.date) > EngineConstants.LH_SERIES_GAP_DAYS;
      if (!open || gapTooBig) {
        series.push([]);
        open = true;
      }
      series[series.length - 1].push(t.date);
      lastPositive = t.date;
    } else if (neg) {
      open = false;
    }
  }
  if (!series.length) return null;
  return { ovulation: addDays(series[series.length - 1][0], 1), multipleSurges: series.length > 1 };
}

function confirmBbtShift(t, h, cover) {
  const shift = cover + EngineConstants.BBT_SHIFT_MIN_CENTI;
  if (h + 2 < t.length && t[h + 1] > cover && t[h + 2] > cover) {
    if (t[h + 2] >= shift) return { index: h + 2, rule: 'STANDARD' };
    if (h + 3 < t.length && t[h + 3] > cover) return { index: h + 3, rule: 'EXCEPTION_1' };
  }
  // Exception 2: one of h+1 or h+2 <= cover, next reading >= cover + 0.20
  if (h + 3 < t.length) {
    if (t[h + 1] <= cover && t[h + 2] > cover && t[h + 3] >= shift) return { index: h + 3, rule: 'EXCEPTION_2' };
    if (t[h + 1] > cover && t[h + 2] <= cover && t[h + 3] >= shift) return { index: h + 3, rule: 'EXCEPTION_2' };
  }
  return null;
}

export function detectBbtShift(measurements, from, to) {
  const inRange = measurements
    .filter((m) => m.date >= from && m.date <= to && (!m.flags || m.flags.length === 0))
    .sort((a, b) => a.date.localeCompare(b.date));
  const t = inRange.map((m) => Math.round(Number(m.celsius) * 100));
  const low = EngineConstants.BBT_LOW_COUNT;
  for (let h = low; h < t.length; h++) {
    let cover = -Infinity;
    for (let i = h - low; i < h; i++) if (t[i] > cover) cover = t[i];
    if (t[h] <= cover) continue;
    const res = confirmBbtShift(t, h, cover);
    if (res) {
      return {
        firstHighDate: inRange[h].date,
        coverline: cover / 100,
        confirmedOn: inRange[res.index].date,
        ovulation: addDays(inRange[h].date, -1),
        rule: res.rule,
      };
    }
  }
  return null;
}

// ---- Pregnancy.kt ----
export function computePregnancyInfo(preg, today, cycleLength = 28) {
  if (!preg) return null;
  let edd = null;
  if (preg.dating === 'CONCEPTION' && preg.conception) {
    edd = addDays(preg.conception, EngineConstants.CONCEPTION_TO_EDD);
  } else if (preg.dating === 'IVF_TRANSFER' && preg.transfer) {
    edd = addDays(preg.transfer, EngineConstants.CONCEPTION_TO_EDD - (Number(preg.embryoAgeDays) || 5));
  } else if (preg.dating === 'ULTRASOUND' && preg.ultrasoundDate && preg.ultrasoundGaDays != null) {
    edd = addDays(preg.ultrasoundDate, EngineConstants.NAEGELE_DAYS - Number(preg.ultrasoundGaDays));
  } else if (preg.lmp) {
    const corr = preg.cycleLengthCorrection ? (cycleLength - 28) : 0;
    edd = addDays(preg.lmp, EngineConstants.NAEGELE_DAYS + corr);
  }
  if (!edd) return null;
  const start = addDays(edd, -EngineConstants.NAEGELE_DAYS);
  const gestDays = Math.max(0, diffDays(start, today));
  const weeks = Math.floor(gestDays / 7);
  const remDays = gestDays % 7;
  const trimester = gestDays <= 13 * 7 + 6 ? 1 : gestDays <= 27 * 7 + 6 ? 2 : 3;
  const daysLeft = diffDays(today, edd);
  return { edd, start, gestDays, weeks, remDays, trimester, daysLeft, dating: preg.dating || 'LMP' };
}

// ---- Episode grouping ----
function isBleedingFlow(flow) {
  return Boolean(flow && flow !== 'SPOTTING');
}

export function groupEpisodes(logsByDate, periodDecisions = {}) {
  const bleedingDates = Object.entries(logsByDate)
    .filter(([, log]) => isBleedingFlow(log.flow))
    .map(([date]) => date)
    .sort();

  const episodes = [];
  for (const d of bleedingDates) {
    if (!episodes.length) {
      episodes.push({ start: d, end: d, days: [d] });
    } else {
      const last = episodes[episodes.length - 1];
      if (diffDays(last.end, d) - 1 <= EngineConstants.MERGE_GAP) {
        last.end = d;
        last.days.push(d);
      } else {
        episodes.push({ start: d, end: d, days: [d] });
      }
    }
  }

  const periods = [];
  const intermenstrual = [];
  const ambiguousEpisodes = [];
  for (const ep of episodes) {
    const dec = periodDecisions[ep.start];
    if (dec === 'INTERMENSTRUAL') {
      intermenstrual.push(ep);
      continue;
    }
    if (!periods.length || dec === 'PERIOD') {
      periods.push(ep);
      continue;
    }
    const prev = periods[periods.length - 1];
    if (diffDays(prev.start, ep.start) >= EngineConstants.MIN_AUTO_CYCLE) {
      periods.push(ep);
    } else {
      ambiguousEpisodes.push(ep);
      intermenstrual.push(ep);
    }
  }
  return { periods, intermenstrual, ambiguousEpisodes };
}

function rejectOutliers(values) {
  if (values.length < EngineConstants.OUTLIER_MIN_N) return values;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const med = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const devs = sorted.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  const mad = devs.length % 2 ? devs[mid] : (devs[mid - 1] + devs[mid]) / 2;
  const scale = Math.max(EngineConstants.MAD_FLOOR_DAYS, EngineConstants.MAD_SCALE * mad);
  return values.filter((v) => Math.abs(v - med) <= EngineConstants.OUTLIER_K * scale);
}

const EXCLUDING_FLAGS = new Set(['ATYPICAL', 'FORGOT_TO_LOG', 'POSTPARTUM', 'BREASTFEEDING']);

export function computeCycleState(state, today = todayIso()) {
  const profile = state.profile || {};
  const logs = state.logs || {};
  const decisions = state.periodDecisions || {};
  const cycleFlags = state.cycleFlags || {};
  const { periods, intermenstrual, ambiguousEpisodes } = groupEpisodes(logs, decisions);

  // Collect BBT & LH measurements across all logs
  const allBbt = [];
  const allLh = [];
  const allManualOv = [];
  for (const [date, l] of Object.entries(logs)) {
    if (l.bbt && !isNaN(Number(l.bbt))) {
      allBbt.push({ date, celsius: Number(l.bbt), time: l.bbtTime || null, flags: l.bbtFlags || [] });
    }
    if (l.otest) allLh.push({ date, result: l.otest });
    if (l.manualOvulation) allManualOv.push({ date, method: l.manualOvulation });
  }

  const cycles = periods.map((p, idx) => {
    const next = periods[idx + 1];
    const length = next ? diffDays(p.start, next.start) : null;
    const periodLength = diffDays(p.start, p.end) + 1;
    const flags = cycleFlags[p.start] || [];
    const excluded = flags.some((f) => EXCLUDING_FLAGS.has(f));
    const endRange = next ? addDays(next.start, -1) : addDays(p.start, 60);

    // Detect confirmed ovulation in this cycle
    const man = allManualOv.find((m) => m.date >= p.start && m.date <= endRange);
    const lh = detectLhOvulation(allLh.filter((t) => t.date >= p.start && t.date <= endRange));
    const bbt = detectBbtShift(allBbt, p.start, endRange);
    let confirmedOv = null;
    let ovSource = null;
    let ovDivergence = false;
    if (man) {
      confirmedOv = man.date; ovSource = 'MANUAL';
    } else if (bbt && lh) {
      if (Math.abs(diffDays(bbt.ovulation, lh.ovulation)) > EngineConstants.LH_BBT_DIVERGENCE_DAYS) {
        confirmedOv = bbt.ovulation; ovSource = 'BBT'; ovDivergence = true;
      } else {
        confirmedOv = bbt.ovulation; ovSource = 'BBT_LH';
      }
    } else if (bbt) {
      confirmedOv = bbt.ovulation; ovSource = 'BBT';
    } else if (lh) {
      confirmedOv = lh.ovulation; ovSource = 'LH';
    }

    const lutealLen = (confirmedOv && next) ? diffDays(confirmedOv, next.start) : null;

    return {
      start: p.start, end: p.end, length, periodLength, days: p.days,
      flags, excluded, confirmedOv, ovSource, ovDivergence, bbtShift: bbt, lhResult: lh, lutealLen,
    };
  });

  const validCycles = cycles.filter((c) => !c.excluded);
  const rawCycleLengths = validCycles
    .filter((c) => c.length !== null && c.length >= EngineConstants.CYCLE_SUPPORT_MIN && c.length <= EngineConstants.CYCLE_SUPPORT_MAX)
    .slice(-EngineConstants.HISTORY_CYCLES)
    .map((c) => c.length);
  const cycleLengths = rejectOutliers(rawCycleLengths);

  const periodLengths = validCycles
    .map((c) => c.periodLength)
    .filter((l) => l >= EngineConstants.PERIOD_SUPPORT_MIN && l <= EngineConstants.PERIOD_SUPPORT_MAX)
    .slice(-EngineConstants.HISTORY_CYCLES);

  const lutealLengths = validCycles
    .filter((c) => c.lutealLen !== null && c.lutealLen >= EngineConstants.LUTEAL_SUPPORT_MIN && c.lutealLen <= EngineConstants.LUTEAL_SUPPORT_MAX)
    .slice(-EngineConstants.RECENT_CYCLES)
    .map((c) => c.lutealLen);

  const cyclePrior = profile.typicalCycle
    ? { ...EngineConstants.CYCLE_PRIOR, mu0: Number(profile.typicalCycle) }
    : EngineConstants.CYCLE_PRIOR;
  const periodPrior = profile.typicalPeriod
    ? { ...EngineConstants.PERIOD_PRIOR, mu0: Number(profile.typicalPeriod) }
    : EngineConstants.PERIOD_PRIOR;
  const lutealPrior = profile.typicalLuteal
    ? { ...EngineConstants.LUTEAL_PRIOR, mu0: Number(profile.typicalLuteal) }
    : EngineConstants.LUTEAL_PRIOR;

  const cycleForecast = predictLength(cyclePrior, cycleLengths, EngineConstants.CYCLE_SUPPORT_MIN, EngineConstants.CYCLE_SUPPORT_MAX);
  const periodForecast = predictLength(periodPrior, periodLengths, EngineConstants.PERIOD_SUPPORT_MIN, EngineConstants.PERIOD_SUPPORT_MAX);
  const lutealForecast = predictLength(lutealPrior, lutealLengths, EngineConstants.LUTEAL_SUPPORT_MIN, EngineConstants.LUTEAL_SUPPORT_MAX);

  const cycleLength = cycleForecast.dist.median;
  const cycleRange = [cycleForecast.dist.quantile(EngineConstants.RANGE_LOW_Q), cycleForecast.dist.quantile(EngineConstants.RANGE_HIGH_Q)];
  const periodLength = periodForecast.dist.median;
  const periodRange = [periodForecast.dist.quantile(EngineConstants.RANGE_LOW_Q), periodForecast.dist.quantile(EngineConstants.RANGE_HIGH_Q)];
  const lutealPhase = lutealForecast.dist.median;

  // One-step forecast accuracy on last cycles
  let accuracy = null;
  if (cycleLengths.length >= EngineConstants.ACCURACY_MIN_CHECKS + 1) {
    const errors = [];
    const startIdx = Math.max(1, cycleLengths.length - EngineConstants.ACCURACY_CYCLES);
    for (let i = startIdx; i < cycleLengths.length; i++) {
      const prevPred = predictLength(cyclePrior, cycleLengths.slice(0, i), EngineConstants.CYCLE_SUPPORT_MIN, EngineConstants.CYCLE_SUPPORT_MAX).dist.median;
      errors.push(Math.abs(cycleLengths[i] - prevPred));
    }
    if (errors.length >= EngineConstants.ACCURACY_MIN_CHECKS) {
      accuracy = { mae: errors.reduce((a, b) => a + b, 0) / errors.length, count: errors.length };
    }
  }

  // Contraception pack info (D-41: starts from break days if breakDays > 0)
  const contra = state.contraception || {};
  const isHormonal = profile.mode === 'CONTRACEPTION' && Boolean(contra.method) && !['CONDOM', 'COPPER_IUD'].includes(contra.method);
  const hasPack = isHormonal && Number(contra.activeDays) > 0;
  let packInfo = null;
  if (hasPack) {
    const activeD = Number(contra.activeDays) || 21;
    const breakD = Number(contra.breakDays) || 0;
    const totalD = activeD + breakD;
    const anchor = contra.startDate || (cycles.length ? cycles[cycles.length - 1].start : today);
    const rawOff = diffDays(anchor, today);
    const dayIdx = ((rawOff % totalD) + totalD) % totalD; // 0..totalD-1
    // D-41: pack ring starts with break days (0..breakD-1), then active days (breakD..totalD-1)
    const inBreak = breakD > 0 && dayIdx < breakD;
    packInfo = {
      activeDays: activeD, breakDays: breakD, totalDays: totalD,
      dayInPack: dayIdx + 1, inBreak,
      daysUntilBreak: inBreak ? 0 : totalD - dayIdx,
      daysUntilActive: inBreak ? breakD - dayIdx : 0,
    };
  }

  const effectiveCycleLength = packInfo ? packInfo.totalDays : cycleLength;

  // Pregnancy info
  let pregnancy = null;
  if (profile.mode === 'PREGNANCY') {
    const rec = { ...(state.pregnancy || {}) };
    if (!rec.lmp && cycles.length) rec.lmp = cycles[cycles.length - 1].start;
    pregnancy = computePregnancyInfo(rec, today, cycleLength);
  }

  const currentCycle = cycles.length ? cycles[cycles.length - 1] : null;
  let predictions = null;
  let currentPhase = 'UNKNOWN';
  let cycleDay = null;
  let delayDays = 0;
  let daysUntilNextPeriod = null;
  let ovulationDate = null;
  let ovulationSource = 'CALENDAR';
  let fertileStart = null;
  let fertileEnd = null;
  let fertileChancesMap = new Map();
  let predictedPeriods = [];
  let predictedWindows = [];
  const questions = [];
  const insights = [];

  if (currentCycle && !pregnancy) {
    cycleDay = diffDays(currentCycle.start, today) + 1;
    const expectWindow = Math.max(EngineConstants.EXPECT_WINDOW_MIN, Math.min(EngineConstants.EXPECT_WINDOW_MAX, cycleRange[1] - cycleLength));

    const ovulationVisible = !isHormonal && effectiveCycleLength >= EngineConstants.OVULATION_VISIBLE_MIN && effectiveCycleLength <= EngineConstants.OVULATION_VISIBLE_MAX;

    let nextPeriodStart;
    let nextStartFromOvulation = false;

    if (currentCycle.confirmedOv && !isHormonal) {
      ovulationDate = currentCycle.confirmedOv;
      ovulationSource = currentCycle.ovSource;
      nextPeriodStart = addDays(ovulationDate, lutealPhase);
      nextStartFromOvulation = true;
      fertileStart = addDays(ovulationDate, -5);
      fertileEnd = addDays(ovulationDate, 1);
      EngineConstants.FERTILITY_KERNEL.forEach((v, idx) => {
        fertileChancesMap.set(addDays(ovulationDate, EngineConstants.KERNEL_FIRST_OFFSET + idx), v);
      });
    } else {
      nextPeriodStart = addDays(currentCycle.start, effectiveCycleLength);
      if (ovulationVisible) {
        const ovDist = ovulationOffsets(cycleForecast.dist, lutealForecast.dist);
        ovulationDate = addDays(currentCycle.start, ovDist.median);
        ovulationSource = 'CALENDAR';
        const chances = fertilityChances(ovDist);
        let peak = 0;
        for (const v of chances.values()) if (v > peak) peak = v;
        const thresh = Math.min(EngineConstants.CHANCE_MEDIUM, peak * EngineConstants.WINDOW_PEAK_FRACTION);
        const fOffs = [...chances.entries()].filter(([, v]) => v >= thresh).map(([t]) => t).sort((a, b) => a - b);
        if (fOffs.length) {
          fertileStart = addDays(currentCycle.start, fOffs[0]);
          fertileEnd = addDays(currentCycle.start, fOffs[fOffs.length - 1]);
          for (const t of fOffs) fertileChancesMap.set(addDays(currentCycle.start, t), chances.get(t));
        }
      }
    }

    const nextPeriodEnd = addDays(nextPeriodStart, periodLength - 1);
    daysUntilNextPeriod = diffDays(today, nextPeriodStart);
    if (daysUntilNextPeriod < 0) delayDays = Math.abs(daysUntilNextPeriod);

    let cursor = nextPeriodStart;
    for (let i = 0; i < 6; i++) {
      predictedPeriods.push({ start: cursor, end: addDays(cursor, periodLength - 1) });
      if (ovulationVisible) {
        const ov = addDays(cursor, effectiveCycleLength - lutealPhase);
        predictedWindows.push({ ovulation: ov, start: addDays(ov, -5), end: addDays(ov, 1) });
      }
      cursor = addDays(cursor, effectiveCycleLength);
    }

    // Current period end flow-LR update
    const periodEnded = currentCycle.flags.includes('PERIOD_ENDED') || Boolean(state.periodEndedDates?.[currentCycle.start]);
    const daysSinceStart = diffDays(currentCycle.start, today);
    const inLoggedPeriod = today >= currentCycle.start && today <= currentCycle.end;
    const isOngoingAuto = !periodEnded && daysSinceStart >= 0 && daysSinceStart < periodLength && currentCycle.periodLength === 1;

    // v0.2 Period end questions
    const dismissed = Boolean(state.dismissedPeriodEnd?.[currentCycle.start]);
    if (!periodEnded && !dismissed && daysSinceStart >= 1 && daysSinceStart <= EngineConstants.PERIOD_END_QUESTION_DAYS) {
      if (currentCycle.periodLength === 1 && daysSinceStart <= periodLength + 2) {
        questions.push({ type: 'PERIOD_STILL_ON', cycleStart: currentCycle.start, title: 'Месячные ещё идут?', body: `Начало отмечено ${currentCycle.start}. Отметь, если они продолжаются или уже закончились.` });
      } else if (diffDays(currentCycle.end, today) >= 1 && diffDays(currentCycle.end, today) <= 10 && !inLoggedPeriod) {
        questions.push({ type: 'PERIOD_LAST_DAY', cycleStart: currentCycle.start, lastLogged: currentCycle.end, title: 'Месячные закончились?', body: `Последний отмеченный день — ${currentCycle.end}. Подтверди, что это был последний день.` });
      }
    }

    for (const amb of ambiguousEpisodes) {
      questions.push({ type: 'INTERMENSTRUAL', episodeStart: amb.start, title: 'Новые месячные или кровь между циклами?', body: `Выделения начались ${amb.start} — раньше обычного срока.` });
    }

    if (packInfo?.inBreak) {
      currentPhase = 'MENSTRUAL';
    } else if (inLoggedPeriod || isOngoingAuto) {
      currentPhase = 'MENSTRUAL';
    } else if (delayDays > 0) {
      currentPhase = 'DELAY';
    } else if (ovulationDate && today === ovulationDate) {
      currentPhase = 'OVULATION';
    } else if (fertileStart && fertileEnd && today >= fertileStart && today <= fertileEnd) {
      currentPhase = 'FERTILE';
    } else if (ovulationDate && today > ovulationDate) {
      currentPhase = 'LUTEAL';
    } else {
      currentPhase = 'FOLLICULAR';
    }

    const recentLengths = validCycles.filter((c) => c.length !== null).slice(-EngineConstants.RECENT_CYCLES).map((c) => c.length);
    const variation = recentLengths.length >= 2 ? Math.max(...recentLengths) - Math.min(...recentLengths) : 0;

    // Norms & Insights
    const age = profile.birthYear ? (new Date().getFullYear() - Number(profile.birthYear)) : 25;
    const maxNorm = age < EngineConstants.TEEN_AGE ? EngineConstants.TEEN_MAX_CYCLE : EngineConstants.ADULT_MAX_CYCLE;
    if (variation >= EngineConstants.IRREGULAR_V) {
      insights.push({ level: 'info', title: 'Нестабильная длина цикла', body: `Разброс последних циклов — ${variation} дн. (обычно до 7 дн.). Прогноз автоматически расширен.` });
    }
    if (recentLengths.length >= 2 && (cycleLength < EngineConstants.ADULT_MIN_CYCLE || cycleLength > maxNorm)) {
      insights.push({ level: 'warn', title: 'Длина цикла вне обычной нормы', body: `Средний цикл ${cycleLength} дн. (ориентир: ${EngineConstants.ADULT_MIN_CYCLE}–${maxNorm} дн.). Если так несколько циклов подряд — обсудите с врачом.` });
    }
    if (currentCycle.periodLength > EngineConstants.LONG_PERIOD_DAYS) {
      insights.push({ level: 'warn', title: 'Длинные месячные', body: `Текущие месячные идут уже ${currentCycle.periodLength} дн. (норма до 8 дн.).` });
    }
    if (!isHormonal && cycleDay > EngineConstants.NO_PERIOD_DAYS) {
      insights.push({ level: 'warn', title: 'Нет месячных больше 90 дней', body: 'Если беременность исключена, это повод обратиться к врачу.' });
    }
    if (currentCycle.ovDivergence) {
      insights.push({ level: 'info', title: 'Сигналы овуляции расходятся', body: 'Тест на ЛГ и утренняя температура дали разные даты (> 2 дн.). В расчёте использована температура.' });
    }
    if (daysUntilNextPeriod > 0 && daysUntilNextPeriod <= EngineConstants.PMS_WINDOW_DAYS && !isHormonal) {
      insights.push({ level: 'info', title: 'Окно ПМС', body: `До ожидаемых месячных ${daysUntilNextPeriod} дн. Возможны перепады настроения, усталость или чувствительность груди.` });
    }
    if (lutealLengths.filter((l) => l < EngineConstants.SHORT_LUTEAL).length >= 2) {
      insights.push({ level: 'info', title: 'Короткая лютеиновая фаза', body: 'В двух и более циклах фаза после овуляции короче 10 дней.' });
    }

    predictions = {
      cycleLength: effectiveCycleLength,
      cycleMean: cycleForecast.posteriorMean,
      cycleRange,
      periodLength,
      periodRange,
      lutealPhase,
      lutealFromHistory: lutealLengths.length > 0,
      historyCount: cycleLengths.length,
      periodHistoryCount: periodLengths.length,
      variation,
      expectWindow,
      nextPeriodStart,
      nextPeriodEnd,
      nextStartFromOvulation,
      ovulationDate,
      ovulationSource,
      ovulationVisible,
      fertileStart,
      fertileEnd,
      fertileChancesMap,
      accuracy,
    };
  }

  return {
    today, cycles, intermenstrual, currentCycle, cycleDay, currentPhase,
    delayDays, daysUntilNextPeriod, predictions, predictedPeriods, predictedWindows,
    pregnancy, isHormonal, packInfo, questions, insights, allBbt,
  };
}

export function computeForecastDiff(prevSnap, currPred) {
  if (!prevSnap || !currPred) return [];
  const diffs = [];
  if (prevSnap.nextPeriodStart && currPred.nextPeriodStart && prevSnap.nextPeriodStart !== currPred.nextPeriodStart) {
    const d = diffDays(prevSnap.nextPeriodStart, currPred.nextPeriodStart);
    diffs.push(`Следующие месячные сдвинулись на ${d > 0 ? '+' + d : d} дн. (${prevSnap.nextPeriodStart} → ${currPred.nextPeriodStart})`);
  }
  if (prevSnap.ovulationDate && currPred.ovulationDate && prevSnap.ovulationDate !== currPred.ovulationDate) {
    const d = diffDays(prevSnap.ovulationDate, currPred.ovulationDate);
    diffs.push(`Овуляция сдвинулась на ${d > 0 ? '+' + d : d} дн. (${prevSnap.ovulationDate} → ${currPred.ovulationDate})`);
  }
  if (prevSnap.cycleLength && currPred.cycleLength && prevSnap.cycleLength !== currPred.cycleLength) {
    diffs.push(`Прогноз длины цикла: ${prevSnap.cycleLength} → ${currPred.cycleLength} дн.`);
  }
  return diffs;
}
