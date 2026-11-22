import {
  computeCycleState, todayIso, addDays, diffDays, parseDate,
} from './engine.js';
import { LOG_CATEGORIES, FLOW_OPTIONS } from './catalog.js';
import {
  loadState, saveState, hashPin, exportBackupJson, parseBackupJson, defaultState,
} from './storage.js';

const MONTHS_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];
const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];
const WEEKDAYS_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const PHASE_NAMES = {
  MENSTRUAL: 'Месячные',
  FOLLICULAR: 'Фолликулярная фаза',
  FERTILE: 'Фертильное окно',
  OVULATION: 'День овуляции',
  LUTEAL: 'Лютеиновая фаза',
  DELAY: 'Задержка',
  UNKNOWN: 'Нет данных',
};

let state = loadState();
let activeTab = 'today';
let calDate = new Date();
let calYear = calDate.getFullYear();
let calMonth = calDate.getMonth();
let logModalDate = null;
let howModalOpen = false;
let activeStory = null;
let storySlideIdx = 0;
let activeArticle = null;
let activeBook = null;
let activeBookMd = '';
let articles = [];
let stories = [];
let booksIndex = [];
let librarySub = 'articles';
let unlocked = !state.profile.pinHash;
let pinEntry = '';
let pinError = '';

function fmtDateShort(iso) {
  if (!iso) return '—';
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS_GEN[m - 1]}`;
}

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function renderMarkdown(md) {
  const lines = md.split('\n');
  let html = '';
  let inList = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith('### ')) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h3>${escapeHtml(line.slice(4))}</h3>`;
    } else if (line.startsWith('## ')) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h2>${escapeHtml(line.slice(3))}</h2>`;
    } else if (line.startsWith('# ')) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h1>${escapeHtml(line.slice(2))}</h1>`;
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${escapeHtml(line.slice(2)).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</li>`;
    } else if (line.trim() === '') {
      if (inList) { html += '</ul>'; inList = false; }
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<p>${escapeHtml(line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</p>`;
    }
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
  for (const pp of cs.predictedPeriods) {
    if (iso >= pp.start && iso <= pp.end) return 'predicted';
  }
  for (const pw of cs.predictedWindows) {
    if (iso === pw.ovulation) return 'ovulation';
    if (iso >= pw.start && iso <= pw.end) return 'fertile';
  }
  return '';
}

function hasAnyLog(iso) {
  const l = state.logs[iso];
  if (!l) return false;
  return Boolean(l.flow || (l.marks && l.marks.length) || (l.note && l.note.trim()) || l.bbt || l.otest || l.ptest);
}

