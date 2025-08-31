// Offscreen logic implementing translation and message dispatch without eval

// MV2 -> MV3 compatibility shims for background code running in offscreen DOM
if (!chrome.browserAction && chrome.action) {
  chrome.browserAction = {
    setIcon: chrome.action.setIcon.bind(chrome.action)
  };
}

const YOUDAO_BASE = 'https://mobile.youdao.com';

function isWord(text) {
  if (!text) return false;
  // Normalize only for detection (preserve original text for translation)
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

function sanitizeHTML(html) {
  // keep minimal to parse; DOMParser will handle
  return html;
}

function generateBaseForms(word) {
  const w = String(word || '').toLowerCase();
  const forms = new Set([w]);
  if (w.endsWith('ies') && w.length > 3) forms.add(w.slice(0, -3) + 'y');
  if (w.endsWith('es') && w.length > 2) forms.add(w.slice(0, -2));
  if (w.endsWith('s') && w.length > 1) forms.add(w.slice(0, -1));
  if (w.endsWith('ing') && w.length > 4) {
    forms.add(w.slice(0, -3));
    forms.add(w.slice(0, -3) + 'e');
  }
  if (w.endsWith('ed') && w.length > 3) {
    forms.add(w.slice(0, -2));
    forms.add(w.slice(0, -1));
  }
  return Array.from(forms);
}

async function fetchPhoneticOnly(word) {
  const tryExtractPh = (doc) => {
    const roots = [
      doc.querySelector('#phrsListTab'),
      doc.querySelector('#ec_contentWrp'),
      doc.querySelector('#ec'),
      doc.body
    ].filter(Boolean);
    for (const root of roots) {
      const ph =
        root.querySelector('#phrsListTab .pronounce .phonetic') ||
        root.querySelector('#phrsListTab .phonetic') ||
        root.querySelector('.baav .pronounce .phonetic') ||
        root.querySelector('.baav .phonetic') ||
        root.querySelector('.wordbook-js .phonetic') ||
        root.querySelector('.phonetic');
      if (ph) { return ph.textContent.trim(); }
    }
    return '';
  };
  try {
    const dUrl = `https://dict.youdao.com/w/eng/${encodeURIComponent(word)}/`;
    const dRes = await fetch(dUrl, { credentials: 'omit' });
    const dText = await dRes.text();
    let doc = new DOMParser().parseFromString(sanitizeHTML(dText), 'text/html');
    const ph = tryExtractPh(doc);
    if (ph) return ph;
  } catch(_) {}
  try {
    const mUrl = `${YOUDAO_BASE}/dict?le=eng&q=${encodeURIComponent(word)}`;
    const mRes = await fetch(mUrl, { credentials: 'omit' });
    const mText = await mRes.text();
    const doc = new DOMParser().parseFromString(sanitizeHTML(mText), 'text/html');
    const ph = tryExtractPh(doc);
    if (ph) return ph;
  } catch(_) {}
  return '';
}

async function fetchDict(word) {
  const result = { status: 'failure', text: word };
  const tryExtract = (doc) => {
    const roots = [
      doc.querySelector('#phrsListTab'),
      doc.querySelector('#ec_contentWrp'),
      doc.querySelector('#ec')
    ].filter(Boolean);
    // phonetic
    for (const root of roots) {
      const ph =
        root.querySelector('.pronounce .phonetic') ||
        root.querySelector('.baav .phonetic') ||
        root.querySelector('.phonetic');
      if (ph) { result.phonetic = ph.textContent.trim(); break; }
    }
    // basic meanings: only within trans-container ul > li
    let items = [];
    for (const root of roots) {
      const lis = [...root.querySelectorAll('.trans-container ul li')]
        .map(li => li.textContent.trim())
        .filter(Boolean);
      if (lis.length) { items = lis; break; }
    }
    // filter to keep concise pos lines, drop obvious example sources
    const posPrefix = /^(n|v|vi|vt|adj|adv|prep|pron|conj|art|num|int|abbr)\./i;
    const filtered = items
      .filter(t => !/VOA|youdao|\bexample\b|\b例句\b/i.test(t))
      .filter(t => t.length <= 120)
      .filter((t, i, arr) => posPrefix.test(t) || (i < 8 && !posPrefix.test(t)))
      .slice(0, 12);
    if (filtered.length) {
      result.translation = filtered.join('\n');
      result.status = 'success';
    }
  };
  // Prefer desktop first (richer structure), then fallback to mobile
  try {
    const dUrl = `https://dict.youdao.com/w/eng/${encodeURIComponent(word)}/`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
    const dRes = await fetch(dUrl, { credentials: 'omit', signal: controller.signal });
    clearTimeout(timeoutId);
    const dText = await dRes.text();
    const dDoc = new DOMParser().parseFromString(sanitizeHTML(dText), 'text/html');
    tryExtract(dDoc);
  } catch (_) {}
  if (result.status !== 'success') {
    try {
      const mUrl = `${YOUDAO_BASE}/dict?le=eng&q=${encodeURIComponent(word)}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
      const mRes = await fetch(mUrl, { credentials: 'omit', signal: controller.signal });
      clearTimeout(timeoutId);
      const mText = await mRes.text();
      const mDoc = new DOMParser().parseFromString(sanitizeHTML(mText), 'text/html');
      tryExtract(mDoc);
    } catch (_) {}
  }
  // Do not mutate translation output here; leave rendering to content script
  if (result.status !== 'success') result.translation = '未找到释义';
  return result;
}

async function fetchTranslate(text) {
  // Youdao mobile translate
  try {
    const url = `${YOUDAO_BASE}/translate`;
    const form = new URLSearchParams();
    form.set('inputtext', text);
    form.set('type', 'AUTO');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      credentials: 'omit',
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(sanitizeHTML(html), 'text/html');
    const lis = [...doc.querySelectorAll('#translateResult li')];
    if (lis.length) {
      return { status: 'success', translation: lis.map(li => li.textContent.trim()).join('<br/><br/>') };
    }
  } catch (_) {}
  // Fallback to Google translate (public endpoint)
  try {
    const g = await fetchGoogle(text);
    if (g && g.translation) return { status: 'success', translation: g.translation };
  } catch (_) {}
  return { status: 'failure', translation: '未找到释义' };
}

async function fetchGoogle(text) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
  const res = await fetch(url, { credentials: 'omit', signal: controller.signal });
  clearTimeout(timeoutId);
  const data = await res.json();
  // data[0] is array of [translated, original, ...]
  const segs = Array.isArray(data) && Array.isArray(data[0]) ? data[0].map(s => s[0]).filter(Boolean) : [];
  return { translation: segs.join('') };
}

async function translateHandler(payload, sendResponse) {
  let text = (payload && payload.text || '').trim();
  // trim paired punctuation around the selection (added for duplicate identity)
  text = text.replace(/^[\'\"“”‘’\(\[\{]+/, '').replace(/[\'\"“”‘’\)\]\}]+$/, '');
  if (!text) {
    try {
      return sendResponse({ status: 'failure', translation: '未找到释义' });
    } catch (e) {
      console.warn('Failed to send response for empty text:', e);
      return;
    }
  }
  let result;
  try {
    if (isWord(text)) {
      result = await fetchDict(text);
      if (result.status !== 'success') {
        // fallback to google for single words too
        const g = await fetchGoogle(text);
        if (g && g.translation) result = { status: 'success', translation: g.translation, text };
      }
    } else {
      result = await fetchTranslate(text);
    }
    if (!result.text) result.text = text;
  } catch (e) {
    result = { status: 'failure', translation: '未找到释义', text };
  }
  // Add timeout: prefer payload.timeout if provided, else read from storage
  const preferred = Number(payload && payload.timeout);
  if (Number.isFinite(preferred) && preferred > 0) {
    result.timeout = preferred;
    try {
      sendResponse(result);
    } catch (e) {
      console.warn('Failed to send response with preferred timeout:', e);
    }
    return;
  }
  const getter = storageNS && storageNS.local && storageNS.local.get ? storageNS.local.get : null;
  if (!getter) {
    result.timeout = 10;
    try {
      sendResponse(result);
    } catch (e) {
      console.warn('Failed to send response without getter:', e);
    }
    return;
  }
  getter({ notifyTimeout: 10 }, (opts) => {
    const to = Number(opts && opts.notifyTimeout);
    const timeout = Number.isFinite(to) ? to : 10;
    result.timeout = timeout;
    try {
      sendResponse(result);
    } catch (e) {
      console.warn('Failed to send response from storage callback:', e);
    }
  });
}

function saveCurrent(text) {
  const setter = storageNS && storageNS.local && storageNS.local.set ? storageNS.local.set : null;
  if (setter) setter({ __currentSelection: text });
}

function getCurrent(sendResponse) {
  const getter = storageNS && storageNS.local && storageNS.local.get ? storageNS.local.get : null;
  if (!getter) { 
    try {
      sendResponse(''); 
    } catch (e) {
      console.warn('Failed to send response in getCurrent:', e);
    }
    return; 
  }
  getter({ __currentSelection: '' }, (items) => {
    try {
      sendResponse(items.__currentSelection || '');
    } catch (e) {
      console.warn('Failed to send response in getCurrent callback:', e);
    }
  });
}

function stripInvisibleMarkers(t) {
  try { return String(t).replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]+/g, ''); } catch(_) { return t; }
}

function handleSelection(payloadText, presetTimeout) {
  // Persist selection as-is (original behavior uses plain text already)
  const visible = stripInvisibleMarkers(payloadText || '');
  saveCurrent(visible);
  if (!isWord(visible)) return;
  if (!chrome.tabs || !chrome.tabs.query) return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || tab.id == null) return;
    const getter = storageNS && storageNS.local && storageNS.local.get ? storageNS.local.get : null;
    if (!getter) return;
    getter({ siteRules: [{ site: '*', enabled: true }], notifyTimeout: 10 }, (opts) => {
      const rules = opts.siteRules || [];
      const hostname = (() => {
        try { return new URL(tab.url).hostname; } catch { return '*'; }
      })();
      const match = rules.find(r => r.site === hostname) || rules.find(r => r.site === '*');
      if (match && match.enabled) {
        const startAt = Date.now();
        // prefer timeout forwarded from SW if provided
        const to = Number(presetTimeout);
        const stored = Number(opts && opts.notifyTimeout);
        const timeout = Number.isFinite(to) ? to : (Number.isFinite(stored) ? stored : 10);
        const displayText = String(payloadText || visible || '');
        const plainText = stripInvisibleMarkers(displayText);
        const wordText = visible;
        // Schedule hide relative to the moment the toast was first shown (consistent per toast)
        try {
          setTimeout(() => {
            chrome.tabs.sendMessage(tab.id, { type: 'translate', from: 'page', text: displayText, wordText, result: { text: wordText, show: false } });
          }, Math.max(0, timeout * 1000));
        } catch(_) {}
        // Also request offscreen translation and send final result back to the toast (no extra hide here)
        translateHandler({ text: plainText, from: 'page', timeout }, (result) => {
          // Ensure timeout is present both at top-level and inside result for robust UIs
          const tmo = Number.isFinite(result && result.timeout) ? result.timeout : timeout;
          if (result) result.timeout = tmo;
          // If timeout has already elapsed, avoid re-showing a disappeared toast
          try {
            const elapsed = Date.now() - startAt;
            if (elapsed >= tmo * 1000 - 50) {
              result.show = false;
            }
          } catch(_) {}
          // Use displayText for identity, but keep result.text as plain word to enable word-mode (phonetic/pos)
          try { if (result && typeof result === 'object') result.text = wordText; } catch(_) {}
          chrome.tabs.sendMessage(tab.id, { type: 'translate', from: 'page', text: displayText, wordText, timeout: tmo, result });
        });
      }
    });
  });
}

function handleLinkInspect(enabled) {
  // No-op: avoid setIcon to prevent resource fetch errors in MV3
}

const isSw = (typeof window === 'undefined');
const runtimeNS = (typeof chrome !== 'undefined' && chrome.runtime) ? chrome : (typeof browser !== 'undefined' ? browser : null);
const storageNS = chrome && chrome.storage ? chrome.storage : (runtimeNS && runtimeNS.storage ? runtimeNS.storage : null);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message && message.type) {
    case 'translate':
      try {
        let responseTimeout;
        let responseSent = false;
        
        // 设置超时保护，防止消息通道永久挂起
        responseTimeout = setTimeout(() => {
          if (!responseSent) {
            responseSent = true;
            try {
              sendResponse({ 
                status: 'failure', 
                translation: '翻译超时', 
                text: message.text || '',
                timeout: 10
              });
            } catch (e) {
              console.warn('Failed to send timeout response:', e);
            }
          }
        }, 15000); // 15秒超时
        
        translateHandler(message, (resp) => { 
          if (!responseSent) {
            responseSent = true;
            clearTimeout(responseTimeout);
            try { 
              sendResponse(resp); 
            } catch(e) {
              console.warn('Failed to send translate response:', e);
            }
          }
        });
      } catch (e) {
        console.error('Error in translateHandler:', e);
        try {
          sendResponse({ status: 'failure', translation: '翻译处理出错', text: message.text || '' });
        } catch (sendErr) {
          console.warn('Failed to send error response:', sendErr);
        }
      }
      return true;
    case 'selection':
      handleSelection(message.displayText || message.text || '', Number(message && message.timeout));
      saveCurrent(stripInvisibleMarkers(message.displayText || message.text || ''));
      return false; // 同步处理，不需要异步响应
    case 'current':
      try {
        let responseTimeout;
        let responseSent = false;
        
        // 为 current 请求也添加超时保护
        responseTimeout = setTimeout(() => {
          if (!responseSent) {
            responseSent = true;
            try {
              sendResponse('');
            } catch (e) {
              console.warn('Failed to send timeout response for current:', e);
            }
          }
        }, 5000); // 5秒超时
        
        getCurrent((result) => {
          if (!responseSent) {
            responseSent = true;
            clearTimeout(responseTimeout);
            try {
              sendResponse(result);
            } catch (e) {
              console.warn('Failed to send current response:', e);
            }
          }
        });
      } catch (e) {
        console.error('Error in getCurrent:', e);
        try {
          sendResponse('');
        } catch (sendErr) {
          console.warn('Failed to send error response for current:', sendErr);
        }
      }
      return true;
    case 'linkInspect':
      handleLinkInspect(!!message.enabled);
      return false; // 同步处理，不需要异步响应
    default:
      return false; // 明确表示不需要异步响应
  }
});
