// Toast Status Synchronizer - syncs data-cst-status from .cst-result to parent .cst-result-toast
// 同时负责加载和应用Toast样式设置（classic/modern）
(function() {
  'use strict';
  
  /* ============================================================
     Toast样式设置功能
     从chrome.storage加载用户选择的样式（classic或modern）
     并应用到#cst-list元素的data-cst-toast-style属性
     ============================================================ */
  function applyToastStyle(style) {
    const listElement = document.getElementById('cst-list');
    if (listElement) {
      listElement.setAttribute('data-cst-toast-style', style || 'modern');
    }
  }
  
  function loadAndApplyToastStyle() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['toastStyle'], function(result) {
        const style = result.toastStyle || 'modern';
        applyToastStyle(style);
      });
      
      // 监听设置变化，实时更新样式
      chrome.storage.onChanged.addListener(function(changes, areaName) {
        if (areaName === 'local' && changes.toastStyle) {
          applyToastStyle(changes.toastStyle.newValue || 'modern');
        }
      });
    }
  }
  
  /* ============================================================
     Toast位置设置功能
     从chrome.storage加载用户选择的位置（left、center或right）
     并应用到#cst-list元素的data-cst-toast-position属性
     ============================================================ */
  function applyToastPosition(position) {
    const listElement = document.getElementById('cst-list');
    if (listElement) {
      listElement.setAttribute('data-cst-toast-position', position || 'right');
    }
  }
  
  function loadAndApplyToastPosition() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['toastPosition'], function(result) {
        const position = result.toastPosition || 'right';
        applyToastPosition(position);
      });
      
      // 监听设置变化，实时更新位置
      chrome.storage.onChanged.addListener(function(changes, areaName) {
        if (areaName === 'local' && changes.toastPosition) {
          applyToastPosition(changes.toastPosition.newValue || 'right');
        }
      });
    }
  }
  
  // Function to sync status from result to toast container
  function syncToastStatus(resultElement) {
    if (!resultElement || !resultElement.parentElement) return;
    
    const toast = resultElement.closest('.cst-result-toast');
    if (!toast) return;
    
    const oldStatus = toast.getAttribute('data-cst-toast-status');
    const status = resultElement.getAttribute('data-cst-status');
    
    if (status) {
      toast.setAttribute('data-cst-toast-status', status);
      
      // Handle fade animation when transitioning from pending to success/failure
      if (oldStatus === 'pending' && (status === 'success' || status === 'failure')) {
        // Remove any existing fade classes
        toast.classList.remove('fade-enter', 'fade-enter-active', 'fade-leave-active');
        
        // Apply fade-in animation
        toast.classList.add('fade-enter');
        toast.style.display = 'block';
        toast.style.visibility = 'visible';
        toast.style.height = 'auto';
        toast.style.margin = '';
        toast.style.padding = '';
        toast.style.overflow = '';
        
        // Force reflow
        void toast.offsetHeight;
        
        // Add active class for transition
        toast.classList.add('fade-enter-active');
        toast.classList.remove('fade-enter');
        
        // Clean up after animation
        setTimeout(function() {
          toast.classList.remove('fade-enter-active');
        }, 500);
      }
    }
  }
  
  // Function to observe all result elements
  function observeResults() {
    // Initial sync for existing elements
    document.querySelectorAll('.cst-result[data-cst-status]').forEach(syncToastStatus);
    
  // Set up observer for the main list container
    const listElement = document.getElementById('cst-list');
    
    // 应用Toast样式设置
    loadAndApplyToastStyle();
    
    // 应用Toast位置设置
    loadAndApplyToastPosition();
    
    if (!listElement) {
      // If list doesn't exist yet, wait for it
      const bodyObserver = new MutationObserver(function(mutations) {
        const list = document.getElementById('cst-list');
        if (list) {
          bodyObserver.disconnect();
          observeResults();
        }
      });
      
      bodyObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
      return;
    }
    
    // Create observer for changes within the list
    const observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        // Check for new nodes
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(function(node) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Check if it's a result element or contains one
              if (node.classList && node.classList.contains('cst-result')) {
                syncToastStatus(node);
              } else if (node.querySelectorAll) {
                node.querySelectorAll('.cst-result[data-cst-status]').forEach(syncToastStatus);
              }
            }
          });
        }
        
        // Check for attribute changes
        if (mutation.type === 'attributes' && 
            mutation.target.classList && 
            mutation.target.classList.contains('cst-result') &&
            mutation.attributeName === 'data-cst-status') {
          syncToastStatus(mutation.target);
        }
      });
    });
    
    // Start observing
    observer.observe(listElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-cst-status']
    });
  }
  
  // Start observing when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeResults);
  } else {
    observeResults();
  }
})();
