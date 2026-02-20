/* Tracking Languages – content script (youtube.com + bilibili.com) */

const extensionAPI = (() => {
  if (typeof browser !== 'undefined' && browser?.runtime) return browser;
  if (typeof chrome !== 'undefined' && chrome?.runtime) return chrome;
  return null;
})();

const PLATFORM = window.location.hostname.includes('bilibili.com') ? 'bilibili' : 'youtube';

// --- Constants ---

const TICK_INTERVAL_MS = 5000;
const MAX_DETECT_RETRIES = 5;
const DETECT_RETRY_DELAY_MS = 1500;

const SUPPORTED_LANGUAGES = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
  pt: 'Portuguese', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', ar: 'Arabic',
  ru: 'Russian', tr: 'Turkish', sv: 'Swedish', nl: 'Dutch', pl: 'Polish',
  el: 'Greek', th: 'Thai', vi: 'Vietnamese', hi: 'Hindi', id: 'Indonesian',
};

// Function words for Latin-script language detection (title fallback)
const FUNCTION_WORDS = {
  en: ['the', 'and', 'is', 'are', 'was', 'were', 'will', 'have', 'has', 'been',
    'this', 'that', 'with', 'for', 'not', 'but', 'you', 'all', 'can', 'from',
    'they', 'what', 'when', 'how', 'why', 'who', 'which', 'about', 'would',
    'could', 'should', 'into', 'more', 'some', 'than', 'them', 'these', 'other',
    'only', 'also', 'very', 'even', 'most', 'where', 'after', 'before', 'every',
    'through', 'because', 'your', 'our', 'their', 'there', 'here', 'while',
    'between', 'both', 'during', 'being', 'over', 'again', 'then', 'once',
    'just', 'like', 'my', 'its', 'out', 'did', 'had', 'any', 'now'],
  es: ['el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'al', 'con', 'por',
    'para', 'que', 'en', 'es', 'son', 'como', 'mas', 'pero', 'este', 'esta',
    'estos', 'estas', 'ese', 'esa', 'muy', 'cuando', 'donde', 'porque', 'entre',
    'desde', 'hasta', 'sobre', 'todo', 'cada', 'otro', 'otra', 'sin', 'siempre',
    'nunca', 'puede', 'tiene', 'hay', 'tambien', 'despues', 'antes', 'nos',
    'les', 'su', 'sus', 'mi', 'mis', 'tu', 'tus', 'yo', 'ella', 'ellos',
    'ya', 'aqui', 'asi', 'solo', 'mucho', 'poco', 'mejor', 'peor', 'nuevo',
    'nueva', 'bueno', 'buena', 'grande', 'se', 'lo', 'le'],
  fr: ['le', 'la', 'les', 'un', 'une', 'de', 'des', 'du', 'au', 'aux',
    'et', 'est', 'sont', 'dans', 'pour', 'pas', 'qui', 'vers', 'sur', 'avec',
    'plus', 'mais', 'tout', 'cette', 'ces', 'ses', 'mon', 'mes', 'par',
    'vous', 'nous', 'ils', 'elles', 'aussi', 'tres', 'meme', 'ou', 'comme',
    'quand', 'depuis', 'apres', 'avant', 'toujours', 'jamais', 'je', 'tu',
    'il', 'elle', 'on', 'leur', 'leurs', 'notre', 'votre', 'ce', 'cet',
    'ici', 'donc', 'alors', 'ni', 'car', 'puis', 'encore', 'rien', 'peu',
    'beaucoup', 'trop', 'assez', 'ne'],
  de: ['der', 'die', 'das', 'ein', 'eine', 'und', 'ist', 'nicht', 'auf', 'mit',
    'ich', 'sie', 'den', 'dem', 'des', 'von', 'zu', 'fur', 'auch', 'sich',
    'aber', 'oder', 'wie', 'noch', 'nach', 'nur', 'wenn', 'kann', 'hat',
    'war', 'wir', 'sind', 'werden', 'haben', 'wird', 'schon', 'mehr',
    'immer', 'sehr', 'alle', 'wieder', 'neue', 'diese', 'hier', 'beim',
    'uber', 'unter', 'zwischen', 'durch', 'ohne', 'gegen'],
  it: ['il', 'la', 'gli', 'una', 'che', 'del', 'per', 'con', 'sono', 'questo',
    'nella', 'dalla', 'come', 'alla', 'delle', 'dei', 'gli', 'suo', 'sua',
    'loro', 'essere', 'stato', 'anche', 'piu', 'molto', 'sempre', 'dove',
    'quando', 'ogni', 'tutto', 'dopo', 'prima', 'senza', 'ancora', 'qui',
    'fra', 'tra', 'perche', 'poi', 'solo', 'mai', 'bene', 'ora', 'anno'],
  pt: ['que', 'para', 'com', 'uma', 'por', 'mais', 'como', 'mas', 'seu', 'sua',
    'esta', 'isso', 'quando', 'muito', 'dos', 'das', 'nos', 'tem', 'foi',
    'ser', 'pode', 'ainda', 'entre', 'depois', 'desde', 'cada', 'sobre',
    'tambem', 'aqui', 'onde', 'todos', 'sempre', 'sem', 'outro', 'outra',
    'ele', 'ela', 'eles', 'voce', 'meu', 'minha', 'bem', 'agora', 'ano'],
  nl: ['het', 'een', 'van', 'dat', 'die', 'niet', 'zijn', 'voor', 'met', 'ook',
    'maar', 'naar', 'wel', 'nog', 'dan', 'bij', 'uit', 'aan', 'kan', 'deze',
    'alle', 'hun', 'hebben', 'wat', 'waar', 'moet', 'veel', 'goed', 'over',
    'door', 'meer', 'haar', 'zou', 'tussen', 'onder', 'zonder', 'alleen'],
  sv: ['och', 'att', 'det', 'som', 'har', 'med', 'den', 'inte', 'jag', 'till',
    'var', 'kan', 'ett', 'ska', 'men', 'dig', 'mig', 'alla', 'hans', 'hennes',
    'deras', 'efter', 'bara', 'nar', 'hur', 'mer', 'utan', 'mycket', 'sedan'],
  pl: ['nie', 'jak', 'tak', 'ale', 'jest', 'czy', 'aby', 'tego', 'dla', 'tylko',
    'jako', 'przed', 'przez', 'przy', 'bez', 'bardzo', 'jeszcze', 'wszystko',
    'moze', 'gdzie', 'kiedy', 'ich', 'ten', 'nas', 'jego', 'jej', 'tutaj'],
  tr: ['bir', 'bu', 'ile', 'gibi', 'daha', 'olan', 'ancak', 'kadar', 'nasil',
    'sonra', 'icin', 'ama', 'cok', 'var', 'hem', 'her', 'bile', 'hangi',
    'bazi', 'yeni', 'burada', 'oraya', 'simdi', 'sadece', 'hala', 'olarak'],
  id: ['yang', 'dan', 'ini', 'itu', 'untuk', 'dengan', 'dari', 'pada', 'akan',
    'tidak', 'ada', 'juga', 'bisa', 'sudah', 'lebih', 'oleh', 'saya', 'kami',
    'mereka', 'tetapi', 'atau', 'hanya', 'seperti', 'karena', 'semua', 'sangat'],
  vi: ['cua', 'trong', 'nhung', 'duoc', 'cac', 'cung', 'khong', 'nhu', 'nay',
    'khi', 'mot', 'nguoi', 'theo', 'nhieu', 'tai', 'voi', 'cho', 'roi',
    'con', 'rat', 'hon', 'noi', 'hay', 'biet', 'lam', 'den', 'sau'],
};

