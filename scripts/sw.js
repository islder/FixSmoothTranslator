// Service worker for MV3: bootstraps offscreen document and bridges messages

const OFFSCREEN_URL = chrome.runtime.getURL('pages/offscreen.html');
const OFFSCREEN_REASON = 'DOM parsing and legacy MV2 background logic';
// Use DOM_PARSER to allow DOM APIs inside offscreen document
const OFFSCREEN_DOCUMENT = 'DOM_PARSER';

// No-op helper removed; offscreen is responsible for initial show to avoid races

async function ensureOffscreen() {
  // Check if offscreen API is available
  if (!chrome.offscreen) {
    console.warn('Offscreen API not available');
    return;
  }
  
  try {
    // Check if hasDocument method exists and if document already exists
    const hasDocument = chrome.offscreen.hasDocument;
    if (hasDocument) {
      const existing = await hasDocument();
      if (existing) return;
    }
    
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: [OFFSCREEN_DOCUMENT],
      justification: OFFSCREEN_REASON,
    });
  } catch (error) {
    console.error('Failed to create offscreen document:', error);
  }
}

// Word recording function
function recordWord(text) {
  if (!text) return;
  
  // Clean and normalize the word
  const cleanWord = text.toLowerCase().trim();
  
  chrome.storage.local.get(['recordedWords', 'wordRetentionDays', 'wordRecordingEnabled'], function(result) {
    // Check if feature is enabled (default to true for backward compatibility)
    const isEnabled = result.wordRecordingEnabled !== false;
    if (!isEnabled) return;
    const words = result.recordedWords || {};
    const retentionDays = result.wordRetentionDays || 30;
    const MAX_WORDS = 10000; // Prevent memory overflow
    
    // Skip if word already exists (deduplication)
    if (words[cleanWord]) {
      // Update timestamp for existing word to keep it fresh
      words[cleanWord].timestamp = Date.now();
    } else {
      // Check if we've reached the limit
      const wordCount = Object.keys(words).length;
      if (wordCount >= MAX_WORDS) {
        // Remove oldest words to make room
        const sortedWords = Object.entries(words).sort((a, b) => a[1].timestamp - b[1].timestamp);
        const toRemove = Math.max(1, Math.floor(wordCount * 0.1)); // Remove 10% of oldest
        for (let i = 0; i < toRemove; i++) {
          delete words[sortedWords[i][0]];
        }
      }
      
      // Add new word
      words[cleanWord] = {
        word: cleanWord,
        timestamp: Date.now()
      };
    }
    
    // Clean old words based on retention setting
    const now = Date.now();
    const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
    const cutoffTime = now - retentionMs;
    
    for (const word in words) {
      if (words[word].timestamp < cutoffTime) {
        delete words[word];
      }
    }
    
    // Save updated words
    chrome.storage.local.set({ recordedWords: words });
  });
}

 function isWordSelection(text) {
  if (!text) return false;
  // Normalize only for word detection to avoid false negatives
  const t = String(text)
    .replace(/[\u00A0\u00AD]/g, '') // NBSP and soft hyphen
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '') // zero-width
    .trim()
    .replace(/^[\'\"""''\(\)\[\]\{\}«»《》【】]+/, '')
    .replace(/[\'\"""''\(\)\[\]\{\}«»《》【】.,!?;:，。！？；：、·…—]+$/, '');
  
  // Support 1-2 words: single word or two words separated by space/hyphen
  const oneWordPattern = /^[A-Za-z]+(?:[-'][A-Za-z]+)*$/;
  const twoWordPattern = /^[A-Za-z]+(?:[-'][A-Za-z]+)*\s+[A-Za-z]+(?:[-'][A-Za-z]+)*$/;
  
  return oneWordPattern.test(t) || twoWordPattern.test(t);
 }

// Handle connection cleanup for back/forward cache
function isValidSender(sender) {
  try {
    // Check if the sender tab is still valid and not in bfcache
    if (!sender || !sender.tab) return true; // Non-tab senders are always valid
    
    // Check if we can still communicate with the tab
    if (sender.tab.id !== undefined && sender.tab.id >= 0) {
      return true;
    }
    return false;
  } catch (e) {
    console.warn('Sender validation failed:', e);
    return false;
  }
}

// Proxy messages to the offscreen page once it exists
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    // Check if extension context is still valid
    if (!chrome.runtime?.id) {
      console.warn('Extension context invalidated in service worker');
      return false;
    }
    
    // Check if the sender is still valid (not in bfcache)
    if (!isValidSender(sender)) {
      console.warn('Message from invalid sender (possibly in bfcache)');
      return false;
    }
  } catch (e) {
    console.warn('Extension context check failed in service worker:', e);
    return false;
  }
  
  // Ignore messages that were already bridged by this service worker to avoid loops
  if (message && message.__bridged) {
    return false; // let the intended target handle it, don't keep channel open
  }
  // Handle quick, UI-triggered messages directly to avoid race with offscreen boot
  if (message && message.type === 'selection') {
    const raw = (message.text || '').trim();
    // Original conservative cleanup: strip only quotes/brackets at both ends
    const text = raw
      .replace(/^[\'\"“”‘’\(\[\{]+/, '')
      .replace(/[\'\"“”‘’\)\]\}]+$/, '');
    chrome.storage.local.set({ __currentSelection: text });
    
    // Record word if it's a valid selection
    if (text && isWordSelection(text)) {
      recordWord(text);
    }
    if (!text || !isWordSelection(text)) return false;
    const tabId = sender && sender.tab && sender.tab.id;
    if (tabId != null) {
      // Debounce identical selections per tab to avoid spurious triggers
      try {
        if (!globalThis.__cstLastShow) globalThis.__cstLastShow = new Map();
        const key = `${tabId}|${text.toLowerCase()}`;
        const now = Date.now();
        const last = globalThis.__cstLastShow.get(key) || 0;
        if (now - last < 650) {
          return false;
        }
        globalThis.__cstLastShow.set(key, now);
      } catch(_) {}
      // Build a visible-ignored unique wrapper using paired punctuation that UI strips for word-mode
      if (typeof globalThis.__cstDisplayCounter !== 'number') globalThis.__cstDisplayCounter = 0;
      const n = (++globalThis.__cstDisplayCounter) >>> 0;
      const pairs = [
        ['"', '"'],
        ['\'', '\''],
        ['“', '”'],
        ['‘', '’'],
        ['(', ')'],
        ['[', ']'],
        ['{', '}']
      ];
      const pick = pairs[n % pairs.length];
      const wrapper = (t) => pick[0] + t + pick[1];
      chrome.storage.local.get({ siteRules: [{ site: '*', enabled: true }], notifyTimeout: 10 }, (opts) => {
        const rules = opts.siteRules || [];
        const hostname = (() => { try { return new URL(sender.tab.url).hostname; } catch { return '*'; } })();
        const rule = rules.find(r => r.site === hostname) || rules.find(r => r.site === '*');
        if (rule && rule.enabled) {
          const to = Number(opts && opts.notifyTimeout);
          const timeout = Number.isFinite(to) ? to : 10;
          // Build invisible identity so repeated selections are unique without visible quotes
          if (typeof globalThis.__cstDisplayCounter !== 'number') globalThis.__cstDisplayCounter = 0;
          const n = (++globalThis.__cstDisplayCounter) >>> 0;
          const zw = ['\u200B','\u200C','\u200D','\uFEFF'];
          const id = zw[n % 4] + zw[(n >> 2) % 4];
          const displayText = text + id;
          // Immediate pending toast for responsiveness; carry both identity and visible word
          try {
            // Verify tab is still valid before sending message
            chrome.tabs.get(tabId, (tab) => {
              if (chrome.runtime.lastError) {
                console.warn('Tab no longer valid:', chrome.runtime.lastError.message);
                return;
              }
              chrome.tabs.sendMessage(tabId, { type: 'translate', text: displayText, wordText: text, from: 'page', timeout, result: { timeout, status: 'pending' } }, () => {
                if (chrome.runtime.lastError) {
                  console.warn('Failed to send message to tab:', chrome.runtime.lastError.message);
                }
              });
            });
          } catch(e) {
            console.warn('Error sending message to tab:', e);
          }
          // Forward to offscreen with the same timeout to schedule hide and compute final result
          ensureOffscreen().then(() => {
            const bridged = { __bridged: true, type: 'selection', text, displayText, wordText: text, timeout };
            chrome.runtime.sendMessage(bridged);
          });
        }
      });
    }
    return false; // explicitly return false for no response
  }
  if (message && message.type === 'current') {
    chrome.storage.local.get({ __currentSelection: '' }, (items) => sendResponse(items.__currentSelection));
    return true;
  }
  if (message && message.type === 'linkInspect') {
    // Avoid setIcon to prevent icon path issues in MV3; rely on CSS indicator in page instead.
    return false;
  }
  // Handle page hiding (entering bfcache)
  if (message && message.type === 'pageHiding') {
    // Clean up any resources for this tab
    const tabId = sender && sender.tab && sender.tab.id;
    if (tabId != null) {
      // Clear debounce cache for this tab
      if (globalThis.__cstLastShow) {
        const keysToDelete = [];
        for (const key of globalThis.__cstLastShow.keys()) {
          if (key.startsWith(`${tabId}|`)) {
            keysToDelete.push(key);
          }
        }
        keysToDelete.forEach(key => globalThis.__cstLastShow.delete(key));
      }
      console.log('Cleaned up resources for tab entering bfcache:', tabId);
    }
    return false; // No response needed
  }
  // Handle translate with a safe fallback to avoid undefined responses
  if (message && message.type === 'translate') {
    ensureOffscreen().then(() => {
      const forward = (timeoutOverride) => {
        let responded = false;
        const bridged = Object.assign({ __bridged: true }, message);
        if (Number.isFinite(timeoutOverride)) bridged.timeout = timeoutOverride;
        chrome.runtime.sendMessage(bridged, (resp) => {
          responded = true;
          if (chrome.runtime.lastError) {
            console.warn('Translate message failed:', chrome.runtime.lastError.message);
            try {
              sendResponse({ 
                status: 'failure', 
                translation: '消息传递失败', 
                text: message.text || '', 
                timeout: 10 
              });
            } catch (e) {
              console.warn('Failed to send error response:', e);
            }
            return;
          }
          try { sendResponse(resp); } catch (_) {}
          // No extra hide here; offscreen schedules hide on first show
        });
        // Safety fallback
        chrome.storage.local.get({ notifyTimeout: 10 }, (opts) => {
          setTimeout(() => {
            if (!responded) {
              try {
                const to = Number(opts && opts.notifyTimeout);
                const timeout = Number.isFinite(to) ? to : 10;
                sendResponse({ status: 'failure', translation: '未找到释义', text: message.text || '', timeout });
              } catch (_) {}
            }
          }, 4000);
        });
      };
      // If caller didn't include timeout and it's from a tab (not popup), inject current timeout
      if (!Number.isFinite(Number(message && message.timeout)) && sender && sender.tab && sender.tab.id != null) {
        chrome.storage.local.get({ notifyTimeout: 10 }, (opts) => {
          const to = Number(opts && opts.notifyTimeout);
          forward(Number.isFinite(to) ? to : 10);
        });
      } else {
        forward(Number(message && message.timeout));
      }
    });
    return true;
  }
  // Fallback: proxy other messages to offscreen
  ensureOffscreen().then(() => {
    const bridged = Object.assign({ __bridged: true }, message);
    chrome.runtime.sendMessage(bridged, (resp) => {
      if (chrome.runtime.lastError) {
        console.warn('Message sending failed:', chrome.runtime.lastError.message);
        try {
          sendResponse({ error: chrome.runtime.lastError.message });
        } catch (e) {
          console.warn('Failed to send error response:', e);
        }
        return;
      }
      try { 
        sendResponse(resp); 
      } catch (error) {
        console.warn('Failed to send response:', error);
      }
    });
  }).catch((error) => {
    console.error('Failed to ensure offscreen:', error);
    // Send error response to prevent channel timeout
    try {
      sendResponse({ error: 'Failed to initialize offscreen document' });
    } catch (e) {
      console.warn('Failed to send error response:', e);
    }
  });
  return true; // keep the channel open for async response
});

// Commands mapping (handle directly)
chrome.commands?.onCommand.addListener(async (command) => {
  if (command === 'toggle-link-inspect') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (tab && tab.id != null) {
        chrome.tabs.sendMessage(tab.id, { type: 'toggleLink' });
      }
    });
  }
});

// Extension lifecycle
chrome.runtime.onInstalled.addListener(async () => {
  await ensureOffscreen();
  // Only set defaults if they are not already defined, do not overwrite user settings
  chrome.storage.local.get(['notifyTimeout', 'siteRules'], (items) => {
    const updates = {};
    if (typeof items.notifyTimeout === 'undefined') {
      updates.notifyTimeout = 10; // default fade time in seconds
    }
    if (!Array.isArray(items.siteRules)) {
      updates.siteRules = [{ site: '*', enabled: true }];
    }
    if (Object.keys(updates).length) {
      chrome.storage.local.set(updates);
    }
  });
});

// Warm on startup
chrome.runtime.onStartup?.addListener(async () => {
  await ensureOffscreen();
  // Do not override user-configured options on startup
});
