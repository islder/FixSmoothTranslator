// Word Recorder Module - Manages saved words with auto-delete and export features
(function() {
  'use strict';

  // Constants
  const STORAGE_KEY = 'recordedWords';
  const RETENTION_KEY = 'wordRetentionDays';
  const ENABLED_KEY = 'wordRecordingEnabled';
  const DEFAULT_RETENTION = 30; // Default 30 days
  const MAX_WORDS = 10000; // Prevent memory overflow

  // State management
  let currentRetentionDays = DEFAULT_RETENTION;
  let wordStatusArea = null;
  
  // Modal system
  let modalCallback = null;
  
  function showModal(title, body, buttons) {
    const overlay = document.getElementById('modalOverlay');
    const modalTitle = document.getElementById('modalTitle');
    const modalBody = document.getElementById('modalBody');
    const modalFooter = document.getElementById('modalFooter');
    
    if (!overlay || !modalTitle || !modalBody || !modalFooter) return;
    
    modalTitle.textContent = title;
    modalBody.innerHTML = body;
    
    // Clear footer and add custom buttons
    modalFooter.innerHTML = '';
    buttons.forEach(button => {
      const btn = document.createElement('button');
      btn.className = button.class || 'btn btn-outline';
      btn.textContent = button.text;
      btn.onclick = function() {
        overlay.classList.remove('show');
        if (button.callback) button.callback();
      };
      modalFooter.appendChild(btn);
    });
    
    overlay.classList.add('show');
  }
  
  function hideModal() {
    const overlay = document.getElementById('modalOverlay');
    if (overlay) overlay.classList.remove('show');
  }
  
  // Validate if a string is a valid English word (basic check)
  function isValidWord(word) {
    if (!word || typeof word !== 'string') return false;
    
    // Clean the word
    const cleaned = word.toLowerCase().trim();
    
    // Check length (words should be between 1 and 45 characters)
    if (cleaned.length < 1 || cleaned.length > 45) return false;
    
    // Check if it contains only valid English word characters
    // Allow letters, hyphens, and apostrophes (for words like "don't" or "mother-in-law")
    const validWordPattern = /^[a-z]+(?:[-'][a-z]+)*$/;
    
    return validWordPattern.test(cleaned);
  }

  // Helper function to show messages
  function showMessage(text, type = 'info') {
    if (!wordStatusArea) return;
    wordStatusArea.className = 'alert show alert-' + type;
    wordStatusArea.textContent = text;
    setTimeout(function() { 
      if (wordStatusArea) {
        wordStatusArea.className = 'alert';
        wordStatusArea.textContent = '';
      }
    }, 3000);
  }

  // Format date for display
  function formatDate(timestamp) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  // Clean old words based on retention setting
  function cleanOldWords(words) {
    const now = Date.now();
    const retentionMs = currentRetentionDays * 24 * 60 * 60 * 1000;
    const cutoffTime = now - retentionMs;
    
    // Filter out old words
    const cleaned = {};
    let removedCount = 0;
    
    for (const word in words) {
      if (words[word].timestamp >= cutoffTime) {
        cleaned[word] = words[word];
      } else {
        removedCount++;
      }
    }
    
    if (removedCount > 0) {
      console.log('Cleaned ' + removedCount + ' old words');
    }
    
    return cleaned;
  }

  // Load and display word statistics
  function loadWordStats() {
    chrome.storage.local.get([STORAGE_KEY], function(result) {
      const words = result[STORAGE_KEY] || {};
      const wordList = Object.values(words);
      const wordCount = wordList.length;
      
      // Update count
      const countElement = document.getElementById('wordCount');
      if (countElement) {
        countElement.textContent = wordCount;
      }
      
      // Update oldest and newest
      if (wordCount > 0) {
        wordList.sort((a, b) => a.timestamp - b.timestamp);
        
        const oldestElement = document.getElementById('oldestWord');
        if (oldestElement) {
          oldestElement.textContent = wordList[0].word + ' (' + formatDate(wordList[0].timestamp) + ')';
        }
        
        const newestElement = document.getElementById('newestWord');
        if (newestElement) {
          newestElement.textContent = wordList[wordCount - 1].word + ' (' + formatDate(wordList[wordCount - 1].timestamp) + ')';
        }
      } else {
        const oldestElement = document.getElementById('oldestWord');
        const newestElement = document.getElementById('newestWord');
        if (oldestElement) oldestElement.textContent = '--';
        if (newestElement) newestElement.textContent = '--';
      }
    });
  }

  // Load retention setting
  function loadRetentionSetting() {
    chrome.storage.local.get([RETENTION_KEY], function(result) {
      currentRetentionDays = result[RETENTION_KEY] || DEFAULT_RETENTION;
      
      // Update UI
      const currentRetentionSpan = document.getElementById('currentRetention');
      if (currentRetentionSpan) {
        currentRetentionSpan.textContent = currentRetentionDays + '天';
      }
      
      // Update button states
      const buttons = document.querySelectorAll('.word-retention-btn');
      buttons.forEach(function(btn) {
        const days = parseInt(btn.getAttribute('data-days'), 10);
        if (days === currentRetentionDays) {
          btn.className = 'btn btn-primary word-retention-btn';
        } else {
          btn.className = 'btn btn-outline word-retention-btn';
        }
      });
      
      // Perform cleanup
      performCleanup();
    });
  }

  // Perform cleanup of old words
  function performCleanup() {
    chrome.storage.local.get([STORAGE_KEY], function(result) {
      const words = result[STORAGE_KEY] || {};
      const cleaned = cleanOldWords(words);
      
      if (Object.keys(cleaned).length !== Object.keys(words).length) {
        chrome.storage.local.set({ [STORAGE_KEY]: cleaned }, function() {
          loadWordStats();
        });
      }
    });
  }

  // Handle retention time change
  function handleRetentionChange(days) {
    currentRetentionDays = days;
    chrome.storage.local.set({ [RETENTION_KEY]: days }, function() {
      const currentRetentionSpan = document.getElementById('currentRetention');
      if (currentRetentionSpan) {
        currentRetentionSpan.textContent = days + '天';
      }
      
      // Update button states
      const buttons = document.querySelectorAll('.word-retention-btn');
      buttons.forEach(function(btn) {
        const btnDays = parseInt(btn.getAttribute('data-days'), 10);
        if (btnDays === days) {
          btn.className = 'btn btn-primary word-retention-btn';
        } else {
          btn.className = 'btn btn-outline word-retention-btn';
        }
      });
      
      showMessage('✅ 自动清理时间已设置为 ' + days + ' 天', 'success');
      
      // Perform immediate cleanup
      performCleanup();
    });
  }

  // Export words with format selection
  function exportWords() {
    // Use modal for format selection
    showModal(
      '选择导出格式',
      '<p style="margin-bottom: 20px;">请选择您想要导出的格式：</p>' +
      '<div style="display: flex; flex-direction: column; gap: 12px;">' +
      '<div style="padding: 12px; background: #f5f5f5; border-radius: 8px;">' +
      '<strong>💾 完整格式 (JSON)</strong>' +
      '<p style="margin: 4px 0 0 0; font-size: 13px; color: #666;">包含时间戳，适用于备份和恢复</p>' +
      '</div>' +
      '<div style="padding: 12px; background: #f5f5f5; border-radius: 8px;">' +
      '<strong>📄 简单格式 (TXT)</strong>' +
      '<p style="margin: 4px 0 0 0; font-size: 13px; color: #666;">仅单词列表，用分号分隔</p>' +
      '</div>' +
      '</div>',
      [
        {
          text: '导出完整格式',
          class: 'btn btn-primary',
          callback: function() { performExport(true); }
        },
        {
          text: '导出简单格式',
          class: 'btn btn-secondary',
          callback: function() { performExport(false); }
        },
        {
          text: '取消',
          class: 'btn btn-outline',
          callback: null
        }
      ]
    );
  }
  
  function performExport(format) {
    
    chrome.storage.local.get([STORAGE_KEY], function(result) {
      const words = result[STORAGE_KEY] || {};
      const wordList = Object.keys(words).sort();
      
      if (wordList.length === 0) {
        showMessage('❌ 没有词汇可以导出', 'error');
        return;
      }
      
      let content, filename;
      
      if (format) {
        // Full format with timestamps (JSON)
        const exportData = {
          version: '1.0',
          exportDate: Date.now(),
          wordCount: wordList.length,
          words: words
        };
        content = JSON.stringify(exportData, null, 2);
        filename = 'words_backup_' + formatDate(Date.now()).replace(/-/g, '') + '.json';
      } else {
        // Simple format with semicolons
        content = wordList.join(';');
        filename = 'words_simple_' + formatDate(Date.now()).replace(/-/g, '') + '.txt';
      }
      
      // Create blob and download
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      const formatName = format ? '完整格式' : '简单格式';
      showMessage('✅ 已导出 ' + wordList.length + ' 个单词（' + formatName + '）', 'success');
    });
  }

  // View words
  function viewWords() {
    const previewDiv = document.getElementById('wordsPreview');
    const previewContent = document.getElementById('wordsPreviewContent');
    
    if (!previewDiv || !previewContent) return;
    
    // Toggle visibility
    if (previewDiv.style.display === 'none' || !previewDiv.style.display) {
      previewDiv.style.display = 'block';
      
      // Load and display words
      chrome.storage.local.get([STORAGE_KEY], function(result) {
        const words = result[STORAGE_KEY] || {};
        const wordList = Object.keys(words).sort();
        
        if (wordList.length === 0) {
          previewContent.textContent = '暂无记录的词汇';
        } else {
          // Group words by date
          const wordsByDate = {};
          for (const word in words) {
            const date = formatDate(words[word].timestamp);
            if (!wordsByDate[date]) {
              wordsByDate[date] = [];
            }
            wordsByDate[date].push(word);
          }
          
          // Create formatted display
          let display = '总计: ' + wordList.length + ' 个单词\n\n';
          
          // Sort dates in descending order (newest first)
          const dates = Object.keys(wordsByDate).sort().reverse();
          
          dates.forEach(function(date) {
            display += '【' + date + '】\n';
            display += wordsByDate[date].sort().join('; ') + '\n\n';
          });
          
          previewContent.textContent = display;
        }
      });
      
      // Update button text
      const viewBtn = document.getElementById('viewWordsBtn');
      if (viewBtn) {
        viewBtn.innerHTML = '<span class="icon">🙈</span> 隐藏词汇';
      }
    } else {
      previewDiv.style.display = 'none';
      
      // Update button text
      const viewBtn = document.getElementById('viewWordsBtn');
      if (viewBtn) {
        viewBtn.innerHTML = '<span class="icon">👁️</span> 查看词汇';
      }
    }
  }

  // Clear all words
  function clearAllWords() {
    if (!confirm('⚠️ 确定要清空所有记录的词汇吗？此操作不可恢复！')) {
      return;
    }
    
    chrome.storage.local.remove(STORAGE_KEY, function() {
      loadWordStats();
      
      // Hide preview if visible
      const previewDiv = document.getElementById('wordsPreview');
      if (previewDiv) {
        previewDiv.style.display = 'none';
      }
      
      showMessage('✅ 已清空所有词汇记录', 'success');
    });
  }

  // Handle feature toggle
  function handleFeatureToggle() {
    const toggle = document.getElementById('wordRecordingToggle');
    const settingsDiv = document.getElementById('wordRecordingSettings');
    
    if (!toggle || !settingsDiv) return;
    
    // Load current state
    chrome.storage.local.get([ENABLED_KEY], function(result) {
      const isEnabled = result[ENABLED_KEY] !== false; // Default to true
      toggle.checked = isEnabled;
      settingsDiv.style.opacity = isEnabled ? '1' : '0.5';
      settingsDiv.style.pointerEvents = isEnabled ? 'auto' : 'none';
    });
    
    // Handle toggle change
    toggle.addEventListener('change', function() {
      const isEnabled = toggle.checked;
      chrome.storage.local.set({ [ENABLED_KEY]: isEnabled }, function() {
        settingsDiv.style.opacity = isEnabled ? '1' : '0.5';
        settingsDiv.style.pointerEvents = isEnabled ? 'auto' : 'none';
        
        if (isEnabled) {
          showMessage('✅ 词汇记录功能已启用', 'success');
          loadWordStats();
        } else {
          showMessage('⚠️ 词汇记录功能已禁用（数据保留）', 'info');
        }
      });
    });
  }
  
  // Import words from file
  function importWords() {
    const fileInput = document.getElementById('importFileInput');
    if (!fileInput) return;
    
    fileInput.click();
  }
  
  // Handle file import
  function handleFileImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
      const content = e.target.result;
      
      try {
        let importedWords = {};
        let validCount = 0;
        let invalidWords = [];
        let isJsonFormat = false;
        
        // Try to parse as JSON first (full format)
        try {
          const jsonData = JSON.parse(content);
          if (jsonData.words && typeof jsonData.words === 'object') {
            // Full format import - validate each word in JSON
            isJsonFormat = true;
            for (const word in jsonData.words) {
              const cleanWord = word.toLowerCase().trim();
              if (isValidWord(cleanWord) && jsonData.words[word].timestamp) {
                importedWords[cleanWord] = {
                  word: cleanWord,
                  timestamp: jsonData.words[word].timestamp
                };
                validCount++;
              } else if (cleanWord) {
                invalidWords.push(word);
              }
            }
            console.log('Importing JSON format: ' + validCount + ' valid words');
          } else {
            throw new Error('Not valid JSON format');
          }
        } catch (jsonError) {
          // Try to parse as simple text format
          const wordList = content.split(/[;,\n\r\t]+/).map(w => w.trim()).filter(w => w);
          if (wordList.length > 0) {
            // Simple format import - add current timestamp
            const now = Date.now();
            
            wordList.forEach(word => {
              const cleanWord = word.toLowerCase().trim();
              // Validate word before adding
              if (isValidWord(cleanWord)) {
                importedWords[cleanWord] = {
                  word: cleanWord,
                  timestamp: now
                };
                validCount++;
              } else if (cleanWord) {
                invalidWords.push(word);
              }
            });
            
            console.log('Importing simple format: ' + validCount + ' valid words');
          } else {
            throw new Error('无法识别文件格式');
          }
        }
        
        // Log skipped words if any
        if (invalidWords.length > 0) {
          console.warn('Skipped invalid words:', invalidWords);
        }
        
        if (Object.keys(importedWords).length === 0) {
          showMessage('❌ 文件中没有有效的单词', 'error');
          return;
        }
        
        // Use modal to ask user how to handle import
        showModal(
          '导入选项',
          '<p style="margin-bottom: 20px;">找到 <strong>' + Object.keys(importedWords).length + '</strong> 个有效单词</p>' +
          '<p style="margin-bottom: 20px;">请选择导入方式：</p>' +
          '<div style="display: flex; flex-direction: column; gap: 12px;">' +
          '<div style="padding: 12px; background: #f5f5f5; border-radius: 8px;">' +
          '<strong>🔄 合并导入</strong>' +
          '<p style="margin: 4px 0 0 0; font-size: 13px; color: #666;">保留现有单词，添加新单词</p>' +
          '</div>' +
          '<div style="padding: 12px; background: #f5f5f5; border-radius: 8px;">' +
          '<strong>🔄 替换导入</strong>' +
          '<p style="margin: 4px 0 0 0; font-size: 13px; color: #666;">清空现有列表后导入</p>' +
          '</div>' +
          '</div>',
          [
            {
              text: '合并导入',
              class: 'btn btn-primary',
              callback: function() { performImport(importedWords, true); }
            },
            {
              text: '替换导入',
              class: 'btn btn-secondary',
              callback: function() { performImport(importedWords, false); }
            },
            {
              text: '取消',
              class: 'btn btn-outline',
              callback: null
            }
          ]
        );
        
      } catch (error) {
        console.error('Import error:', error);
        showMessage('❌ 导入失败：' + error.message, 'error');
      }
    };
    
    reader.readAsText(file);
    // Reset file input
    event.target.value = '';
  }
  
  // Perform the actual import
  function performImport(importedWords, mergeOption) {
    chrome.storage.local.get([STORAGE_KEY], function(result) {
      let finalWords = {};
      
      if (mergeOption) {
        // Merge with existing words
        finalWords = result[STORAGE_KEY] || {};
        // Add imported words, updating timestamp to current time to prevent immediate deletion
        const now = Date.now();
        for (const word in importedWords) {
          // Always update timestamp to current time when importing to keep words fresh
          finalWords[word] = {
            word: importedWords[word].word,
            timestamp: now
          };
        }
      } else {
        // Replace existing words with fresh timestamps
        const now = Date.now();
        for (const word in importedWords) {
          finalWords[word] = {
            word: importedWords[word].word,
            timestamp: now
          };
        }
      }
      
      // Save imported words
      chrome.storage.local.set({ [STORAGE_KEY]: finalWords }, function() {
        loadWordStats();
        const action = mergeOption ? '合并' : '替换';
        showMessage('✅ 成功' + action + '导入 ' + Object.keys(importedWords).length + ' 个单词', 'success');
      });
    });
  }
  
  // Initialize when DOM is ready
  document.addEventListener('DOMContentLoaded', function() {
    wordStatusArea = document.getElementById('wordStatusArea');
    
    // Setup modal close button
    const modalClose = document.getElementById('modalClose');
    const modalOverlay = document.getElementById('modalOverlay');
    if (modalClose) {
      modalClose.addEventListener('click', hideModal);
    }
    if (modalOverlay) {
      modalOverlay.addEventListener('click', function(e) {
        if (e.target === modalOverlay) hideModal();
      });
    }
    
    // Handle feature toggle
    handleFeatureToggle();
    
    // Load initial data
    loadRetentionSetting();
    loadWordStats();
    
    // Attach event listeners
    const retentionBtns = document.querySelectorAll('.word-retention-btn');
    retentionBtns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        const days = parseInt(btn.getAttribute('data-days'), 10);
        handleRetentionChange(days);
      });
    });
    
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', exportWords);
    }
    
    const importBtn = document.getElementById('importBtn');
    if (importBtn) {
      importBtn.addEventListener('click', importWords);
    }
    
    const importFileInput = document.getElementById('importFileInput');
    if (importFileInput) {
      importFileInput.addEventListener('change', handleFileImport);
    }
    
    const viewBtn = document.getElementById('viewWordsBtn');
    if (viewBtn) {
      viewBtn.addEventListener('click', viewWords);
    }
    
    const clearBtn = document.getElementById('clearWordsBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', clearAllWords);
    }
    
    // Set up periodic cleanup (every hour)
    setInterval(performCleanup, 60 * 60 * 1000);
    
    // Listen for storage changes to update stats
    chrome.storage.onChanged.addListener(function(changes, namespace) {
      if (namespace === 'local' && changes[STORAGE_KEY]) {
        loadWordStats();
      }
    });
  });
})();
