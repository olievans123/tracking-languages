/* Tracking Languages – background service worker */

const extensionAPI = (() => {
  if (typeof browser !== 'undefined' && browser?.runtime) return browser;
  if (typeof chrome !== 'undefined' && chrome?.runtime) return chrome;
  return null;
})();

const storageArea = extensionAPI?.storage?.local ?? null;

const DEFAULT_SETTINGS = {
  dailyGoalMinutes: 30,
  targetLanguages: ['es', 'fr'],
  trackingEnabled: true,
  progressRingMode: 'total',
  showTotalInSplitRing: false,
  showStreakCounter: false,
  languageGoals: {},
};

const DEFAULTS = {
  settings: { ...DEFAULT_SETTINGS },
  trackingData: {},
  videoLog: {},
  channelLanguages: {},
};

// --- Storage helpers ---

function storageGet(keys) {
  if (!storageArea) return Promise.resolve({ ...DEFAULTS });
  try {
    const result = storageArea.get(keys || DEFAULTS);
    if (result?.then) return result.catch(() => ({ ...DEFAULTS }));
  } catch { /* fall through */ }
  return new Promise((resolve) => {
    try {
      storageArea.get(keys || DEFAULTS, (items) => resolve(items || { ...DEFAULTS }));
    } catch {
      resolve({ ...DEFAULTS });
    }
  });
}

function storageSet(data) {
  if (!storageArea) return Promise.resolve();
  try {
    const result = storageArea.set(data);
    if (result?.then) return result.catch(() => {});
  } catch { /* fall through */ }
  return new Promise((resolve) => {
    try {
      storageArea.set(data, () => resolve());
    } catch {
      resolve();
    }
  });
}

// --- Helpers ---

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function formatBadge(seconds) {
  if (seconds < 60) return '';
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h${rem}` : `${h}h`;
}

function sanitizeDayData(dayData) {
  if (!dayData || typeof dayData !== 'object') return;
  for (const [lang, value] of Object.entries(dayData)) {
    if (!value || value <= 0) delete dayData[lang];
  }
}

function makeEntryUid() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch { /* continue */ }
  return `entry-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function ensureEntryUid(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (typeof entry.uid === 'string' && entry.uid.trim().length > 0) return false;
  entry.uid = makeEntryUid();
  return true;
}

function ensureEntryLangBreakdown(entry) {
  if (!entry || typeof entry !== 'object') return {};
  const hasBreakdown = entry.langBreakdown && typeof entry.langBreakdown === 'object' && !Array.isArray(entry.langBreakdown);
  if (hasBreakdown) return entry.langBreakdown;

  const breakdown = {};
  const seconds = Number(entry.seconds) || 0;
  const lang = entry.lang || 'unknown';
  if (seconds > 0) breakdown[lang] = seconds;
  entry.langBreakdown = breakdown;
  return breakdown;
}

function subtractFromDayData(dayData, lang, seconds) {
  if (!dayData || !lang || !seconds || seconds <= 0) return 0;
  const available = Number(dayData[lang]) || 0;
  if (available <= 0) return 0;
  const used = Math.min(available, seconds);
  dayData[lang] = available - used;
  if (dayData[lang] <= 0) delete dayData[lang];
  return used;
}

function subtractEntryFromDayData(dayData, entry) {
  if (!dayData || !entry) return;
  let remaining = Math.max(Number(entry.seconds) || 0, 0);
  const breakdown = entry.langBreakdown && typeof entry.langBreakdown === 'object' && !Array.isArray(entry.langBreakdown)
    ? entry.langBreakdown
    : null;

  if (breakdown) {
    for (const [lang, rawSeconds] of Object.entries(breakdown)) {
      const seconds = Math.max(Number(rawSeconds) || 0, 0);
      if (seconds <= 0) continue;
      subtractFromDayData(dayData, lang, seconds);
      remaining -= seconds;
    }
    remaining = Math.max(remaining, 0);
  }

  // Legacy fallback for old entries without language breakdown.
  if (remaining > 0 && entry.lang) {
    remaining -= subtractFromDayData(dayData, entry.lang, remaining);
  }
  if (remaining > 0) {
    remaining -= subtractFromDayData(dayData, 'unknown', remaining);
  }
  if (remaining > 0) {
    for (const [lang] of Object.entries(dayData).sort((a, b) => b[1] - a[1])) {
      if (remaining <= 0) break;
      remaining -= subtractFromDayData(dayData, lang, remaining);
    }
  }

  sanitizeDayData(dayData);
}

function moveUnknownEntryTimeToLanguage(entry, lang) {
  if (!entry || !lang) return 0;
  const breakdown = ensureEntryLangBreakdown(entry);
  const unknownSeconds = Math.max(Number(breakdown.unknown) || 0, 0);
  if (unknownSeconds <= 0) return 0;

  breakdown[lang] = (breakdown[lang] || 0) + unknownSeconds;
  delete breakdown.unknown;
  entry.lang = lang;
  return unknownSeconds;
}

function migrateVideoLogEntries(videoLog) {
  let changed = false;
  if (!videoLog || typeof videoLog !== 'object') return changed;
  for (const dateKey of Object.keys(videoLog)) {
    const entries = Array.isArray(videoLog[dateKey]) ? videoLog[dateKey] : [];
    for (const entry of entries) {
      if (ensureEntryUid(entry)) changed = true;
    }
  }
  return changed;
}

function matchesEntryFallback(entry, entryMatch) {
  if (!entry || !entryMatch) return false;
  const norm = (v) => (v == null ? '' : String(v));
  const secondsA = Number(entry.seconds) || 0;
  const secondsB = Number(entryMatch.seconds) || 0;
  return (
    norm(entry.id) === norm(entryMatch.id) &&
    norm(entry.title) === norm(entryMatch.title) &&
    norm(entry.lang) === norm(entryMatch.lang) &&
    norm(entry.channelId) === norm(entryMatch.channelId) &&
    secondsA === secondsB
  );
}

function normalizeTargetLanguages(settings) {
  const raw = settings?.targetLanguages;
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_SETTINGS.targetLanguages];
  return [...new Set(raw.filter((lang) => typeof lang === 'string' && lang.length > 0))];
}

