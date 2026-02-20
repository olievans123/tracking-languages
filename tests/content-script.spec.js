// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const CONTENT_SCRIPT_PATH = path.join(__dirname, '..', 'content-script.js');
const BACKGROUND_SCRIPT_PATH = path.join(__dirname, '..', 'background.js');

/**
 * Inject content-script functions into page for testing.
 * We define stubs for browser globals, then load the script via addScriptTag.
 */
async function injectContentScript(page) {
  await page.evaluate(() => {
    // Stub browser globals the content script needs
    window.extensionAPI = null;
    // Prevent errors from DOM queries on about:blank
    if (!document.querySelector('video')) {
      HTMLElement.prototype._origQS = HTMLElement.prototype.querySelector;
    }
  });

  // Read and wrap content script so it doesn't error on missing YouTube DOM
  const code = fs.readFileSync(CONTENT_SCRIPT_PATH, 'utf-8');

  // Build a version that only exposes the pure functions we want to test
  const wrappedCode = `
    (function() {
      // Stubs
      const extensionAPI = null;
      const document = { visibilityState: 'visible', querySelector: () => null, addEventListener: () => {} };
      const window = globalThis;

      // --- Paste the constants and pure functions ---

      ${extractConstants(code)}
      ${extractFunction(code, 'normalizeLanguageCode')}
      ${extractFunction(code, 'detectFromTitle')}
      ${extractFunction(code, 'detectFromCaptions')}
      ${extractFunction(code, 'detectFromVideoDetails')}

      // Expose on globalThis for test access
      globalThis.normalizeLanguageCode = normalizeLanguageCode;
      globalThis.detectFromTitle = detectFromTitle;
      globalThis.detectFromCaptions = detectFromCaptions;
      globalThis.detectFromVideoDetails = detectFromVideoDetails;
      globalThis.SUPPORTED_LANGUAGES = SUPPORTED_LANGUAGES;
    })();
  `;

  await page.evaluate(wrappedCode);
}

/** Extract constant declarations (const X = ...) from source */
function extractConstants(code) {
  const lines = code.split('\n');
  const result = [];
  let braceDepth = 0;
  let inConst = false;

  for (const line of lines) {
    if (!inConst && /^const (SUPPORTED_LANGUAGES|FUNCTION_WORDS|SCRIPT_PATTERNS|TICK_INTERVAL|MAX_DETECT|DETECT_RETRY)\b/.test(line)) {
      inConst = true;
      braceDepth = 0;
    }

    if (inConst) {
      result.push(line);
      for (const ch of line) {
        if (ch === '{' || ch === '[') braceDepth++;
        if (ch === '}' || ch === ']') braceDepth--;
      }
      if (braceDepth <= 0 && line.includes(';')) {
        inConst = false;
      }
    }
  }
  return result.join('\n');
}

/** Extract a named function from source */
function extractFunction(code, name) {
  const lines = code.split('\n');
  const result = [];
  let braceDepth = 0;
  let inFunc = false;

  for (const line of lines) {
    if (!inFunc && line.match(new RegExp(`^(?:async )?function ${name}\\b`))) {
      inFunc = true;
      braceDepth = 0;
    }

    if (inFunc) {
      result.push(line);
      for (const ch of line) {
        if (ch === '{') braceDepth++;
        if (ch === '}') braceDepth--;
      }
      if (braceDepth === 0 && result.length > 1) {
        inFunc = false;
      }
    }
  }
  return result.join('\n');
}

