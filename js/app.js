import {
  computeCycleState, todayIso, addDays, diffDays, parseDate,
} from './engine.js';
import {
  LOG_CATEGORIES, FLOW_OPTIONS, SEX_TYPES, PROTECTION_TYPES, OTEST_OPTIONS,
  PTEST_OPTIONS, BBT_FLAGS, PILL_STATUSES, CYCLE_FLAGS, CONTRACEPTION_METHODS,
  PERIOD_TIPS, PREGNANCY_CONTENT,
} from './catalog.js';
import {
  loadState, saveState, hashPin, exportBackupJson, exportCsv, parseBackupJson, defaultState,
} from './storage.js';

const MONTHS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const MONTHS_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const WEEKDAYS_SHORT = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const WEEKDAYS_FULL = ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];
const PHASE_NAMES = {
  MENSTRUAL: 'Месячные', FOLLICULAR: 'До овуляции', FERTILE: 'Фертильные дни',
  OVULATION: 'День овуляции', LUTEAL: 'После овуляции', DELAY: 'Задержка', UNKNOWN: 'Нет данных',
};

const STORY_ICONS = {
  drop: '<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  run: '<circle cx="13" cy="4" r="2"/><path d="M7 21l3-7 3 2 2 5M10 14l2-5 4 2 2-2"/>',
  leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/><path d="M2 21c0-3 1.85-5.36 5.08-6"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  pill: '<rect x="5" y="9" width="14" height="6" rx="3" transform="rotate(-45 12 12)"/><line x1="9.5" y1="9.5" x2="14.5" y2="14.5"/>',
  flask: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3"/>',
  thermo: '<path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
};

let state = loadState();
let activeTab = 'today'; // today | calendar | reports | profile | library
let calDate = new Date();
let calYear = calDate.getFullYear();
let calMonth = calDate.getMonth();
let calEditMode = false;
let calEditDraft = new Set();

let logModalDate = null;
let howScreenOpen = false;
let tipsModalOpen = false;
let diffSheetData = null; // { prevDate, items: [{label, from, to, delta}] }
let lastDaySheet = null; // { cycleStart, selectedDate }
let cycleFlagsModalStart = null;
let doctorReportOpen = false;
let activeStory = null;
let storySlideIdx = 0;
let activeArticle = null;
let activeBook = null;
let activeBookMd = '';
let activeBookChapter = 0;

let articles = [];
let stories = [];
let booksIndex = [];
let librarySub = 'articles';
let articleFilter = 'all';
let articleQuery = '';
let notesQuery = '';
let toastMsg = '';
let toastTimer = null;

let unlocked = !state.profile.pinHash;
let pinEntry = '';
let pinError = '';

function showToast(msg) {
  toastMsg = msg;
  clearTimeout(toastTimer);
  render();
  toastTimer = setTimeout(() => { toastMsg = ''; render(); }, 2400);
}

function pluralDays(n) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a >= 11 && a <= 19) return `${n} дней`;
  if (b === 1) return `${n} день`;
  if (b >= 2 && b <= 4) return `${n} дня`;
  return `${n} дней`;
}

function fmtDateShort(iso) {
  if (!iso) return '—';
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS_GEN[m - 1]}`;
}

function fmtHeaderDate(iso) {
  const dt = new Date(parseDate(iso));
  const wd = WEEKDAYS_FULL[(dt.getUTCDay() + 6) % 7];
  return `${wd}, ${fmtDateShort(iso)}`;
}

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function renderMarkdown(md) {
  const lines = md.split('\n');
  let html = '', inList = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^(id|color|summary):/.test(line)) continue;
    if (line.startsWith('### ')) { if (inList) { html += '</ul>'; inList = false; } html += `<h3>${escapeHtml(line.slice(4))}</h3>`; }
    else if (line.startsWith('## ')) { if (inList) { html += '</ul>'; inList = false; } html += `<h2>${escapeHtml(line.slice(3))}</h2>`; }
    else if (line.startsWith('# ')) { if (inList) { html += '</ul>'; inList = false; } html += `<h1>${escapeHtml(line.slice(2))}</h1>`; }
    else if (line.startsWith('> ')) { if (inList) { html += '</ul>'; inList = false; } html += `<blockquote>${escapeHtml(line.slice(2)).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</blockquote>`; }
    else if (line.startsWith('- ') || line.startsWith('* ')) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${escapeHtml(line.slice(2)).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</li>`;
    } else if (line.trim() === '') { if (inList) { html += '</ul>'; inList = false; } }
    else { if (inList) { html += '</ul>'; inList = false; } html += `<p>${escapeHtml(line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</p>`; }
  }
  if (inList) html += '</ul>';
  return html;
}

function applyTheme() {
  const pref = state.profile.theme || 'system';
  const isDark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
}

function getDayStatus(iso, cs) {
  const log = state.logs[iso];
  if (log?.flow && log.flow !== 'SPOTTING') return 'period';
  if (log?.flow === 'SPOTTING') return 'spotting';
  if (cs.predictions?.ovulationDate === iso) return 'ovulation';
  if (cs.predictions?.fertileStart && iso >= cs.predictions.fertileStart && iso <= cs.predictions.fertileEnd) return 'fertile';
  for (const pp of cs.predictedPeriods) if (iso >= pp.start && iso <= pp.end) return 'predicted';
  for (const pw of cs.predictedWindows) {
    if (iso === pw.ovulation) return 'ovulation';
    if (iso >= pw.start && iso <= pw.end) return 'fertile';
  }
  return '';
}

function hasAnyLog(iso) {
  const l = state.logs[iso];
  if (!l) return false;
  return Boolean(l.flow || (l.marks?.length) || (l.sexEvents?.length) || (l.note?.trim()) || l.bbt || l.otest || l.ptest || l.pillStatus || l.libido);
}

function ensureLog(date) {
  if (!state.logs[date]) {
    state.logs[date] = {
      flow: null, clots: false, marks: [], sexEvents: [], libido: null,
      note: '', bbt: '', bbtTime: '', bbtFlags: [], otest: null, manualOvulation: null,
      ptest: null, pillStatus: null, metrics: {}, custom: {},
    };
  }
  const l = state.logs[date];
  if (!Array.isArray(l.marks)) l.marks = [];
  if (!Array.isArray(l.sexEvents)) l.sexEvents = [];
  if (!Array.isArray(l.bbtFlags)) l.bbtFlags = [];
  if (!l.metrics) l.metrics = {};
  if (!l.custom) l.custom = {};
  return l;
}

