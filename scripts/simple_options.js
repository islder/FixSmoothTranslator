// Attach logic for simple_options.html without inline scripts
(function(){
  'use strict';

  let currentTimeout = 10;
  let rangeInput, valueDisplay, statusArea, saveBtn, testBtn, resetBtn;

  function showMessage(text, type = 'info') {
    if (!statusArea) return;
    statusArea.className = 'alert show alert-' + type;
    statusArea.textContent = text;
    setTimeout(function(){ 
      if (statusArea) {
        statusArea.className = 'alert';
        statusArea.textContent = '';
      }
    }, 3000);
  }

  function updateDisplay(value) {
    if (valueDisplay) valueDisplay.textContent = value + ' 秒';
    currentTimeout = parseInt(value, 10) || 10;
  }

  function onSliderInput(){ updateDisplay(this.value); }

  function saveSettings() {
    const timeout = parseInt(rangeInput && rangeInput.value, 10) || 10;
    if (!chrome || !chrome.storage || !chrome.storage.local) {
      showMessage('❌ Chrome存储API不可用，请确保在扩展环境中使用', 'error');
      return;
    }
    chrome.storage.local.set({ notifyTimeout: timeout }, function(){
      if (chrome.runtime && chrome.runtime.lastError) {
        showMessage('❌ 保存失败: ' + chrome.runtime.lastError.message, 'error');
      } else {
        showMessage('✅ 设置已保存！提示将显示 ' + timeout + ' 秒', 'success');
      }
    });
  }

  function testSettings() {
    const timeout = parseInt(rangeInput && rangeInput.value, 10) || 10;
    if (!chrome || !chrome.storage || !chrome.storage.local) {
      showMessage('❌ Chrome API不可用', 'error');
      return;
    }
    chrome.storage.local.set({ notifyTimeout: timeout }, function(){
      if (chrome.runtime && chrome.runtime.lastError) {
        showMessage('❌ 无法保存设置', 'error');
        return;
      }
      chrome.tabs && chrome.tabs.query({ active: true, currentWindow: true }, function(tabs){
        const tab = tabs && tabs[0];
        if (!tab) { showMessage('❌ 没有找到活动页面', 'error'); return; }
        chrome.tabs.sendMessage(tab.id, {
          type: 'translate',
          text: 'test',
          timeout,
          result: { status: 'success', translation: '🧪 测试提示 - ' + timeout + '秒后消失', text: 'test', timeout }
        }, function(){
          if (chrome.runtime && chrome.runtime.lastError) {
            showMessage('❌ 测试失败：请在网页上重试', 'error');
          } else {
            showMessage('🧪 测试提示已发送，' + timeout + '秒后消失', 'info');
          }
        });
      });
    });
  }

  function resetSettings() {
    if (rangeInput) rangeInput.value = 10;
    updateDisplay(10);
    if (chrome && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ notifyTimeout: 10 }, function(){
        if (chrome.runtime && chrome.runtime.lastError) {
          showMessage('❌ 重置失败', 'error');
        } else {
          showMessage('🔄 已重置为默认值（10秒）', 'success');
        }
      });
    }
  }

  function handleQuickClick(e){
    const btn = e.currentTarget;
    const seconds = parseInt(btn.getAttribute('data-seconds'), 10) || 10;
    if (rangeInput) rangeInput.value = seconds;
    updateDisplay(seconds);
    if (chrome && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ notifyTimeout: seconds }, function(){
        if (chrome.runtime && chrome.runtime.lastError) {
          showMessage('❌ 快速设置失败', 'error');
        } else {
          showMessage('⚡ 已快速设置为 ' + seconds + ' 秒', 'success');
        }
      });
    }
  }

  function loadSettings() {
    if (!chrome || !chrome.storage || !chrome.storage.local) {
      showMessage('⚠️ Chrome API不可用，使用默认值', 'info');
      return;
    }
    chrome.storage.local.get(['notifyTimeout'], function(result){
      if (chrome.runtime && chrome.runtime.lastError) {
        showMessage('⚠️ 加载设置失败，使用默认值', 'info');
        return;
      }
      const timeout = (result && result.notifyTimeout) || 10;
      if (rangeInput) rangeInput.value = timeout;
      updateDisplay(timeout);
      showMessage('📋 当前设置：' + timeout + '秒', 'info');
    });
  }

  // Keyboard shortcut functions
  function showShortcutMessage(text, type = 'info') {
    const shortcutStatusArea = document.getElementById('shortcutStatusArea');
    if (!shortcutStatusArea) return;
    shortcutStatusArea.className = 'alert show alert-' + type;
    shortcutStatusArea.textContent = text;
    setTimeout(function(){ 
      if (shortcutStatusArea) {
        shortcutStatusArea.className = 'alert';
        shortcutStatusArea.textContent = '';
      }
    }, 5000);
  }

  function getCurrentShortcut() {
    if (!chrome || !chrome.commands) {
      showShortcutMessage('⚠️ 快捷键API不可用', 'error');
      return;
    }
    
    chrome.commands.getAll(function(commands) {
      const toggleLinkCommand = commands.find(cmd => cmd.name === 'toggle-link-inspect');
      const currentShortcut = document.getElementById('currentShortcut');
      
      if (currentShortcut) {
        if (toggleLinkCommand && toggleLinkCommand.shortcut && toggleLinkCommand.shortcut.trim() !== '') {
          // Format the shortcut for display
          const formatted = toggleLinkCommand.shortcut.replace(/\+/g, '+');
          currentShortcut.textContent = formatted;
        } else {
          // No shortcut is set
          currentShortcut.textContent = '未设置';
        }
      }
    });
  }

  function openShortcutSettings() {
    // Chrome doesn't allow programmatic modification of shortcuts,
    // but we can open the shortcuts page for the user
    if (chrome && chrome.tabs) {
      // Show instruction message
      showShortcutMessage('🔗 正在打开Chrome快捷键设置页面...', 'info');
      
      // Open Chrome's keyboard shortcuts page
      chrome.tabs.create({
        url: 'chrome://extensions/shortcuts'
      }, function() {
        // After opening, show additional instructions
        setTimeout(function() {
          showShortcutMessage(
            '📝 请在打开的页面中找到「Fix Smooth Translator」，然后修改「打开/关闭链接划词模式」的快捷键。修改后返回此页面查看更新。',
            'info'
          );
        }, 500);
      });
    } else {
      showShortcutMessage(
        '⚠️ 请手动打开 chrome://extensions/shortcuts 页面修改快捷键',
        'info'
      );
    }
  }

  document.addEventListener('DOMContentLoaded', function(){
    rangeInput = document.getElementById('timeoutRange');
    valueDisplay = document.getElementById('valueDisplay');
    statusArea = document.getElementById('statusArea');
    saveBtn = document.getElementById('saveBtn');
    testBtn = document.getElementById('testBtn');
    resetBtn = document.getElementById('resetBtn');

    if (rangeInput) rangeInput.addEventListener('input', onSliderInput);
    if (saveBtn) saveBtn.addEventListener('click', saveSettings);
    if (testBtn) testBtn.addEventListener('click', testSettings);
    if (resetBtn) resetBtn.addEventListener('click', resetSettings);

    const quickBtns = document.querySelectorAll('.quickBtn');
    quickBtns.forEach(function(btn){ btn.addEventListener('click', handleQuickClick); });

  // Keyboard shortcut button
    const customizeShortcutBtn = document.getElementById('customizeShortcutBtn');
    if (customizeShortcutBtn) {
      customizeShortcutBtn.addEventListener('click', openShortcutSettings);
    }

    // Load current shortcut
    getCurrentShortcut();

    // Refresh shortcut display when page becomes visible (user might have changed it)
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) {
        getCurrentShortcut();
      }
    });

    // Translation Sources Settings
    const saveSourcesBtn = document.getElementById('saveSourcesBtn');
    const resetSourcesBtn = document.getElementById('resetSourcesBtn');
    const sourcesStatusArea = document.getElementById('sourcesStatusArea');

    function showSourcesMessage(text, type = 'info') {
      if (!sourcesStatusArea) return;
      sourcesStatusArea.className = 'alert show alert-' + type;
      sourcesStatusArea.textContent = text;
      setTimeout(function(){ 
        if (sourcesStatusArea) {
          sourcesStatusArea.className = 'alert';
          sourcesStatusArea.textContent = '';
        }
      }, 3000);
    }

    function loadTranslationSources() {
      if (!chrome || !chrome.storage || !chrome.storage.local) {
        showSourcesMessage('⚠️ Chrome API不可用，使用默认值', 'info');
        return;
      }
      chrome.storage.local.get(['translationSources'], function(result) {
        if (chrome.runtime && chrome.runtime.lastError) {
          showSourcesMessage('⚠️ 加载翻译源设置失败，使用默认值', 'info');
          return;
        }
        const sources = result.translationSources || {
          youdaoDict: true,
          youdaoTranslate: true,
          iciba: false
        };
        
        // Update checkboxes
        const youdaoDictCheck = document.getElementById('source-youdao-dict');
        const youdaoTranslateCheck = document.getElementById('source-youdao-translate');
        const icibaCheck = document.getElementById('source-iciba');
        
        if (youdaoDictCheck) youdaoDictCheck.checked = sources.youdaoDict !== false;
        if (youdaoTranslateCheck) youdaoTranslateCheck.checked = sources.youdaoTranslate !== false;
        if (icibaCheck) icibaCheck.checked = sources.iciba === true;
      });
    }

    function saveTranslationSources() {
      const youdaoDictCheck = document.getElementById('source-youdao-dict');
      const youdaoTranslateCheck = document.getElementById('source-youdao-translate');
      const icibaCheck = document.getElementById('source-iciba');
      
      const sources = {
        youdaoDict: youdaoDictCheck ? youdaoDictCheck.checked : true,
        youdaoTranslate: youdaoTranslateCheck ? youdaoTranslateCheck.checked : true,
        iciba: icibaCheck ? icibaCheck.checked : false
      };
      
      console.log('[Options] Saving translation sources:', sources);
      
      // Ensure at least one source is selected
      if (!sources.youdaoDict && !sources.youdaoTranslate && !sources.iciba) {
        showSourcesMessage('❌ 至少需要选择一个翻译源', 'error');
        return;
      }
      
      if (!chrome || !chrome.storage || !chrome.storage.local) {
        showSourcesMessage('❌ Chrome存储API不可用，请确保在扩展环境中使用', 'error');
        return;
      }
      
      chrome.storage.local.set({ translationSources: sources }, function() {
        if (chrome.runtime && chrome.runtime.lastError) {
          showSourcesMessage('❌ 保存失败: ' + chrome.runtime.lastError.message, 'error');
          console.error('[Options] Failed to save sources:', chrome.runtime.lastError);
        } else {
          showSourcesMessage('✅ 翻译源设置已保存', 'success');
          console.log('[Options] Sources saved successfully');
          // Verify what was saved
          chrome.storage.local.get(['translationSources'], function(result) {
            console.log('[Options] Verification - saved sources:', result.translationSources);
          });
        }
      });
    }

    function resetTranslationSources() {
      const youdaoDictCheck = document.getElementById('source-youdao-dict');
      const youdaoTranslateCheck = document.getElementById('source-youdao-translate');
      const icibaCheck = document.getElementById('source-iciba');
      
      if (youdaoDictCheck) youdaoDictCheck.checked = true;
      if (youdaoTranslateCheck) youdaoTranslateCheck.checked = true;
      if (icibaCheck) icibaCheck.checked = false;
      
      const defaultSources = {
        youdaoDict: true,
        youdaoTranslate: true,
        iciba: false
      };
      
      if (!chrome || !chrome.storage || !chrome.storage.local) {
        showSourcesMessage('❌ Chrome存储API不可用', 'error');
        return;
      }
      
      chrome.storage.local.set({ translationSources: defaultSources }, function() {
        if (chrome.runtime && chrome.runtime.lastError) {
          showSourcesMessage('❌ 重置失败', 'error');
        } else {
          showSourcesMessage('🔄 已恢复默认翻译源设置', 'success');
        }
      });
    }

    if (saveSourcesBtn) {
      saveSourcesBtn.addEventListener('click', saveTranslationSources);
    }
    
    if (resetSourcesBtn) {
      resetSourcesBtn.addEventListener('click', resetTranslationSources);
    }
    
    // Load translation sources settings
    loadTranslationSources();

    /* ============================================================
       Toast样式切换功能
       允许用户在经典样式(classic)和现代样式(modern)之间切换
       设置保存在chrome.storage.local的toastStyle字段
       ============================================================ */
    const toastStyleBtns = document.querySelectorAll('.toast-style-btn');
    const currentToastStyleSpan = document.getElementById('currentToastStyle');
    const toastStyleStatusArea = document.getElementById('toastStyleStatusArea');
    
    function showToastStyleMessage(text, type) {
      if (!toastStyleStatusArea) return;
      toastStyleStatusArea.className = 'alert show alert-' + type;
      toastStyleStatusArea.textContent = text;
      setTimeout(function() {
        if (toastStyleStatusArea) {
          toastStyleStatusArea.className = 'alert';
          toastStyleStatusArea.textContent = '';
        }
      }, 3000);
    }
    
    function updateToastStyleUI(style) {
      // 更新按钮样式
      toastStyleBtns.forEach(function(btn) {
        if (btn.getAttribute('data-style') === style) {
          btn.classList.remove('btn-outline');
          btn.classList.add('btn-primary');
        } else {
          btn.classList.remove('btn-primary');
          btn.classList.add('btn-outline');
        }
      });
      // 更新显示文字
      if (currentToastStyleSpan) {
        currentToastStyleSpan.textContent = style === 'classic' ? '经典样式' : '现代样式';
      }
    }
    
    function loadToastStyle() {
      if (!chrome || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.get(['toastStyle'], function(result) {
        const style = result.toastStyle || 'modern';
        updateToastStyleUI(style);
      });
    }
    
    function saveToastStyle(style) {
      if (!chrome || !chrome.storage || !chrome.storage.local) {
        showToastStyleMessage('❌ Chrome存储API不可用', 'error');
        return;
      }
      chrome.storage.local.set({ toastStyle: style }, function() {
        if (chrome.runtime && chrome.runtime.lastError) {
          showToastStyleMessage('❌ 保存失败: ' + chrome.runtime.lastError.message, 'error');
        } else {
          updateToastStyleUI(style);
          const styleName = style === 'classic' ? '经典样式' : '现代样式';
          showToastStyleMessage('✅ 已切换到' + styleName, 'success');
        }
      });
    }
    
    // 绑定按钮点击事件
    toastStyleBtns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        const style = btn.getAttribute('data-style');
        saveToastStyle(style);
      });
    });
    
    // 加载当前Toast样式设置
    loadToastStyle();

    // Wait a tick for chrome APIs if needed
    if (chrome && chrome.storage) {
      loadSettings();
    } else {
      setTimeout(loadSettings, 100);
    }
  });
})();