/** Inject background.js functions into page with mock storage */
async function injectBackground(page) {
  const code = fs.readFileSync(BACKGROUND_SCRIPT_PATH, 'utf-8');

  const wrappedCode = `
    (function() {
      const extensionAPI = null;

      // In-memory storage mock
      const _store = {};
      const storageArea = {
        get(defaults) {
          const result = {};
          for (const [k, v] of Object.entries(defaults)) {
            result[k] = _store[k] !== undefined ? JSON.parse(JSON.stringify(_store[k])) : v;
          }
          return Promise.resolve(result);
        },
        set(data) {
          for (const [k, v] of Object.entries(data)) {
            _store[k] = JSON.parse(JSON.stringify(v));
          }
          return Promise.resolve();
        },
      };

      ${extractFunction(code, 'storageGet')}
      ${extractFunction(code, 'storageSet')}
      ${extractFunction(code, 'todayKey')}
      ${extractFunction(code, 'formatBadge')}
      ${extractFunction(code, 'updateBadge')}
      ${extractHandlers(code)}

      globalThis.handleAddWatchTime = handleAddWatchTime;
      globalThis.handleAddManualTime = handleAddManualTime;
      globalThis.handleGetTrackingData = handleGetTrackingData;
      globalThis.handleGetSettings = handleGetSettings;
      globalThis.handleSaveSettings = handleSaveSettings;
      globalThis.handleGetVideoLog = handleGetVideoLog;
      globalThis.handleRemoveVideoEntry = handleRemoveVideoEntry;
      globalThis.handleSetChannelLanguage = handleSetChannelLanguage;
      globalThis.formatBadge = formatBadge;
      globalThis.todayKey = todayKey;
    })();
  `;

  await page.evaluate(wrappedCode);
}

/** Extract async handler functions from background.js */
function extractHandlers(code) {
  const names = [
    'makeEntryUid',
    'ensureEntryUid',
    'sanitizeDayData',
    'ensureEntryLangBreakdown',
    'subtractFromDayData',
    'subtractEntryFromDayData',
    'moveUnknownEntryTimeToLanguage',
    'normalizeTargetLanguages',
    'migrateVideoLogEntries',
    'matchesEntryFallback',
    'handleAddWatchTime', 'handleAddManualTime', 'handleGetTrackingData',
    'handleGetSettings', 'handleSaveSettings', 'handleGetVideoLog',
    'handleRemoveVideoEntry', 'handleSetChannelLanguage',
  ];
  return names.map(n => extractFunction(code, n)).join('\n\n');
}

// Also need DEFAULT_SETTINGS from background
function extractBackgroundConstants(code) {
  const lines = code.split('\n');
  const result = [];
  let braceDepth = 0;
  let inConst = false;

  for (const line of lines) {
    if (!inConst && /^const (DEFAULT_SETTINGS|DEFAULTS)\b/.test(line)) {
      inConst = true;
      braceDepth = 0;
    }

    if (inConst) {
      result.push(line);
      for (const ch of line) {
        if (ch === '{' || ch === '[') braceDepth++;
        if (ch === '}' || ch === ']') braceDepth--;
      }
      if (braceDepth <= 0 && line.includes(';')) {
        inConst = false;
      }
    }
  }
  return result.join('\n');
}

// Patch injectBackground to include constants
const _origInjectBg = injectBackground;

async function injectBackgroundWithConstants(page) {
  const code = fs.readFileSync(BACKGROUND_SCRIPT_PATH, 'utf-8');

  const wrappedCode = `
    (function() {
      const extensionAPI = null;

      const _store = {};
      const storageArea = {
        get(defaults) {
          const result = {};
          for (const [k, v] of Object.entries(defaults)) {
            result[k] = _store[k] !== undefined ? JSON.parse(JSON.stringify(_store[k])) : v;
          }
          return Promise.resolve(result);
        },
        set(data) {
          for (const [k, v] of Object.entries(data)) {
            _store[k] = JSON.parse(JSON.stringify(v));
          }
          return Promise.resolve();
        },
      };

      ${extractBackgroundConstants(code)}
      ${extractFunction(code, 'storageGet')}
      ${extractFunction(code, 'storageSet')}
      ${extractFunction(code, 'todayKey')}
      ${extractFunction(code, 'formatBadge')}
      ${extractFunction(code, 'updateBadge')}
      ${extractHandlers(code)}

      globalThis.handleAddWatchTime = handleAddWatchTime;
      globalThis.handleAddManualTime = handleAddManualTime;
      globalThis.handleGetTrackingData = handleGetTrackingData;
      globalThis.handleGetSettings = handleGetSettings;
      globalThis.handleSaveSettings = handleSaveSettings;
      globalThis.handleGetVideoLog = handleGetVideoLog;
      globalThis.handleRemoveVideoEntry = handleRemoveVideoEntry;
      globalThis.handleSetChannelLanguage = handleSetChannelLanguage;
      globalThis.formatBadge = formatBadge;
      globalThis.todayKey = todayKey;
    })();
  `;

  await page.evaluate(wrappedCode);
}