// Script ranges for non-Latin language detection
// Order matters: ja before zh because Japanese text contains kanji (CJK) + kana
const SCRIPT_PATTERNS = [
  ['ja', /[\u3040-\u309f\u30a0-\u30ff]/],
  ['ko', /[\uac00-\ud7af\u1100-\u11ff]/],
  ['zh', /[\u4e00-\u9fff\u3400-\u4dbf]/],
  ['ar', /[\u0600-\u06ff\u0750-\u077f]/],
  ['ru', /[\u0400-\u04ff]/],
  ['el', /[\u0370-\u03ff]/],
  ['th', /[\u0e00-\u0e7f]/],
  ['hi', /[\u0900-\u097f]/],
];

// --- State ---

let currentLanguage = null;
let currentVideoTitle = null;
let currentChannelId = null;
let tickTimer = null;
let videoElement = null;
let detectRetries = 0;
let lastVideoId = null;

// --- Messaging ---

function sendMessage(msg) {
  if (!extensionAPI?.runtime?.sendMessage) return Promise.resolve(null);
  try {
    const result = extensionAPI.runtime.sendMessage(msg);
    if (result?.then) return result.catch(() => null);
    return Promise.resolve(result);
  } catch {
    return Promise.resolve(null);
  }
}

// --- Language detection ---

