(function(){
  'use strict';

  let statusArea, openSettingsBtn, testBtn, checkBtn, currentSite, siteToggle, toggleStatus;

  function showStatus(message, type) {
    if (!statusArea) return;
    statusArea.className = 'status show ' + (type || 'info');
    statusArea.textContent = message;
    setTimeout(function(){ 
      if (statusArea) {
        statusArea.className = 'status';
        statusArea.textContent = '';
      }
    }, 3000);
  }

  function openSettings(){
    if (chrome && chrome.runtime && chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else if (chrome && chrome.tabs) {
      chrome.tabs.create({ url: chrome.runtime.getURL('pages/simple_options.html') });
    }
  }

  function testTranslation(){
    if (!chrome || !chrome.storage || !chrome.storage.local) {
      showStatus('Chrome API不可用', 'error');
      return;
    }
    chrome.storage.local.get(['notifyTimeout'], function(result){
      const timeout = (result && result.notifyTimeout) || 10;
      chrome.tabs && chrome.tabs.query({ active: true, currentWindow: true }, function(tabs){
        const tab = tabs && tabs[0];
        if (!tab) { showStatus('没有活动页面', 'error'); return; }
        chrome.tabs.sendMessage(tab.id, {
          type: 'translate', text: 'test', timeout,
          result: { status: 'success', translation: '🧪 测试提示 - ' + timeout + '秒后消失', text: 'test', timeout }
        }, function(){
          if (chrome.runtime && chrome.runtime.lastError) {
            showStatus('请在网页上重试', 'error');
          } else {
            showStatus('测试完成 (' + timeout + 's)', 'success');
            try { window.close(); } catch(_){}
          }
        });
      });
    });
  }

  function checkCurrentTimeout(){
    if (!chrome || !chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get(['notifyTimeout'], function(result){
      const timeout = (result && result.notifyTimeout) || 10;
      showStatus('当前设置: ' + timeout + ' 秒', 'info');
    });
  }

  // Site toggle functionality
  function getCurrentSite() {
    if (!chrome || !chrome.tabs) return;
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (tabs && tabs[0] && tabs[0].url) {
        try {
          const url = new URL(tabs[0].url);
          const hostname = url.hostname;
          if (currentSite) {
            currentSite.textContent = hostname;
          }
          loadSiteStatus(hostname);
        } catch (e) {
          if (currentSite) {
            currentSite.textContent = '无法获取网站信息';
          }
        }
      }
    });
  }

  function loadSiteStatus(hostname) {
    if (!chrome || !chrome.storage) return;
    chrome.storage.local.get(['siteRules'], function(result) {
      const siteRules = result.siteRules || [{ site: '*', enabled: true }];
      const isEnabled = checkSiteEnabled(hostname, siteRules);
      
      if (siteToggle) {
        siteToggle.checked = isEnabled;
      }
      if (toggleStatus) {
        toggleStatus.textContent = isEnabled ? '在此网站启用插件' : '在此网站禁用插件';
      }
    });
  }

  function checkSiteEnabled(hostname, siteRules) {
    // Check for exact match first
    for (const rule of siteRules) {
      if (rule.site === hostname) {
        return rule.enabled;
      }
    }
    
    // Check for wildcard match
    for (const rule of siteRules) {
      if (rule.site === '*') {
        return rule.enabled;
      }
    }
    
    return true; // Default to enabled
  }

  function toggleSiteStatus() {
    if (!chrome || !chrome.tabs) return;
    
    // 添加动画类，只在用户交互时播放动画
    const slider = document.querySelector('.slider');
    if (slider) {
      slider.classList.add('animate');
      setTimeout(() => slider.classList.remove('animate'), 300);
    }
    
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (tabs && tabs[0] && tabs[0].url) {
        try {
          const url = new URL(tabs[0].url);
          const hostname = url.hostname;
          const isEnabled = siteToggle.checked;
          
          chrome.storage.local.get(['siteRules'], function(result) {
            let siteRules = result.siteRules || [{ site: '*', enabled: true }];
            
            // Find existing rule for this site
            const existingRuleIndex = siteRules.findIndex(rule => rule.site === hostname);
            
            if (existingRuleIndex >= 0) {
              // Update existing rule
              siteRules[existingRuleIndex].enabled = isEnabled;
            } else {
              // Add new rule for this site
              siteRules.push({ site: hostname, enabled: isEnabled });
            }
            
            chrome.storage.local.set({ siteRules }, function() {
              if (chrome.runtime.lastError) {
                showStatus('保存失败: ' + chrome.runtime.lastError.message, 'error');
                // Revert toggle state
                siteToggle.checked = !isEnabled;
              } else {
                if (toggleStatus) {
                  toggleStatus.textContent = isEnabled ? '在此网站启用插件' : '在此网站禁用插件';
                }
                showStatus(isEnabled ? '已启用插件' : '已禁用插件', 'success');
              }
            });
          });
        } catch (e) {
          showStatus('无法获取网站信息', 'error');
        }
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function(){
    statusArea = document.getElementById('statusArea');
    openSettingsBtn = document.getElementById('openSettingsBtn');
    testBtn = document.getElementById('testBtn');
    checkBtn = document.getElementById('checkBtn');
    currentSite = document.getElementById('currentSite');
    siteToggle = document.getElementById('siteToggle');
    toggleStatus = document.getElementById('toggleStatus');

    if (openSettingsBtn) openSettingsBtn.addEventListener('click', openSettings);
    if (testBtn) testBtn.addEventListener('click', testTranslation);
    if (checkBtn) checkBtn.addEventListener('click', checkCurrentTimeout);
    if (siteToggle) siteToggle.addEventListener('change', toggleSiteStatus);

    getCurrentSite();
    checkCurrentTimeout();
  });
})();