// --- Language detection tests ---

test.describe('Language detection from title', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('about:blank');
    await injectContentScript(page);
  });

  test('detects Chinese from CJK characters', async ({ page }) => {
    const result = await page.evaluate(() => detectFromTitle('如何学习中文的基本发音技巧'));
    expect(result).toBe('zh');
  });

  test('detects Japanese from hiragana/katakana', async ({ page }) => {
    const result = await page.evaluate(() => detectFromTitle('日本語の文法をわかりやすく説明します'));
    expect(result).toBe('ja');
  });

  test('detects Korean from hangul', async ({ page }) => {
    const result = await page.evaluate(() => detectFromTitle('한국어 배우기 초급 레슨 첫 번째'));
    expect(result).toBe('ko');
  });

  test('detects Arabic from Arabic script', async ({ page }) => {
    const result = await page.evaluate(() => detectFromTitle('تعلم اللغة العربية للمبتدئين'));
    expect(result).toBe('ar');
  });

  test('detects Russian from Cyrillic', async ({ page }) => {
    const result = await page.evaluate(() => detectFromTitle('Русский язык для начинающих урок первый'));
    expect(result).toBe('ru');
  });

  test('detects Thai from Thai script', async ({ page }) => {
    const result = await page.evaluate(() => detectFromTitle('เรียนภาษาไทยสำหรับผู้เริ่มต้น'));
    expect(result).toBe('th');
  });

  test('detects Hindi from Devanagari', async ({ page }) => {
    const result = await page.evaluate(() => detectFromTitle('हिंदी सीखने का आसान तरीका'));
    expect(result).toBe('hi');
  });

  test('detects Spanish from function words', async ({ page }) => {
    const result = await page.evaluate(() => detectFromTitle('La guía que necesitas para aprender español con esta técnica'));
    expect(result).toBe('es');
  });

  test('detects Spanish when title has no accents', async ({ page }) => {
    const result = await page.evaluate(() => detectFromTitle('Volando los 10 aviones mas raros del mundo'));
    expect(result).toBe('es');
  });

  test('detects French from function words', async ({ page }) => {
    const result = await page.evaluate(() => detectFromTitle('Les meilleures techniques pour apprendre le français dans la vie quotidienne'));
    expect(result).toBe('fr');
  });

  test('detects German from function words', async ({ page }) => {
    const result = await page.evaluate(() => detectFromTitle('Die besten Tipps und Tricks für das Lernen der deutschen Sprache'));
    expect(result).toBe('de');
  });

  test('detects English from function words', async ({ page }) => {
    const result = await page.evaluate(() => detectFromTitle('This is the best tutorial for learning how to code with JavaScript'));
    expect(result).toBe('en');
  });

  test('returns null for ambiguous titles', async ({ page }) => {
    const result = await page.evaluate(() => detectFromTitle('OK'));
    expect(result).toBeNull();
  });

  test('returns null for empty title', async ({ page }) => {
    const result = await page.evaluate(() => detectFromTitle(''));
    expect(result).toBeNull();
  });
});

// --- Caption detection tests ---

