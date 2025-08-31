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

    // Wait a tick for chrome APIs if needed
    if (chrome && chrome.storage) {
      loadSettings();
    } else {
      setTimeout(loadSettings, 100);
    }
  });
})();