// --- YouTube helpers ---

function getYouTubeVideoId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('v') || null;
}

function isYouTubeWatchPage() {
  return window.location.pathname === '/watch' && !!getYouTubeVideoId();
}

// --- Bilibili helpers ---

function getBilibiliVideoId() {
  const match = window.location.pathname.match(/^\/video\/([A-Za-z0-9]+)/);
  return match ? match[1] : null;
}

function isBilibiliWatchPage() {
  return window.location.pathname.startsWith('/video/') && !!getBilibiliVideoId();
}

let _lastBilibiliState = null;

function requestBilibiliInitialState() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', handler);
      resolve(value);
    };
    const msgId = `__bili_is_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const handler = (e) => {
      if (e.data?.type === msgId) {
        _lastBilibiliState = e.data.state || null;
        finish(_lastBilibiliState);
      }
    };
    try {
      window.addEventListener('message', handler);
    } catch {
      resolve(null);
      return;
    }
    try {
      const s = document.createElement('script');
      s.textContent = `(function(){
        var st=null;
        try{st=window.__INITIAL_STATE__;}catch(e){}
        var data={type:'${msgId}',state:null};
        if(st){try{data.state={
          videoData:st.videoData||null,
          upData:st.upData||null
        };}catch(e){}}
        window.postMessage(data,'*');
      })();`;
      const root = document.documentElement || document.head || document.body;
      if (!root) { finish(null); return; }
      root.appendChild(s);
      s.remove();
    } catch {
      finish(null);
      return;
    }
    setTimeout(() => finish(null), 300);
  });
}

function captureBilibiliTitle() {
  if (_lastBilibiliState?.videoData?.title) return _lastBilibiliState.videoData.title;
  const titleEl = document.querySelector('.video-title, h1.video-title, [class*="video-title"]');
  if (titleEl?.textContent?.trim()) return titleEl.textContent.trim();
  if (document.title) return document.title.replace(/\s*_哔哩哔哩.*$/i, '').trim();
  return '';
}

function captureBilibiliChannelId() {
  if (_lastBilibiliState?.upData?.mid) return String(_lastBilibiliState.upData.mid);
  try {
    const link = document.querySelector('.up-name, [class*="up-name"], .username');
    if (link?.href) {
      const m = link.href.match(/space\.bilibili\.com\/(\d+)/);
      if (m) return m[1];
    }
  } catch { /* continue */ }
  return null;
}

function captureBilibiliChannelName() {
  if (_lastBilibiliState?.upData?.name) return _lastBilibiliState.upData.name;
  try {
    const nameEl = document.querySelector('.up-name, [class*="up-name"], .username');
    const name = nameEl?.textContent?.trim();
    if (name) return name;
  } catch { /* continue */ }
  return '';
}

function detectBilibiliLanguage() {
  // Check subtitle list from initial state
  try {
    const subs = _lastBilibiliState?.videoData?.subtitle?.list;
    if (Array.isArray(subs) && subs.length > 0) {
      for (const sub of subs) {
        const lang = normalizeLanguageCode(sub.lan);
        if (lang) return lang;
      }
    }
  } catch { /* continue */ }

  // Fall back to title analysis
  const title = captureBilibiliTitle();
  return detectFromTitle(title);
}

// --- Platform dispatch ---

function getVideoId() {
  return PLATFORM === 'bilibili' ? getBilibiliVideoId() : getYouTubeVideoId();
}

function isWatchPage() {
  return PLATFORM === 'bilibili' ? isBilibiliWatchPage() : isYouTubeWatchPage();
}

function extractPlayerResponse() {
  // Try to find ytInitialPlayerResponse in page scripts
  const scripts = document.querySelectorAll('script');
  for (const script of scripts) {
    const text = script.textContent;
    if (!text) continue;

    const match = text.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
    if (match) {
      try { return JSON.parse(match[1]); } catch { /* continue */ }
    }
  }

  // Try window property
  if (window.ytInitialPlayerResponse) {
    return window.ytInitialPlayerResponse;
  }

  // Try cached result from page-level script injection
  if (_lastPagePlayerResponse) return _lastPagePlayerResponse;

  return null;
}

// Page-level script injection to access YouTube player API (works after SPA navigation)
let _lastPagePlayerResponse = null;

function requestPlayerResponseFromPage() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', handler);
      resolve(value);
    };
    const msgId = `__yt_pr_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const handler = (e) => {
      if (e.data?.type === msgId) {
        _lastPagePlayerResponse = e.data.pr || null;
        finish(_lastPagePlayerResponse);
      }
    };
    try {
      window.addEventListener('message', handler);
    } catch {
      resolve(null);
      return;
    }

    try {
      const s = document.createElement('script');
      s.textContent = `(function(){
        var pr=null;
        try{var p=document.querySelector('#movie_player');if(p&&p.getPlayerResponse)pr=p.getPlayerResponse();}catch(e){}
        if(!pr)try{pr=window.ytInitialPlayerResponse;}catch(e){}
        var data={type:'${msgId}',pr:null};
        if(pr){try{data.pr={videoDetails:pr.videoDetails||null,captions:pr.captions||null};}catch(e){}}
        window.postMessage(data,'*');
      })();`;
      const root = document.documentElement || document.head || document.body;
      if (!root) {
        finish(null);
        return;
      }
      root.appendChild(s);
      s.remove();
    } catch {
      // YouTube may block inline script assignment (Trusted Types/CSP). Keep going with other detectors.
      finish(null);
      return;
    }

    setTimeout(() => finish(null), 300);
  });
}