test.describe('Language detection from captions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('about:blank');
    await injectContentScript(page);
  });

  test('detects language from ASR caption track', async ({ page }) => {
    const result = await page.evaluate(() => {
      return detectFromCaptions({
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [
              { languageCode: 'es', kind: 'asr', name: { simpleText: 'Spanish (auto-generated)' } },
              { languageCode: 'en', name: { simpleText: 'English' } },
            ],
          },
        },
      });
    });
    expect(result).toBe('es');
  });

  test('falls back to first track when no ASR', async ({ page }) => {
    const result = await page.evaluate(() => {
      return detectFromCaptions({
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [
              { languageCode: 'fr', name: { simpleText: 'French' } },
              { languageCode: 'en', name: { simpleText: 'English' } },
            ],
          },
        },
      });
    });
    expect(result).toBe('fr');
  });

  test('returns null for missing captions', async ({ page }) => {
    const result = await page.evaluate(() => detectFromCaptions({}));
    expect(result).toBeNull();
  });

  test('normalizes language codes with region', async ({ page }) => {
    const result = await page.evaluate(() => {
      return detectFromCaptions({
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [{ languageCode: 'pt-BR', kind: 'asr' }],
          },
        },
      });
    });
    expect(result).toBe('pt');
  });
});

// --- Video details detection tests ---

test.describe('Language detection from video details', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('about:blank');
    await injectContentScript(page);
  });

  test('detects defaultAudioLanguage', async ({ page }) => {
    const result = await page.evaluate(() => {
      return detectFromVideoDetails({ videoDetails: { defaultAudioLanguage: 'ja' } });
    });
    expect(result).toBe('ja');
  });

  test('normalizes zh-Hans to zh', async ({ page }) => {
    const result = await page.evaluate(() => {
      return detectFromVideoDetails({ videoDetails: { defaultAudioLanguage: 'zh-Hans' } });
    });
    expect(result).toBe('zh');
  });

  test('returns null for unsupported language', async ({ page }) => {
    const result = await page.evaluate(() => {
      return detectFromVideoDetails({ videoDetails: { defaultAudioLanguage: 'xx-fantasy' } });
    });
    expect(result).toBeNull();
  });
});

// --- Language code normalization ---

test.describe('normalizeLanguageCode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('about:blank');
    await injectContentScript(page);
  });

  test('normalizes en-US to en', async ({ page }) => {
    expect(await page.evaluate(() => normalizeLanguageCode('en-US'))).toBe('en');
  });

  test('normalizes ko-KR to ko', async ({ page }) => {
    expect(await page.evaluate(() => normalizeLanguageCode('ko-KR'))).toBe('ko');
  });

  test('passes through simple codes', async ({ page }) => {
    expect(await page.evaluate(() => normalizeLanguageCode('es'))).toBe('es');
  });

  test('returns null for unsupported codes', async ({ page }) => {
    expect(await page.evaluate(() => normalizeLanguageCode('zz'))).toBeNull();
  });

  test('returns null for null input', async ({ page }) => {
    expect(await page.evaluate(() => normalizeLanguageCode(null))).toBeNull();
  });
});

// --- Background storage tests ---