function buildRingSvg(cs) {
  const r = 104;
  const cx = 124;
  const cy = 124;
  const C = 2 * Math.PI * r;

  let centerMain = 'Отметь цикл';
  let centerSub = 'Нажми кнопку ниже';
  let accent = 'var(--brand)';
  let progress = 0;

  if (cs.pregnancy) {
    centerMain = `${cs.pregnancy.weeks} нед. ${cs.pregnancy.remDays} дн.`;
    centerSub = `ПДР: ${fmtDateShort(cs.pregnancy.edd)} • ${cs.pregnancy.trimester} триместр`;
    accent = 'var(--luteal)';
    progress = Math.min(1, cs.pregnancy.gestDays / 280);
  } else if (cs.predictions) {
    const p = cs.predictions;
    progress = Math.min(1, Math.max(0, (cs.cycleDay - 1) / Math.max(1, p.cycleLength)));
    if (cs.currentPhase === 'MENSTRUAL') {
      centerMain = `День ${cs.cycleDay}`;
      centerSub = 'Идут месячные';
      accent = 'var(--period)';
    } else if (cs.currentPhase === 'DELAY') {
      centerMain = `Задержка ${cs.delayDays} дн.`;
      centerSub = `Ожидались ${fmtDateShort(p.nextPeriodStart)}`;
      accent = 'var(--delay)';
      progress = 1;
    } else if (cs.currentPhase === 'OVULATION') {
      centerMain = 'Овуляция';
      centerSub = `День цикла ${cs.cycleDay} • Месячные ${fmtDateShort(p.nextPeriodStart)}`;
      accent = 'var(--ovulation)';
    } else if (cs.currentPhase === 'FERTILE') {
      centerMain = 'Фертильные дни';
      centerSub = `Овуляция ~${fmtDateShort(p.ovulationDate)}`;
      accent = 'var(--ovulation)';
    } else {
      centerMain = cs.daysUntilNextPeriod === 0
        ? 'Ожидаются сегодня'
        : `Через ${cs.daysUntilNextPeriod} дн.`;
      centerSub = `${PHASE_NAMES[cs.currentPhase]} • ${fmtDateShort(p.nextPeriodStart)}`;
      accent = cs.currentPhase === 'LUTEAL' ? 'var(--luteal)' : 'var(--brand)';
    }
  }

  const dash = (progress * C).toFixed(1);
  return `
    <svg class="ring-svg" viewBox="0 0 248 248" aria-label="Кольцо цикла">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--track)" stroke-width="18"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${accent}" stroke-width="18"
        stroke-linecap="round" stroke-dasharray="${dash} ${C.toFixed(1)}"
        transform="rotate(-90 ${cx} ${cy})"/>
      <text x="${cx}" y="${cy - 8}" text-anchor="middle" fill="var(--text)" font-size="22" font-weight="800">${escapeHtml(centerMain)}</text>
      <text x="${cx}" y="${cy + 18}" text-anchor="middle" fill="var(--text-secondary)" font-size="12.5" font-weight="600">${escapeHtml(centerSub)}</text>
    </svg>
  `;
}

