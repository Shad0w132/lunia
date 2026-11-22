// Exact port of Lunia Engine v2 (Bayes.kt, EngineConstants.kt, CycleEngine.kt, Pregnancy.kt)
// Deterministic, dependency-free, offline-first.

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
  EXPECT_WINDOW_MIN: 1,
  EXPECT_WINDOW_MAX: 7,
  OVULATION_VISIBLE_MIN: 21,
  OVULATION_VISIBLE_MAX: 60,
  NAEGELE_DAYS: 280,
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

// ---- Date helpers (UTC ISO YYYY-MM-DD, immune to DST) ----
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
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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

// ---- Episode grouping & Cycle State computation ----
function isBleedingFlow(flow) {
  return flow && flow !== 'SPOTTING';
}

export function groupPeriods(logsByDate) {
  const bleedingDates = Object.entries(logsByDate)
    .filter(([, log]) => isBleedingFlow(log.flow))
    .map(([date]) => date)
    .sort();

  const episodes = [];
  for (const d of bleedingDates) {
    if (episodes.length === 0) {
      episodes.push({ start: d, end: d, days: [d] });
    } else {
      const last = episodes[episodes.length - 1];
      const gap = diffDays(last.end, d) - 1;
      if (gap <= EngineConstants.MERGE_GAP) {
        last.end = d;
        last.days.push(d);
      } else {
        episodes.push({ start: d, end: d, days: [d] });
      }
    }
  }

  // Filter out episodes too close to previous start (< MIN_AUTO_CYCLE)
  const periods = [];
  for (const ep of episodes) {
    if (periods.length === 0) {
      periods.push(ep);
    } else {
      const prev = periods[periods.length - 1];
      if (diffDays(prev.start, ep.start) >= EngineConstants.MIN_AUTO_CYCLE) {
        periods.push(ep);
      }
    }
  }
  return periods;
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

export function computeCycleState(state, today = todayIso()) {
  const profile = state.profile || {};
  const logs = state.logs || {};
  const periods = groupPeriods(logs);

  const cycles = periods.map((p, idx) => {
    const next = periods[idx + 1];
    const length = next ? diffDays(p.start, next.start) : null;
    const periodLength = diffDays(p.start, p.end) + 1;
    return {
      start: p.start,
      end: p.end,
      length,
      periodLength,
      days: p.days,
    };
  });

  // Valid completed cycle lengths (last HISTORY_CYCLES within support)
  const rawCycleLengths = cycles
    .filter((c) => c.length !== null && c.length >= EngineConstants.CYCLE_SUPPORT_MIN && c.length <= EngineConstants.CYCLE_SUPPORT_MAX)
    .slice(-EngineConstants.HISTORY_CYCLES)
    .map((c) => c.length);
  const cycleLengths = rejectOutliers(rawCycleLengths);

  const periodLengths = cycles
    .map((c) => c.periodLength)
    .filter((l) => l >= EngineConstants.PERIOD_SUPPORT_MIN && l <= EngineConstants.PERIOD_SUPPORT_MAX)
    .slice(-EngineConstants.HISTORY_CYCLES);

  const cyclePrior = profile.typicalCycle
    ? { ...EngineConstants.CYCLE_PRIOR, mu0: Number(profile.typicalCycle) }
    : EngineConstants.CYCLE_PRIOR;
  const periodPrior = profile.typicalPeriod
    ? { ...EngineConstants.PERIOD_PRIOR, mu0: Number(profile.typicalPeriod) }
    : EngineConstants.PERIOD_PRIOR;
  const lutealPrior = EngineConstants.LUTEAL_PRIOR;

  const cycleForecast = predictLength(
    cyclePrior,
    cycleLengths,
    EngineConstants.CYCLE_SUPPORT_MIN,
    EngineConstants.CYCLE_SUPPORT_MAX
  );
  const periodForecast = predictLength(
    periodPrior,
    periodLengths,
    EngineConstants.PERIOD_SUPPORT_MIN,
    EngineConstants.PERIOD_SUPPORT_MAX
  );
  const lutealForecast = predictLength(
    lutealPrior,
    [],
    EngineConstants.LUTEAL_SUPPORT_MIN,
    EngineConstants.LUTEAL_SUPPORT_MAX
  );

  const cycleLength = cycleForecast.dist.median;
  const cycleRange = [
    cycleForecast.dist.quantile(EngineConstants.RANGE_LOW_Q),
    cycleForecast.dist.quantile(EngineConstants.RANGE_HIGH_Q),
  ];
  const periodLength = periodForecast.dist.median;
  const periodRange = [
    periodForecast.dist.quantile(EngineConstants.RANGE_LOW_Q),
    periodForecast.dist.quantile(EngineConstants.RANGE_HIGH_Q),
  ];
  const lutealPhase = lutealForecast.dist.median;

  // Hormonal contraception pack mode
  const isHormonal = profile.mode === 'CONTRACEPTION' && profile.contraceptionPack;
  const effectiveCycleLength = isHormonal
    ? (Number(profile.pillActiveDays || 21) + Number(profile.pillBreakDays || 7))
    : cycleLength;

  // Pregnancy mode
  let pregnancy = null;
  if (profile.mode === 'PREGNANCY') {
    const lmp = profile.pregnancyLmp || (cycles.length ? cycles[cycles.length - 1].start : today);
    const edd = addDays(lmp, EngineConstants.NAEGELE_DAYS);
    const gestDays = Math.max(0, diffDays(lmp, today));
    const weeks = Math.floor(gestDays / 7);
    const remDays = gestDays % 7;
    const daysLeft = Math.max(0, diffDays(today, edd));
    const trimester = weeks < 14 ? 1 : weeks < 28 ? 2 : 3;
    pregnancy = { lmp, edd, gestDays, weeks, remDays, daysLeft, trimester };
  }

  const currentCycle = cycles.length ? cycles[cycles.length - 1] : null;
  let predictions = null;
  let currentPhase = 'UNKNOWN';
  let cycleDay = null;
  let delayDays = 0;
  let daysUntilNextPeriod = null;
  let ovulationDate = null;
  let fertileStart = null;
  let fertileEnd = null;
  let fertileChancesMap = new Map();
  let predictedPeriods = [];
  let predictedWindows = [];

  if (currentCycle && !pregnancy) {
    cycleDay = diffDays(currentCycle.start, today) + 1;
    const expectWindow = Math.max(
      EngineConstants.EXPECT_WINDOW_MIN,
      Math.min(EngineConstants.EXPECT_WINDOW_MAX, cycleRange[1] - cycleLength)
    );

    const nextPeriodStart = addDays(currentCycle.start, effectiveCycleLength);
    const nextPeriodEnd = addDays(nextPeriodStart, periodLength - 1);
    daysUntilNextPeriod = diffDays(today, nextPeriodStart);

    if (daysUntilNextPeriod < 0) {
      delayDays = Math.abs(daysUntilNextPeriod);
    }

    const ovulationVisible =
      !isHormonal &&
      effectiveCycleLength >= EngineConstants.OVULATION_VISIBLE_MIN &&
      effectiveCycleLength <= EngineConstants.OVULATION_VISIBLE_MAX;

    if (ovulationVisible) {
      const ovDist = ovulationOffsets(cycleForecast.dist, lutealForecast.dist);
      const ovOffset = ovDist.median;
      ovulationDate = addDays(currentCycle.start, ovOffset);

      const chances = fertilityChances(ovDist);
      let peak = 0;
      for (const v of chances.values()) if (v > peak) peak = v;
      const thresh = Math.min(EngineConstants.CHANCE_MEDIUM, peak * EngineConstants.WINDOW_PEAK_FRACTION);
      const fertileOffsets = [...chances.entries()]
        .filter(([, v]) => v >= thresh)
        .map(([t]) => t)
        .sort((a, b) => a - b);

      if (fertileOffsets.length) {
        fertileStart = addDays(currentCycle.start, fertileOffsets[0]);
        fertileEnd = addDays(currentCycle.start, fertileOffsets[fertileOffsets.length - 1]);
        for (const t of fertileOffsets) {
          fertileChancesMap.set(addDays(currentCycle.start, t), chances.get(t));
        }
      }
    }

    // Generate future predicted periods & windows (6 cycles ahead)
    let cursor = nextPeriodStart;
    for (let i = 0; i < 6; i++) {
      const pEnd = addDays(cursor, periodLength - 1);
      predictedPeriods.push({ start: cursor, end: pEnd });
      if (ovulationVisible) {
        const ovOffset = effectiveCycleLength - lutealPhase;
        const ov = addDays(cursor, ovOffset);
        predictedWindows.push({
          ovulation: ov,
          start: addDays(ov, -5),
          end: addDays(ov, 1),
        });
      }
      cursor = addDays(cursor, effectiveCycleLength);
    }

    // Determine current phase
    const inLoggedPeriod = today >= currentCycle.start && today <= currentCycle.end;
    const isRecentSingleDay =
      currentCycle.periodLength === 1 &&
      diffDays(currentCycle.start, today) >= 0 &&
      diffDays(currentCycle.start, today) < periodLength &&
      !state.periodEndedDates?.[currentCycle.start];

    if (inLoggedPeriod || isRecentSingleDay) {
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

    const recentLengths = cycles.filter((c) => c.length !== null).slice(-EngineConstants.RECENT_CYCLES).map((c) => c.length);
    const variation = recentLengths.length >= 2 ? Math.max(...recentLengths) - Math.min(...recentLengths) : 0;

    predictions = {
      cycleLength: effectiveCycleLength,
      cycleMean: cycleForecast.posteriorMean,
      cycleRange,
      periodLength,
      periodRange,
      lutealPhase,
      historyCount: cycleLengths.length,
      periodHistoryCount: periodLengths.length,
      variation,
      expectWindow,
      nextPeriodStart,
      nextPeriodEnd,
      ovulationDate,
      ovulationVisible,
      fertileStart,
      fertileEnd,
      fertileChancesMap,
    };
  }

  return {
    today,
    cycles,
    currentCycle,
    cycleDay,
    currentPhase,
    delayDays,
    daysUntilNextPeriod,
    predictions,
    predictedPeriods,
    predictedWindows,
    pregnancy,
    isHormonal,
  };
}