test.describe('Background message handlers', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('about:blank');
    await injectBackgroundWithConstants(page);
  });

  test('addWatchTime accumulates seconds', async ({ page }) => {
    await page.evaluate(() => handleAddWatchTime({ lang: 'es', seconds: 5, date: '2026-02-20' }));
    await page.evaluate(() => handleAddWatchTime({ lang: 'es', seconds: 5, date: '2026-02-20' }));
    await page.evaluate(() => handleAddWatchTime({ lang: 'fr', seconds: 10, date: '2026-02-20' }));

    const result = await page.evaluate(() => handleGetTrackingData());
    expect(result.trackingData['2026-02-20']).toEqual({ es: 10, fr: 10 });
  });

  test('addWatchTime handles multiple dates', async ({ page }) => {
    await page.evaluate(() => handleAddWatchTime({ lang: 'es', seconds: 100, date: '2026-02-19' }));
    await page.evaluate(() => handleAddWatchTime({ lang: 'es', seconds: 200, date: '2026-02-20' }));

    const result = await page.evaluate(() => handleGetTrackingData());
    expect(result.trackingData['2026-02-19']).toEqual({ es: 100 });
    expect(result.trackingData['2026-02-20']).toEqual({ es: 200 });
  });

  test('addWatchTime skips non-target languages', async ({ page }) => {
    await page.evaluate(() => handleSaveSettings({ targetLanguages: ['es', 'fr'] }));
    await page.evaluate(() => handleAddWatchTime({ lang: 'en', seconds: 30, date: '2026-02-20' }));
    await page.evaluate(() => handleAddWatchTime({ lang: 'es', seconds: 10, date: '2026-02-20' }));

    const result = await page.evaluate(() => handleGetTrackingData());
    expect(result.trackingData['2026-02-20']).toEqual({ es: 10 });
  });

  test('addWatchTime respects trackingEnabled false', async ({ page }) => {
    await page.evaluate(() => handleSaveSettings({ trackingEnabled: false }));
    await page.evaluate(() => handleAddWatchTime({ lang: 'es', seconds: 20, date: '2026-02-20' }));

    const result = await page.evaluate(() => handleGetTrackingData());
    expect(result.trackingData['2026-02-20']).toBeUndefined();
  });

  test('removeVideoEntry subtracts mixed unknown/known time correctly', async ({ page }) => {
    await page.evaluate(() => handleAddWatchTime({
      lang: 'unknown',
      seconds: 5,
      date: '2026-02-20',
      videoId: 'vid-1',
      channelId: 'chan-1',
    }));
    await page.evaluate(() => handleAddWatchTime({
      lang: 'fr',
      seconds: 5,
      date: '2026-02-20',
      videoId: 'vid-1',
      channelId: 'chan-1',
    }));

    await page.evaluate(() => handleRemoveVideoEntry({ date: '2026-02-20', videoId: 'vid-1' }));

    const tracking = await page.evaluate(() => handleGetTrackingData());
    const log = await page.evaluate(() => handleGetVideoLog());
    expect(tracking.trackingData['2026-02-20']).toBeUndefined();
    expect(log.videoLog['2026-02-20']).toBeUndefined();
  });

  test('setChannelLanguage moves unknown time even after later known ticks', async ({ page }) => {
    await page.evaluate(() => handleAddWatchTime({
      lang: 'unknown',
      seconds: 10,
      date: '2026-02-20',
      videoId: 'vid-2',
      channelId: 'chan-2',
    }));
    await page.evaluate(() => handleAddWatchTime({
      lang: 'fr',
      seconds: 5,
      date: '2026-02-20',
      videoId: 'vid-2',
      channelId: 'chan-2',
    }));

    await page.evaluate(() => handleSetChannelLanguage({ channelId: 'chan-2', lang: 'es' }));

    const tracking = await page.evaluate(() => handleGetTrackingData());
    const log = await page.evaluate(() => handleGetVideoLog());
    expect(tracking.trackingData['2026-02-20']).toEqual({ es: 10, fr: 5 });
    expect(log.videoLog['2026-02-20'][0].lang).toBe('es');
    expect(log.videoLog['2026-02-20'][0].langBreakdown).toEqual({ es: 10, fr: 5 });
  });

  test('addWatchTime rejects invalid input', async ({ page }) => {
    const r1 = await page.evaluate(() => handleAddWatchTime({ lang: '', seconds: 5, date: '2026-02-20' }));
    const r2 = await page.evaluate(() => handleAddWatchTime({ lang: 'es', seconds: 0, date: '2026-02-20' }));
    const r3 = await page.evaluate(() => handleAddWatchTime({ lang: 'es', seconds: -5, date: '2026-02-20' }));

    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    expect(r3.ok).toBe(false);
  });

  test('addManualTime converts minutes to seconds', async ({ page }) => {
    await page.evaluate(() => handleSaveSettings({ targetLanguages: ['de'] }));
    await page.evaluate(() => handleAddManualTime({ lang: 'de', minutes: 15, date: '2026-02-20' }));

    const result = await page.evaluate(() => handleGetTrackingData());
    expect(result.trackingData['2026-02-20']).toEqual({ de: 900 });
  });

  test('getSettings returns defaults', async ({ page }) => {
    const result = await page.evaluate(() => handleGetSettings());
    expect(result.settings.dailyGoalMinutes).toBe(30);
    expect(result.settings.targetLanguages).toEqual(['es', 'fr']);
    expect(result.settings.trackingEnabled).toBe(true);
  });

  test('saveSettings merges with defaults', async ({ page }) => {
    await page.evaluate(() => handleSaveSettings({ dailyGoalMinutes: 60 }));
    const result = await page.evaluate(() => handleGetSettings());
    expect(result.settings.dailyGoalMinutes).toBe(60);
    expect(result.settings.targetLanguages).toEqual(['es', 'fr']);
  });

  test('formatBadge formats correctly', async ({ page }) => {
    const results = await page.evaluate(() => [
      formatBadge(0),
      formatBadge(30),
      formatBadge(300),
      formatBadge(3600),
      formatBadge(5400),
    ]);
    expect(results).toEqual(['', '', '5m', '1h', '1h30']);
  });
});