async function updateBadge() {
  // Badge disabled
}

// --- Message handlers ---

async function handleAddWatchTime({ lang, seconds, date, videoId, title, channelId }) {
  if (!lang || !seconds || seconds <= 0) return { ok: false };
  const key = date || todayKey();
  const { trackingData, videoLog, channelLanguages, settings } = await storageGet({
    trackingData: {},
    videoLog: {},
    channelLanguages: {},
    settings: { ...DEFAULT_SETTINGS },
  });
  const effectiveSettings = { ...DEFAULT_SETTINGS, ...settings };

  // Resolve unknown language via channel mapping
  if (lang === 'unknown' && channelId && channelLanguages[channelId]) {
    lang = channelLanguages[channelId];
  }
  if (effectiveSettings.trackingEnabled === false) {
    return { ok: true, skipped: 'trackingDisabled' };
  }
  const targetLanguages = normalizeTargetLanguages(effectiveSettings);
  if (lang !== 'unknown' && targetLanguages.length > 0 && !targetLanguages.includes(lang)) {
    return { ok: true, skipped: 'languageNotTargeted' };
  }
  if (!trackingData[key]) trackingData[key] = {};
  trackingData[key][lang] = (trackingData[key][lang] || 0) + seconds;

  // Upsert video entry into videoLog if videoId provided
  if (videoId) {
    if (!videoLog[key]) videoLog[key] = [];
    const existing = videoLog[key].find((e) => e.id === videoId);
    if (existing) {
      ensureEntryUid(existing);
      const breakdown = ensureEntryLangBreakdown(existing);
      existing.seconds = (existing.seconds || 0) + seconds;
      breakdown[lang] = (breakdown[lang] || 0) + seconds;
      if (title && !existing.title) existing.title = title;
      if (channelId && !existing.channelId) existing.channelId = channelId;
      if (lang && lang !== 'unknown') existing.lang = lang;
      if (!existing.lang) existing.lang = lang || 'unknown';
    } else {
      const entry = { id: videoId, title: title || '', lang, seconds };
      if (channelId) entry.channelId = channelId;
      ensureEntryUid(entry);
      entry.langBreakdown = { [lang]: seconds };
      videoLog[key].push(entry);
    }
    await storageSet({ trackingData, videoLog });
  } else {
    await storageSet({ trackingData });
  }

  await updateBadge();
  return { ok: true };
}

async function handleAddManualTime({ lang, minutes, date }) {
  if (!lang || !minutes || minutes <= 0) return { ok: false };
  return handleAddWatchTime({ lang, seconds: Math.round(minutes * 60), date });
}

async function handleGetTrackingData() {
  const { trackingData } = await storageGet({ trackingData: {} });
  return { trackingData };
}

async function handleGetSettings() {
  const { settings } = await storageGet({ settings: { ...DEFAULT_SETTINGS } });
  return { settings: { ...DEFAULT_SETTINGS, ...settings } };
}

