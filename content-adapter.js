/**
 * GENERIC CONTENT SCRIPT - ADAPTER SYSTEM
 * Works with any adapter - no firm-specific code here!
 * 
 * This script runs alongside the existing content.js
 * Uses the modular adapter system for data extraction.
 */

(function() {
  'use strict';

  // Prevent double initialization
  if (window.__adapterContentLoaded) return;
  window.__adapterContentLoaded = true;

  const DEBUG = true;
  function log(...args) {
    if (DEBUG) console.log('[ADAPTER]', ...args);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ADAPTER LOADING
  // ═══════════════════════════════════════════════════════════════════
  
  let adapter = null;
  let extractor = null;
  
  async function loadAdapter() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: 'GET_ADAPTER_FOR_URL', url: window.location.href },
        (response) => {
          if (chrome.runtime.lastError) {
            log('Error getting adapter:', chrome.runtime.lastError.message);
            resolve(false);
            return;
          }
          if (response?.adapter) {
            adapter = response.adapter;
            // Reconstruct functions from strings
            reconstructFunctions(adapter);
            extractor = new DataExtractor(adapter);
            log(`✅ Loaded adapter: ${adapter.name}`);
            resolve(true);
          } else {
            resolve(false);
          }
        }
      );
    });
  }

  // Reconstruct functions that were serialized as strings
  function reconstructFunctions(obj) {
    if (!obj || typeof obj !== 'object') return;
    
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (typeof value === 'string' && value.startsWith('(') && value.includes('=>')) {
        try {
          obj[key] = eval(value);
        } catch (e) {
          // Keep as string if eval fails
        }
      } else if (typeof value === 'object') {
        reconstructFunctions(value);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // DATA EXTRACTOR (inline for content script)
  // ═══════════════════════════════════════════════════════════════════
  
  class DataExtractor {
    constructor(adapter) {
      this.adapter = adapter;
    }

    extract() {
      const data = {
        partner: this.adapter.id,
        email: null,
        customer_name: null,
        product_name: null,
        original_price: null,
        final_price: null,
        discount_amount: null,
        coupon_code: null,
        order_number: null,
        plan_id: null,
        checkout_url: window.location.href,
        extra: {}
      };

      if (!this.adapter.extraction?.sources) return data;

      for (const source of this.adapter.extraction.sources) {
        this.extractFromSource(source, data);
      }

      return data;
    }

    extractFromSource(source, data) {
      let sourceData = null;

      switch (source.type) {
        case 'localStorage':
          sourceData = this.getLocalStorage(source.key);
          break;
        case 'sessionStorage':
          sourceData = this.getSessionStorage(source.key);
          break;
        case 'cookie':
          sourceData = this.getCookie(source.key);
          break;
        case 'dom':
          sourceData = {};
          break;
        case 'url':
          sourceData = this.getUrlParams();
          break;
      }

      if (!sourceData && source.type !== 'dom') return;

      for (const [targetField, sourcePath] of Object.entries(source.fields || {})) {
        if (data[targetField] !== null && data[targetField] !== undefined) continue;

        let value = null;

        if (source.type === 'dom') {
          value = this.getDomValue(sourcePath);
        } else if (typeof sourcePath === 'function') {
          try {
            value = sourcePath(sourceData);
          } catch (e) {
            // Function failed
          }
        } else if (typeof sourcePath === 'string') {
          value = this.getNestedValue(sourceData, sourcePath);
        }

        if (value !== null && value !== undefined && value !== '') {
          data[targetField] = value;
        }
      }
    }

    getLocalStorage(key) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      } catch (e) {
        return null;
      }
    }

    getSessionStorage(key) {
      try {
        const raw = sessionStorage.getItem(key);
        if (!raw) return null;
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      } catch (e) {
        return null;
      }
    }

    getCookie(name) {
      const match = document.cookie.match(new RegExp(`${name}=([^;]+)`));
      return match ? decodeURIComponent(match[1]) : null;
    }

    getUrlParams() {
      const params = {};
      new URLSearchParams(window.location.search).forEach((v, k) => params[k] = v);
      return params;
    }

    getDomValue(selector) {
      try {
        const el = document.querySelector(selector);
        if (!el) return null;
        return el.value || el.textContent?.trim() || null;
      } catch (e) {
        return null;
      }
    }

    getNestedValue(obj, path) {
      return path.split('.').reduce((curr, key) => 
        curr && curr[key] !== undefined ? curr[key] : null, obj);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PAGE DETECTION
  // ═══════════════════════════════════════════════════════════════════
  
  function isCheckoutPage() {
    if (!adapter?.pages?.checkout) return false;
    try {
      return adapter.pages.checkout(window.location.href, document);
    } catch (e) {
      return false;
    }
  }

  function isSuccessPage() {
    if (!adapter?.pages?.success) return false;
    try {
      return adapter.pages.success(window.location.href, document);
    } catch (e) {
      return false;
    }
  }

  function checkSuccessTriggers() {
    if (!adapter?.successTriggers) return false;
    
    for (const trigger of adapter.successTriggers) {
      try {
        switch (trigger.type) {
          case 'localStorage':
            if (localStorage.getItem(trigger.key) === trigger.value) return true;
            break;
          case 'url':
            if (window.location.href.includes(trigger.pattern)) return true;
            break;
          case 'dom':
            if (document.querySelector(trigger.selector)) return true;
            break;
        }
      } catch (e) {
        // Trigger check failed
      }
    }
    return false;
  }

  // ═══════════════════════════════════════════════════════════════════
  // CAPTURE & SUCCESS
  // ═══════════════════════════════════════════════════════════════════
  
  function capturePurchase() {
    if (!extractor) return;
    
    const data = extractor.extract();
    
    // Need at least email OR price to consider this a valid capture
    if (!data.email && !data.final_price && !data.original_price) {
      log('Not enough data to capture');
      return;
    }
    
    log('📦 Capturing:', data);
    
    chrome.runtime.sendMessage(
      { action: 'ADAPTER_CAPTURE_PURCHASE', data },
      (response) => {
        if (chrome.runtime.lastError) {
          log('Capture error:', chrome.runtime.lastError.message);
          return;
        }
        if (response?.success) {
          log('✅ Queued:', response.fingerprint);
          showNotification('Purchase data captured', 'success');
        }
      }
    );
  }

  function triggerSuccess() {
    log('🎉 Success detected!');
    
    // Also capture any remaining data from success page
    const successData = extractor ? extractor.extract() : {};
    
    chrome.runtime.sendMessage(
      { 
        action: 'ADAPTER_SUCCESS_DETECTED', 
        data: { 
          partner: adapter.id,
          successPageData: successData
        } 
      },
      (response) => {
        if (chrome.runtime.lastError) {
          log('Success trigger error:', chrome.runtime.lastError.message);
          return;
        }
        if (response?.success) {
          if (response.skipped) {
            showNotification('Already tracked', 'info');
          } else {
            showNotification('Purchase submitted! 🎉', 'success');
          }
        } else if (response?.error) {
          log('❌ Submit failed:', response.error);
          showNotification('Tracking in progress...', 'info');
        }
      }
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // MONITORING
  // ═══════════════════════════════════════════════════════════════════
  
  let lastCaptureTime = 0;
  let hasTriggeredSuccess = false;

  function checkAndCapture() {
    // Throttle to max once every 2 seconds
    if (Date.now() - lastCaptureTime < 2000) return;
    
    if (isCheckoutPage()) {
      capturePurchase();
      lastCaptureTime = Date.now();
    }
  }

  function checkForSuccess() {
    if (hasTriggeredSuccess) return;
    
    if (isSuccessPage() || checkSuccessTriggers()) {
      hasTriggeredSuccess = true;
      const delay = adapter?.timing?.successDelay || 500;
      setTimeout(triggerSuccess, delay);
    }
  }

  // Watch localStorage changes
  function setupStorageWatcher() {
    const originalSetItem = localStorage.setItem;
    localStorage.setItem = function(key, value) {
      originalSetItem.apply(this, arguments);
      
      if (!adapter) return;
      
      // Check if this key triggers success
      for (const trigger of (adapter.successTriggers || [])) {
        if (trigger.type === 'localStorage' && trigger.key === key && trigger.value === value) {
          setTimeout(checkForSuccess, 100);
        }
      }
      
      // Check if this key contains purchase data
      for (const source of (adapter.extraction?.sources || [])) {
        if (source.type === 'localStorage' && source.key === key) {
          setTimeout(checkAndCapture, 300);
        }
      }
    };
  }

  // Watch URL changes (SPA navigation)
  function setupUrlWatcher() {
    let lastUrl = window.location.href;
    
    const observer = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        hasTriggeredSuccess = false;
        log('URL changed:', lastUrl);
        setTimeout(() => {
          checkAndCapture();
          checkForSuccess();
        }, 500);
      }
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Watch form changes
  function setupFormWatcher() {
    document.addEventListener('change', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') {
        setTimeout(checkAndCapture, 500);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // NOTIFICATION
  // ═══════════════════════════════════════════════════════════════════
  
  function showNotification(message, type = 'info') {
    const colors = { 
      success: '#22c55e', 
      error: '#ef4444', 
      info: '#3b82f6' 
    };
    
    const el = document.createElement('div');
    el.style.cssText = `
      position: fixed; 
      top: 20px; 
      right: 20px;
      background: ${colors[type]}; 
      color: white;
      padding: 12px 20px; 
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; 
      font-size: 14px;
      z-index: 999999; 
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      animation: slideIn 0.3s ease;
    `;
    el.innerHTML = `<span style="margin-right: 8px;">🎯</span>${message}`;
    
    // Add animation keyframes
    if (!document.getElementById('adapter-notification-styles')) {
      const style = document.createElement('style');
      style.id = 'adapter-notification-styles';
      style.textContent = `
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }
    
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.animation = 'slideIn 0.3s ease reverse';
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }

  // ═══════════════════════════════════════════════════════════════════
  // DEBUG COMMANDS
  // ═══════════════════════════════════════════════════════════════════
  
  window.adapterDebug = {
    getAdapter: () => adapter,
    extract: () => extractor ? extractor.extract() : null,
    isCheckout: () => isCheckoutPage(),
    isSuccess: () => isSuccessPage(),
    forceCapture: () => capturePurchase(),
    forceSuccess: () => triggerSuccess(),
    getStatus: () => new Promise(resolve => {
      chrome.runtime.sendMessage({ action: 'ADAPTER_GET_STATUS' }, resolve);
    })
  };

  // ═══════════════════════════════════════════════════════════════════
  // INITIALIZE
  // ═══════════════════════════════════════════════════════════════════
  
  async function init() {
    const hasAdapter = await loadAdapter();
    
    if (!hasAdapter) {
      log('No adapter for this URL');
      return;
    }
    
    log(`🚀 Initialized for ${adapter.name}`);
    log(`   Checkout page: ${isCheckoutPage()}`);
    log(`   Success page: ${isSuccessPage()}`);
    
    // Setup watchers
    setupStorageWatcher();
    setupUrlWatcher();
    setupFormWatcher();
    
    // Initial check after delay
    const delay = adapter?.timing?.captureDelay || 1000;
    setTimeout(() => {
      checkAndCapture();
      checkForSuccess();
    }, delay);
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
