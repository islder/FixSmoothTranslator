(function(){
  'use strict';

  // Queue of pending messages to bind with newly created toasts
  var pending = [];
  var observing = false;
  
  // Track recently closed toasts to prevent duplicate creation
  // Key: normalized text, Value: timestamp when closed
  var recentlyClosed = new Map();
  var CLOSE_DEBOUNCE_MS = 1500; // Ignore duplicate within 1.5 seconds of closing

  function parseTimeout(message, cb){
    var t = null;
    try {
      if (message) {
        if (typeof message.timeout !== 'undefined') t = Number(message.timeout);
        if ((t == null || !isFinite(t)) && message.result && typeof message.result.timeout !== 'undefined') {
          t = Number(message.result.timeout);
        }
      }
    } catch(_){}
    if (isFinite(t) && t > 0) return cb(t);
    try {
      if (chrome && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get({ notifyTimeout: 10 }, function(items){
          var to = Number(items && items.notifyTimeout);
          cb(isFinite(to) && to > 0 ? to : 10);
        });
        return;
      }
    } catch(_){}
    cb(10);
  }

  // Helper to normalize text for comparison (remove zero-width characters and close button symbol)
  function normalizeText(text) {
    try {
      return String(text || '')
        .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]+/g, '') // Remove zero-width chars
        .replace(/[×✕✖xX]$/g, '') // Remove close button symbol at end
        .replace(/^[×✕✖xX]/g, '') // Remove close button symbol at start
        .trim()
        .toLowerCase();
    } catch(_) {
      return '';
    }
  }
  
  // Extract the word/phrase from a toast element (excluding close button)
  function extractToastWord(el) {
    try {
      // Try to get the word from .cst-result-text first
      var textEl = el.querySelector('.cst-result-text');
      if (textEl) {
        return normalizeText(textEl.textContent || '');
      }
      // Fallback: get h6 element (the word header)
      var h6 = el.querySelector('h6');
      if (h6) {
        return normalizeText(h6.textContent || '');
      }
      // Last resort: use full text but clean it
      return normalizeText(el.textContent || '');
    } catch(_) {
      return '';
    }
  }
  
  function fadeOutAndRemove(el){
    try {
      // Use the original fade animation classes
      el.classList.add('fade-leave-active');
      
      // Wait for the animation to complete before removing
      setTimeout(function(){ 
        try { 
          el.remove(); 
        } catch(_){} 
      }, 500);
    } catch(_) {
      try { el.remove(); } catch(_){}
    }
  }
  
  // Check if text was recently closed
  function wasRecentlyClosed(text) {
    var normalized = normalizeText(text);
    if (!normalized) return false;
    
    var closedTime = recentlyClosed.get(normalized);
    if (!closedTime) return false;
    
    return (Date.now() - closedTime) < CLOSE_DEBOUNCE_MS;
  }

  // Remove a duplicate toast element by triggering its close button
  function removeDuplicateToast(el) {
    try {
      el.dataset.cstBound = '1'; // Mark as bound to prevent re-processing
      
      // First, hide it immediately to prevent visual flash
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      
      // Try to click the close button to let Vue handle cleanup properly
      var closeBtn = el.querySelector('a.close');
      if (closeBtn) {
        // Temporarily remove from recentlyClosed to allow the click to work
        var word = extractToastWord(el);
        var savedTime = word ? recentlyClosed.get(word) : null;
        if (word) recentlyClosed.delete(word);
        
        try {
          closeBtn.click();
        } catch(_) {}
        
        // Restore the record after click
        if (word && savedTime) {
          recentlyClosed.set(word, savedTime);
        }
      } else {
        // Fallback: direct removal if no close button
        el.style.display = 'none';
        el.style.visibility = 'hidden';
        el.style.height = '0';
        el.style.margin = '0';
        el.style.padding = '0';
        el.style.overflow = 'hidden';
        setTimeout(function() {
          try { el.remove(); } catch(_) {}
        }, 100);
      }
    } catch(_) {}
  }
  
  function bindToastElement(el){
    if (!el || el.dataset.cstBound === '1') return; // already bound
    var txt = '';
    try { txt = (el.textContent || '').trim(); } catch(_){}
    
    // Check if this toast is a duplicate of a recently closed one
    // We need to wait a bit for Vue to render the content
    var word = extractToastWord(el);
    if (word && wasRecentlyClosed(word)) {
      removeDuplicateToast(el);
      return;
    }
    
    // If word is empty, Vue might not have rendered yet - check again after a short delay
    if (!word || word.length < 2) {
      setTimeout(function() {
        if (el.dataset.cstBound === '1') return; // already handled
        var delayedWord = extractToastWord(el);
        if (delayedWord && wasRecentlyClosed(delayedWord)) {
          removeDuplicateToast(el);
        }
      }, 50);
    }
    
    // find best pending entry (match text, prefer most recent)
    var bestIdx = -1;
    for (var i = pending.length - 1; i >= 0; i--) {
      var p = pending[i];
      if (!p) continue;
      if (!p.text) { bestIdx = i; break; }
      try {
        var ptxt = (p.text || '').toLowerCase();
        var ttxt = (txt || '').toLowerCase();
        if (ttxt.indexOf(ptxt) !== -1 || ptxt.indexOf(ttxt) !== -1) { bestIdx = i; break; }
      } catch(_){}
    }
    var timeoutSec = 10;
    if (bestIdx >= 0) {
      timeoutSec = pending[bestIdx].timeout;
      pending.splice(bestIdx, 1);
    } else {
      // fallback to storage
      try {
        if (chrome && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get({ notifyTimeout: 10 }, function(items){
            var to = Number(items && items.notifyTimeout);
            var s = isFinite(to) && to > 0 ? to : 10;
            schedule(el, s);
          });
          el.dataset.cstBound = '1';
          return;
        }
      } catch(_){}
    }
    el.dataset.cstBound = '1';
    schedule(el, timeoutSec);
  }

  function schedule(el, seconds){
    try {
      setTimeout(function(){
        // element might have been removed already by native logic
        if (document.contains(el)) fadeOutAndRemove(el);
      }, Math.max(0, seconds * 1000));
    } catch(_){}
  }

  // Record a toast's word as recently closed
  function recordClosedToast(toast) {
    try {
      var word = extractToastWord(toast);
      if (word) {
        recentlyClosed.set(word, Date.now());
        // Clean up old entries after debounce period
        setTimeout(function() {
          recentlyClosed.delete(word);
        }, CLOSE_DEBOUNCE_MS + 100);
      }
    } catch(_) {}
  }
  
  // Track close button clicks to prevent duplicate toasts
  // Note: We do NOT stop propagation to allow Vue's original handler to work
  function setupCloseButtonInterceptor() {
    try {
      // Helper to check if element is a close button and record the close
      function handleCloseInteraction(e) {
        var closeBtn = e.target;
        if (!closeBtn) return;
        
        // Match both the close button and its parent structure
        var isCloseButton = closeBtn.classList && closeBtn.classList.contains('close');
        if (!isCloseButton && closeBtn.parentElement) {
          closeBtn = closeBtn.parentElement;
          isCloseButton = closeBtn.classList && closeBtn.classList.contains('close');
        }
        
        if (!isCloseButton) return;
        
        var toast = closeBtn.closest('.cst-result-toast');
        if (!toast) return;
        
        // Record this as a manual close (do NOT stop propagation - let Vue handle the actual close)
        recordClosedToast(toast);
      }
      
      // Listen on both mousedown and click to catch the interaction as early as possible
      document.addEventListener('mousedown', handleCloseInteraction, true);
      document.addEventListener('click', handleCloseInteraction, true);
    } catch(_) {}
  }
  
  function ensureObserver(){
    if (observing) return;
    observing = true;
    
    // Setup close button interceptor
    setupCloseButtonInterceptor();
    
    try {
      var target = document.body || document.documentElement;
      var obs = new MutationObserver(function(mutations){
        mutations.forEach(function(m){
          if (m.type !== 'childList') return;
          // direct added nodes
          m.addedNodes && m.addedNodes.forEach(function(node){
            if (!(node instanceof Element)) return;
            if (node.matches && node.matches('.cst-result-toast')) {
              bindToastElement(node);
            } else {
              var found = node.querySelectorAll ? node.querySelectorAll('.cst-result-toast') : [];
              if (found && found.length) {
                found.forEach(bindToastElement);
              }
            }
          });
        });
      });
      obs.observe(target, { childList: true, subtree: true });
    } catch(_){}
  }

  chrome.runtime.onMessage.addListener(function(message){
    // 检查扩展上下文是否有效
    try {
      if (!chrome.runtime?.id) {
        console.warn('Extension context invalidated, removing listener');
        return false;
      }
    } catch (e) {
      console.warn('Extension context check failed:', e);
      return false;
    }
    
    if (!message || message.type !== 'translate') return false;
    ensureObserver();
    var msgText = '';
    try { msgText = (message.text || '').trim(); } catch(_){}
    
    // Skip if this text was recently closed manually (prevents duplicate toasts)
    if (wasRecentlyClosed(msgText)) {
      return false;
    }

    // If show:false explicitly, try to close the latest matching toast immediately
    try {
      if (message.result && message.result.show === false) {
        // Try to bind and close any existing matching element right away
        try {
          var list = document.getElementById('cst-list');
          if (list) {
            var nodes = list.querySelectorAll('.cst-result-toast');
            for (var i = nodes.length - 1; i >= 0; i--) {
              var el = nodes[i];
              if (!msgText || (el.textContent || '').indexOf(msgText) !== -1) {
                fadeOutAndRemove(el);
                break;
              }
            }
          }
        } catch(_){}
        return;
      }
    } catch(_){}

    // Record pending entry, to be paired with the toast element by observer
    parseTimeout(message, function(seconds){
      pending.push({ text: msgText, timeout: seconds, ts: Date.now() });
      // best-effort: also try to bind immediately if toast already exists
      try {
        var list = document.getElementById('cst-list');
        if (list) {
          var nodes = list.querySelectorAll('.cst-result-toast');
          if (nodes && nodes.length) bindToastElement(nodes[nodes.length - 1]);
        }
      } catch(_){}
    });
    return false; // 同步处理，不需要异步响应
  });
})();