function getTitleElement() {
  return document.querySelector(
    'h1.ytd-watch-metadata yt-formatted-string, ' +
    'h1.ytd-video-primary-info-renderer, ' +
    'ytd-watch-metadata h1 yt-formatted-string, ' +
    'ytd-watch-metadata h1, ' +
    '#title h1'
  );
}

function detectFromCaptions(playerResponse) {
  try {
    const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(tracks)) return null;

    // Prefer auto-generated (ASR) track - it indicates the actual spoken language
    const asrTrack = tracks.find((t) => t.kind === 'asr');
    if (asrTrack?.languageCode) {
      return normalizeLanguageCode(asrTrack.languageCode);
    }

    // Fall back to first track
    if (tracks[0]?.languageCode) {
      return normalizeLanguageCode(tracks[0].languageCode);
    }
  } catch { /* continue */ }
  return null;
}

function detectFromVideoDetails(playerResponse) {
  try {
    const lang = playerResponse?.videoDetails?.defaultAudioLanguage;
    if (lang) return normalizeLanguageCode(lang);
  } catch { /* continue */ }
  return null;
}

function normalizeLanguageCode(code) {
  if (!code) return null;
  // Take just the primary language subtag (e.g. 'en-US' -> 'en', 'zh-Hans' -> 'zh')
  const primary = code.toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LANGUAGES[primary] ? primary : null;
}

