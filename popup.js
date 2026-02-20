(() => {
  const SUPPORTED_LANGUAGES = {
    en: 'English',
    es: 'Spanish',
    fr: 'French',
    zh: 'Mandarin',
  };

  const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  const extensionAPI = (() => {
    if (typeof browser !== 'undefined' && browser?.runtime) return browser;
    if (typeof chrome !== 'undefined' && chrome?.runtime) return chrome;
    return null;
  })();

  // --- Messaging ---

  const sendMessage = (message) => {
    if (!extensionAPI?.runtime?.sendMessage) return Promise.resolve(null);
    try {
      const result = extensionAPI.runtime.sendMessage(message);
      if (result?.then) return result.catch(() => null);
    } catch {}
    return new Promise((resolve) => {
      try {
        extensionAPI.runtime.sendMessage(message, (response) => resolve(response ?? null));
      } catch { resolve(null); }
    });
  };

  const queryTabs = (queryInfo) => {
    if (!extensionAPI?.tabs?.query) return Promise.resolve([]);
    try {
      const result = extensionAPI.tabs.query(queryInfo);
      if (result?.then) return result.catch(() => []);
    } catch {}
    return new Promise((resolve) => {
      try {
        extensionAPI.tabs.query(queryInfo, (tabs) => resolve(tabs || []));
      } catch { resolve([]); }
    });
  };

  const sendTabMessage = (tabId, message) => {
    if (!extensionAPI?.tabs?.sendMessage || tabId == null) return Promise.resolve(null);
    try {
      const result = extensionAPI.tabs.sendMessage(tabId, message);
      if (result?.then) return result.catch(() => null);
    } catch {}
    return new Promise((resolve) => {
      try {
        extensionAPI.tabs.sendMessage(tabId, message, (response) => resolve(response ?? null));
      } catch { resolve(null); }
    });
  };

  // --- Helpers ---

  const el = (id) => document.getElementById(id);

  const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const dateKey = (daysAgo) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const dateKeyFromDate = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  const parseDateKey = (key) => {
    if (!key || typeof key !== 'string') return null;
    const match = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (Number.isNaN(date.getTime())) return null;
    return date;
  };

  const sumDay = (dayData) => {
    if (!dayData || typeof dayData !== 'object') return 0;
    return Object.values(dayData).reduce((a, b) => a + (b || 0), 0);
  };

  const formatTime = (seconds) => {
    if (!seconds || seconds <= 0) return '0s';
    if (seconds < 60) return `${Math.floor(seconds)}s`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0 && m > 0) return `${h}h${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  };

  const formatTimeShort = (seconds) => {
    if (!seconds || seconds <= 0) return '';
    if (seconds < 60) return `${Math.floor(seconds)}s`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h${m > 0 ? m : ''}`;
    return `${m}m`;
  };

  const formatDateLabel = (key) => {
    const d = parseDateKey(key);
    if (!d) return key || '';
    return `${DAY_LABELS[d.getDay()]}, ${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
  };

  const normalizeSelectedLanguages = (langs) => {
    if (!Array.isArray(langs)) return ['es', 'fr'];
    const normalized = [...new Set(
      langs
        .map((lang) => String(lang || '').toLowerCase())
        .filter((lang) => !!SUPPORTED_LANGUAGES[lang])
    )];
    return normalized.length > 0 ? normalized : ['es', 'fr'];
  };

  const escapeHtml = (text) => {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  // --- Views ---

  const showView = (viewId) => {
    for (const view of document.querySelectorAll('#dashboard-view, #settings-view, #video-log-view')) {
      view.classList.toggle('hidden', view.id !== viewId);
    }
  };

  // --- Progress ring ---

  const CIRCUMFERENCE = 2 * Math.PI * 52;

  const buildLanguageRingGradient = (seconds, goalSeconds, color) => {
    if (!goalSeconds || goalSeconds <= 0 || !seconds || seconds <= 0) {
      return 'conic-gradient(from -90deg, #1a1d24 0 100%)';
    }
    const pct = Math.min((seconds / goalSeconds) * 100, 100);
    return `conic-gradient(from -90deg, ${color} 0 ${pct.toFixed(2)}%, #1a1d24 ${pct.toFixed(2)}% 100%)`;
  };

  const buildLanguagesForCircleMode = (dayData, targetLanguages) => {
    const result = [];
    const seen = new Set();
    for (const lang of normalizeSelectedLanguages(targetLanguages)) {
      seen.add(lang);
      result.push(lang);
    }
    const activeExtras = Object.entries(dayData || {})
      .filter(([, seconds]) => (seconds || 0) > 0)
      .map(([lang]) => lang)
      .filter((lang) => !seen.has(lang))
      .sort();
    return [...result, ...activeExtras];
  };

  const renderPerLanguageCircles = (dayData, goalMinutes, targetLanguages, includeTotalCard, totalSeconds, languageGoals) => {
    const container = el('ring-language-circles');
    container.innerHTML = '';
    const goalSeconds = goalMinutes * 60;
    const languages = buildLanguagesForCircleMode(dayData, targetLanguages);

    if (includeTotalCard) {
      const totalCard = document.createElement('div');
      totalCard.className = 'lang-ring-card total-card';

      const totalRing = document.createElement('div');
      totalRing.className = 'lang-ring';
      totalRing.style.background = buildLanguageRingGradient(totalSeconds, goalSeconds, '#6366f1');

      const totalMeta = document.createElement('div');
      totalMeta.className = 'lang-ring-meta';
      const totalCodeEl = document.createElement('span');
      totalCodeEl.className = 'lang-ring-code';
      totalCodeEl.textContent = 'TOTAL';
      const totalTimeEl = document.createElement('span');
      totalTimeEl.className = 'lang-ring-time';
      totalTimeEl.textContent = formatTime(totalSeconds);
      totalMeta.appendChild(totalCodeEl);
      totalMeta.appendChild(totalTimeEl);

      totalCard.appendChild(totalRing);
      totalCard.appendChild(totalMeta);
      container.appendChild(totalCard);
    }

    for (const lang of languages) {
      const seconds = Math.max(Number(dayData?.[lang]) || 0, 0);
      const color = LANG_COLORS[lang] || LANG_COLORS.unknown;
      const langGoalSeconds = ((languageGoals && languageGoals[lang]) || goalMinutes) * 60;

      const card = document.createElement('div');
      card.className = 'lang-ring-card';

      const ring = document.createElement('div');
      ring.className = 'lang-ring';
      ring.style.background = buildLanguageRingGradient(seconds, langGoalSeconds, color);

      const meta = document.createElement('div');
      meta.className = 'lang-ring-meta';
      const codeEl = document.createElement('span');
      codeEl.className = 'lang-ring-code';
      codeEl.textContent = lang.toUpperCase();
      const timeEl = document.createElement('span');
      timeEl.className = 'lang-ring-time';
      timeEl.textContent = formatTime(seconds);
      meta.appendChild(codeEl);
      meta.appendChild(timeEl);

      card.appendChild(ring);
      card.appendChild(meta);
      container.appendChild(card);
    }
  };

  const renderProgressRing = (totalSeconds, goalMinutes, dayData, ringMode, targetLanguages, includeTotalCard, languageGoals) => {
    const goalSeconds = goalMinutes * 60;
    const progress = Math.min(totalSeconds / goalSeconds, 1);
    const ringContainer = el('ring-container');
    const circles = el('ring-language-circles');
    const progressRing = el('progress-ring');
    const splitRing = el('ring-segments');

    if (ringMode === 'split') {
      ringContainer.classList.add('hidden');
      circles.classList.remove('hidden');
      renderPerLanguageCircles(dayData, goalMinutes, targetLanguages, includeTotalCard, totalSeconds, languageGoals);
      progressRing.classList.add('hidden');
      splitRing.classList.add('hidden');
    } else {
      circles.classList.add('hidden');
      ringContainer.classList.remove('hidden');
      splitRing.classList.add('hidden');
      progressRing.classList.remove('hidden');
      const offset = CIRCUMFERENCE * (1 - progress);
      const ring = el('ring-progress');
      ring.style.strokeDashoffset = offset;
      ring.style.stroke = progress >= 1 ? '#22c55e' : '#6366f1';
    }

    el('ring-time').textContent = formatTime(totalSeconds);
    el('ring-goal').textContent = `/ ${goalMinutes}m`;
  };

  // --- Streak ---

  const calculateStreak = (trackingData, goalSeconds) => {
    let streak = 0;
    let i = 0;
    const todayTotal = sumDay(trackingData[todayKey()]);
    if (todayTotal < goalSeconds) i = 1;
    while (true) {
      const key = dateKey(i);
      const dayTotal = sumDay(trackingData[key]);
      if (dayTotal >= goalSeconds) {
        streak++;
        i++;
      } else {
        break;
      }
    }
    return streak;
  };

  // --- Weekly chart ---

  const LANG_COLORS = {
    en: '#3ea6ff', es: '#f59e0b', fr: '#8b5cf6', de: '#ef4444', it: '#10b981',
    pt: '#f97316', zh: '#ec4899', ja: '#e11d48', ko: '#14b8a6', ar: '#a78bfa',
    ru: '#06b6d4', tr: '#84cc16', sv: '#fbbf24', nl: '#f472b6', pl: '#fb923c',
    el: '#2dd4bf', th: '#c084fc', vi: '#34d399', hi: '#fca5a5', id: '#67e8f9',
    unknown: 'rgba(255,255,255,0.2)',
  };

  const renderWeeklyChart = (trackingData) => {
    const container = el('weekly-chart');
    container.innerHTML = '';

    let maxTotal = 0;
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const key = dateKey(i);
      const dayData = trackingData[key] || {};
      const total = sumDay(dayData);
      if (total > maxTotal) maxTotal = total;
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push({ key, dayData, total, dayLabel: DAY_LABELS[d.getDay()] });
    }

    for (const day of days) {
      const col = document.createElement('div');
      col.className = 'weekly-bar';
      col.title = `${day.key}: ${formatTime(day.total)}`;

      const stack = document.createElement('div');
      stack.className = 'weekly-bar-stack';

      if (day.total > 0 && maxTotal > 0) {
        const barHeight = Math.max((day.total / maxTotal) * 60, 2);
        stack.style.height = `${barHeight}px`;
        const langs = Object.entries(day.dayData).sort((a, b) => b[1] - a[1]);
        for (const [lang, seconds] of langs) {
          if (seconds <= 0) continue;
          const segPct = (seconds / day.total) * 100;
          const seg = document.createElement('div');
          seg.className = 'weekly-bar-seg';
          seg.style.height = `${segPct}%`;
          seg.style.background = LANG_COLORS[lang] || LANG_COLORS.unknown;
          stack.appendChild(seg);
        }
      } else {
        stack.style.height = '2px';
        const seg = document.createElement('div');
        seg.className = 'weekly-bar-seg';
        seg.style.height = '100%';
        seg.style.background = 'rgba(255,255,255,0.06)';
        stack.appendChild(seg);
      }

      col.appendChild(stack);
      const label = document.createElement('span');
      label.className = 'weekly-bar-label';
      label.textContent = day.dayLabel;
      col.appendChild(label);
      container.appendChild(col);
    }
  };

  // --- Calendar ---

  let calYear, calMonth;

  const initCalendar = () => {
    const now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();
  };

  const renderCalendar = (trackingData, goalSeconds) => {
    const grid = el('calendar-grid');
    grid.innerHTML = '';
    el('cal-month-year').textContent = `${MONTH_NAMES[calMonth]} ${calYear}`;

    const today = new Date();
    const todayStr = dateKeyFromDate(today);
    const firstDay = new Date(calYear, calMonth, 1);
    const lastDay = new Date(calYear, calMonth + 1, 0);
    const startPad = firstDay.getDay();
    const totalDays = lastDay.getDate();

    // Previous month padding
    const prevMonthLast = new Date(calYear, calMonth, 0);
    for (let i = startPad - 1; i >= 0; i--) {
      const dayNum = prevMonthLast.getDate() - i;
      const cell = document.createElement('div');
      cell.className = 'cal-day outside';
      cell.innerHTML = `<span class="cal-day-num">${dayNum}</span>`;
      grid.appendChild(cell);
    }

    // Current month days
    for (let d = 1; d <= totalDays; d++) {
      const date = new Date(calYear, calMonth, d);
      const key = dateKeyFromDate(date);
      const total = sumDay(trackingData[key]);
      const isFuture = date > today;
      const isToday = key === todayStr;

      const cell = document.createElement('div');
      let cls = 'cal-day';
      if (isFuture) cls += ' future';
      else if (total >= goalSeconds && goalSeconds > 0) cls += ' goal-met';
      else if (total > 0) cls += ' has-activity';
      if (isToday) cls += ' today';
      if (!isFuture) cls += ' selectable';
      if (selectedDayKey === key) cls += ' selected';
      cell.className = cls;

      let timeStr = '';
      if (total > 0 && !isFuture) timeStr = `<span class="cal-day-time">${formatTimeShort(total)}</span>`;
      cell.innerHTML = `<span class="cal-day-num">${d}</span>${timeStr}`;
      if (!isFuture) {
        cell.addEventListener('click', () => {
          selectedDayKey = (key === todayKey()) ? null : key;
          renderDashboard();
        });
      }
      grid.appendChild(cell);
    }

    // Next month padding
    const endPad = (7 - ((startPad + totalDays) % 7)) % 7;
    for (let i = 1; i <= endPad; i++) {
      const cell = document.createElement('div');
      cell.className = 'cal-day outside';
      cell.innerHTML = `<span class="cal-day-num">${i}</span>`;
      grid.appendChild(cell);
    }
  };

  // --- Video log ---

  const renderVideoLog = (videoLog, dateStr) => {
    const list = el('video-log-list');
    const emptyMsg = el('video-log-empty');
    list.innerHTML = '';

    const entries = videoLog[dateStr] || [];
    if (entries.length === 0) {
      emptyMsg.classList.remove('hidden');
      return;
    }
    emptyMsg.classList.add('hidden');

    const sorted = [...entries].sort((a, b) => b.seconds - a.seconds);
    for (const entry of sorted) {
      const item = document.createElement('div');
      item.className = 'video-log-item';
      item.title = entry.title || entry.id;

      const info = document.createElement('div');
      info.className = 'video-log-info';
      info.addEventListener('click', () => {
        window.open(`https://www.youtube.com/watch?v=${encodeURIComponent(entry.id)}`, '_blank');
      });

      const titleSpan = document.createElement('span');
      titleSpan.className = 'video-log-title';
      titleSpan.textContent = entry.title || entry.id;
      info.appendChild(titleSpan);

      // Language badge — clickable picker for unknown entries with a channelId
      if ((entry.lang === 'unknown' || !entry.lang) && entry.channelId) {
        const select = document.createElement('select');
        select.className = 'video-log-lang-picker';
        select.innerHTML = '<option value="">?</option>' +
          Object.entries(SUPPORTED_LANGUAGES).map(([code, name]) =>
            `<option value="${code}">${code.toUpperCase()}</option>`
          ).join('');
        select.addEventListener('click', (e) => e.stopPropagation());
        select.addEventListener('change', async (e) => {
          e.stopPropagation();
          const lang = select.value;
          if (!lang) return;
          await sendMessage({ type: 'setChannelLanguage', channelId: entry.channelId, lang });
          // Refresh all data and re-render
          const [logRes, trackRes] = await Promise.all([
            sendMessage({ type: 'getVideoLog' }),
            sendMessage({ type: 'getTrackingData' }),
          ]);
          videoLog = logRes?.videoLog || {};
          trackingData = trackRes?.trackingData || {};
          renderDashboard();
          renderVideoLog(videoLog, dateStr);
        });
        info.appendChild(select);
      } else {
        const badge = document.createElement('span');
        badge.className = 'video-log-badge';
        badge.textContent = entry.lang || '?';
        info.appendChild(badge);
      }

      const timeSpan = document.createElement('span');
      timeSpan.className = 'video-log-time';
      timeSpan.textContent = formatTime(entry.seconds);
      info.appendChild(timeSpan);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'video-log-delete';
      deleteBtn.innerHTML = '&times;';
      deleteBtn.title = 'Remove';
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await sendMessage({
          type: 'removeVideoEntry',
          date: dateStr,
          videoId: entry.id,
          entryUid: entry.uid,
          entryMatch: {
            id: entry.id || '',
            title: entry.title || '',
            lang: entry.lang || '',
            channelId: entry.channelId || '',
            seconds: entry.seconds || 0,
          },
        });
        const [logRes, trackRes] = await Promise.all([
          sendMessage({ type: 'getVideoLog' }),
          sendMessage({ type: 'getTrackingData' }),
        ]);
        videoLog = logRes?.videoLog || {};
        trackingData = trackRes?.trackingData || {};
        renderDashboard();
        renderVideoLog(videoLog, dateStr);
      });

      item.appendChild(info);
      item.appendChild(deleteBtn);
      list.appendChild(item);
    }
  };

  // --- Settings ---

  const buildTargetLanguagesList = (selected, langGoals) => {
    const container = el('targetLanguages');
    container.innerHTML = '';
    const goals = langGoals || {};
    for (const [code, name] of Object.entries(SUPPORTED_LANGUAGES)) {
      const isChecked = selected.includes(code);
      const label = document.createElement('label');
      label.className = `lang-option${isChecked ? ' checked' : ''}`;
      const goalVal = goals[code] || '';
      label.innerHTML = `
        <input type="checkbox" value="${code}" ${isChecked ? 'checked' : ''} />
        <span class="lang-name">${name}</span>
        <span class="lang-goal-input">
          <input type="number" min="1" max="480" step="5" placeholder="—" value="${goalVal}" data-lang="${code}" />
          <span class="goal-unit">min</span>
        </span>
        <span class="lang-code">${code.toUpperCase()}</span>
      `;
      const cb = label.querySelector('input[type="checkbox"]');
      cb.addEventListener('change', () => {
        label.classList.toggle('checked', cb.checked);
      });
      container.appendChild(label);
    }
  };

  const getTargetLanguageCheckboxes = () =>
    Array.from(el('targetLanguages').querySelectorAll('input[type="checkbox"]'));

  const readSettings = () => {
    const goals = {};
    for (const input of el('targetLanguages').querySelectorAll('input[type="number"]')) {
      const lang = input.dataset.lang;
      const val = parseInt(input.value, 10);
      if (lang && val > 0) goals[lang] = val;
    }
    return {
      trackingEnabled: el('trackingEnabled').checked,
      dailyGoalMinutes: parseInt(el('dailyGoal').value, 10) || 30,
      targetLanguages: getTargetLanguageCheckboxes().filter((cb) => cb.checked).map((cb) => cb.value),
      progressRingMode: el('progressRingMode').value === 'split' ? 'split' : 'total',
      showTotalInSplitRing: el('showTotalInSplitRing').checked,
      showStreakCounter: el('showStreakCounter').checked,
      languageGoals: goals,
    };
  };

  const writeSettings = (settings) => {
    el('trackingEnabled').checked = settings.trackingEnabled !== false;
    el('dailyGoal').value = settings.dailyGoalMinutes || 30;
    el('progressRingMode').value = settings.progressRingMode === 'split' ? 'split' : 'total';
    el('showTotalInSplitRing').checked = settings.showTotalInSplitRing === true;
    el('showStreakCounter').checked = settings.showStreakCounter === true;
    buildTargetLanguagesList(normalizeSelectedLanguages(settings.targetLanguages), settings.languageGoals || {});
  };

  const setStatus = (message, type = '') => {
    const status = el('status');
    if (!status) return;
    status.textContent = message;
    status.className = `status${type ? ` ${type}` : ''}`;
  };

  const setDashboardStatus = (message, type = '') => {
    const status = el('dashboard-status');
    if (!status) return;
    status.textContent = message;
    status.className = `status status-dashboard${type ? ` ${type}` : ''}`;
  };

  let globalStatusTimer = null;
  const setGlobalStatus = (message, type = '') => {
    if (globalStatusTimer) {
      clearTimeout(globalStatusTimer);
      globalStatusTimer = null;
    }
    setStatus(message, type);
    setDashboardStatus(message, type);
    if (!message) return;
    globalStatusTimer = setTimeout(() => {
      setStatus('');
      setDashboardStatus('');
      globalStatusTimer = null;
    }, 2500);
  };

  const mapCurrentChannelLanguage = async () => {
    const context = await sendMessage({ type: 'getChannelContext' });
    if (!context?.channelId) {
      setGlobalStatus('Open a YouTube watch page, then try again.', 'error');
      return;
    }

    const channelLabel = context.channelName || context.channelId;
    const suggested = context.detectedLanguage && context.detectedLanguage !== 'unknown' ? context.detectedLanguage : '';

    // Show inline language picker
    const picker = el('channel-picker');
    const optionsEl = el('channel-picker-options');
    el('channel-picker-label').textContent = channelLabel;
    optionsEl.innerHTML = '';
    picker.classList.remove('hidden');

    const lang = await new Promise((resolve) => {
      for (const [code, name] of Object.entries(SUPPORTED_LANGUAGES)) {
        const btn = document.createElement('button');
        btn.className = `channel-picker-btn${code === suggested ? ' suggested' : ''}`;
        btn.textContent = code;
        btn.title = name;
        btn.addEventListener('click', () => resolve(code));
        optionsEl.appendChild(btn);
      }
    });

    picker.classList.add('hidden');

    const saveRes = await sendMessage({ type: 'setChannelLanguage', channelId: context.channelId, lang });
    if (!saveRes?.ok) {
      setGlobalStatus('Could not save channel language.', 'error');
      return;
    }

    const [logRes, trackRes] = await Promise.all([
      sendMessage({ type: 'getVideoLog' }),
      sendMessage({ type: 'getTrackingData' }),
    ]);
    videoLog = logRes?.videoLog || {};
    trackingData = trackRes?.trackingData || {};
    renderDashboard();
    if (!el('video-log-view').classList.contains('hidden')) {
      renderVideoLog(videoLog, el('video-log-date').value);
    }

    setGlobalStatus(`Saved ${channelLabel} as ${lang.toUpperCase()}.`, 'success');
  };

  const saveSettings = async () => {
    try {
      const settings = readSettings();
      settings.targetLanguages = normalizeSelectedLanguages(settings.targetLanguages);
      buildTargetLanguagesList(settings.targetLanguages, settings.languageGoals || {});
      const saveRes = await sendMessage({ type: 'saveSettings', settings });
      const effectiveSettings = saveRes?.settings || settings;
      goalMinutes = effectiveSettings.dailyGoalMinutes || 30;
      progressRingMode = effectiveSettings.progressRingMode === 'split' ? 'split' : 'total';
      targetLanguages = normalizeSelectedLanguages(effectiveSettings.targetLanguages);
      showTotalInSplitRing = effectiveSettings.showTotalInSplitRing === true;
      showStreakCounter = effectiveSettings.showStreakCounter === true;
      languageGoals = effectiveSettings.languageGoals || {};
      renderDashboard();
      setStatus('Saved', 'success');
      setTimeout(() => setStatus(''), 1500);
    } catch (err) {
      setStatus(`Error: ${err.message}`, 'error');
    }
  };

  // --- Main ---

  let trackingData = {};
  let videoLog = {};
  let goalMinutes = 30;
  let targetLanguages = ['es', 'fr'];
  let progressRingMode = 'total';
  let showTotalInSplitRing = false;
  let showStreakCounter = false;
  let languageGoals = {};
  let calendarVisible = false;
  let selectedDayKey = null;

  const setCalendarVisible = (visible) => {
    calendarVisible = !!visible;
    el('calendar-section').classList.toggle('hidden', !calendarVisible);
  };

  const loadAllData = async () => {
    const [trackRes, settingsRes, logRes] = await Promise.all([
      sendMessage({ type: 'getTrackingData' }),
      sendMessage({ type: 'getSettings' }),
      sendMessage({ type: 'getVideoLog' }),
    ]);

    trackingData = trackRes?.trackingData || {};
    videoLog = logRes?.videoLog || {};
    const settings = settingsRes?.settings || {
      dailyGoalMinutes: 30,
      targetLanguages: ['es', 'fr'],
      trackingEnabled: true,
      progressRingMode: 'total',
      showTotalInSplitRing: false,
      showStreakCounter: false,
      languageGoals: {},
    };
    goalMinutes = settings.dailyGoalMinutes || 30;
    targetLanguages = normalizeSelectedLanguages(settings.targetLanguages);
    progressRingMode = settings.progressRingMode === 'split' ? 'split' : 'total';
    showTotalInSplitRing = settings.showTotalInSplitRing === true;
    showStreakCounter = settings.showStreakCounter === true;
    languageGoals = settings.languageGoals || {};

    return settings;
  };

  const renderDashboard = () => {
    const goalSeconds = goalMinutes * 60;
    const activeKey = selectedDayKey || todayKey();
    const activeData = trackingData[activeKey] || {};
    const activeTotal = sumDay(activeData);
    const isToday = !selectedDayKey || selectedDayKey === todayKey();

    renderProgressRing(activeTotal, goalMinutes, activeData, progressRingMode, targetLanguages, showTotalInSplitRing, languageGoals);

    const dateLabel = el('ring-date-label');
    if (isToday) {
      dateLabel.classList.add('hidden');
    } else {
      dateLabel.classList.remove('hidden');
      el('ring-date-text').textContent = formatDateLabel(activeKey);
    }

    el('streak-info').classList.toggle('hidden', !showStreakCounter);
    if (showStreakCounter) {
      const streak = calculateStreak(trackingData, goalSeconds);
      el('streak-count').textContent = streak;
    }

    if (calendarVisible) {
      renderCalendar(trackingData, goalSeconds);
    }
    setCalendarVisible(calendarVisible);
  };

  const init = async () => {
    initCalendar();

    const settings = await loadAllData();
    writeSettings(settings);
    renderDashboard();

    // Set video log date to today
    el('video-log-date').value = todayKey();

    // --- Event listeners ---

    // View navigation
    el('channel-map-btn').addEventListener('click', () => {
      mapCurrentChannelLanguage().catch((err) => {
        setGlobalStatus(`Channel map error: ${err.message}`, 'error');
      });
    });
    el('settings-btn').addEventListener('click', () => showView('settings-view'));
    el('settings-back-btn').addEventListener('click', () => {
      showView('dashboard-view');
      loadAllData().then(renderDashboard);
    });

    el('videos-btn').addEventListener('click', () => {
      renderVideoLog(videoLog, el('video-log-date').value);
      showView('video-log-view');
    });
    el('videos-back-btn').addEventListener('click', () => {
      showView('dashboard-view');
      loadAllData().then(renderDashboard);
    });

    el('calendar-btn').addEventListener('click', () => {
      setCalendarVisible(!calendarVisible);
      if (calendarVisible) {
        renderCalendar(trackingData, goalMinutes * 60);
      }
    });


    el('cal-prev').addEventListener('click', () => {
      calMonth--;
      if (calMonth < 0) { calMonth = 11; calYear--; }
      renderCalendar(trackingData, goalMinutes * 60);
    });

    el('cal-next').addEventListener('click', () => {
      calMonth++;
      if (calMonth > 11) { calMonth = 0; calYear++; }
      renderCalendar(trackingData, goalMinutes * 60);
    });

    // Video log date change
    el('video-log-date').addEventListener('change', () => {
      renderVideoLog(videoLog, el('video-log-date').value);
    });

    // Settings change handlers
    el('trackingEnabled').addEventListener('change', saveSettings);
    el('dailyGoal').addEventListener('change', () => {
      goalMinutes = parseInt(el('dailyGoal').value, 10) || 30;
      saveSettings();
    });
    el('progressRingMode').addEventListener('change', () => {
      progressRingMode = el('progressRingMode').value === 'split' ? 'split' : 'total';
      saveSettings();
      renderDashboard();
    });
    el('showTotalInSplitRing').addEventListener('change', () => {
      showTotalInSplitRing = el('showTotalInSplitRing').checked;
      saveSettings();
      renderDashboard();
    });
    el('showStreakCounter').addEventListener('change', () => {
      showStreakCounter = el('showStreakCounter').checked;
      saveSettings();
      renderDashboard();
    });
    // Delegate for dynamically built language checkboxes
    el('targetLanguages').addEventListener('change', saveSettings);

    setCalendarVisible(false);
  };

  init().catch((err) => {
    const status = document.getElementById('status');
    if (status) {
      status.textContent = `Load error: ${err.message}`;
      status.className = 'status error';
    }
  });
})();
