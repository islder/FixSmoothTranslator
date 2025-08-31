(function(){
  'use strict';
  
  // 全局错误处理器，防止Extension context invalidated错误和bfcache错误
  if (typeof window !== 'undefined') {
    // 监听全局错误
    window.addEventListener('error', function(event) {
      if (event.error && event.error.message) {
        const errorMsg = event.error.message;
        if (errorMsg.includes('Extension context invalidated') ||
            errorMsg.includes('back/forward cache') ||
            errorMsg.includes('extension port')) {
          console.warn('Extension/bfcache error suppressed:', errorMsg);
          event.preventDefault();
          return false;
        }
      }
    });
    
    // 监听未捕获的Promise错误
    window.addEventListener('unhandledrejection', function(event) {
      if (event.reason) {
        const errorMsg = event.reason.message || String(event.reason);
        if (errorMsg.includes('Extension context invalidated') ||
            errorMsg.includes('message channel closed') ||
            errorMsg.includes('back/forward cache') ||
            errorMsg.includes('extension port')) {
          console.warn('Extension/message error suppressed:', errorMsg);
          event.preventDefault();
          return false;
        }
      }
    });
  }
  
  // 包装chrome.runtime.onMessage.addListener以添加错误处理
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    const originalAddListener = chrome.runtime.onMessage.addListener;
    chrome.runtime.onMessage.addListener = function(listener) {
      const wrappedListener = function(message, sender, sendResponse) {
        try {
          // 检查扩展上下文是否有效
          if (!chrome.runtime?.id) {
            console.warn('Extension context invalidated in listener');
            return false;
          }
          
          // 检查sender是否仍然有效（防止bfcache问题）
          if (sender && sender.tab && sender.tab.id) {
            // 如果tab已经不存在或无法访问，直接返回
            try {
              // 这是一个简单的检查，实际验证会在service worker中进行
              if (sender.tab.id < 0) {
                console.warn('Invalid tab ID, possibly in bfcache');
                return false;
              }
            } catch (e) {
              console.warn('Cannot validate sender tab:', e);
              return false;
            }
          }
          
          const result = listener(message, sender, sendResponse);
          
          // 如果返回undefined，强制返回false以避免异步通道问题
          if (result === undefined) {
            return false;
          }
          
          return result;
        } catch (error) {
          const errorMsg = error.message || '';
          if (errorMsg.includes('Extension context invalidated') ||
              errorMsg.includes('back/forward cache') ||
              errorMsg.includes('extension port')) {
            console.warn('Extension/bfcache error in listener:', errorMsg);
            return false;
          }
          console.error('Error in message listener:', error);
          return false;
        }
      };
      
      return originalAddListener.call(this, wrappedListener);
    };
  }
  
  // 监听页面生命周期事件，处理bfcache
  if (typeof document !== 'undefined') {
    // 页面进入bfcache前清理
    document.addEventListener('pagehide', function(event) {
      if (event.persisted) {
        // 页面将被缓存，清理所有活动的连接
        console.log('Page entering bfcache, cleaning up connections');
        // 触发清理操作
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
          try {
            // 发送清理消息给service worker
            chrome.runtime.sendMessage({ type: 'pageHiding', cached: true }, () => {
              // 忽略任何错误
              if (chrome.runtime.lastError) {
                console.log('Page hide notification sent');
              }
            });
          } catch (e) {
            // 忽略错误
          }
        }
      }
    });
    
    // 页面从bfcache恢复
    document.addEventListener('pageshow', function(event) {
      if (event.persisted) {
        // 页面从缓存恢复，重新初始化连接
        console.log('Page restored from bfcache, reinitializing');
        // 如果需要，可以在这里重新初始化连接
      }
    });
  }
})();
