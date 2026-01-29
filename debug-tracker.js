// Debug Tracker Module for PropFirm Compare Extension
// Captures all extension activity for debugging and testing

(function() {
  'use strict';
  
  // Only run if debug mode is enabled
  const DEBUG_TRACKER_ENABLED = true; // Set to false in production builds
  
  if (!DEBUG_TRACKER_ENABLED) return;
  
  window.PropFirmDebugTracker = {
    version: '1.0.0',
    startTime: Date.now(),
    logs: [],
    pageInfo: {},
    formFields: [],
    storageSnapshots: [],
    networkRequests: [],
    domObservations: [],
    
    init() {
      this.capturePageInfo();
      this.captureFormFields();
      this.captureStorage();
      this.setupStorageListener();
      this.log('🚀 Debug Tracker initialized', { url: window.location.href });
      
      // Re-capture form fields when DOM changes
      this.setupDOMObserver();
      
      // Capture on page unload
      window.addEventListener('beforeunload', () => {
        this.log('📤 Page unloading');
      });
      
      // Add keyboard shortcut to export (Ctrl+Shift+D)
      document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && e.key === 'D') {
          e.preventDefault();
          this.exportDebugData();
        }
      });
      
      console.log('%c[PropFirm Debug] Press Ctrl+Shift+D to export debug data', 'color: #00ff00; font-weight: bold;');
    },
    
    log(message, data = null) {
      const entry = {
        timestamp: Date.now(),
        relativeTime: Date.now() - this.startTime,
        message,
        data,
        url: window.location.href
      };
      this.logs.push(entry);
      console.log(`%c[PropFirm Debug] ${message}`, 'color: #00ccff;', data || '');
    },
    
    capturePageInfo() {
      this.pageInfo = {
        url: window.location.href,
        hostname: window.location.hostname,
        pathname: window.location.pathname,
        search: window.location.search,
        hash: window.location.hash,
        title: document.title,
        referrer: document.referrer,
        timestamp: Date.now(),
        userAgent: navigator.userAgent,
        screenSize: `${window.screen.width}x${window.screen.height}`,
        viewportSize: `${window.innerWidth}x${window.innerHeight}`,
        cookies: document.cookie ? 'present (not captured for privacy)' : 'none'
      };
      this.log('📄 Page info captured', this.pageInfo);
    },
    
    captureFormFields() {
      const inputs = document.querySelectorAll('input, select, textarea');
      this.formFields = [];
      
      inputs.forEach((input, index) => {
        const field = {
          index,
          tagName: input.tagName.toLowerCase(),
          type: input.type || 'text',
          name: input.name || null,
          id: input.id || null,
          className: input.className || null,
          placeholder: input.placeholder || null,
          autocomplete: input.autocomplete || null,
          ariaLabel: input.getAttribute('aria-label') || null,
          dataAttributes: this.getDataAttributes(input),
          isVisible: this.isElementVisible(input),
          isInIframe: this.isInIframe(input),
          hasValue: !!input.value,
          valueLength: input.value?.length || 0,
          // Don't capture actual values for privacy
          looksLikeEmail: input.type === 'email' || 
                          input.name?.toLowerCase().includes('email') ||
                          input.id?.toLowerCase().includes('email') ||
                          input.placeholder?.toLowerCase().includes('email'),
          looksLikeSensitive: this.looksLikeSensitive(input)
        };
        this.formFields.push(field);
      });
      
      this.log(`📝 Found ${this.formFields.length} form fields`, {
        total: this.formFields.length,
        visible: this.formFields.filter(f => f.isVisible).length,
        inIframes: this.formFields.filter(f => f.isInIframe).length,
        emailFields: this.formFields.filter(f => f.looksLikeEmail).length,
        sensitiveFields: this.formFields.filter(f => f.looksLikeSensitive).length
      });
    },
    
    getDataAttributes(element) {
      const dataAttrs = {};
      Array.from(element.attributes).forEach(attr => {
        if (attr.name.startsWith('data-')) {
          dataAttrs[attr.name] = attr.value;
        }
      });
      return Object.keys(dataAttrs).length > 0 ? dataAttrs : null;
    },
    
    isElementVisible(element) {
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && 
             style.visibility !== 'hidden' && 
             style.opacity !== '0' &&
             element.offsetParent !== null;
    },
    
    isInIframe(element) {
      try {
        return element.ownerDocument !== window.document;
      } catch (e) {
        return true; // Cross-origin iframe
      }
    },
    
    looksLikeSensitive(input) {
      const name = (input.name || '').toLowerCase();
      const id = (input.id || '').toLowerCase();
      const type = input.type?.toLowerCase();
      const autocomplete = (input.autocomplete || '').toLowerCase();
      
      const sensitivePatterns = [
        'card', 'credit', 'debit', 'cc-', 'cvv', 'cvc', 'csv',
        'expir', 'password', 'passwd', 'ssn', 'social', 'tax',
        'account-number', 'routing', 'pin', 'secret'
      ];
      
      const text = `${name} ${id} ${autocomplete}`;
      return type === 'password' || 
             sensitivePatterns.some(p => text.includes(p));
    },
    
    async captureStorage() {
      const snapshot = {
        timestamp: Date.now(),
        relativeTime: Date.now() - this.startTime,
        localStorage: this.captureLocalStorage(),
        sessionStorage: this.captureSessionStorage(),
        chromeStorage: await this.captureChromeStorage()
      };
      this.storageSnapshots.push(snapshot);
      this.log('💾 Storage snapshot captured', {
        localStorageKeys: Object.keys(snapshot.localStorage).length,
        sessionStorageKeys: Object.keys(snapshot.sessionStorage).length,
        chromeStorageKeys: Object.keys(snapshot.chromeStorage).length
      });
    },
    
    captureLocalStorage() {
      const data = {};
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          const value = localStorage.getItem(key);
          // Truncate long values
          data[key] = value?.length > 500 ? value.substring(0, 500) + '...[truncated]' : value;
        }
      } catch (e) {
        data._error = e.message;
      }
      return data;
    },
    
    captureSessionStorage() {
      const data = {};
      try {
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          const value = sessionStorage.getItem(key);
          data[key] = value?.length > 500 ? value.substring(0, 500) + '...[truncated]' : value;
        }
      } catch (e) {
        data._error = e.message;
      }
      return data;
    },
    
    async captureChromeStorage() {
      const data = {};
      try {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          const result = await chrome.storage.local.get(null);
          for (const [key, value] of Object.entries(result)) {
            const stringValue = JSON.stringify(value);
            data[key] = stringValue?.length > 500 ? 
              stringValue.substring(0, 500) + '...[truncated]' : 
              value;
          }
        }
      } catch (e) {
        data._error = e.message;
      }
      return data;
    },
    
    setupStorageListener() {
      // Listen for chrome.storage changes
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.onChanged.addListener((changes, areaName) => {
          this.log(`💾 Chrome storage changed (${areaName})`, changes);
        });
      }
    },
    
    setupDOMObserver() {
      let debounceTimer;
      const observer = new MutationObserver((mutations) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          const addedNodes = mutations.reduce((acc, m) => acc + m.addedNodes.length, 0);
          const removedNodes = mutations.reduce((acc, m) => acc + m.removedNodes.length, 0);
          
          if (addedNodes > 0 || removedNodes > 0) {
            this.domObservations.push({
              timestamp: Date.now(),
              relativeTime: Date.now() - this.startTime,
              addedNodes,
              removedNodes,
              url: window.location.href
            });
            
            // Re-capture form fields if significant changes
            if (addedNodes > 5) {
              this.captureFormFields();
            }
          }
        }, 500);
      });
      
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    },
    
    captureIframes() {
      const iframes = document.querySelectorAll('iframe');
      const iframeInfo = [];
      
      iframes.forEach((iframe, index) => {
        iframeInfo.push({
          index,
          src: iframe.src || null,
          id: iframe.id || null,
          className: iframe.className || null,
          width: iframe.width || iframe.offsetWidth,
          height: iframe.height || iframe.offsetHeight,
          isVisible: this.isElementVisible(iframe),
          isCrossOrigin: this.isCrossOriginIframe(iframe)
        });
      });
      
      return iframeInfo;
    },
    
    isCrossOriginIframe(iframe) {
      try {
        // Attempting to access contentDocument will throw for cross-origin
        const doc = iframe.contentDocument;
        return false;
      } catch (e) {
        return true;
      }
    },
    
    async exportDebugData() {
      // Capture final state
      this.captureFormFields();
      await this.captureStorage();
      
      const debugData = {
        exportVersion: '1.0.0',
        exportTimestamp: new Date().toISOString(),
        extensionVersion: '2.1.3',
        sessionDuration: Date.now() - this.startTime,
        
        pageInfo: this.pageInfo,
        
        formFields: this.formFields,
        formFieldsSummary: {
          total: this.formFields.length,
          visible: this.formFields.filter(f => f.isVisible).length,
          inIframes: this.formFields.filter(f => f.isInIframe).length,
          emailFields: this.formFields.filter(f => f.looksLikeEmail),
          withValues: this.formFields.filter(f => f.hasValue).length
        },
        
        iframes: this.captureIframes(),
        
        storageSnapshots: this.storageSnapshots,
        latestStorage: this.storageSnapshots[this.storageSnapshots.length - 1],
        
        logs: this.logs,
        
        domObservations: this.domObservations,
        
        urlHistory: this.getUrlHistory(),
        
        // Page structure (simplified)
        pageStructure: this.capturePageStructure()
      };
      
      // Create and download file
      const blob = new Blob([JSON.stringify(debugData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `propfirm-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      console.log('%c[PropFirm Debug] Debug data exported!', 'color: #00ff00; font-weight: bold;');
      this.log('📤 Debug data exported');
    },
    
    getUrlHistory() {
      // Extract URLs from logs
      const urls = new Set();
      this.logs.forEach(log => {
        if (log.url) urls.add(log.url);
      });
      return Array.from(urls);
    },
    
    capturePageStructure() {
      // Capture simplified page structure for debugging
      const structure = {
        forms: [],
        buttons: [],
        links: []
      };
      
      // Forms
      document.querySelectorAll('form').forEach((form, i) => {
        structure.forms.push({
          index: i,
          id: form.id || null,
          action: form.action || null,
          method: form.method || null,
          inputCount: form.querySelectorAll('input').length
        });
      });
      
      // Submit buttons
      document.querySelectorAll('button[type="submit"], input[type="submit"], button:not([type])').forEach((btn, i) => {
        structure.buttons.push({
          index: i,
          text: btn.textContent?.trim().substring(0, 50) || null,
          type: btn.type || null,
          id: btn.id || null
        });
      });
      
      return structure;
    }
  };
  
  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      window.PropFirmDebugTracker.init();
    });
  } else {
    window.PropFirmDebugTracker.init();
  }
})();

