(function(){
  'use strict';

  // Queue of pending messages to bind with newly created toasts
  var pending = [];
  var observing = false;

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

  function bindToastElement(el){
    if (!el || el.dataset.cstBound === '1') return; // already bound
    var txt = '';
    try { txt = (el.textContent || '').trim(); } catch(_){}
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

  function ensureObserver(){
    if (observing) return;
    observing = true;
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