function detectFromTitle(title) {
  if (!title) return null;
  const lower = title.toLowerCase();

  // Script-based detection (order: ja before zh since Japanese contains kanji)
  for (const [lang, pattern] of SCRIPT_PATTERNS) {
    const matches = lower.match(new RegExp(pattern.source, 'g'));
    if (matches && matches.length >= 3) return lang;
  }

  // Accent-based hints
  const hasSpanishAccent = /[ñ¿¡]/i.test(title) || (/[áéíóú]/i.test(title) && !/[àâçèêëîïôûùüÿœæ]/i.test(title));
  const hasFrenchAccent = /[àâçèêëîïôûùüÿœæ]/i.test(title);

  // Normalize accents for word matching
  const normalized = lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const words = normalized.replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(w => w.length > 1);
  const scores = {};

  for (const [lang, functionWords] of Object.entries(FUNCTION_WORDS)) {
    let count = 0;
    for (const w of words) {
      if (functionWords.includes(w)) count++;
    }
    // Accent bonus
    if (lang === 'es' && hasSpanishAccent && count > 0) count += 1;
    if (lang === 'fr' && hasFrenchAccent && count > 0) count += 1;
    if (count >= 1) scores[lang] = count;
  }

  const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    // Pure accent fallback when no function words match
    if (hasSpanishAccent) return 'es';
    if (hasFrenchAccent) return 'fr';
    return null;
  }

  // Need at least 2 total score points for confidence (1 word + accent = 2)
  if (entries[0][1] < 2) return null;

  // Require clear winner (ahead of runner-up, or only one match)
  if (entries.length === 1 || entries[0][1] > entries[1][1]) {
    return entries[0][0];
  }

  return null;
}

async function detectLanguage() {
  if (!isWatchPage()) return null;

  const playerResponse = extractPlayerResponse();
  const titleEl = getTitleElement();
  const titleLang = detectFromTitle(titleEl?.textContent);

  // Priority 1: Caption tracks (ASR)
  let lang = detectFromCaptions(playerResponse);
  if (lang) return lang;

  // Priority 2: defaultAudioLanguage
  lang = detectFromVideoDetails(playerResponse);
  if (lang) {
    // Guard against common ES/FR metadata swaps by using strong title evidence.
    if (
      titleLang &&
      titleLang !== lang &&
      ((titleLang === 'es' && lang === 'fr') || (titleLang === 'fr' && lang === 'es'))
    ) {
      return titleLang;
    }
    return lang;
  }

  // Priority 3: Title-based fallback
  if (titleLang) return titleLang;

  return null;
}

// --- Video tracking ---

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function startTracking() {
  stopTracking();

  videoElement = document.querySelector('video.html5-main-video') || document.querySelector('video');
  if (!videoElement) return;

  tickTimer = setInterval(() => {
    if (!currentLanguage) return;
    if (!videoElement || videoElement.paused || videoElement.ended) return;
    if (document.visibilityState === 'hidden') return;

    // Lazily capture title/channel if not yet available
    if (!currentVideoTitle) currentVideoTitle = captureVideoTitle();
    if (!currentChannelId) currentChannelId = captureChannelId();

    sendMessage({
      type: 'addWatchTime',
      lang: currentLanguage,
      seconds: 5,
      date: todayKey(),
      videoId: getVideoId(),
      title: currentVideoTitle || '',
      channelId: currentChannelId || '',
    });
  }, TICK_INTERVAL_MS);
}