function renderToday(cs) {
  const today = cs.today;
  const weekDays = [];
  for (let i = -3; i <= 3; i++) {
    const iso = addDays(today, i);
    const dt = new Date(parseDate(iso));
    const wd = WEEKDAYS_RU[(dt.getUTCDay() + 6) % 7];
    const num = dt.getUTCDate();
    const st = getDayStatus(iso, cs);
    const cls = st === 'period' ? 'wd-period'
      : st === 'predicted' ? 'wd-predicted'
      : st === 'ovulation' ? 'wd-ovulation'
      : st === 'fertile' ? 'wd-fertile' : '';
    weekDays.push(`
      <button class="week-day ${iso === today ? 'today' : ''} ${cls}" data-open-log="${iso}">
        <span class="wd-name">${wd}</span>
        <span class="wd-num">${num}</span>
        ${hasAnyLog(iso) ? '<span class="wd-dot"></span>' : ''}
      </button>
    `);
  }

  const todayFlow = state.logs[today]?.flow;
  const isPeriodToday = todayFlow && todayFlow !== 'SPOTTING';

  const sortedStories = [...stories].sort((a, b) => {
    const aMatch = (a.phases || []).includes(cs.currentPhase) ? 0 : 1;
    const bMatch = (b.phases || []).includes(cs.currentPhase) ? 0 : 1;
    return aMatch - bMatch;
  }).slice(0, 12);

  const storiesHtml = sortedStories.length ? `
    <div class="stories-row">
      ${sortedStories.map((st) => {
        const unread = !state.viewedStories.includes(st.id);
        const col = st.color || 'neutral';
        return `
          <div class="story-card c-${escapeHtml(col)} ${unread ? 'unread' : ''}" data-open-story="${escapeHtml(st.id)}">
            <span class="st-badge">${escapeHtml(st.label || 'История')}</span>
            <span class="st-title">${escapeHtml(st.title)}</span>
          </div>
        `;
      }).join('')}
    </div>
  ` : '';

  return `
    <div class="week-strip">${weekDays.join('')}</div>
    <div class="card ring-wrap">
      ${buildRingSvg(cs)}
      <div class="ring-actions">
        ${!cs.pregnancy ? `
          <button class="btn ${isPeriodToday ? 'btn-soft' : 'btn-period'}" id="btn-toggle-period-today">
            ${isPeriodToday ? 'Убрать отметку месячных' : 'Отметить месячные'}
          </button>
        ` : ''}
        <button class="btn btn-soft" data-open-log="${today}">+ Симптомы</button>
        ${cs.predictions ? `<button class="btn btn-soft btn-sm" id="btn-open-how">Как посчитано</button>` : ''}
      </div>
    </div>
    ${storiesHtml}
    ${cs.predictions ? `
      <div class="card">
        <div class="card-title">Прогноз цикла</div>
        <div class="muted">
          Следующие месячные: <strong>${fmtDateShort(cs.predictions.nextPeriodStart)} — ${fmtDateShort(cs.predictions.nextPeriodEnd)}</strong><br/>
          Длина цикла: <strong>${cs.predictions.cycleLength} дн.</strong> (обычно ${cs.predictions.cycleRange[0]}–${cs.predictions.cycleRange[1]} дн.)<br/>
          ${cs.predictions.ovulationVisible ? `Овуляция: <strong>~${fmtDateShort(cs.predictions.ovulationDate)}</strong> • Окно: ${fmtDateShort(cs.predictions.fertileStart)} — ${fmtDateShort(cs.predictions.fertileEnd)}` : 'Овуляция скрыта в текущем режиме'}
        </div>
      </div>
    ` : ''}
    <div class="muted" style="text-align:center; padding:6px 8px;">
      Прогнозы — ориентир, а не диагноз и не метод контрацепции. Все данные хранятся только на этом iPhone.
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
    const st = getDayStatus(iso, cs);
    const isToday = iso === cs.today;
    cells.push(`
      <div class="cal-cell ${st} ${isToday ? 'today' : ''}" data-open-log="${iso}">
        <span>${d}</span>
        ${hasAnyLog(iso) ? '<span class="has-log"></span>' : ''}
      </div>
    `);
  }
  return `
    <div class="card">
      <div class="cal-header">
        <button class="btn btn-soft btn-sm" id="cal-prev">←</button>
        <strong>${MONTHS_RU[calMonth]} ${calYear}</strong>
        <button class="btn btn-soft btn-sm" id="cal-next">→</button>
      </div>
      <div class="cal-grid">
        ${WEEKDAYS_RU.map((w) => `<div class="cal-wd">${w}</div>`).join('')}
        ${cells.join('')}
      </div>
      <div class="cal-legend">
        <span class="legend-item"><i class="legend-dot" style="background:var(--period)"></i>Месячные</span>
        <span class="legend-item"><i class="legend-dot" style="border:1.5px dashed var(--period)"></i>Прогноз</span>
        <span class="legend-item"><i class="legend-dot" style="background:var(--fertile)"></i>Фертильные</span>
        <span class="legend-item"><i class="legend-dot" style="background:var(--ovulation)"></i>Овуляция</span>
      </div>
    </div>
    <p class="muted" style="text-align:center">Нажми на любой день, чтобы отметить месячные, симптомы или заметку.</p>
  `;
}

function renderReports(cs) {
  const p = cs.predictions;
  const completed = cs.cycles.filter((c) => c.length !== null);
  const maxLen = Math.max(35, ...completed.map((c) => c.length));

  const barsHtml = cs.cycles.slice().reverse().map((c) => {
    const w = c.length ? Math.round((c.length / maxLen) * 100) : 50;
    return `
      <div class="bar-row">
        <span style="width:92px">${fmtDateShort(c.start)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${w}%"></div></div>
        <strong style="width:52px;text-align:right">${c.length ? c.length + ' дн.' : 'текущ.'}</strong>
      </div>
    `;
  }).join('') || '<p class="muted">Отметь хотя бы один цикл в календаре, чтобы появилась история.</p>';

  const notes = Object.entries(state.logs)
    .filter(([, l]) => l.note && l.note.trim())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 10);

  return `
    <div class="stat-grid">
      <div class="stat-box">
        <div class="stat-val">${p ? p.cycleLength + ' дн.' : '—'}</div>
        <div class="stat-lbl">Прогноз цикла</div>
      </div>
      <div class="stat-box">
        <div class="stat-val">${p ? p.periodLength + ' дн.' : '—'}</div>
        <div class="stat-lbl">Длина месячных</div>
      </div>
      <div class="stat-box">
        <div class="stat-val">${p ? p.variation + ' дн.' : '—'}</div>
        <div class="stat-lbl">Разброс (6 циклов)</div>
      </div>
      <div class="stat-box">
        <div class="stat-val">${cs.cycles.length}</div>
        <div class="stat-lbl">Записано циклов</div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">История циклов</div>
      ${barsHtml}
    </div>
    <div class="card">
      <div class="card-title">Последние заметки</div>
      ${notes.length ? notes.map(([d, l]) => `
        <div style="padding:8px 0;border-bottom:1px solid var(--outline);cursor:pointer" data-open-log="${d}">
          <strong>${fmtDateShort(d)}</strong>
          <div class="muted">${escapeHtml(l.note)}</div>
        </div>
      `).join('') : '<p class="muted">Заметок пока нет.</p>'}
    </div>
  `;
}

function renderLibrary() {
  return `
    <div class="row" style="margin-bottom:12px">
      <button class="btn ${librarySub === 'articles' ? 'btn-primary' : 'btn-soft'} btn-full" data-lib-sub="articles">Статьи (${articles.length})</button>
      <button class="btn ${librarySub === 'books' ? 'btn-primary' : 'btn-soft'} btn-full" data-lib-sub="books">Мини-книги (${booksIndex.length})</button>
    </div>
    ${librarySub === 'articles' ? articles.map((a) => `
      <div class="card" style="cursor:pointer" data-open-article="${escapeHtml(a.id)}">
        <div class="card-title">${escapeHtml(a.ru?.title || a.id)}</div>
        <div class="muted">${escapeHtml((a.ru?.body || '').slice(0, 120))}…</div>
      </div>
    `).join('') : booksIndex.map((b) => `
      <div class="card" style="cursor:pointer" data-open-book="${escapeHtml(b.id)}">
        <div class="card-title">${escapeHtml(b.title)}</div>
        <div class="muted">Открыть мини-книгу полностью →</div>
      </div>
    `).join('')}
  `;
}

function renderProfile() {
  const pr = state.profile;
  return `
    <div class="card">
      <div class="card-title">Режим работы</div>
      <select id="prof-mode" class="input">
        <option value="TRACK_CYCLE" ${pr.mode === 'TRACK_CYCLE' ? 'selected' : ''}>Отслеживание цикла</option>
        <option value="CONCEIVE" ${pr.mode === 'CONCEIVE' ? 'selected' : ''}>Планирую беременность</option>
        <option value="PREGNANCY" ${pr.mode === 'PREGNANCY' ? 'selected' : ''}>Я беременна</option>
        <option value="CONTRACEPTION" ${pr.mode === 'CONTRACEPTION' ? 'selected' : ''}>Гормональная контрацепция (таблетки)</option>
      </select>
      ${pr.mode === 'PREGNANCY' ? `
        <div style="margin-top:10px">
          <label class="muted">Первый день последних месячных (ПДМ):</label>
          <input type="date" id="prof-lmp" class="input" value="${pr.pregnancyLmp || todayIso()}" />
        </div>
      ` : ''}
      ${pr.mode === 'CONTRACEPTION' ? `
        <div class="row" style="margin-top:10px">
          <label class="muted">Активных дней <input type="number" id="prof-pill-act" class="input" value="${pr.pillActiveDays || 21}" min="1" max="84" /></label>
          <label class="muted">Перерыв <input type="number" id="prof-pill-brk" class="input" value="${pr.pillBreakDays || 7}" min="0" max="14" /></label>
        </div>
      ` : ''}
    </div>

    <div class="card">
      <div class="card-title">Базовые параметры анкеты</div>
      <div class="row">
        <label class="muted">Обычный цикл (дн.)<input type="number" id="prof-cycle" class="input" value="${pr.typicalCycle}" min="15" max="90" /></label>
        <label class="muted">Месячные (дн.)<input type="number" id="prof-period" class="input" value="${pr.typicalPeriod}" min="1" max="15" /></label>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Тема оформления</div>
      <select id="prof-theme" class="input">
        <option value="system" ${pr.theme === 'system' ? 'selected' : ''}>Как в системе (iOS)</option>
        <option value="light" ${pr.theme === 'light' ? 'selected' : ''}>Светлая</option>
        <option value="dark" ${pr.theme === 'dark' ? 'selected' : ''}>Тёмная</option>
      </select>
    </div>

    <div class="card">
      <div class="card-title">Приватность и резервные копии</div>
      <div class="row" style="flex-wrap:wrap;margin-top:8px">
        <button class="btn btn-soft btn-sm" id="btn-set-pin">${pr.pinHash ? 'Убрать PIN-код' : 'Поставить PIN-код'}</button>
        <button class="btn btn-primary btn-sm" id="btn-export-json">Экспорт JSON</button>
        <label class="btn btn-soft btn-sm">Импорт JSON<input type="file" id="input-import-json" accept="application/json" style="display:none" /></label>
      </div>
      <div style="margin-top:12px">
        <button class="btn btn-danger btn-sm" id="btn-reset-all">Удалить все данные</button>
      </div>
    </div>
  `;
}

function renderOnboarding() {
  return `
    <div class="app-shell" style="padding:24px 18px;justify-content:center">
      <div class="card">
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
        <button class="btn btn-primary btn-full" id="ob-start" style="margin-top:18px">Начать</button>
      </div>
    </div>
  `;
}

function renderLogModal() {
  if (!logModalDate) return '';
  const log = state.logs[logModalDate] || { flow: null, marks: [], note: '', bbt: '' };
  const marksSet = new Set(log.marks || []);

  return `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal-sheet">
        <div class="modal-header">
          <h2>Запись: ${fmtDateShort(logModalDate)}</h2>
          <button class="btn btn-soft btn-sm" id="btn-close-log">Готово</button>
        </div>

        <div class="card">
          <div class="card-title">Месячные</div>
          <div class="chips">
            ${FLOW_OPTIONS.map((f) => `
              <span class="chip t-period ${log.flow === f.id ? 'active' : ''}" data-set-flow="${f.id}">${escapeHtml(f.label)}</span>
            `).join('')}
          </div>
        </div>

        ${LOG_CATEGORIES.map((cat) => `
          <div class="card">
            <div class="card-title">${escapeHtml(cat.title)}</div>
            <div class="chips">
              ${cat.options.map((opt) => `
                <span class="chip t-${cat.tint} ${marksSet.has(opt.key) ? 'active' : ''}" data-toggle-mark="${escapeHtml(opt.key)}" data-cat="${cat.id}" data-excl="${opt.exclusive}">
                  ${escapeHtml(opt.label)}
                </span>
              `).join('')}
            </div>
          </div>
        `).join('')}

        <div class="card">
          <div class="card-title">Базальная температура (°C) и заметка</div>
          <input type="number" step="0.01" min="35" max="39" id="log-bbt" class="input" placeholder="Например: 36.65" value="${log.bbt || ''}" style="margin-bottom:10px" />
          <textarea id="log-note" placeholder="Заметка за день…">${escapeHtml(log.note || '')}</textarea>
        </div>
      </div>
    </div>
  `;
}

function renderHowModal(cs) {
  if (!howModalOpen || !cs.predictions) return '';
  const p = cs.predictions;
  return `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal-sheet">
        <div class="modal-header">
          <h2>Как это посчитано</h2>
          <button class="btn btn-soft btn-sm" id="btn-close-how">Закрыть</button>
        </div>
        <div class="card">
          <p>Луния использует байесовскую модель <strong>Engine v2</strong> (Student-t + Inverse-Gamma): прогноз плавно объединяет популяционную статистику (или твою анкету) с реальной историей циклов.</p>
          <p class="muted">
            • Средняя оценка цикла: <strong>${p.cycleMean.toFixed(2)} дн.</strong><br/>
            • 80%-й интервал цикла: <strong>${p.cycleRange[0]}–${p.cycleRange[1]} дн.</strong><br/>
            • Учтено завершённых циклов: <strong>${p.historyCount}</strong><br/>
            • Лютеиновая фаза: <strong>${p.lutealPhase} дн.</strong>
          </p>
        </div>
      </div>
    </div>
  `;
}

function renderReaderModal() {
  if (activeArticle) {
    return `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-sheet">
          <div class="modal-header">
            <h2>${escapeHtml(activeArticle.ru?.title || '')}</h2>
            <button class="btn btn-soft btn-sm" id="btn-close-reader">Закрыть</button>
          </div>
          <div class="card">
            <p>${escapeHtml(activeArticle.ru?.body || '')}</p>
            ${activeArticle.source ? `<p class="muted">Источник: ${escapeHtml(activeArticle.source)}</p>` : ''}
          </div>
        </div>
      </div>
    `;
  }
  if (activeBook) {
    return `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-sheet">
          <div class="modal-header">
            <h2>${escapeHtml(activeBook.title)}</h2>
            <button class="btn btn-soft btn-sm" id="btn-close-reader">Закрыть</button>
          </div>
          <div class="card md-content">${renderMarkdown(activeBookMd)}</div>
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
    <div class="story-viewer" id="story-viewer">
      <div class="story-bars">
        ${slides.map((_, i) => `<div class="story-bar ${i <= storySlideIdx ? 'done' : ''}"></div>`).join('')}
      </div>
      <div class="row">
        <span class="muted" style="color:#EBC4DC">${escapeHtml(activeStory.title)}</span>
        <button class="btn btn-soft btn-sm" id="btn-close-story">✕</button>
      </div>
      <div class="story-body">
        <h2>${escapeHtml(slide.title)}</h2>
        <p>${escapeHtml(slide.body)}</p>
      </div>
      <div class="row">
        <button class="btn btn-soft" id="story-prev">Назад</button>
        <button class="btn btn-period" id="story-next">${storySlideIdx + 1 < slides.length ? 'Дальше' : 'Готово'}</button>
      </div>
    </div>
  `;
}

function renderLockScreen() {
  return `
    <div class="lock-screen">
      <h2>Введите PIN-код</h2>
      ${pinError ? `<div style="color:var(--period);font-size:13px">${pinError}</div>` : ''}
      <div class="pin-dots">
        ${[0, 1, 2, 3].map((i) => `<span class="pin-dot ${i < pinEntry.length ? 'filled' : ''}"></span>`).join('')}
      </div>
      <div class="pin-pad">
        ${['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k) =>
          k ? `<button class="pin-key" data-pin-key="${k}">${k}</button>` : '<div></div>'
        ).join('')}
      </div>
    </div>
  `;
}

function render() {
  applyTheme();
  const root = document.getElementById('app');

  if (!unlocked) {
    root.innerHTML = renderLockScreen();
    bindLockEvents();
    return;
  }

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
          if (d <= todayIso()) state.logs[d] = { flow: 'MEDIUM', marks: [], note: '' };
        }
      }
      state.onboarded = true;
      saveState(state);
      render();
    };
    return;
  }

  const cs = computeCycleState(state);
  const titles = {
    today: 'Луния',
    calendar: 'Календарь',
    reports: 'Отчёты',
    library: 'Библиотека',
    profile: 'Профиль',
  };

  let body = '';
  if (activeTab === 'today') body = renderToday(cs);
  else if (activeTab === 'calendar') body = renderCalendar(cs);
  else if (activeTab === 'reports') body = renderReports(cs);
  else if (activeTab === 'library') body = renderLibrary();
  else body = renderProfile();

  root.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <h1>${titles[activeTab]}</h1>
        <span class="muted">${fmtDateShort(cs.today)}</span>
      </header>
      <main class="main-content">${body}</main>
      <nav class="tabbar">
        ${[
          ['today', 'Сегодня', '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'],
          ['calendar', 'Календарь', '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'],
          ['reports', 'Отчёты', '<path d="M4 20V10M10 20V4M16 20v-6M22 20v-9"/>'],
          ['library', 'Читать', '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'],
          ['profile', 'Профиль', '<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 14.5-4 16 0"/>'],
        ].map(([id, lbl, icon]) => `
          <button class="tab-btn ${activeTab === id ? 'active' : ''}" data-tab="${id}">
            <svg viewBox="0 0 24 24">${icon}</svg>
            <span>${lbl}</span>
          </button>
        `).join('')}
      </nav>
    </div>
    ${renderLogModal()}
    ${renderHowModal(cs)}
    ${renderReaderModal()}
    ${renderStoryViewer()}
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
        const h = await hashPin(pinEntry);
        if (h === state.profile.pinHash) {
          unlocked = true;
          pinEntry = '';
        } else {
          pinError = 'Неверный PIN-код';
          pinEntry = '';
        }
      }
      render();
    };
  });
}

function ensureLog(date) {
  if (!state.logs[date]) state.logs[date] = { flow: null, marks: [], note: '', bbt: '' };
  return state.logs[date];
}

function bindEvents(cs) {
  document.querySelectorAll('[data-tab]').forEach((b) => {
    b.onclick = () => { activeTab = b.dataset.tab; render(); };
  });
  document.querySelectorAll('[data-open-log]').forEach((el) => {
    el.onclick = () => { logModalDate = el.dataset.openLog; render(); };
  });

  const btnTogglePeriod = document.getElementById('btn-toggle-period-today');
  if (btnTogglePeriod) {
    btnTogglePeriod.onclick = () => {
      const log = ensureLog(cs.today);
      log.flow = (log.flow && log.flow !== 'SPOTTING') ? null : 'MEDIUM';
      saveState(state);
      render();
    };
  }

  const btnHow = document.getElementById('btn-open-how');
  if (btnHow) btnHow.onclick = () => { howModalOpen = true; render(); };

  const calPrev = document.getElementById('cal-prev');
  if (calPrev) calPrev.onclick = () => { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } render(); };
  const calNext = document.getElementById('cal-next');
  if (calNext) calNext.onclick = () => { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } render(); };

  document.querySelectorAll('[data-open-story]').forEach((el) => {
    el.onclick = () => {
      activeStory = stories.find((s) => s.id === el.dataset.openStory) || null;
      storySlideIdx = 0;
      if (activeStory && !state.viewedStories.includes(activeStory.id)) {
        state.viewedStories.push(activeStory.id);
        saveState(state);
      }
      render();
    };
  });
  const btnCloseStory = document.getElementById('btn-close-story');
  if (btnCloseStory) btnCloseStory.onclick = () => { activeStory = null; render(); };
  const sPrev = document.getElementById('story-prev');
  if (sPrev) sPrev.onclick = () => { if (storySlideIdx > 0) { storySlideIdx--; render(); } };
  const sNext = document.getElementById('story-next');
  if (sNext) sNext.onclick = () => {
    if (activeStory && storySlideIdx + 1 < activeStory.slides.length) { storySlideIdx++; render(); }
    else { activeStory = null; render(); }
  };

  document.querySelectorAll('[data-lib-sub]').forEach((b) => {
    b.onclick = () => { librarySub = b.dataset.libSub; render(); };
  });
  document.querySelectorAll('[data-open-article]').forEach((el) => {
    el.onclick = () => {
      activeArticle = articles.find((a) => a.id === el.dataset.openArticle) || null;
      render();
    };
  });
  document.querySelectorAll('[data-open-book]').forEach((el) => {
    el.onclick = async () => {
      const b = booksIndex.find((x) => x.id === el.dataset.openBook);
      if (!b) return;
      activeBook = b;
      activeBookMd = 'Загрузка…';
      render();
      try {
        const res = await fetch(b.file);
        activeBookMd = await res.text();
      } catch {
        activeBookMd = 'Не удалось загрузить книгу.';
      }
      render();
    };
  });

  const backdrop = document.getElementById('modal-backdrop');
  if (backdrop) {
    backdrop.onclick = (e) => {
      if (e.target === backdrop) {
        logModalDate = null; howModalOpen = false; activeArticle = null; activeBook = null; render();
      }
    };
  }
  const closeLog = document.getElementById('btn-close-log');
  if (closeLog) closeLog.onclick = () => { logModalDate = null; render(); };
  const closeHow = document.getElementById('btn-close-how');
  if (closeHow) closeHow.onclick = () => { howModalOpen = false; render(); };
  const closeReader = document.getElementById('btn-close-reader');
  if (closeReader) closeReader.onclick = () => { activeArticle = null; activeBook = null; render(); };

  if (logModalDate) {
    document.querySelectorAll('[data-set-flow]').forEach((chip) => {
      chip.onclick = () => {
        const log = ensureLog(logModalDate);
        const val = chip.dataset.setFlow;
        log.flow = log.flow === val ? null : val;
        saveState(state);
        render();
      };
    });
    document.querySelectorAll('[data-toggle-mark]').forEach((chip) => {
      chip.onclick = () => {
        const log = ensureLog(logModalDate);
        const key = chip.dataset.toggleMark;
        const catPrefix = chip.dataset.cat + '.';
        const isExcl = chip.dataset.excl === 'true';
        const set = new Set(log.marks || []);
        if (set.has(key)) {
          set.delete(key);
        } else {
          if (isExcl) {
            for (const existing of [...set]) if (existing.startsWith(catPrefix)) set.delete(existing);
          } else {
            const cat = LOG_CATEGORIES.find((c) => c.id === chip.dataset.cat);
            cat?.options.filter((o) => o.exclusive).forEach((o) => set.delete(o.key));
          }
          set.add(key);
        }
        log.marks = [...set];
        saveState(state);
        render();
      };
    });
    const noteEl = document.getElementById('log-note');
    if (noteEl) noteEl.oninput = () => { ensureLog(logModalDate).note = noteEl.value; saveState(state); };
    const bbtEl = document.getElementById('log-bbt');
    if (bbtEl) bbtEl.oninput = () => { ensureLog(logModalDate).bbt = bbtEl.value; saveState(state); };
  }

  const profMode = document.getElementById('prof-mode');
  if (profMode) profMode.onchange = () => {
    state.profile.mode = profMode.value;
    state.profile.contraceptionPack = profMode.value === 'CONTRACEPTION';
    saveState(state); render();
  };
  const profLmp = document.getElementById('prof-lmp');
  if (profLmp) profLmp.onchange = () => { state.profile.pregnancyLmp = profLmp.value; saveState(state); render(); };
  const profCycle = document.getElementById('prof-cycle');
  if (profCycle) profCycle.onchange = () => { state.profile.typicalCycle = Number(profCycle.value) || 28; saveState(state); };
  const profPeriod = document.getElementById('prof-period');
  if (profPeriod) profPeriod.onchange = () => { state.profile.typicalPeriod = Number(profPeriod.value) || 5; saveState(state); };
  const profTheme = document.getElementById('prof-theme');
  if (profTheme) profTheme.onchange = () => { state.profile.theme = profTheme.value; saveState(state); render(); };

  const btnPin = document.getElementById('btn-set-pin');
  if (btnPin) btnPin.onclick = async () => {
    if (state.profile.pinHash) {
      state.profile.pinHash = null;
      saveState(state); render();
    } else {
      const p = prompt('Задайте 4-значный PIN-код:');
      if (p && /^\d{4}$/.test(p)) {
        state.profile.pinHash = await hashPin(p);
        saveState(state); render();
      }
    }
  };

  const btnExport = document.getElementById('btn-export-json');
  if (btnExport) btnExport.onclick = () => {
    const blob = new Blob([exportBackupJson(state)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lunia-backup-${todayIso()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const inpImport = document.getElementById('input-import-json');
  if (inpImport) inpImport.onchange = async () => {
    const file = inpImport.files?.[0];
    if (!file) return;
    try {
      state = parseBackupJson(await file.text());
      saveState(state);
      alert('Резервная копия успешно восстановлена.');
      render();
    } catch (err) {
      alert(err.message);
    }
  };

  const btnReset = document.getElementById('btn-reset-all');
  if (btnReset) btnReset.onclick = () => {
    if (confirm('Удалить все записи и настройки Лунии?')) {
      state = defaultState();
      saveState(state);
      render();
    }
  };
}

async function boot() {
  try {
    const [aRes, sRes, bRes] = await Promise.all([
      fetch('assets/articles.json'),
      fetch('assets/stories.json'),
      fetch('assets/books/index.json'),
    ]);
    articles = await aRes.json();
    stories = await sRes.json();
    booksIndex = await bRes.json();
  } catch {
  }
  render();
}

boot();