async function handleGetVideoLog() {
  const { videoLog } = await storageGet({ videoLog: {} });
  if (migrateVideoLogEntries(videoLog)) {
    await storageSet({ videoLog });
  }
  return { videoLog };
}

async function handleSetChannelLanguage({ channelId, lang }) {
  if (!channelId || !lang) return { ok: false };
  const { channelLanguages, videoLog, trackingData } = await storageGet({ channelLanguages: {}, videoLog: {}, trackingData: {} });
  channelLanguages[channelId] = lang;

  // Retroactively update existing video log entries for this channel
  for (const dateKey of Object.keys(videoLog)) {
    for (const entry of videoLog[dateKey]) {
      if (entry.channelId !== channelId) continue;
      const movedUnknownSeconds = moveUnknownEntryTimeToLanguage(entry, lang);
      if (movedUnknownSeconds <= 0 || !trackingData[dateKey]) continue;
      trackingData[dateKey].unknown = (trackingData[dateKey].unknown || 0) - movedUnknownSeconds;
      trackingData[dateKey][lang] = (trackingData[dateKey][lang] || 0) + movedUnknownSeconds;
      sanitizeDayData(trackingData[dateKey]);
      if (Object.keys(trackingData[dateKey]).length === 0) delete trackingData[dateKey];
    }
  }

  await storageSet({ channelLanguages, videoLog, trackingData });
  return { ok: true };
}

async function handleGetChannelLanguages() {
  const { channelLanguages } = await storageGet({ channelLanguages: {} });
  return { channelLanguages };
}

async function handleRemoveVideoEntry({ date, videoId }) {
  const { entryUid, entryMatch } = arguments[0] || {};
  if (!date || (!videoId && !entryUid && !entryMatch)) return { ok: false };
  const { videoLog, trackingData } = await storageGet({ videoLog: {}, trackingData: {} });
  const entries = Array.isArray(videoLog[date]) ? videoLog[date] : null;
  if (!entries) return { ok: true };
  let entryIndex = -1;
  if (entryUid) {
    entryIndex = entries.findIndex((e) => e?.uid === entryUid);
  }
  if (entryIndex < 0 && videoId) {
    entryIndex = entries.findIndex((e) => e.id === videoId);
  }
  if (entryIndex < 0 && entryMatch) {
    entryIndex = entries.findIndex((e) => matchesEntryFallback(e, entryMatch));
  }
  if (entryIndex < 0) return { ok: true };
  const entry = entries[entryIndex];
  if (entry && trackingData[date]) {
    subtractEntryFromDayData(trackingData[date], entry);
    if (Object.keys(trackingData[date]).length === 0) delete trackingData[date];
  }
  entries.splice(entryIndex, 1);
  videoLog[date] = entries;
  if (videoLog[date].length === 0) delete videoLog[date];
  await storageSet({ videoLog, trackingData });
  return { ok: true };
}

async function handleSaveSettings(newSettings) {
  const { settings } = await storageGet({ settings: { ...DEFAULT_SETTINGS } });
  const merged = { ...DEFAULT_SETTINGS, ...settings, ...newSettings };
  await storageSet({ settings: merged });
  await updateBadge();
  return { settings: merged };
}

function onMessage(message, _sender, sendResponse) {
  if (!message?.type) return;

  let promise;
  switch (message.type) {
    case 'addWatchTime':
      promise = handleAddWatchTime(message);
      break;
    case 'addManualTime':
      promise = handleAddManualTime(message);
      break;
    case 'getTrackingData':
      promise = handleGetTrackingData();
      break;
    case 'getSettings':
      promise = handleGetSettings();
      break;
    case 'getVideoLog':
      promise = handleGetVideoLog();
      break;
    case 'removeVideoEntry':
      promise = handleRemoveVideoEntry(message);
      break;
    case 'setChannelLanguage':
      promise = handleSetChannelLanguage(message);
      break;
    case 'getChannelLanguages':
      promise = handleGetChannelLanguages();
      break;
    case 'saveSettings':
      promise = handleSaveSettings(message.settings);
      break;
    default:
      return;
  }

  promise.then(sendResponse).catch(() => sendResponse({ error: true }));
  return true; // keep channel open for async response
}

if (extensionAPI?.runtime?.onMessage) {
  extensionAPI.runtime.onMessage.addListener(onMessage);
}

// Set badge on startup
updateBadge();

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    handleAddWatchTime,
    handleAddManualTime,
    handleGetTrackingData,
    handleGetSettings,
    handleSaveSettings,
    handleGetVideoLog,
    formatBadge,
    todayKey,
    DEFAULT_SETTINGS,
  };
}