// --- End-to-end-ish content tracking loop ---

test.describe('Content tracking loop', () => {
  test('tracks watch time even when page script injection is blocked', async ({ page }) => {
    await page.goto('https://example.com/watch?v=test123');

    await page.evaluate(() => {
      // Mock browser runtime used by the content script.
      window.__sentMessages = [];
      window.browser = {
        runtime: {
          sendMessage: (msg) => {
            window.__sentMessages.push(msg);
            return Promise.resolve({ ok: true });
          },
          onMessage: { addListener: () => {} },
        },
      };

      // Build a minimal YouTube-like DOM for selectors used by the script.
      const h1 = document.createElement('h1');
      h1.className = 'ytd-watch-metadata';
      const title = document.createElement('yt-formatted-string');
      title.textContent = 'Volando los 10 aviones mas raros del mundo';
      h1.appendChild(title);
      document.body.appendChild(h1);

      const owner = document.createElement('div');
      owner.id = 'owner';
      const ownerLink = document.createElement('a');
      ownerLink.href = 'https://www.youtube.com/channel/chan-test';
      ownerLink.textContent = 'Canal Test';
      owner.appendChild(ownerLink);
      document.body.appendChild(owner);

      const video = document.createElement('video');
      Object.defineProperty(video, 'paused', { get: () => false });
      Object.defineProperty(video, 'ended', { get: () => false });
      video.className = 'html5-main-video';
      document.body.appendChild(video);

      // Simulate Trusted Types/CSP blocking inline script text assignment.
      Object.defineProperty(HTMLScriptElement.prototype, 'textContent', {
        configurable: true,
        get() { return ''; },
        set() { throw new Error('TrustedScript required'); },
      });
    });

    const fullScript = fs.readFileSync(CONTENT_SCRIPT_PATH, 'utf-8');
    await page.evaluate(fullScript);

    // One tracking tick should be enough to produce addWatchTime.
    await page.waitForTimeout(6500);

    const sent = await page.evaluate(() => window.__sentMessages || []);
    const addWatchTime = sent.find((m) => m && m.type === 'addWatchTime');

    expect(addWatchTime).toBeTruthy();
    expect(addWatchTime.videoId).toBe('test123');
    expect(addWatchTime.lang).toBe('es');
    expect(addWatchTime.seconds).toBe(5);
  });
});