function stopTracking() {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

// --- SPA navigation handling ---

let navigationTimer = null;

function onNavigate() {
  if (navigationTimer) clearTimeout(navigationTimer);
  navigationTimer = setTimeout(() => {
    handlePageChange();
  }, 100);
}

async function handlePageChange() {
  const videoId = getVideoId();

  // Not a watch page or same video
  if (!isWatchPage()) {
    stopTracking();
    currentLanguage = null;
    lastVideoId = null;
    return;
  }

  if (videoId === lastVideoId) return;
  lastVideoId = videoId;

  // Reset detection
  currentLanguage = null;
  currentVideoTitle = null;
  currentChannelId = null;
  _lastPagePlayerResponse = null;
  detectRetries = 0;
  stopTracking();

  await attemptDetection();
}

function captureYouTubeTitle() {
  const titleEl = getTitleElement();
  if (titleEl?.textContent?.trim()) return titleEl.textContent.trim();
  const pr = extractPlayerResponse();
  if (pr?.videoDetails?.title) return pr.videoDetails.title;
  if (document.title) return document.title.replace(/\s*-\s*YouTube\s*$/i, '').trim();
  return '';
}

function captureYouTubeChannelId() {
  const pr = extractPlayerResponse();
  if (pr?.videoDetails?.channelId) return pr.videoDetails.channelId;
  try {
    const link = document.querySelector('ytd-channel-name a, #owner a');
    if (link?.href) {
      const m = link.href.match(/\/(channel|c|@)\/([^/?]+)/);
      if (m) return m[2];
    }
  } catch { /* continue */ }
  return null;
}

function captureYouTubeChannelName() {
  const pr = extractPlayerResponse();
  if (pr?.videoDetails?.author) return pr.videoDetails.author;
  try {
    const nameEl = document.querySelector('ytd-channel-name a, #owner #text a, #owner #channel-name');
    const name = nameEl?.textContent?.trim();
    if (name) return name;
  } catch { /* continue */ }
  return '';
}

function captureVideoTitle() {
  return PLATFORM === 'bilibili' ? captureBilibiliTitle() : captureYouTubeTitle();
}

function captureChannelId() {
  return PLATFORM === 'bilibili' ? captureBilibiliChannelId() : captureYouTubeChannelId();
}

function captureChannelName() {
  return PLATFORM === 'bilibili' ? captureBilibiliChannelName() : captureYouTubeChannelName();
}

async function attemptDetection() {
  let lang = null;
  try {
    if (PLATFORM === 'bilibili') {
      await requestBilibiliInitialState();
      lang = detectBilibiliLanguage();
    } else {
      await requestPlayerResponseFromPage();
      lang = await detectLanguage();
    }
  } catch {
    lang = null;
  }

  if (lang) {
    currentLanguage = lang;
    currentVideoTitle = captureVideoTitle();
    currentChannelId = captureChannelId();
    startTracking();
    return;
  }

  // Retry - ytInitialPlayerResponse may not be available immediately after SPA navigation
  detectRetries++;
  if (detectRetries < MAX_DETECT_RETRIES) {
    setTimeout(() => attemptDetection(), DETECT_RETRY_DELAY_MS);
  } else {
    // Give up, track as unknown
    currentLanguage = 'unknown';
    currentVideoTitle = captureVideoTitle();
    currentChannelId = captureChannelId();
    startTracking();
  }
}

// --- MutationObserver for video element replacement ---

function observeVideoElement() {
  const container = PLATFORM === 'bilibili'
    ? (document.querySelector('#bilibili-player') || document.querySelector('#playerWrap') || document.body)
    : (document.querySelector('#movie_player') || document.body);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== 'childList') continue;
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.tagName === 'VIDEO' || node.querySelector?.('video')) {
          // Video element was replaced, re-attach tracking
          if (currentLanguage && isWatchPage()) {
            startTracking();
          }
        }
      }
    }
  });
  observer.observe(container, { childList: true, subtree: true });
}

// --- Visibility change ---

document.addEventListener('visibilitychange', () => {
  // Tick handler already checks visibilityState, but we can
  // restart tracking when becoming visible again
  if (document.visibilityState === 'visible' && currentLanguage && isWatchPage() && !tickTimer) {
    startTracking();
  }
});

if (extensionAPI?.runtime?.onMessage) {
  extensionAPI.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'getChannelContext') return;
    sendResponse({
      channelId: captureChannelId() || currentChannelId || null,
      channelName: captureChannelName() || '',
      detectedLanguage: currentLanguage || null,
      videoId: getVideoId(),
      isWatchPage: isWatchPage(),
    });
  });
}

// --- Init ---

async function checkBilibiliEnabled() {
  if (PLATFORM !== 'bilibili') return true;
  try {
    const res = await sendMessage({ type: 'getSettings' });
    return res?.settings?.bilibiliEnabled === true;
  } catch { return false; }
}

(async () => {
  const enabled = await checkBilibiliEnabled();
  if (!enabled) return; // Bilibili tracking disabled in settings

  if (PLATFORM === 'bilibili') {
    // Bilibili SPA navigation: popstate + URL polling
    window.addEventListener('popstate', onNavigate);
    let lastUrl = window.location.href;
    setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        onNavigate();
      }
    }, 1000);
  } else {
    // YouTube SPA navigation events
    window.addEventListener('yt-navigate-finish', onNavigate);
    window.addEventListener('spfdone', onNavigate);
  }

  handlePageChange();
  observeVideoElement();
})();

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    detectFromTitle,
    detectFromCaptions,
    detectFromVideoDetails,
    normalizeLanguageCode,
    isWatchPage,
    getVideoId,
    SUPPORTED_LANGUAGES,
    FUNCTION_WORDS,
    SCRIPT_PATTERNS,
  };
}