// ---- Exact Multi-Segment SVG Cycle Ring (matching screenshots 1, 3, 4, 5) ----
function polar(cx, cy, r, deg) {
  const rad = (deg - 90) * Math.PI / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function arcPath(cx, cy, r, startDeg, endDeg) {
  const span = Math.max(2, Math.min(355, endDeg - startDeg));
  const [x1, y1] = polar(cx, cy, r, startDeg);
  const [x2, y2] = polar(cx, cy, r, startDeg + span);
  const large = span > 180 ? 1 : 0;
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

function buildMultiSegmentRing(cs) {
  const cx = 136, cy = 136, r = 110;
  let topLabel = '', mainText = 'Отметь цикл', subText = 'Нажми кнопку ниже', mainColor = 'var(--brand)';
  let segments = '';
  let markers = '';

  if (cs.pregnancy) {
    const progDeg = Math.min(354, Math.max(8, (cs.pregnancy.gestDays / 280) * 360));
    segments = `<path d="${arcPath(cx, cy, r, 0, progDeg)}" fill="none" stroke="var(--luteal)" stroke-width="18" stroke-linecap="round"/>`;
    const [tx, ty] = polar(cx, cy, r, progDeg);
    markers = `<circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="10" fill="var(--luteal)" stroke="var(--bg)" stroke-width="4"/>`;
    topLabel = `${cs.pregnancy.trimester}-й триместр`;
    mainText = `${cs.pregnancy.weeks} нед. ${cs.pregnancy.remDays} дн.`;
    subText = `ПДР — ${fmtDateShort(cs.pregnancy.edd)}`;
    mainColor = 'var(--luteal)';
  } else if (cs.packInfo) {
    const pk = cs.packInfo;
    const brkEndDeg = (pk.breakDays / pk.totalDays) * 360;
    if (pk.breakDays > 0) {
      segments += `<path d="${arcPath(cx, cy, r, 4, brkEndDeg - 4)}" fill="none" stroke="var(--period)" stroke-width="18" stroke-linecap="round"/>`;
    }
    segments += `<path d="${arcPath(cx, cy, r, brkEndDeg + 6, 354)}" fill="none" stroke="var(--luteal-arc)" stroke-width="18" stroke-linecap="round"/>`;
    const curDeg = ((pk.dayInPack - 0.5) / pk.totalDays) * 360;
    const [tx, ty] = polar(cx, cy, r, curDeg);
    const dotCol = pk.inBreak ? 'var(--period)' : 'var(--luteal)';
    markers = `<circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="10" fill="${dotCol}" stroke="var(--bg)" stroke-width="4"/>`;
    topLabel = pk.inBreak ? 'Дни перерыва' : 'Упаковка таблеток';
    mainText = pk.inBreak ? `День ${pk.dayInPack}` : `Таблетка ${pk.dayInPack - pk.breakDays}`;
    subText = pk.inBreak ? `Активные через ${pluralDays(pk.daysUntilActive)}` : (pk.breakDays > 0 ? `Перерыв через ${pluralDays(pk.daysUntilBreak)}` : 'Приём без перерыва');
    mainColor = dotCol;
  } else if (cs.predictions) {
    const p = cs.predictions;
    const total = Math.max(15, p.cycleLength);
    const d2deg = (day) => Math.max(0, Math.min(360, ((day - 1) / total) * 360));

    // 1. Period arc (crimson)
    const pEnd = Math.min(total - 2, Math.max(1, p.periodLength));
    segments += `<path d="${arcPath(cx, cy, r, 3, Math.max(14, d2deg(pEnd + 0.6)))}" fill="none" stroke="var(--period)" stroke-width="18" stroke-linecap="round"/>`;

    // 2. Fertile arc (teal) & Luteal arc (lavender)
    let ovDay = null;
    if (p.ovulationVisible && p.fertileStart && p.fertileEnd && cs.currentCycle) {
      const fStart = Math.max(pEnd + 1, diffDays(cs.currentCycle.start, p.fertileStart) + 1);
      const fEnd = Math.min(total - 1, diffDays(cs.currentCycle.start, p.fertileEnd) + 1);
      ovDay = Math.max(fStart, Math.min(fEnd, diffDays(cs.currentCycle.start, p.ovulationDate) + 1));

      if (fEnd > fStart) {
        segments += `<path d="${arcPath(cx, cy, r, d2deg(fStart) + 3, d2deg(fEnd + 0.6) - 3)}" fill="none" stroke="var(--fertile-arc)" stroke-width="18" stroke-linecap="round"/>`;
      }
      if (fEnd + 1 < total) {
        segments += `<path d="${arcPath(cx, cy, r, d2deg(fEnd + 1) + 4, 355)}" fill="none" stroke="var(--luteal-arc)" stroke-width="18" stroke-linecap="round"/>`;
      }
      // Ovulation dot
      const [ox, oy] = polar(cx, cy, r, d2deg(ovDay + 0.5));
      markers += `<circle cx="${ox.toFixed(1)}" cy="${oy.toFixed(1)}" r="7.5" fill="var(--ovulation)" stroke="var(--bg)" stroke-width="3"/>`;
    } else {
      segments += `<path d="${arcPath(cx, cy, r, d2deg(pEnd + 1) + 6, 355)}" fill="none" stroke="var(--luteal-arc)" stroke-width="18" stroke-linecap="round"/>`;
    }

    // 3. Today marker dot
    const clampedDay = Math.max(1, Math.min(total, cs.cycleDay || 1));
    const todayDeg = cs.currentPhase === 'DELAY' || cs.daysUntilNextPeriod === 0 ? 0 : d2deg(clampedDay + 0.3);
    const [tx, ty] = polar(cx, cy, r, todayDeg);
    const dotCol = (cs.currentPhase === 'MENSTRUAL' || cs.daysUntilNextPeriod === 0) ? 'var(--period)'
      : (cs.currentPhase === 'FERTILE' || cs.currentPhase === 'OVULATION') ? 'var(--ovulation)'
      : cs.currentPhase === 'LUTEAL' ? 'var(--luteal)'
      : cs.currentPhase === 'DELAY' ? 'var(--delay)' : 'var(--brand)';
    markers += `<circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="10" fill="${dotCol}" stroke="var(--surface)" stroke-width="4"/>`;

    // 4. Exact center text hierarchy matching screenshots
    subText = `${cs.cycleDay}-й день цикла`;
    if (cs.currentPhase === 'MENSTRUAL') {
      topLabel = 'Месячные';
      mainText = `День ${cs.cycleDay}`;
      mainColor = 'var(--period)';
    } else if (cs.currentPhase === 'DELAY') {
      topLabel = 'Задержка';
      mainText = pluralDays(cs.delayDays);
      subText = `Ожидались ${fmtDateShort(p.nextPeriodStart)}`;
      mainColor = 'var(--delay)';
    } else if (cs.daysUntilNextPeriod === 0) {
      topLabel = 'Месячные ожидаются';
      mainText = 'Сегодня';
      mainColor = 'var(--period)';
    } else if (cs.currentPhase === 'OVULATION') {
      topLabel = 'Овуляция';
      mainText = 'Сегодня';
      mainColor = 'var(--ovulation)';
    } else if (p.ovulationVisible && p.ovulationDate && diffDays(cs.today, p.ovulationDate) > 0 && diffDays(cs.today, p.ovulationDate) <= 7) {
      const toOv = diffDays(cs.today, p.ovulationDate);
      topLabel = 'Овуляция через';
      mainText = pluralDays(toOv);
      mainColor = 'var(--ovulation)';
    } else {
      topLabel = 'До месячных';
      mainText = pluralDays(cs.daysUntilNextPeriod);
      mainColor = cs.currentPhase === 'LUTEAL' ? 'var(--luteal)' : 'var(--brand)';
    }
  }

  return `
    <svg class="ring-svg" viewBox="0 0 272 272" aria-label="Кольцо цикла">
      <circle cx="${cx}" cy="${cy}" r="94" fill="var(--surface-variant)" opacity="0.65"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--track)" stroke-width="18"/>
      ${segments}
      ${markers}
      ${topLabel ? `<text x="${cx}" y="${cy - 28}" text-anchor="middle" fill="var(--text-secondary)" font-size="13" font-weight="600">${escapeHtml(topLabel)}</text>` : ''}
      <text x="${cx}" y="${cy + 10}" text-anchor="middle" fill="${mainColor}" font-size="31" font-weight="800">${escapeHtml(mainText)}</text>
      <text x="${cx}" y="${cy + 34}" text-anchor="middle" fill="var(--text-secondary)" font-size="12.5" font-weight="600">${escapeHtml(subText)}</text>
    </svg>
  `;
}

function getChanceBadge(cs) {
  if (cs.pregnancy || cs.isHormonal || !cs.predictions) return '';
  if (cs.currentPhase === 'OVULATION') return `<div class="chance-pill high">+ Высокий шанс забеременеть</div>`;
  if (cs.currentPhase === 'FERTILE') return `<div class="chance-pill medium">+ Средний шанс забеременеть</div>`;
  return `<div class="chance-pill low">+ Низкий шанс забеременеть</div>`;
}

function renderPregnancyCard(cs) {
  const pr = cs.pregnancy;
  if (!pr) return '';
  const w = Math.min(42, pr.weeks);
  const szRow = PREGNANCY_CONTENT.sizeTable.find((r) => r[0] === w);
  const szIdx = PREGNANCY_CONTENT.sizeTable.findIndex((r) => r[0] === w);
  const szName = szIdx >= 0 ? PREGNANCY_CONTENT.sizeNames[szIdx] : null;
  const tIdx = Math.max(0, Math.min(2, pr.trimester - 1));
  const grp = w < 9 ? 0 : w < 14 ? 1 : w < 20 ? 2 : w < 25 ? 3 : w < 29 ? 4 : w < 34 ? 5 : w < 37 ? 6 : 7;
  const items = PREGNANCY_CONTENT.checklists[grp] || [];

  return `
    <div class="card flat">
      <div class="card-title">Неделя ${pr.weeks} ${szName ? `• размер: ${escapeHtml(szName)}` : ''}</div>
      ${szRow ? `<div class="muted" style="margin-bottom:8px">Рост ~${szRow[1]} см • вес ~${szRow[2]} г • осталось ${Math.max(0, pr.daysLeft)} дн.</div>` : ''}
      ${PREGNANCY_CONTENT.baby[tIdx] ? `<p style="margin:6px 0"><strong>Малыш:</strong> ${escapeHtml(PREGNANCY_CONTENT.baby[tIdx])}</p>` : ''}
      ${PREGNANCY_CONTENT.body[tIdx] ? `<p class="muted" style="margin:6px 0"><strong>Организм:</strong> ${escapeHtml(PREGNANCY_CONTENT.body[tIdx])}</p>` : ''}
    </div>
    <div class="card flat">
      <div class="card-title">Чек-лист недели</div>
      ${items.map((txt, idx) => {
        const key = `g${grp}_${idx}`;
        const checked = Boolean(state.pregnancy?.checklist?.[key]);
        return `<label class="check-item"><input type="checkbox" data-preg-check="${key}" ${checked ? 'checked' : ''} /><span>${escapeHtml(txt)}</span></label>`;
      }).join('')}
    </div>
  `;
}

function renderToday(cs) {
  const today = cs.today;
  const weekDays = [];
  for (let i = -2; i <= 4; i++) {
    const iso = addDays(today, i);
    const dt = new Date(parseDate(iso));
    const wd = WEEKDAYS_SHORT[(dt.getUTCDay() + 6) % 7];
    const st = getDayStatus(iso, cs);
    const cls = st === 'period' ? 'wd-period' : st === 'predicted' ? 'wd-predicted' : st === 'ovulation' ? 'wd-ovulation' : st === 'fertile' ? 'wd-fertile' : '';
    weekDays.push(`
      <button class="week-day ${iso === today ? 'today' : ''} ${cls}" data-open-log="${iso}">
        <span class="wd-name">${wd}</span>
        <span class="wd-num">${dt.getUTCDate()}</span>
        ${hasAnyLog(iso) ? '<span class="wd-dot"></span>' : ''}
      </button>
    `);
  }

  const todayLog = state.logs[today] || {};
  const isPeriodToday = Boolean(todayLog.flow && todayLog.flow !== 'SPOTTING');

  // Stories (Circular bubbles matching screenshots!)
  const phaseForStories = cs.isHormonal ? 'CONTRACEPTION' : (cs.currentPhase === 'OVULATION' || cs.currentPhase === 'FERTILE' ? 'OVULATORY' : cs.currentPhase);
  const sortedStories = [...stories].sort((a, b) => {
    const am = (a.phases || []).includes(phaseForStories) || (a.goals || []).includes(state.profile.mode) ? 0 : 1;
    const bm = (b.phases || []).includes(phaseForStories) || (b.goals || []).includes(state.profile.mode) ? 0 : 1;
    return am - bm;
  });

  const storiesHtml = sortedStories.length ? `
    <div class="stories-row">
      ${sortedStories.map((st) => {
        const iconSvg = STORY_ICONS[st.icon] || STORY_ICONS.sparkle;
        const unread = !state.viewedStories.includes(st.id);
        return `
          <div class="story-bubble c-${escapeHtml(st.color || 'neutral')} ${unread ? 'unread' : ''}" data-open-story="${escapeHtml(st.id)}">
            <div class="story-ring">
              <div class="story-inner"><svg viewBox="0 0 24 24">${iconSvg}</svg></div>
            </div>
            <div class="story-lbl">${escapeHtml(st.label || st.title)}</div>
          </div>
        `;
      }).join('')}
    </div>
  ` : '';

  // Warm cream question card matching Screen 3
  const questionsHtml = cs.questions.map((q) => {
    if (q.type === 'PERIOD_STILL_ON' || q.type === 'PERIOD_LAST_DAY') {
      const lastDayStr = q.lastLogged ? `${fmtDateShort(q.lastLogged)}` : `${fmtDateShort(q.cycleStart)}`;
      const dayNum = q.lastLogged ? diffDays(q.cycleStart, q.lastLogged) + 1 : 1;
      return `
        <div class="card cream">
          <div class="card-title" style="color:var(--on-mood-container)">Месячные ещё идут?</div>
          <div style="font-size:13px;margin-bottom:12px;opacity:0.9">Последняя отметка — ${lastDayStr} (${dayNum}-й день).</div>
          <div class="col-2">
            <button class="btn btn-period" data-q-still-yes="${q.cycleStart}">Да, идут</button>
            <button class="btn btn-outline-cream" data-open-lastday="${q.cycleStart}">Закончились</button>
          </div>
        </div>
      `;
    }
    if (q.type === 'INTERMENSTRUAL') {
      return `
        <div class="card cream">
          <div class="card-title">${escapeHtml(q.title)}</div>
          <div style="font-size:13px;margin-bottom:12px">${escapeHtml(q.body)}</div>
          <div class="col-2">
            <button class="btn btn-period btn-sm" data-dec-ep="${q.episodeStart}" data-dec-val="PERIOD">Новые месячные</button>
            <button class="btn btn-outline-cream btn-sm" data-dec-ep="${q.episodeStart}" data-dec-val="INTERMENSTRUAL">Кровь между</button>
          </div>
        </div>
      `;
    }
    return '';
  }).join('');

  const pillCardHtml = cs.isHormonal ? `
    <div class="card flat">
      <div class="card-title">Приём таблетки сегодня</div>
      <div class="chips">
        ${PILL_STATUSES.map((ps) => `<span class="chip ${todayLog.pillStatus === ps.id ? 'active' : ''}" data-quick-pill="${ps.id}">${escapeHtml(ps.label)}</span>`).join('')}
      </div>
    </div>
  ` : '';

  const periodTipsCard = (cs.currentPhase === 'MENSTRUAL' && PERIOD_TIPS.length) ? `
    <div class="card flat">
      <div class="row">
        <div class="card-title" style="margin:0">Советы в дни месячных</div>
        <button class="btn btn-soft btn-sm" id="btn-open-tips">Все советы</button>
      </div>
      <p class="muted" style="margin:8px 0 0"><strong>${escapeHtml(PERIOD_TIPS[0].title)}:</strong> ${escapeHtml(PERIOD_TIPS[0].body)}</p>
    </div>
  ` : '';

  const insightsHtml = cs.insights.map((ins) => `
    <div class="card ${ins.level === 'warn' ? 'cream' : 'flat'}">
      <div class="card-title">${escapeHtml(ins.title)}</div>
      <div style="font-size:13px">${escapeHtml(ins.body)}</div>
    </div>
  `).join('');

  // Bottom Summary Card matching Screens 1 & 3
  let summaryCard = '';
  if (cs.predictions && !cs.pregnancy) {
    const p = cs.predictions;
    const isPeriod = cs.currentPhase === 'MENSTRUAL';
    const title = isPeriod ? `Месячные · ${cs.cycleDay}-й день` : `Следующие месячные — ${fmtDateShort(p.nextPeriodStart)}`;
    const sub = isPeriod
      ? `Скорее всего, закончатся ${fmtDateShort(addDays(cs.currentCycle.start, p.periodLength - 1))}<br/>Следующие — ${fmtDateShort(p.nextPeriodStart)}`
      : (p.ovulationVisible ? `Овуляция — ${fmtDateShort(p.ovulationDate)}` : 'Овуляция скрыта в текущем режиме');
    summaryCard = `
      <div class="card flat">
        <div class="card-title">${title}</div>
        <div class="muted">${sub}</div>
        <div class="card-links">
          <button class="text-link-btn" id="btn-open-how">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            Как это посчитано
          </button>
          <button class="text-link-btn" id="btn-refresh-forecast">
            <svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            Обновить прогноз
          </button>
        </div>
      </div>
    `;
  }

  return `
    <div class="week-strip">${weekDays.join('')}</div>
    <div class="ring-hero">
      ${buildMultiSegmentRing(cs)}
      ${getChanceBadge(cs)}
      ${!cs.pregnancy ? `
        <button class="btn ${isPeriodToday ? 'btn-soft' : 'btn-period'} hero-cta" id="btn-toggle-period-today">
          ${isPeriodToday ? 'Убрать месячные' : 'Отметить месячные'}
        </button>
      ` : ''}
    </div>
    ${storiesHtml}
    ${questionsHtml}
    ${pillCardHtml}
    ${renderPregnancyCard(cs)}
    ${summaryCard}
    ${periodTipsCard}
    ${insightsHtml}
    <div class="card flat" style="cursor:pointer" id="btn-open-library-card">
      <div class="row">
        <div>
          <div class="card-title" style="margin:0">Статьи и мини-книги</div>
          <div class="muted">${articles.length} статей и ${booksIndex.length} мини-книг офлайн</div>
        </div>
        <span style="font-size:18px;color:var(--text-secondary)">→</span>
      </div>
    </div>
  `;
}

function renderCalendar(cs) {
  const firstDay = new Date(Date.UTC(calYear, calMonth, 1));
  const startOffset = (firstDay.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(calYear, calMonth + 1, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push('<div class="cal-cell empty"></div>');
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday = iso === cs.today;
    if (calEditMode) {
      const sel = calEditDraft.has(iso);
      cells.push(`<div class="cal-cell ${sel ? 'edit-selected' : ''} ${isToday ? 'today' : ''}" data-cal-toggle="${iso}"><span>${d}</span></div>`);
    } else {
      const st = getDayStatus(iso, cs);
      cells.push(`
        <div class="cal-cell ${st} ${isToday ? 'today' : ''}" data-open-log="${iso}">
          <span>${d}</span>
          ${hasAnyLog(iso) ? '<span class="has-log"></span>' : ''}
        </div>
      `);
    }
  }
  return `
    <div class="card flat">
      <div class="cal-header">
        <button class="btn btn-soft btn-sm" id="cal-prev">←</button>
        <strong>${MONTHS_RU[calMonth]} ${calYear}</strong>
        <button class="btn btn-soft btn-sm" id="cal-next">→</button>
      </div>
      <div class="cal-grid">
        ${WEEKDAYS_SHORT.map((w) => `<div class="cal-wd">${w}</div>`).join('')}
        ${cells.join('')}
      </div>
      <div class="cal-legend">
        <span class="legend-item"><i class="legend-dot" style="background:var(--period)"></i>Месячные</span>
        <span class="legend-item"><i class="legend-dot" style="border:1.5px dashed var(--period)"></i>Прогноз</span>
        <span class="legend-item"><i class="legend-dot" style="background:var(--fertile)"></i>Фертильные</span>
        <span class="legend-item"><i class="legend-dot" style="background:var(--ovulation)"></i>Овуляция</span>
      </div>
    </div>
    <div class="row" style="margin-bottom:10px">
      ${calEditMode ? `
        <button class="btn btn-period btn-full" id="btn-cal-edit-save">Сохранить месячные</button>
        <button class="btn btn-soft" id="btn-cal-edit-cancel">Отмена</button>
      ` : `
        <button class="btn btn-soft btn-full" id="btn-cal-edit-start">Изменить дни месячных</button>
      `}
    </div>
    <p class="muted" style="text-align:center">${calEditMode ? 'Нажимай на дни, чтобы отметить или убрать месячные.' : 'Нажми на любой день, чтобы открыть запись дня.'}</p>
  `;
}

function buildBbtSvg(bbtList, coverline) {
  if (bbtList.length < 2) return '<p class="muted">Добавь минимум 2 замера утренней температуры, чтобы увидеть график.</p>';
  const pts = bbtList.slice(-24);
  const vals = pts.map((p) => p.celsius);
  const minV = Math.min(36.0, ...vals) - 0.1;
  const maxV = Math.max(37.2, ...vals) + 0.1;
  const W = 320, H = 140, pad = 16;
  const sx = (i) => pad + (i / (pts.length - 1)) * (W - pad * 2);
  const sy = (v) => H - pad - ((v - minV) / (maxV - minV)) * (H - pad * 2);
  const poly = pts.map((p, i) => `${sx(i).toFixed(1)},${sy(p.celsius).toFixed(1)}`).join(' ');
  const covY = coverline ? sy(coverline).toFixed(1) : null;
  return `
    <svg class="chart-svg" viewBox="0 0 ${W} ${H}">
      ${covY ? `<line x1="${pad}" y1="${covY}" x2="${W - pad}" y2="${covY}" stroke="var(--ovulation)" stroke-dasharray="4 3" stroke-width="1.5"/>` : ''}
      <polyline fill="none" stroke="var(--brand)" stroke-width="2.5" points="${poly}" />
      ${pts.map((p, i) => `<circle cx="${sx(i).toFixed(1)}" cy="${sy(p.celsius).toFixed(1)}" r="3.5" fill="${p.flags?.length ? 'var(--delay)' : 'var(--period)'}" />`).join('')}
      <text x="${pad}" y="12" fill="var(--text-secondary)" font-size="10">${maxV.toFixed(1)}°C</text>
      <text x="${pad}" y="${H - 3}" fill="var(--text-secondary)" font-size="10">${minV.toFixed(1)}°C${coverline ? ` • линия ${coverline.toFixed(2)}°C` : ''}</text>
    </svg>
  `;
}

function renderReports(cs) {
  const p = cs.predictions;
  const completed = cs.cycles.filter((c) => c.length !== null);
  const maxLen = Math.max(35, ...completed.map((c) => c.length));

  const barsHtml = cs.cycles.slice().reverse().map((c) => {
    const w = c.length ? Math.round((c.length / maxLen) * 100) : 50;
    return `
      <div class="bar-row" style="cursor:pointer" data-open-flags="${c.start}">
        <span style="width:94px">${fmtDateShort(c.start)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${w}%;opacity:${c.excluded ? 0.35 : 1}"></div></div>
        <strong style="width:62px;text-align:right">${c.length ? c.length + ' дн.' : 'текущ.'}</strong>
      </div>
      ${c.excluded ? `<div style="margin:-4px 0 6px 96px"><span class="badge">исключён</span></div>` : ''}
    `;
  }).join('') || '<p class="muted">Отметь хотя бы один цикл в календаре.</p>';

  const freq = {}, labelMap = {};
  for (const cat of LOG_CATEGORIES) for (const o of cat.options) labelMap[o.key] = o.label;
  for (const l of Object.values(state.logs)) for (const k of (l.marks || [])) freq[k] = (freq[k] || 0) + 1;
  const topSymptoms = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const notes = Object.entries(state.logs)
    .filter(([, l]) => l.note && l.note.trim() && (!notesQuery || l.note.toLowerCase().includes(notesQuery.toLowerCase())))
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 15);

  return `
    <div class="stat-grid">
      <div class="stat-box"><div class="stat-val">${p ? p.cycleLength + ' дн.' : '—'}</div><div class="stat-lbl">Прогноз цикла</div></div>
      <div class="stat-box"><div class="stat-val">${p ? p.periodLength + ' дн.' : '—'}</div><div class="stat-lbl">Длина месячных</div></div>
      <div class="stat-box"><div class="stat-val">${p ? p.variation + ' дн.' : '—'}</div><div class="stat-lbl">Разброс (6 циклов)</div></div>
      <div class="stat-box"><div class="stat-val">${p?.accuracy ? '±' + p.accuracy.mae.toFixed(1) + ' дн.' : cs.cycles.length}</div><div class="stat-lbl">${p?.accuracy ? 'Точность прогноза' : 'Записано циклов'}</div></div>
    </div>
    <div class="card flat">
      <div class="row" style="margin-bottom:8px">
        <div class="card-title" style="margin:0">История циклов</div>
        <button class="btn btn-primary btn-sm" id="btn-open-doctor-pdf">PDF для врача</button>
      </div>
      <p class="muted" style="margin-top:0">Нажми на цикл, чтобы отметить его как необычный или исключить из прогноза.</p>
      ${barsHtml}
    </div>
    <div class="card flat">
      <div class="card-title">График утренней температуры (БТТ)</div>
      ${buildBbtSvg(cs.allBbt, cs.currentCycle?.bbtShift?.coverline || null)}
    </div>
    <div class="card flat">
      <div class="card-title">Частые симптомы</div>
      ${topSymptoms.length ? `<div class="chips">${topSymptoms.map(([k, cnt]) => `<span class="chip">${escapeHtml(labelMap[k] || k)} · ${cnt}</span>`).join('')}</div>` : '<p class="muted">Отмечай симптомы, чтобы видеть закономерности.</p>'}
    </div>
    <div class="card flat">
      <div class="card-title">Поиск по заметкам</div>
      <input type="search" id="notes-search" class="input" placeholder="Поиск по тексту заметок…" value="${escapeHtml(notesQuery)}" style="margin-bottom:10px" />
      ${notes.length ? notes.map(([d, l]) => `<div style="padding:8px 0;border-bottom:1px solid var(--outline);cursor:pointer" data-open-log="${d}"><strong>${fmtDateShort(d)}</strong><div class="muted">${escapeHtml(l.note)}</div></div>`).join('') : '<p class="muted">Заметок не найдено.</p>'}
    </div>
  `;
}

function renderLibrary() {
  const savedSet = new Set(state.savedArticles || []);
  const filteredArticles = articles.filter((a) => {
    if (articleFilter === 'saved' && !savedSet.has(a.id)) return false;
    if (articleQuery.trim()) {
      const q = articleQuery.toLowerCase();
      return (a.ru?.title || '').toLowerCase().includes(q) || (a.ru?.body || '').toLowerCase().includes(q);
    }
    return true;
  });

  return `
    <div class="row" style="margin-bottom:10px">
      <button class="btn ${librarySub === 'articles' ? 'btn-primary' : 'btn-soft'} btn-full" data-lib-sub="articles">Статьи (${articles.length})</button>
      <button class="btn ${librarySub === 'books' ? 'btn-primary' : 'btn-soft'} btn-full" data-lib-sub="books">Мини-книги (${booksIndex.length})</button>
    </div>
    ${librarySub === 'articles' ? `
      <input type="search" id="art-search" class="input" placeholder="Поиск по статьям…" value="${escapeHtml(articleQuery)}" style="margin-bottom:10px" />
      <div class="row" style="margin-bottom:10px">
        <button class="btn btn-sm ${articleFilter === 'all' ? 'btn-primary' : 'btn-soft'}" data-art-filter="all">Все</button>
        <button class="btn btn-sm ${articleFilter === 'saved' ? 'btn-primary' : 'btn-soft'}" data-art-filter="saved">Сохранённые (${savedSet.size})</button>
      </div>
      ${filteredArticles.map((a) => `
        <div class="card flat" style="cursor:pointer" data-open-article="${escapeHtml(a.id)}">
          <div class="row"><div class="card-title" style="margin:0">${escapeHtml(a.ru?.title || a.id)}</div><span>${savedSet.has(a.id) ? '★' : ''}</span></div>
          <div class="muted" style="margin-top:4px">${escapeHtml((a.ru?.body || '').slice(0, 115))}…</div>
        </div>
      `).join('') || '<p class="muted">Ничего не найдено.</p>'}
    ` : booksIndex.map((b) => {
      const totalCh = (b.chapters || []).length;
      const readCnt = (state.readChapters || []).filter((x) => x.startsWith(b.id + '/')).length;
      return `
        <div class="card flat" style="cursor:pointer" data-open-book="${escapeHtml(b.id)}">
          <div class="card-title">${escapeHtml(b.title)}</div>
          <div class="muted">${escapeHtml(b.summary || '')}</div>
          <div class="muted" style="margin-top:6px"><strong>Прочитано глав: ${readCnt} из ${totalCh}</strong></div>
        </div>
      `;
    }).join('')}
  `;
}

function renderProfile() {
  const pr = state.profile, co = state.contraception, pg = state.pregnancy;
  return `
    <div class="card flat">
      <div class="card-title">Режим работы</div>
      <select id="prof-mode" class="input">
        <option value="TRACK_CYCLE" ${pr.mode === 'TRACK_CYCLE' ? 'selected' : ''}>Отслеживание цикла</option>
        <option value="CONCEIVE" ${pr.mode === 'CONCEIVE' ? 'selected' : ''}>Планирую беременность</option>
        <option value="PREGNANCY" ${pr.mode === 'PREGNANCY' ? 'selected' : ''}>Я беременна</option>
        <option value="CONTRACEPTION" ${pr.mode === 'CONTRACEPTION' ? 'selected' : ''}>Контрацепция</option>
      </select>
      ${pr.mode === 'PREGNANCY' ? `
        <div style="margin-top:10px">
          <label class="muted">Способ расчёта срока:</label>
          <select id="preg-dating" class="input" style="margin-bottom:8px">
            <option value="LMP" ${pg.dating === 'LMP' ? 'selected' : ''}>По первому дню последних месячных (ПДМ)</option>
            <option value="CONCEPTION" ${pg.dating === 'CONCEPTION' ? 'selected' : ''}>По дате зачатия / овуляции</option>
            <option value="IVF_TRANSFER" ${pg.dating === 'IVF_TRANSFER' ? 'selected' : ''}>По дате переноса ЭКО</option>
            <option value="ULTRASOUND" ${pg.dating === 'ULTRASOUND' ? 'selected' : ''}>По УЗИ</option>
          </select>
          ${pg.dating === 'LMP' ? `<label class="muted">Дата ПДМ: <input type="date" id="preg-lmp" class="input" value="${pg.lmp || ''}" /></label><label class="check-item"><input type="checkbox" id="preg-corr" ${pg.cycleLengthCorrection ? 'checked' : ''} /><span>Учитывать длину моего цикла</span></label>` : ''}
          ${pg.dating === 'CONCEPTION' ? `<label class="muted">Дата зачатия: <input type="date" id="preg-conc" class="input" value="${pg.conception || ''}" /></label>` : ''}
          ${pg.dating === 'IVF_TRANSFER' ? `<label class="muted">Дата переноса: <input type="date" id="preg-ivf" class="input" value="${pg.transfer || ''}" /></label><label class="muted">Возраст эмбриона (3 или 5 дн.): <input type="number" id="preg-emb" class="input" value="${pg.embryoAgeDays || 5}" min="1" max="7" /></label>` : ''}
          ${pg.dating === 'ULTRASOUND' ? `<label class="muted">Дата УЗИ: <input type="date" id="preg-us-date" class="input" value="${pg.ultrasoundDate || ''}" /></label><label class="muted">Срок на УЗИ (в днях): <input type="number" id="preg-us-ga" class="input" value="${pg.ultrasoundGaDays || ''}" /></label>` : ''}
        </div>
      ` : ''}
      ${pr.mode === 'CONTRACEPTION' ? `
        <div style="margin-top:10px">
          <label class="muted">Метод:</label>
          <select id="contra-method" class="input" style="margin-bottom:8px">
            ${CONTRACEPTION_METHODS.map((m) => `<option value="${m.id}" ${co.method === m.id ? 'selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}
          </select>
          <label class="muted">Дата начала упаковки / перерыва:</label>
          <input type="date" id="contra-start" class="input" value="${co.startDate || todayIso()}" style="margin-bottom:8px" />
          <div class="col-2">
            <label class="muted">Активных дней<input type="number" id="contra-act" class="input" value="${co.activeDays}" min="0" max="84" /></label>
            <label class="muted">Дней перерыва<input type="number" id="contra-brk" class="input" value="${co.breakDays}" min="0" max="14" /></label>
          </div>
        </div>
      ` : ''}
    </div>
    <div class="card flat">
      <div class="card-title">Анкета и нормы</div>
      <div class="col-2">
        <label class="muted">Обычный цикл (дн.)<input type="number" id="prof-cycle" class="input" value="${pr.typicalCycle}" min="15" max="90" /></label>
        <label class="muted">Месячные (дн.)<input type="number" id="prof-period" class="input" value="${pr.typicalPeriod}" min="1" max="15" /></label>
        <label class="muted">Лютеиновая фаза<input type="number" id="prof-luteal" class="input" value="${pr.typicalLuteal || 14}" min="5" max="20" /></label>
        <label class="muted">Год рождения<input type="number" id="prof-birth" class="input" placeholder="напр. 2000" value="${pr.birthYear || ''}" min="1950" max="2020" /></label>
      </div>
    </div>
    <div class="card flat">
      <div class="card-title">Свои категории трекера</div>
      ${(state.customCategories || []).map((c) => `<div class="row" style="margin-bottom:6px"><span>${escapeHtml(c.name)}</span><button class="btn btn-soft btn-sm" data-del-custom="${escapeHtml(c.id)}">Удалить</button></div>`).join('')}
      <div class="row" style="margin-top:8px">
        <input type="text" id="new-custom-name" class="input" placeholder="Например: Витамины, Кофе…" />
        <button class="btn btn-primary btn-sm" id="btn-add-custom">Добавить</button>
      </div>
    </div>
    <div class="card flat">
      <div class="card-title">Оформление</div>
      <select id="prof-theme" class="input">
        <option value="system" ${pr.theme === 'system' ? 'selected' : ''}>Тема как в системе (iOS)</option>
        <option value="light" ${pr.theme === 'light' ? 'selected' : ''}>Светлая</option>
        <option value="dark" ${pr.theme === 'dark' ? 'selected' : ''}>Тёмная</option>
      </select>
    </div>
    <div class="card flat">
      <div class="card-title">Приватность и резервные копии</div>
      <div class="row" style="flex-wrap:wrap;margin-top:8px">
        <button class="btn btn-soft btn-sm" id="btn-set-pin">${pr.pinHash ? 'Убрать PIN-код' : 'Поставить PIN-код'}</button>
        <button class="btn btn-primary btn-sm" id="btn-export-json">Экспорт JSON</button>
        <label class="btn btn-soft btn-sm">Импорт JSON<input type="file" id="input-import-json" accept="application/json,.json" style="display:none" /></label>
        <button class="btn btn-soft btn-sm" id="btn-export-csv">Экспорт CSV</button>
      </div>
      <div style="margin-top:12px">
        <button class="btn btn-danger btn-sm" id="btn-reset-all">Удалить все данные</button>
      </div>
    </div>
  `;
}

// ---- Exact Screen 2 ("Как это посчитано") ----
function renderHowScreen(cs) {
  const p = cs.predictions;
  if (!p) return '';
  const startLow = addDays(cs.currentCycle.start, p.cycleRange[0]);
  const startHigh = addDays(cs.currentCycle.start, p.cycleRange[1]);
  return `
    <div class="app-shell" style="padding-bottom:24px">
      <header class="topbar">
        <div class="row" style="gap:8px">
          <button class="icon-circle-btn" id="btn-back-how" aria-label="Назад"><svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg></button>
          <h1>Как это посчитано</h1>
        </div>
      </header>
      <main class="main-content">
        <div class="card rose">
          <div style="font-size:12.5px;font-weight:700;color:var(--on-period-container);margin-bottom:4px">Прогноз</div>
          <div style="font-size:20px;font-weight:800;color:var(--on-period-container);line-height:1.25;margin-bottom:10px">
            Следующие месячные — ${fmtDateShort(p.nextPeriodStart)}
          </div>
          <p style="margin:0 0 8px;font-size:13.5px;color:var(--on-period-container)">
            Обычный разброс — между ${fmtDateShort(startLow)} и ${fmtDateShort(startHigh)}: так бывает примерно в 8 циклах из 10.
          </p>
          <p style="margin:0;font-size:13.5px;color:var(--on-period-container)">
            Если месячных не будет и после ${fmtDateShort(startHigh)}, это уже задержка.
          </p>
        </div>

        <div class="card flat">
          <div class="card-title">На чём основан прогноз</div>
          <p style="margin:0 0 8px;font-size:14px">
            Учтено ${p.historyCount} ваших последних циклов. Чем больше циклов и чем они ровнее, тем точнее прогноз.
          </p>
          <p class="muted" style="margin:0">
            Не учитываются: текущий цикл, циклы старше года, время гормональной контрацепции и беременности, первые циклы после родов, циклы, которые вы отметили как нетипичные, и явные выбросы.
          </p>
        </div>

        <div class="card flat">
          <div class="card-title">Ваш цикл</div>
          <p style="margin:0 0 8px;font-size:14px">
            Цикл: обычно ${pluralDays(p.cycleLength)}, чаще всего от ${p.cycleRange[0]} до ${p.cycleRange[1]} дней.
          </p>
          <p style="margin:0 0 8px;font-size:14px">
            Месячные: обычно ${pluralDays(p.periodLength)}, чаще всего от ${p.periodRange[0]} до ${p.periodRange[1]} дней.
          </p>
          <p style="margin:0;font-size:14px">
            Разница между самым коротким и самым длинным из последних циклов — ${pluralDays(p.variation)} (до 7 дней считается регулярным циклом).
          </p>
          ${p.accuracy ? `<p class="muted" style="margin:10px 0 0">Средняя точность последних ${p.accuracy.count} прогнозов: ±${p.accuracy.mae.toFixed(1)} дн.</p>` : ''}
        </div>
      </main>
    </div>
  `;
}

function renderOnboarding() {
  return `
    <div class="app-shell" style="padding:24px 18px;justify-content:center">
      <div class="card flat">
        <h1 style="margin:0 0 8px">Добро пожаловать в Лунию</h1>
        <p class="muted">Офлайн-дневник цикла для iPhone. Без аккаунта и сервера — данные остаются только на устройстве.</p>
        <div style="margin-top:14px">
          <label class="muted">Обычная длина цикла (дней)</label>
          <input type="number" id="ob-cycle" class="input" value="28" min="15" max="90" />
        </div>
        <div style="margin-top:10px">
          <label class="muted">Обычная длина месячных (дней)</label>
          <input type="number" id="ob-period" class="input" value="5" min="1" max="15" />
        </div>
        <div style="margin-top:10px">
          <label class="muted">Когда начались последние месячные? (необязательно)</label>
          <input type="date" id="ob-last" class="input" />
        </div>
        <button class="btn btn-period btn-full" id="ob-start" style="margin-top:18px">Начать</button>
        <label class="btn btn-soft btn-full" style="margin-top:10px">Восстановить из копии JSON<input type="file" id="ob-import-json" accept="application/json,.json" style="display:none" /></label>
      </div>
    </div>
  `;
}

function renderLogModal() {
  if (!logModalDate) return '';
  const log = ensureLog(logModalDate);
  const marksSet = new Set(log.marks);
  const bbtFlagsSet = new Set(log.bbtFlags);
  const inPregnancy = state.profile.mode === 'PREGNANCY';

  return `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal-sheet bg-warm">
        <div class="sheet-handle"></div>
        <div class="modal-header">
          <h2>Запись: ${fmtDateShort(logModalDate)}</h2>
          <button class="btn btn-primary btn-sm" id="btn-close-log">Готово</button>
        </div>

        <div class="card flat">
          <div class="card-title">Месячные</div>
          <div class="chips">
            ${FLOW_OPTIONS.map((f) => `<span class="chip t-period ${log.flow === f.id ? 'active' : ''}" data-set-flow="${f.id}">${escapeHtml(f.label)}</span>`).join('')}
            <span class="chip t-period ${log.clots ? 'active' : ''}" id="chip-clots">Сгустки</span>
          </div>
        </div>

        ${state.profile.mode === 'CONTRACEPTION' ? `
          <div class="card flat">
            <div class="card-title">Контрацепция (таблетка)</div>
            <div class="chips">${PILL_STATUSES.map((ps) => `<span class="chip ${log.pillStatus === ps.id ? 'active' : ''}" data-set-pill="${ps.id}">${escapeHtml(ps.label)}</span>`).join('')}</div>
          </div>
        ` : ''}

        <div class="card flat">
          <div class="row">
            <div class="card-title" style="margin:0">Интимные события и либидо</div>
            <button class="btn btn-soft btn-sm" id="btn-add-sex">+ Событие</button>
          </div>
          <div style="margin-top:8px" class="muted">Либидо (1–5):
            ${[1,2,3,4,5].map((n) => `<span class="chip ${log.libido === n ? 'active' : ''}" data-set-libido="${n}" style="padding:4px 10px">${n}</span>`).join('')}
          </div>
          ${log.sexEvents.map((ev, idx) => `
            <div style="margin-top:10px;padding:10px;border:1px solid var(--outline);border-radius:14px">
              <div class="row" style="margin-bottom:6px"><strong>Событие #${idx + 1}</strong><button class="btn btn-danger btn-sm" data-del-sex="${idx}">Удалить</button></div>
              <div class="col-2" style="margin-bottom:6px">
                <select class="input" data-sex-field="type" data-sex-idx="${idx}">${SEX_TYPES.map((t) => `<option value="${t.id}" ${ev.type === t.id ? 'selected' : ''}>${t.label}</option>`).join('')}</select>
                <select class="input" data-sex-field="protection" data-sex-idx="${idx}">${PROTECTION_TYPES.map((p) => `<option value="${p.id}" ${ev.protection === p.id ? 'selected' : ''}>${p.label}</option>`).join('')}</select>
              </div>
              <div class="chips">
                ${[['orgasm','Оргазм'],['pain','Боль'],['bleedingAfter','Кровь после'],['condomFailure','Порвался презерватив'],['emergencyContraception','Экстр. контрацепция']].map(([k, lbl]) => `<span class="chip ${ev[k] ? 'active' : ''}" data-sex-flag="${k}" data-sex-idx="${idx}">${lbl}</span>`).join('')}
              </div>
            </div>
          `).join('')}
        </div>

        ${!inPregnancy ? `
          <div class="card flat">
            <div class="card-title">Тест на овуляцию (ЛГ)</div>
            <div class="chips">
              ${OTEST_OPTIONS.map((o) => `<span class="chip t-discharge ${log.otest === o.id ? 'active' : ''}" data-set-otest="${o.id}">${escapeHtml(o.label)}</span>`).join('')}
              <span class="chip t-discharge ${log.manualOvulation ? 'active' : ''}" id="chip-manual-ov">Овуляция: свой метод</span>
            </div>
          </div>
        ` : ''}

        <div class="card flat">
          <div class="card-title">Тест на беременность</div>
          <div class="chips">${PTEST_OPTIONS.map((o) => `<span class="chip t-symptom ${log.ptest === o.id ? 'active' : ''}" data-set-ptest="${o.id}">${escapeHtml(o.label)}</span>`).join('')}</div>
        </div>

        ${LOG_CATEGORIES.map((cat) => `
          <div class="card flat">
            <div class="card-title">${escapeHtml(cat.title)}</div>
            <div class="chips">
              ${cat.options.map((opt) => `<span class="chip t-${cat.tint} ${marksSet.has(opt.key) ? 'active' : ''}" data-toggle-mark="${escapeHtml(opt.key)}" data-cat="${cat.id}" data-excl="${opt.exclusive}">${escapeHtml(opt.label)}</span>`).join('')}
            </div>
          </div>
        `).join('')}

        ${!inPregnancy ? `
          <div class="card flat">
            <div class="card-title">Утренняя температура (БТТ)</div>
            <div class="col-2" style="margin-bottom:8px">
              <input type="number" step="0.01" min="35" max="39" id="log-bbt" class="input" placeholder="36.65 °C" value="${log.bbt || ''}" />
              <input type="time" id="log-bbt-time" class="input" value="${log.bbtTime || ''}" />
            </div>
            <div class="muted">Факторы (исключают точку из 3-из-6):</div>
            <div class="chips">${BBT_FLAGS.map((bf) => `<span class="chip ${bbtFlagsSet.has(bf.id) ? 'active' : ''}" data-toggle-bbtflag="${bf.id}">${escapeHtml(bf.label)}</span>`).join('')}</div>
          </div>
        ` : ''}

        <div class="card flat">
          <div class="card-title">Числа и метрики</div>
          <div class="col-2">
            <label class="muted">Вес (кг)<input type="number" step="0.1" id="m-weight" class="input" value="${log.metrics.weight ?? ''}" /></label>
            <label class="muted">Сон (ч)<input type="number" step="0.5" id="m-sleep" class="input" value="${log.metrics.sleep ?? ''}" /></label>
            <label class="muted">Вода (стаканов)<input type="number" id="m-water" class="input" value="${log.metrics.water ?? ''}" /></label>
            <label class="muted">Шаги<input type="number" id="m-steps" class="input" value="${log.metrics.steps ?? ''}" /></label>
          </div>
        </div>

        ${(state.customCategories || []).length ? `
          <div class="card flat">
            <div class="card-title">Свои категории</div>
            ${state.customCategories.map((c) => `<label class="muted" style="display:block;margin-bottom:8px">${escapeHtml(c.name)}<input type="text" class="input" data-custom-val="${escapeHtml(c.id)}" value="${escapeHtml(log.custom[c.id] || '')}" /></label>`).join('')}
          </div>
        ` : ''}

        <div class="card flat">
          <div class="card-title">Заметка</div>
          <textarea id="log-note" placeholder="Заметка за день…">${escapeHtml(log.note || '')}</textarea>
        </div>
      </div>
    </div>
  `;
}

function renderModals(cs) {
  if (logModalDate) return renderLogModal();

  // Exact Screen 4: "Когда был последний день?"
  if (lastDaySheet) {
    const start = lastDaySheet.cycleStart;
    const maxOffset = Math.min(8, Math.max(5, diffDays(start, cs.today)));
    const options = [];
    for (let i = 0; i <= maxOffset; i++) {
      const d = addDays(start, i);
      if (d > cs.today) break;
      options.push({ date: d, dayNum: i + 1 });
    }
    return `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-sheet">
          <div class="sheet-handle"></div>
          <h2 style="margin:0 0 6px;font-size:20px;font-weight:800">Когда был последний день?</h2>
          <p class="muted" style="margin:0">Месячные начались ${fmtDateShort(start)}. Выберите последний день — так прогноз станет точнее.</p>
          <div class="day-pick-grid">
            ${options.map((o) => `
              <button class="day-pick-btn ${lastDaySheet.selectedDate === o.date ? 'selected' : ''}" data-pick-lastday="${o.date}">
                <span class="dp-date">${fmtDateShort(o.date)}</span>
                <span class="dp-sub">${o.dayNum}-й день</span>
              </button>
            `).join('')}
          </div>
          <button class="btn btn-period btn-full" id="btn-save-lastday">Сохранить</button>
          <div style="text-align:center;margin-top:10px">
            <button class="text-link-btn" id="btn-dismiss-lastday">Не помню</button>
          </div>
        </div>
      </div>
    `;
  }

  // Exact Screen 5: "Что изменилось в прогнозе"
  if (diffSheetData) {
    return `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-sheet">
          <div class="sheet-handle"></div>
          <h2 style="margin:0 0 6px;font-size:20px;font-weight:800">Что изменилось в прогнозе</h2>
          <p class="muted" style="margin:0 0 14px">
            ${diffSheetData.prevDate ? `С прошлой проверки (${fmtDateShort(diffSheetData.prevDate)}) прогноз уточнился:` : 'Снимок прогноза сохранён для будущих сравнений.'}
          </p>
          ${diffSheetData.items.length ? diffSheetData.items.map((it) => `
            <div class="diff-block">
              <div class="diff-lbl">${escapeHtml(it.label)}</div>
              <div class="diff-val">${escapeHtml(it.from)} → ${escapeHtml(it.to)}</div>
              ${it.delta ? `<div class="diff-delta">${escapeHtml(it.delta)}</div>` : ''}
            </div>
          `).join('') : '<p style="margin:0 0 12px;font-size:14px">Даты прогноза не изменились.</p>'}
          <p class="muted" style="margin:14px 0 18px">
            Прогноз уточняется после каждой отметки: новые месячные, их длительность, тесты на овуляцию и утренняя температура. Чем больше данных, тем меньше такие сдвиги.
          </p>
          <button class="btn btn-primary btn-full" id="btn-close-modal">Понятно</button>
          <div style="text-align:center;margin-top:10px">
            <button class="text-link-btn" id="btn-diff-to-how">
              <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
              Как это посчитано
            </button>
          </div>
        </div>
      </div>
    `;
  }

  if (tipsModalOpen) {
    return `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-sheet bg-warm">
          <div class="sheet-handle"></div>
          <div class="modal-header"><h2>Советы в дни месячных</h2><button class="btn btn-soft btn-sm" id="btn-close-modal">Закрыть</button></div>
          ${PERIOD_TIPS.map((t) => `<div class="card flat"><div class="card-title">${escapeHtml(t.title)}</div><p style="margin:0;font-size:14px">${escapeHtml(t.body)}</p></div>`).join('')}
        </div>
      </div>
    `;
  }

  if (cycleFlagsModalStart) {
    const flags = new Set(state.cycleFlags[cycleFlagsModalStart] || []);
    return `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-sheet">
          <div class="sheet-handle"></div>
          <div class="modal-header"><h2>Цикл от ${fmtDateShort(cycleFlagsModalStart)}</h2><button class="btn btn-primary btn-sm" id="btn-close-modal">Готово</button></div>
          ${CYCLE_FLAGS.map((cf) => `<label class="check-item"><input type="checkbox" data-toggle-cflag="${cf.id}" ${flags.has(cf.id) ? 'checked' : ''} /><span>${escapeHtml(cf.label)}</span></label>`).join('')}
        </div>
      </div>
    `;
  }

  if (doctorReportOpen) {
    const incInt = Boolean(state.profile.pdfIncludeIntimate);
    const p = cs.predictions;
    return `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-sheet bg-warm">
          <div class="sheet-handle no-print"></div>
          <div class="modal-header no-print"><h2>Отчёт для врача</h2><button class="btn btn-soft btn-sm" id="btn-close-modal">Закрыть</button></div>
          <div class="card flat no-print">
            <label class="check-item"><input type="checkbox" id="chk-pdf-intimate" ${incInt ? 'checked' : ''} /><span>Включить интимные события</span></label>
            <button class="btn btn-primary btn-full" id="btn-print-pdf" style="margin-top:8px">Распечатать / Сохранить PDF</button>
          </div>
          <div class="card flat">
            <h2 style="margin-top:0">Отчёт цикла — Луния</h2>
            <p class="muted">Сформирован: ${cs.today}</p>
            ${p ? `<p>Средний цикл: <strong>${pluralDays(p.cycleLength)}</strong> (разброс ${p.variation} дн.) • Месячные: <strong>${pluralDays(p.periodLength)}</strong></p>` : ''}
            <h3>Циклы (${cs.cycles.length})</h3>
            <ul>${cs.cycles.slice(-12).reverse().map((c) => `<li>${c.start} — ${c.end} (месячные ${c.periodLength} дн.${c.length ? `, цикл ${c.length} дн.` : ', текущий'}${c.confirmedOv ? `, овуляция ${c.confirmedOv}` : ''})</li>`).join('')}</ul>
            ${incInt ? `<h3>Интимные события</h3><ul>${Object.entries(state.logs).filter(([,l])=>l.sexEvents?.length).slice(-20).map(([d,l])=>`<li>${d}: ${l.sexEvents.map(e=>`${e.type}/${e.protection}`).join(', ')}</li>`).join('') || '<li>Нет записей</li>'}</ul>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  if (activeArticle) {
    const saved = (state.savedArticles || []).includes(activeArticle.id);
    return `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-sheet bg-warm">
          <div class="sheet-handle"></div>
          <div class="modal-header">
            <h2>${escapeHtml(activeArticle.ru?.title || '')}</h2>
            <div class="row"><button class="btn btn-soft btn-sm" id="btn-bookmark-art">${saved ? '★' : '☆'}</button><button class="btn btn-soft btn-sm" id="btn-close-modal">Закрыть</button></div>
          </div>
          <div class="card flat">
            <p>${escapeHtml(activeArticle.ru?.body || '')}</p>
            ${activeArticle.source ? `<p class="muted">Источник: ${escapeHtml(activeArticle.source)}</p>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  if (activeBook) {
    const parts = activeBookMd.split(/\n(?=## )/);
    const chapters = parts.slice(1);
    const chIdx = Math.min(activeBookChapter, Math.max(0, chapters.length - 1));
    const chKey = `${activeBook.id}/${chIdx}`;
    const isRead = (state.readChapters || []).includes(chKey);
    return `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-sheet bg-warm">
          <div class="sheet-handle"></div>
          <div class="modal-header"><h2>${escapeHtml(activeBook.title)}</h2><button class="btn btn-soft btn-sm" id="btn-close-modal">Закрыть</button></div>
          ${chapters.length > 1 ? `<div class="chips" style="margin-bottom:10px">${chapters.map((ch, idx) => { const t = ch.split('\n')[0].replace(/^##\s*/, ''); const done = (state.readChapters || []).includes(`${activeBook.id}/${idx}`); return `<span class="chip ${idx === chIdx ? 'active' : ''}" data-book-ch="${idx}">${done ? '✓ ' : ''}${idx + 1}. ${escapeHtml(t.slice(0, 22))}</span>`; }).join('')}</div>` : ''}
          <div class="card flat md-content">${renderMarkdown(chapters[chIdx] || activeBookMd)}</div>
          <button class="btn ${isRead ? 'btn-soft' : 'btn-primary'} btn-full" id="btn-toggle-ch-read" data-ch-key="${chKey}">${isRead ? '✓ Глава прочитана' : 'Отметить главу прочитанной'}</button>
        </div>
      </div>
    `;
  }
  return '';
}

function renderStoryViewer() {
  if (!activeStory) return '';
  const slides = activeStory.slides || [];
  const slide = slides[storySlideIdx] || { title: activeStory.title, body: '' };
  return `
    <div class="story-viewer">
      <div class="story-bars">${slides.map((_, i) => `<div class="story-bar ${i <= storySlideIdx ? 'done' : ''}"></div>`).join('')}</div>
      <div class="row"><span class="muted" style="color:#EBC4DC">${escapeHtml(activeStory.title)}</span><button class="btn btn-soft btn-sm" id="btn-close-story">✕</button></div>
      <div class="story-body"><h2>${escapeHtml(slide.title)}</h2><p>${escapeHtml(slide.body)}</p>${activeStory.source && storySlideIdx + 1 === slides.length ? `<p class="muted" style="color:#B9AAB4;font-size:12px">Источник: ${escapeHtml(activeStory.source)}</p>` : ''}</div>
      <div class="row"><button class="btn btn-soft" id="story-prev">Назад</button><button class="btn btn-period" id="story-next">${storySlideIdx + 1 < slides.length ? 'Дальше' : 'Готово'}</button></div>
    </div>
  `;
}

function renderLockScreen() {
  return `
    <div class="lock-screen">
      <h2>Введите PIN-код</h2>
      ${pinError ? `<div style="color:var(--period);font-size:13px">${pinError}</div>` : ''}
      <div class="pin-dots">${[0,1,2,3].map((i) => `<span class="pin-dot ${i < pinEntry.length ? 'filled' : ''}"></span>`).join('')}</div>
      <div class="pin-pad">${['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k) => k ? `<button class="pin-key" data-pin-key="${k}">${k}</button>` : '<div></div>').join('')}</div>
    </div>
  `;
}

function render() {
  applyTheme();
  const root = document.getElementById('app');
  if (!unlocked) { root.innerHTML = renderLockScreen(); bindLockEvents(); return; }
  if (!state.onboarded) {
    root.innerHTML = renderOnboarding();
    document.getElementById('ob-start').onclick = () => {
      state.profile.typicalCycle = Number(document.getElementById('ob-cycle').value) || 28;
      state.profile.typicalPeriod = Number(document.getElementById('ob-period').value) || 5;
      const last = document.getElementById('ob-last').value;
      if (last) {
        const len = Math.min(7, Math.max(1, state.profile.typicalPeriod));
        for (let i = 0; i < len; i++) {
          const d = addDays(last, i);
          if (d <= todayIso()) ensureLog(d).flow = 'MEDIUM';
        }
      }
      state.onboarded = true; saveState(state); render();
    };
    const obImp = document.getElementById('ob-import-json');
    if (obImp) obImp.onchange = async () => {
      const f = obImp.files?.[0]; if (!f) return;
      try { state = parseBackupJson(await f.text()); saveState(state); showToast('Копия восстановлена'); }
      catch (e) { alert(e.message); }
    };
    return;
  }

  const cs = computeCycleState(state);

  if (howScreenOpen && cs.predictions) {
    root.innerHTML = renderHowScreen(cs);
    document.getElementById('btn-back-how').onclick = () => { howScreenOpen = false; render(); };
    return;
  }

  let topbarHtml = '';
  if (activeTab === 'today') {
    topbarHtml = `
      <header class="topbar">
        <div>
          <div class="topbar-sub">Сегодня</div>
          <h1>${fmtHeaderDate(cs.today)}</h1>
        </div>
        <div class="topbar-actions">
          <button class="icon-circle-btn" id="btn-top-share" title="Поделиться статусом">
            <svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          </button>
          <button class="icon-circle-btn" id="btn-top-library" title="Статьи и мини-книги">
            <svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
          </button>
        </div>
      </header>
    `;
  } else if (activeTab === 'library') {
    topbarHtml = `
      <header class="topbar">
        <div class="row" style="gap:8px">
          <button class="icon-circle-btn" id="btn-back-lib"><svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg></button>
          <h1>Статьи и мини-книги</h1>
        </div>
      </header>
    `;
  } else {
    const titles = { calendar:'Календарь', reports:'Отчёты', profile:'Профиль' };
    topbarHtml = `<header class="topbar"><h1>${titles[activeTab]}</h1><span class="muted">${fmtDateShort(cs.today)}</span></header>`;
  }

  let body = '';
  if (activeTab === 'today') body = renderToday(cs);
  else if (activeTab === 'calendar') body = renderCalendar(cs);
  else if (activeTab === 'reports') body = renderReports(cs);
  else if (activeTab === 'library') body = renderLibrary();
  else body = renderProfile();

  root.innerHTML = `
    <div class="app-shell">
      ${topbarHtml}
      <main class="main-content">${body}</main>
      <nav class="tabbar">
        <button class="tab-btn ${activeTab === 'today' ? 'active' : ''}" data-tab="today">
          <span class="tab-icon-wrap"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></svg></span>
          <span>Сегодня</span>
        </button>
        <button class="tab-btn ${activeTab === 'calendar' ? 'active' : ''}" data-tab="calendar">
          <span class="tab-icon-wrap"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg></span>
          <span>Календарь</span>
        </button>
        <button class="fab-add" id="btn-fab-log" aria-label="Добавить запись">
          <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <button class="tab-btn ${activeTab === 'reports' ? 'active' : ''}" data-tab="reports">
          <span class="tab-icon-wrap"><svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-6M22 20v-9"/></svg></span>
          <span>Отчёты</span>
        </button>
        <button class="tab-btn ${activeTab === 'profile' ? 'active' : ''}" data-tab="profile">
          <span class="tab-icon-wrap"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 14.5-4 16 0"/></svg></span>
          <span>Профиль</span>
        </button>
      </nav>
    </div>
    ${renderModals(cs)}
    ${renderStoryViewer()}
    ${toastMsg ? `<div class="toast">${escapeHtml(toastMsg)}</div>` : ''}
  `;
  bindEvents(cs);
}

function bindLockEvents() {
  document.querySelectorAll('[data-pin-key]').forEach((btn) => {
    btn.onclick = async () => {
      const k = btn.dataset.pinKey;
      if (k === '⌫') pinEntry = pinEntry.slice(0, -1);
      else if (pinEntry.length < 4) pinEntry += k;
      pinError = '';
      if (pinEntry.length === 4) {
        if ((await hashPin(pinEntry)) === state.profile.pinHash) { unlocked = true; pinEntry = ''; }
        else { pinError = 'Неверный PIN-код'; pinEntry = ''; }
      }
      render();
    };
  });
}

function closeAllModals() {
  logModalDate = null; tipsModalOpen = false; diffSheetData = null; lastDaySheet = null;
  cycleFlagsModalStart = null; doctorReportOpen = false; activeArticle = null; activeBook = null;
  render();
}

function bindEvents(cs) {
  document.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { activeTab = b.dataset.tab; calEditMode = false; render(); });
  document.querySelectorAll('[data-open-log]').forEach((el) => el.onclick = () => { logModalDate = el.dataset.openLog; render(); });

  const fab = document.getElementById('btn-fab-log');
  if (fab) fab.onclick = () => { logModalDate = cs.today; render(); };

  const bLibTop = document.getElementById('btn-top-library');
  if (bLibTop) bLibTop.onclick = () => { activeTab = 'library'; render(); };
  const bLibCard = document.getElementById('btn-open-library-card');
  if (bLibCard) bLibCard.onclick = () => { activeTab = 'library'; render(); };
  const bBackLib = document.getElementById('btn-back-lib');
  if (bBackLib) bBackLib.onclick = () => { activeTab = 'today'; render(); };

  const bShare = document.getElementById('btn-top-share');
  if (bShare) bShare.onclick = async () => {
    const p = cs.predictions;
    const text = p
      ? `Луния • ${cs.cycleDay}-й день цикла (${PHASE_NAMES[cs.currentPhase]}). Следующие месячные — ${fmtDateShort(p.nextPeriodStart)}.`
      : `Луния • ${fmtHeaderDate(cs.today)}`;
    try { await navigator.clipboard.writeText(text); showToast('Статус скопирован'); }
    catch { alert(text); }
  };

  const btp = document.getElementById('btn-toggle-period-today');
  if (btp) btp.onclick = () => {
    const l = ensureLog(cs.today);
    l.flow = (l.flow && l.flow !== 'SPOTTING') ? null : 'MEDIUM';
    saveState(state); render();
  };

  // Screen 5: "Обновить прогноз" -> "Что изменилось в прогнозе"
  const bRef = document.getElementById('btn-refresh-forecast');
  if (bRef && cs.predictions) bRef.onclick = () => {
    const prev = state.forecastSnapshot;
    const curr = cs.predictions;
    const items = [];
    if (prev) {
      if (prev.nextPeriodStart && curr.nextPeriodStart && prev.nextPeriodStart !== curr.nextPeriodStart) {
        const d = diffDays(prev.nextPeriodStart, curr.nextPeriodStart);
        items.push({
          label: 'Следующие месячные',
          from: fmtDateShort(prev.nextPeriodStart),
          to: fmtDateShort(curr.nextPeriodStart),
          delta: d > 0 ? `на ${pluralDays(d)} позже` : `на ${pluralDays(Math.abs(d))} раньше`,
        });
      }
      if (prev.cycleLength && curr.cycleLength && prev.cycleLength !== curr.cycleLength) {
        items.push({
          label: 'Длина цикла',
          from: pluralDays(prev.cycleLength),
          to: pluralDays(curr.cycleLength),
          delta: '',
        });
      }
      if (prev.ovulationDate && curr.ovulationDate && prev.ovulationDate !== curr.ovulationDate) {
        const d = diffDays(prev.ovulationDate, curr.ovulationDate);
        items.push({
          label: 'Овуляция',
          from: fmtDateShort(prev.ovulationDate),
          to: fmtDateShort(curr.ovulationDate),
          delta: d > 0 ? `на ${pluralDays(d)} позже` : `на ${pluralDays(Math.abs(d))} раньше`,
        });
      }
    }
    diffSheetData = { prevDate: prev?.takenOn || null, items };
    state.forecastSnapshot = {
      takenOn: cs.today, nextPeriodStart: curr.nextPeriodStart,
      ovulationDate: curr.ovulationDate, cycleLength: curr.cycleLength,
    };
    saveState(state);
    render();
  };

  const bHow = document.getElementById('btn-open-how');
  if (bHow) bHow.onclick = () => { howScreenOpen = true; render(); };
  const bDiffHow = document.getElementById('btn-diff-to-how');
  if (bDiffHow) bDiffHow.onclick = () => { diffSheetData = null; howScreenOpen = true; render(); };

  const bTips = document.getElementById('btn-open-tips');
  if (bTips) bTips.onclick = () => { tipsModalOpen = true; render(); };

  // Questions & Screen 4 ("Когда был последний день?")
  document.querySelectorAll('[data-q-still-yes]').forEach((b) => b.onclick = () => {
    const start = b.dataset.qStillYes;
    const days = diffDays(start, cs.today);
    for (let i = 0; i <= Math.min(days, 12); i++) {
      const l = ensureLog(addDays(start, i));
      if (!l.flow || l.flow === 'SPOTTING') l.flow = 'MEDIUM';
    }
    saveState(state); showToast('Дни месячных продлены до сегодня');
  });
  document.querySelectorAll('[data-open-lastday]').forEach((b) => b.onclick = () => {
    const start = b.dataset.openLastday;
    const cyc = cs.cycles.find((c) => c.start === start);
    lastDaySheet = { cycleStart: start, selectedDate: cyc?.end || start };
    render();
  });
  document.querySelectorAll('[data-pick-lastday]').forEach((b) => b.onclick = () => {
    if (lastDaySheet) { lastDaySheet.selectedDate = b.dataset.pickLastday; render(); }
  });
  const bSaveLast = document.getElementById('btn-save-lastday');
  if (bSaveLast && lastDaySheet) bSaveLast.onclick = () => {
    const start = lastDaySheet.cycleStart;
    const end = lastDaySheet.selectedDate;
    const total = diffDays(start, end);
    for (let i = 0; i <= total; i++) {
      const l = ensureLog(addDays(start, i));
      if (!l.flow || l.flow === 'SPOTTING') l.flow = 'MEDIUM';
    }
    // Clear any logged bleeding days right after selected end (within 5 days)
    for (let i = 1; i <= 5; i++) {
      const d = addDays(end, i);
      if (state.logs[d]?.flow && state.logs[d].flow !== 'SPOTTING') state.logs[d].flow = null;
    }
    state.periodEndedDates[start] = true;
    lastDaySheet = null;
    saveState(state);
    showToast('Последний день сохранён');
  };
  const bDisLast = document.getElementById('btn-dismiss-lastday');
  if (bDisLast && lastDaySheet) bDisLast.onclick = () => {
    state.dismissedPeriodEnd[lastDaySheet.cycleStart] = true;
    lastDaySheet = null;
    saveState(state); render();
  };

  document.querySelectorAll('[data-dec-ep]').forEach((b) => b.onclick = () => {
    state.periodDecisions[b.dataset.decEp] = b.dataset.decVal;
    saveState(state); showToast('Сохранено');
  });

  document.querySelectorAll('[data-quick-pill]').forEach((el) => el.onclick = () => {
    const l = ensureLog(cs.today);
    l.pillStatus = l.pillStatus === el.dataset.quickPill ? null : el.dataset.quickPill;
    saveState(state); render();
  });
  document.querySelectorAll('[data-preg-check]').forEach((chk) => chk.onchange = () => {
    if (!state.pregnancy.checklist) state.pregnancy.checklist = {};
    state.pregnancy.checklist[chk.dataset.pregCheck] = chk.checked;
    saveState(state);
  });

  // Calendar
  const cp = document.getElementById('cal-prev');
  if (cp) cp.onclick = () => { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } render(); };
  const cn = document.getElementById('cal-next');
  if (cn) cn.onclick = () => { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } render(); };
  const bce = document.getElementById('btn-cal-edit-start');
  if (bce) bce.onclick = () => {
    calEditDraft = new Set(Object.entries(state.logs).filter(([,l]) => l.flow && l.flow !== 'SPOTTING').map(([d]) => d));
    calEditMode = true; render();
  };
  const bcc = document.getElementById('btn-cal-edit-cancel');
  if (bcc) bcc.onclick = () => { calEditMode = false; render(); };
  const bcs = document.getElementById('btn-cal-edit-save');
  if (bcs) bcs.onclick = () => {
    for (const [d, l] of Object.entries(state.logs)) if (l.flow && l.flow !== 'SPOTTING' && !calEditDraft.has(d)) l.flow = null;
    for (const d of calEditDraft) { const l = ensureLog(d); if (!l.flow || l.flow === 'SPOTTING') l.flow = 'MEDIUM'; }
    calEditMode = false; saveState(state); showToast('Месячные обновлены');
  };
  document.querySelectorAll('[data-cal-toggle]').forEach((el) => el.onclick = () => {
    const d = el.dataset.calToggle;
    if (calEditDraft.has(d)) calEditDraft.delete(d); else calEditDraft.add(d);
    render();
  });

  // Reports
  document.querySelectorAll('[data-open-flags]').forEach((el) => el.onclick = () => { cycleFlagsModalStart = el.dataset.openFlags; render(); });
  const ns = document.getElementById('notes-search');
  if (ns) ns.oninput = () => { notesQuery = ns.value; render(); };
  const bPdf = document.getElementById('btn-open-doctor-pdf');
  if (bPdf) bPdf.onclick = () => { doctorReportOpen = true; render(); };

  // Stories
  document.querySelectorAll('[data-open-story]').forEach((el) => el.onclick = () => {
    activeStory = stories.find((s) => s.id === el.dataset.openStory) || null;
    storySlideIdx = 0;
    if (activeStory && !state.viewedStories.includes(activeStory.id)) {
      state.viewedStories.push(activeStory.id); saveState(state);
    }
    render();
  });
  const bcsSt = document.getElementById('btn-close-story');
  if (bcsSt) bcsSt.onclick = () => { activeStory = null; render(); };
  const sp = document.getElementById('story-prev');
  if (sp) sp.onclick = () => { if (storySlideIdx > 0) { storySlideIdx--; render(); } };
  const sn = document.getElementById('story-next');
  if (sn) sn.onclick = () => {
    if (activeStory && storySlideIdx + 1 < activeStory.slides.length) { storySlideIdx++; render(); }
    else { activeStory = null; render(); }
  };

  // Library
  document.querySelectorAll('[data-lib-sub]').forEach((b) => b.onclick = () => { librarySub = b.dataset.libSub; render(); });
  document.querySelectorAll('[data-art-filter]').forEach((b) => b.onclick = () => { articleFilter = b.dataset.artFilter; render(); });
  const as = document.getElementById('art-search');
  if (as) as.oninput = () => { articleQuery = as.value; render(); };
  document.querySelectorAll('[data-open-article]').forEach((el) => el.onclick = () => {
    activeArticle = articles.find((a) => a.id === el.dataset.openArticle) || null; render();
  });
  document.querySelectorAll('[data-open-book]').forEach((el) => el.onclick = async () => {
    const b = booksIndex.find((x) => x.id === el.dataset.openBook);
    if (!b) return;
    activeBook = b; activeBookChapter = 0; activeBookMd = 'Загрузка…'; render();
    try { activeBookMd = await (await fetch(b.file)).text(); } catch { activeBookMd = 'Ошибка загрузки книги.'; }
    render();
  });

  // Modal close
  const bd = document.getElementById('modal-backdrop');
  if (bd) bd.onclick = (e) => { if (e.target === bd) closeAllModals(); };
  const bcm = document.getElementById('btn-close-modal') || document.getElementById('btn-close-log');
  if (bcm) bcm.onclick = closeAllModals;

  if (cycleFlagsModalStart) {
    document.querySelectorAll('[data-toggle-cflag]').forEach((chk) => chk.onchange = () => {
      const set = new Set(state.cycleFlags[cycleFlagsModalStart] || []);
      if (chk.checked) set.add(chk.dataset.toggleCflag); else set.delete(chk.dataset.toggleCflag);
      state.cycleFlags[cycleFlagsModalStart] = [...set]; saveState(state);
    });
  }
  const chkInt = document.getElementById('chk-pdf-intimate');
  if (chkInt) chkInt.onchange = () => { state.profile.pdfIncludeIntimate = chkInt.checked; saveState(state); render(); };
  const btnPr = document.getElementById('btn-print-pdf');
  if (btnPr) btnPr.onclick = () => window.print();

  const bBm = document.getElementById('btn-bookmark-art');
  if (bBm && activeArticle) bBm.onclick = () => {
    const set = new Set(state.savedArticles || []);
    if (set.has(activeArticle.id)) set.delete(activeArticle.id); else set.add(activeArticle.id);
    state.savedArticles = [...set]; saveState(state); render();
  };
  document.querySelectorAll('[data-book-ch]').forEach((c) => c.onclick = () => { activeBookChapter = Number(c.dataset.bookCh); render(); });
  const bChR = document.getElementById('btn-toggle-ch-read');
  if (bChR) bChR.onclick = () => {
    const k = bChR.dataset.chKey, set = new Set(state.readChapters || []);
    if (set.has(k)) set.delete(k); else set.add(k);
    state.readChapters = [...set]; saveState(state); render();
  };

  // Log sheet bindings
  if (logModalDate) {
    const log = ensureLog(logModalDate);
    document.querySelectorAll('[data-set-flow]').forEach((c) => c.onclick = () => { log.flow = log.flow === c.dataset.setFlow ? null : c.dataset.setFlow; saveState(state); render(); });
    const cc = document.getElementById('chip-clots'); if (cc) cc.onclick = () => { log.clots = !log.clots; saveState(state); render(); };
    document.querySelectorAll('[data-set-pill]').forEach((c) => c.onclick = () => { log.pillStatus = log.pillStatus === c.dataset.setPill ? null : c.dataset.setPill; saveState(state); render(); });
    document.querySelectorAll('[data-set-libido]').forEach((c) => c.onclick = () => { const n = Number(c.dataset.setLibido); log.libido = log.libido === n ? null : n; saveState(state); render(); });
    const bAs = document.getElementById('btn-add-sex');
    if (bAs) bAs.onclick = () => { log.sexEvents.push({ type:'VAGINAL', protection:'MALE_CONDOM', orgasm:false, pain:false, bleedingAfter:false, condomFailure:false, emergencyContraception:false }); saveState(state); render(); };
    document.querySelectorAll('[data-del-sex]').forEach((b) => b.onclick = () => { log.sexEvents.splice(Number(b.dataset.delSex), 1); saveState(state); render(); });
    document.querySelectorAll('[data-sex-field]').forEach((sel) => sel.onchange = () => { log.sexEvents[Number(sel.dataset.sexIdx)][sel.dataset.sexField] = sel.value; saveState(state); });
    document.querySelectorAll('[data-sex-flag]').forEach((c) => c.onclick = () => { const ev = log.sexEvents[Number(c.dataset.sexIdx)]; ev[c.dataset.sexFlag] = !ev[c.dataset.sexFlag]; saveState(state); render(); });
    document.querySelectorAll('[data-set-otest]').forEach((c) => c.onclick = () => { log.otest = log.otest === c.dataset.setOtest ? null : c.dataset.setOtest; saveState(state); render(); });
    const cmo = document.getElementById('chip-manual-ov'); if (cmo) cmo.onclick = () => { log.manualOvulation = log.manualOvulation ? null : 'Свой метод'; saveState(state); render(); };
    document.querySelectorAll('[data-set-ptest]').forEach((c) => c.onclick = () => { log.ptest = log.ptest === c.dataset.setPtest ? null : c.dataset.setPtest; saveState(state); render(); });
    document.querySelectorAll('[data-toggle-mark]').forEach((c) => c.onclick = () => {
      const key = c.dataset.toggleMark, prefix = c.dataset.cat + '.', excl = c.dataset.excl === 'true';
      const set = new Set(log.marks);
      if (set.has(key)) set.delete(key);
      else {
        if (excl) { for (const x of [...set]) if (x.startsWith(prefix)) set.delete(x); }
        else { LOG_CATEGORIES.find((x) => x.id === c.dataset.cat)?.options.filter((o) => o.exclusive).forEach((o) => set.delete(o.key)); }
        set.add(key);
      }
      log.marks = [...set]; saveState(state); render();
    });
    const bbtEl = document.getElementById('log-bbt'); if (bbtEl) bbtEl.oninput = () => { log.bbt = bbtEl.value; saveState(state); };
    const bbtT = document.getElementById('log-bbt-time'); if (bbtT) bbtT.oninput = () => { log.bbtTime = bbtT.value; saveState(state); };
    document.querySelectorAll('[data-toggle-bbtflag]').forEach((c) => c.onclick = () => {
      const set = new Set(log.bbtFlags);
      if (set.has(c.dataset.toggleBbtflag)) set.delete(c.dataset.toggleBbtflag); else set.add(c.dataset.toggleBbtflag);
      log.bbtFlags = [...set]; saveState(state); render();
    });
    for (const [id, k] of [['m-weight','weight'],['m-sleep','sleep'],['m-water','water'],['m-steps','steps']]) {
      const el = document.getElementById(id); if (el) el.oninput = () => { log.metrics[k] = el.value === '' ? '' : Number(el.value); saveState(state); };
    }
    document.querySelectorAll('[data-custom-val]').forEach((inp) => inp.oninput = () => { log.custom[inp.dataset.customVal] = inp.value; saveState(state); });
    const noteEl = document.getElementById('log-note'); if (noteEl) noteEl.oninput = () => { log.note = noteEl.value; saveState(state); };
  }

  // Profile bindings
  const pm = document.getElementById('prof-mode'); if (pm) pm.onchange = () => { state.profile.mode = pm.value; saveState(state); render(); };
  const pd = document.getElementById('preg-dating'); if (pd) pd.onchange = () => { state.pregnancy.dating = pd.value; saveState(state); render(); };
  const plmp = document.getElementById('preg-lmp'); if (plmp) plmp.onchange = () => { state.pregnancy.lmp = plmp.value; saveState(state); };
  const pcorr = document.getElementById('preg-corr'); if (pcorr) pcorr.onchange = () => { state.pregnancy.cycleLengthCorrection = pcorr.checked; saveState(state); };
  const pconc = document.getElementById('preg-conc'); if (pconc) pconc.onchange = () => { state.pregnancy.conception = pconc.value; saveState(state); };
  const pivf = document.getElementById('preg-ivf'); if (pivf) pivf.onchange = () => { state.pregnancy.transfer = pivf.value; saveState(state); };
  const pemb = document.getElementById('preg-emb'); if (pemb) pemb.onchange = () => { state.pregnancy.embryoAgeDays = Number(pemb.value) || 5; saveState(state); };
  const pusd = document.getElementById('preg-us-date'); if (pusd) pusd.onchange = () => { state.pregnancy.ultrasoundDate = pusd.value; saveState(state); };
  const pusg = document.getElementById('preg-us-ga'); if (pusg) pusg.onchange = () => { state.pregnancy.ultrasoundGaDays = Number(pusg.value) || null; saveState(state); };
  const cm = document.getElementById('contra-method');
  if (cm) cm.onchange = () => {
    const m = CONTRACEPTION_METHODS.find((x) => x.id === cm.value);
    state.contraception.method = cm.value;
    if (m) { state.contraception.activeDays = m.activeDays; state.contraception.breakDays = m.breakDays; }
    saveState(state); render();
  };
  const cst = document.getElementById('contra-start'); if (cst) cst.onchange = () => { state.contraception.startDate = cst.value; saveState(state); };
  const cact = document.getElementById('contra-act'); if (cact) cact.onchange = () => { state.contraception.activeDays = Number(cact.value) || 0; saveState(state); };
  const cbrk = document.getElementById('contra-brk'); if (cbrk) cbrk.onchange = () => { state.contraception.breakDays = Number(cbrk.value) || 0; saveState(state); };
  const pc = document.getElementById('prof-cycle'); if (pc) pc.onchange = () => { state.profile.typicalCycle = Number(pc.value) || 28; saveState(state); };
  const pp = document.getElementById('prof-period'); if (pp) pp.onchange = () => { state.profile.typicalPeriod = Number(pp.value) || 5; saveState(state); };
  const pl = document.getElementById('prof-luteal'); if (pl) pl.onchange = () => { state.profile.typicalLuteal = Number(pl.value) || 14; saveState(state); };
  const pb = document.getElementById('prof-birth'); if (pb) pb.onchange = () => { state.profile.birthYear = pb.value ? Number(pb.value) : null; saveState(state); };
  const pt = document.getElementById('prof-theme'); if (pt) pt.onchange = () => { state.profile.theme = pt.value; saveState(state); render(); };
  const bac = document.getElementById('btn-add-custom');
  if (bac) bac.onclick = () => { const inp = document.getElementById('new-custom-name'); const name = inp?.value.trim(); if (!name) return; state.customCategories.push({ id: 'c_' + Date.now(), name }); saveState(state); render(); };
  document.querySelectorAll('[data-del-custom]').forEach((b) => b.onclick = () => { state.customCategories = state.customCategories.filter((c) => c.id !== b.dataset.delCustom); saveState(state); render(); });
  const bp = document.getElementById('btn-set-pin');
  if (bp) bp.onclick = async () => {
    if (state.profile.pinHash) { state.profile.pinHash = null; saveState(state); render(); }
    else { const p = prompt('Задайте 4-значный PIN-код:'); if (p && /^\d{4}$/.test(p)) { state.profile.pinHash = await hashPin(p); saveState(state); render(); } }
  };
  const bej = document.getElementById('btn-export-json');
  if (bej) bej.onclick = () => { const blob = new Blob([exportBackupJson(state)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `lunia-backup-${todayIso()}.json`; a.click(); URL.revokeObjectURL(url); };
  const bec = document.getElementById('btn-export-csv');
  if (bec) bec.onclick = () => { const blob = new Blob([exportCsv(state)], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `lunia-export-${todayIso()}.csv`; a.click(); URL.revokeObjectURL(url); };
  const iij = document.getElementById('input-import-json');
  if (iij) iij.onchange = async () => { const f = iij.files?.[0]; if (!f) return; try { state = parseBackupJson(await f.text()); saveState(state); showToast('Резервная копия восстановлена'); } catch (e) { alert(e.message); } };
  const bra = document.getElementById('btn-reset-all');
  if (bra) bra.onclick = () => { if (confirm('Удалить все записи и настройки Лунии?')) { state = defaultState(); saveState(state); render(); } };
}

async function boot() {
  try {
    const [aRes, sRes, bRes] = await Promise.all([
      fetch('assets/articles.json'), fetch('assets/stories.json'), fetch('assets/books/index.json'),
    ]);
    articles = await aRes.json();
    stories = await sRes.json();
    booksIndex = await bRes.json();
  } catch {}
  render();
}
boot();
