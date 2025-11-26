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
  
  // Support 1-3 words: single word, two words, or three words separated by space/hyphen
  const oneWordPattern = /^[A-Za-z]+(?:[-'][A-Za-z]+)*$/;
  const twoWordPattern = /^[A-Za-z]+(?:[-'][A-Za-z]+)*\s+[A-Za-z]+(?:[-'][A-Za-z]+)*$/;
  const threeWordPattern = /^[A-Za-z]+(?:[-'][A-Za-z]+)*\s+[A-Za-z]+(?:[-'][A-Za-z]+)*\s+[A-Za-z]+(?:[-'][A-Za-z]+)*$/;
  
  return oneWordPattern.test(t) || twoWordPattern.test(t) || threeWordPattern.test(t);
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
  return { status: 'failure', translation: '未找到释义' };
}

// iCiba dictionary for word lookup when Youdao fails
async function fetchICiba(word) {
  // Clean the word - remove any zero-width characters and trim
  const cleanWord = String(word)
    .replace(/[\u200B\u200C\u200D\u200E\u200F\uFEFF]/g, '') // Remove zero-width chars
    .trim();
  
  try {
    const url = `https://www.iciba.com/word?w=${encodeURIComponent(cleanWord)}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
    const res = await fetch(url, { credentials: 'omit', signal: controller.signal });
    clearTimeout(timeoutId);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    
    const result = { status: 'failure', text: cleanWord };
    
    // Extract phonetic from iCiba page - look for phonetic symbols
    // Try multiple approaches
    let phonetic = '';
    
    // Approach 1: Try selectors first
    const phoneticSelectors = [
      '.Mean_symbols__fpCmS span',
      '.Mean_symbols__fpCmS',
      '[class*="symbols"] span',
      '[class*="symbols"]',
      '[class*="Symbol"]',
      '.Mean_pronounce__dqn_a span',
      '.Mean_pronounce__dqn_a',
      '.pronounce span',
      '.pronounce',
      '[class*="pronounce"] span',
      '[class*="pronounce"]',
      '[class*="phonetic"]',
      'span[class*="phone"]'
    ];
    
    const allPhonetics = [];
    
    for (const selector of phoneticSelectors) {
      const phoneticElems = doc.querySelectorAll(selector);
      if (phoneticElems.length > 0) {
        phoneticElems.forEach(elem => {
          const text = elem.textContent.trim();
          // Look for text containing phonetic brackets
          if (text && (text.includes('[') || text.includes('/'))) {
            // Try multiple patterns
            const patterns = [
              /\[[^\]]+\]/g,  // [xxx] - note the 'g' flag to get all matches
              /\/[^\/]+\//g,  // /xxx/
              /［[^］]+］/g    // Full-width brackets
            ];
            
            for (const pattern of patterns) {
              const matches = text.match(pattern);
              if (matches) {
                matches.forEach(m => {
                  if (!allPhonetics.includes(m)) {
                    allPhonetics.push(m);
                  }
                });
              }
            }
          }
        });
      }
    }
    
    // Choose the best phonetic (prefer US/second one if available, otherwise first)
    if (allPhonetics.length > 0) {
      // If we have multiple phonetics, prefer the second one (usually US)
      // Otherwise use the first one
      phonetic = allPhonetics.length > 1 ? allPhonetics[1] : allPhonetics[0];
    }
    
    // Approach 2: Search in page text more broadly
    if (!phonetic && allPhonetics.length === 0) {
      const pageText = doc.body ? doc.body.innerText : '';
      
      // More comprehensive phonetic pattern - use 'g' flag to get all matches
      const phoneticPatterns = [
        /\[[ˈˌ\w\s:əɪʊæɑɔʌɛɪŋθðʃʒaeiouːɜːɒʤʧ]+\]/g,  // IPA in square brackets
        /\/[ˈˌ\w\s:əɪʊæɑɔʌɛɪŋθðʃʒaeiouːɜːɒʤʧ]+\//g,    // IPA in slashes
        /\[[a-zA-Z:ˈˌ\-\.]+\]/g,                          // Simple phonetic
        /［[^］]+］/g                                       // Full-width brackets
      ];
      
      const textPhonetics = [];
      for (const pattern of phoneticPatterns) {
        const matches = pageText.match(pattern);
        if (matches) {
          matches.forEach(m => {
            if (!textPhonetics.includes(m)) {
              textPhonetics.push(m);
            }
          });
        }
      }
      
      if (textPhonetics.length > 0) {
        // Choose the best one (prefer second if available for US pronunciation)
        phonetic = textPhonetics.length > 1 ? textPhonetics[1] : textPhonetics[0];
      }
    }
    
    // Phonetic will be set later when building the final result
    
    // Extract meanings from iCiba page - try multiple approaches
    const meanings = [];
    
    // Approach 1: Try to get meanings from class-based selectors
    // More inclusive selectors to catch different page structures
    const meaningSelectors = [
      '.Mean_part__UI0nU',
      '[class*="Mean_part"]',
      '[class*="Mean"] [class*="part"]',
      '.trans-container li',
      '[class*="trans"]'
    ];
    
    for (const selector of meaningSelectors) {
      if (meanings.length > 0) {
        break;
      }
      
      const elements = doc.querySelectorAll(selector);
      
      elements.forEach(elem => {
        // Look for part of speech (n., v., adj., etc.)
        const text = elem.textContent.trim();
        
        // Skip common UI elements
        const uiKeywords = [
          'AI工具', 'AI释义', 'AI解词', '英文校对', '词霸下载',
          '简明词典', '柯林斯', '牛津', '查看', '更多', '翻译',
          '例句', '登录', '首页', '其他', '全部', '实用场景',
          'clean翻译清洁', '以上结果来自机器翻译'
        ];
        
        // Check if this is a UI element
        const isUIElement = uiKeywords.some(keyword => text.includes(keyword));
        
        // Filter out navigation, buttons, and other UI elements
        if (text && 
            text.length > 1 && 
            text.length < 500 &&
            !isUIElement) {
          
          // Check if it looks like a definition (has part of speech marker at beginning)
          if (/^(int|n|v|vi|vt|adj|adv|prep|pron|conj|art|num|abbr)\./i.test(text)) {
            // Split by part of speech markers
            const posPattern = /(int\.|n\.|v\.|vi\.|vt\.|adj\.|adv\.|prep\.|pron\.|conj\.|art\.|num\.|abbr\.)/g;
            
            // Split text while keeping the delimiters
            const splits = text.split(posPattern);
            
            // Recombine part of speech with its definition
            const combined = [];
            for (let i = 0; i < splits.length; i++) {
              const part = splits[i].trim();
              if (!part) continue;
              
              // Check if this is a POS marker
              if (/^(int|n|v|vi|vt|adj|adv|prep|pron|conj|art|num|abbr)\.$/i.test(part)) {
                // This is a POS marker, combine with next part if available
                if (i + 1 < splits.length && splits[i + 1].trim()) {
                  const def = splits[i + 1].trim();
                  // Skip if the definition part looks like UI text
                  if (!uiKeywords.some(keyword => def.includes(keyword))) {
                    const meaning = part + ' ' + def;
                    combined.push(meaning);
                  }
                  i++; // Skip next part as we've combined it
                }
              }
            }
            
            // Add all combined meanings
            meanings.push(...combined);
          }
        }
      });
    }
    
    // Approach 2: If no meanings found, try extracting from page text directly
    if (meanings.length === 0) {
      
      // Get the page text and look for definitions section
      const pageText = doc.body ? doc.body.innerText : '';
      const lines = pageText.split('\n').map(l => l.trim()).filter(l => l);
      
      // Look for the "释义" (definitions) section
      let inDefinitionsSection = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (line === '释义') {
          inDefinitionsSection = true;
          continue;
        }
        
        if (inDefinitionsSection) {
          // Stop at next section markers
          if (line === '实用场景例句' || line === '全部' || line.includes('例句')) {
            break;
          }
          
          // Look for lines with part of speech markers
          if (/^(int|n|v|vi|vt|adj|adv|prep|pron|conj|art|num|abbr)\./i.test(line)) {
            // Split if multiple POS on same line
            const posPattern = /(int\.|n\.|v\.|vi\.|vt\.|adj\.|adv\.|prep\.|pron\.|conj\.|art\.|num\.|abbr\.)/g;
            const splits = line.split(posPattern);
            
            for (let j = 0; j < splits.length; j++) {
              const part = splits[j].trim();
              if (/^(int|n|v|vi|vt|adj|adv|prep|pron|conj|art|num|abbr)\.$/i.test(part) && j + 1 < splits.length) {
                const meaning = part + ' ' + splits[j + 1].trim();
                meanings.push(meaning);
                j++;
              }
            }
          }
        }
      }
    }
    
    // Build the final result like Youdao format
    const resultParts = [];
    
    // Store phonetic separately - don't add to translation text
    if (phonetic) {
      // Store phonetic in result object only
      const phoneticStr = String(phonetic).trim();
      result.phonetic = phoneticStr;
      // DON'T add to resultParts to avoid duplication
    }
    
    // Add meanings
    if (meanings.length > 0) {
      // Clean up and add meanings
      meanings.slice(0, 10).forEach(meaning => {
        // Ensure proper spacing after part of speech markers
        let cleaned = meaning
          .replace(/((?:int|n|v|vi|vt|adj|adv|prep|pron|conj|art|num|abbr)\.)([^ ])/gi, '$1 $2')
          .trim();
        resultParts.push(cleaned);
      });
    }
    
    if (resultParts.length > 0) {
      result.translation = resultParts.join('\n');
      result.status = 'success';
    } else {
      result.translation = '未找到释义';
    }
    
    return result;
  } catch (error) {
    console.error('iCiba fetch error:', error);
    return { status: 'failure', text: cleanWord || word, translation: '未找到释义' };
  }
}

async function translateHandler(payload, sendResponse) {
  let text = (payload && payload.text || '').trim();
  // trim paired punctuation around the selection (added for duplicate identity)
  text = text.replace(/^[\'\"""''\(\[\{]+/, '').replace(/[\'\"""''\)\]\}]+$/, '');
  if (!text) {
    try {
      return sendResponse({ status: 'failure', translation: '未找到释义' });
    } catch (e) {
      console.warn('Failed to send response for empty text:', e);
      return;
    }
  }
  
  // Get translation source preferences
  let sources = null;
  
  console.log('[FixSmoothTranslator] ====== TRANSLATION START ======');
  console.log('[FixSmoothTranslator] Text to translate:', text);
  console.log('[FixSmoothTranslator] Message source:', payload.from || 'unknown');
  console.log('[FixSmoothTranslator] Is word?:', isWord(text));
  
  // CRITICAL FIX: Use sources passed from service worker since offscreen can't access storage
  if (payload.translationSources) {
    sources = payload.translationSources;
    console.log('[FixSmoothTranslator] Using sources passed from service worker:', JSON.stringify(sources));
  } else {
    // Fallback: try to read from storage (won't work in offscreen but keep for compatibility)
    console.log('[FixSmoothTranslator] No sources in payload, trying storage (will likely fail in offscreen)');
    try {
      const storageResult = await new Promise((resolve) => {
        if (chrome && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get(['translationSources'], (result) => {
            if (chrome.runtime.lastError) {
              console.error('[FixSmoothTranslator] Storage error:', chrome.runtime.lastError);
              resolve({});
            } else {
              resolve(result);
            }
          });
        } else {
          console.log('[FixSmoothTranslator] Chrome storage not available (expected in offscreen)');
          resolve({});
        }
      });
      
      if (storageResult && storageResult.translationSources) {
        sources = storageResult.translationSources;
        console.log('[FixSmoothTranslator] Got sources from storage:', JSON.stringify(sources));
      }
    } catch (e) {
      console.error('[FixSmoothTranslator] Error loading sources:', e);
    }
  }
  
  // Use defaults if no sources found
  if (!sources) {
    console.log('[FixSmoothTranslator] No sources found, using defaults');
    sources = {
      youdaoDict: true,
      youdaoTranslate: true,
      iciba: false
    };
  }
  
  // Log the sources we're using
  console.log('[FixSmoothTranslator] Final sources to use:', JSON.stringify(sources));
  console.log('[FixSmoothTranslator] Individual source values:');
  console.log('  - youdaoDict:', sources.youdaoDict, '(type:', typeof sources.youdaoDict, ')');
  console.log('  - youdaoTranslate:', sources.youdaoTranslate, '(type:', typeof sources.youdaoTranslate, ')');
  console.log('  - iciba:', sources.iciba, '(type:', typeof sources.iciba, ')')
  
  // Ensure sources is defined
  if (!sources) {
    console.error('[FixSmoothTranslator] Sources is null, using defaults');
    sources = {
      youdaoDict: true,
      youdaoTranslate: true,
      iciba: false
    };
  }
  
  console.log('[FixSmoothTranslator] Final sources to use:', JSON.stringify(sources));
  console.log('[FixSmoothTranslator] Source types:', {
    youdaoDict: typeof sources.youdaoDict,
    youdaoTranslate: typeof sources.youdaoTranslate,
    iciba: typeof sources.iciba
  });
  
  let result = null;
  try {
    if (isWord(text)) {
      // IMPORTANT: Only use explicitly enabled sources - check for true explicitly
      const enabledSources = [];
      
      // Check iCiba first - if it's the only one enabled, prioritize it
      if (sources.iciba === true) {
        enabledSources.push('iciba');
        console.log('[FixSmoothTranslator] iciba is enabled (true) - PRIORITY');
      } else {
        console.log('[FixSmoothTranslator] iciba is disabled:', sources.iciba);
      }
      
      if (sources.youdaoDict === true) {
        enabledSources.push('youdaoDict');
        console.log('[FixSmoothTranslator] youdaoDict is enabled (true)');
      } else {
        console.log('[FixSmoothTranslator] youdaoDict is disabled:', sources.youdaoDict);
      }
      
      if (sources.youdaoTranslate === true) {
        enabledSources.push('youdaoTranslate');
        console.log('[FixSmoothTranslator] youdaoTranslate is enabled (true)');
      } else {
        console.log('[FixSmoothTranslator] youdaoTranslate is disabled:', sources.youdaoTranslate);
      }
      
      console.log(`[FixSmoothTranslator] Final enabled sources for word "${text}":`, enabledSources);
      
      // If NO sources are enabled, return failure
      if (enabledSources.length === 0) {
        result = { status: 'failure', translation: '请至少选择一个翻译源', text };
      } else {
        // IMPORTANT: Only process sources that are in enabledSources array
        console.log(`[FixSmoothTranslator] Will ONLY try these sources: ${enabledSources.join(', ')}`);
        
        // Try ONLY enabled sources, stop at first success
        for (const source of enabledSources) {
          // Skip if we already have a successful result
          if (result && result.status === 'success') {
            console.log(`[FixSmoothTranslator] Skipping ${source} - already have successful result`);
            break;
          }
          
          console.log(`[FixSmoothTranslator] Trying source: ${source}`);
          
          try {
            switch(source) {
              case 'iciba':
                console.log('[FixSmoothTranslator] Processing iciba source (ONLY)');
                if (sources.iciba !== true) {
                  console.error('[FixSmoothTranslator] ERROR: iciba in enabledSources but not enabled in sources!');
                  continue;
                }
                result = await fetchICiba(text);
                if (result) {
                  result.source = 'iciba';
                  console.log(`[FixSmoothTranslator] iCiba result:`, result.status, result.translation ? result.translation.substring(0, 50) : '');
                }
                break;
                
              case 'youdaoDict':
                console.log('[FixSmoothTranslator] Processing youdaoDict source');
                if (sources.youdaoDict !== true) {
                  console.error('[FixSmoothTranslator] CRITICAL: youdaoDict in enabledSources but not enabled in sources!');
                  result = {
                    status: 'failure',
                    text: text,
                    translation: 'ERROR: Youdao Dict was called but is disabled!'
                  };
                  continue;
                }
                result = await fetchDict(text);
                if (result) {
                  result.source = 'youdao-dict';
                  console.log(`[FixSmoothTranslator] Youdao Dict result:`, result.status, result.translation ? result.translation.substring(0, 50) : '');
                }
                break;
                
              case 'youdaoTranslate':
                console.log('[FixSmoothTranslator] Processing youdaoTranslate source');
                if (sources.youdaoTranslate !== true) {
                  console.error('[FixSmoothTranslator] ERROR: youdaoTranslate in enabledSources but not enabled in sources!');
                  continue;
                }
                result = await fetchTranslate(text);
                if (result) {
                  result.source = 'youdao-translate';
                  console.log(`[FixSmoothTranslator] Youdao Translate result:`, result.status, result.translation ? result.translation.substring(0, 50) : '');
                }
                break;
                
              default:
                console.error(`[FixSmoothTranslator] Unknown source: ${source}`);
            }
          } catch (sourceError) {
            console.log(`[FixSmoothTranslator] Error with source ${source}:`, sourceError.message);
            // Continue to next source
          }
        }
      }
      
      // If no source gave results
      if (!result || result.status !== 'success') {
        console.log('[FixSmoothTranslator] No successful result from enabled sources');
        console.log('[FixSmoothTranslator] Sources tried:', enabledSources.join(', '));
        result = { status: 'failure', translation: '未找到释义', text };
      }
      
      // CRITICAL: Final check - ensure the result source is actually enabled
      if (result && result.source) {
        const sourceMap = {
          'iciba': 'iciba',
          'youdao-dict': 'youdaoDict',
          'youdao-translate': 'youdaoTranslate'
        };
        const sourceName = sourceMap[result.source];
        if (sourceName && sources[sourceName] !== true) {
          console.error(`[FixSmoothTranslator] CRITICAL ERROR: Result has source ${result.source} but ${sourceName} is not enabled!`);
          console.error(`[FixSmoothTranslator] Enabled sources were: ${enabledSources.join(', ')}`);
          // Force failure if the source is not enabled
          result = { 
            status: 'failure', 
            translation: `ERROR: ${result.source} was used but not enabled`, 
            text 
          };
        }
      }
    } else {
      // For phrases/sentences, use online translation if enabled
      console.log(`[FixSmoothTranslator] Phrase/sentence mode for: "${text}"`);
      console.log(`[FixSmoothTranslator] Youdao Translate enabled:`, sources.youdaoTranslate);
      
      if (sources.youdaoTranslate === true) {
        console.log(`[FixSmoothTranslator] Using Youdao Translate for phrase`);
        result = await fetchTranslate(text);
        if (result && result.status === 'success') {
          result.source = 'youdao-translate';
        }
      } else {
        console.log(`[FixSmoothTranslator] Youdao Translate disabled, cannot translate phrases`);
        result = { status: 'failure', translation: '有道在线翻译未启用，无法翻译句子', text };
      }
    }
    if (!result.text) result.text = text;
    // Add source info to translation for debugging
    if (result && result.source) {
      console.log(`[FixSmoothTranslator] Final source used: ${result.source}`);
    }
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
  // Get timeout setting
  if (chrome && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get({ notifyTimeout: 10 }, (opts) => {
      const to = Number(opts && opts.notifyTimeout);
      const timeout = Number.isFinite(to) ? to : 10;
      result.timeout = timeout;
      try {
        sendResponse(result);
      } catch (e) {
        console.warn('Failed to send response from storage callback:', e);
      }
    });
  } else {
    result.timeout = 10;
    try {
      sendResponse(result);
    } catch (e) {
      console.warn('Failed to send response without storage:', e);
    }
  }
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

// Log storage availability
console.log('[FixSmoothTranslator] Offscreen page loaded, storage available:', !!storageNS);

// Test storage on load
if (chrome && chrome.storage && chrome.storage.local) {
  chrome.storage.local.get(['translationSources'], (result) => {
    console.log('[FixSmoothTranslator] Initial storage test - translationSources:', result.translationSources);
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Log ALL messages to offscreen
  console.log('[FixSmoothTranslator Offscreen] Received message:', message.type, message.__bridged ? '(bridged)' : '(direct)', message);
  
  switch (message && message.type) {
    case 'translate':
      // CRITICAL: Only process bridged translate messages that come from service worker
      // Direct messages will use default sources, so skip them
      if (!message.__bridged) {
        console.log('[FixSmoothTranslator Offscreen] SKIPPING direct translate message - must come through service worker');
        return false; // Don't process direct translate messages
      }
      console.log('[FixSmoothTranslator Offscreen] Processing bridged translate for:', message.text);
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
