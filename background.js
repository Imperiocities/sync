// Background script for PropFirm Compare Extension v2.1.3 - FORM-BASED TRACKING
// V2.1 Features: User accounts, form-based purchase tracking, rewards display§§§

// Production logging control - set to false for production builds
const DEBUG_MODE = true; // Set to false for production builds

// V2: API Configuration
const API_BASE_URL = 'https://prop-firm-compare-env-develop-junos-projects-17951c31.vercel.app';

// Valid coupon codes to track
const VALID_COUPONS = [
  'LAB',
  'JAN',
  // Tradeify test codes (50K Growth Giveaway)
  'D6AW5AUR',
  'FDE9F6ZJ',
  '34719CZU',
  '8JNM1V6Z',
  'ZRX8E67V'
];

// Controlled logging functions
const debugLog = (...args) => {
  if (DEBUG_MODE) {
    console.log(...args);
  }
};

const debugError = (...args) => {
  if (DEBUG_MODE) {
    debugError(...args);
  }
};

const debugWarn = (...args) => {
  if (DEBUG_MODE) {
    debugWarn(...args);
  }
};

debugLog('🚀 PropFirm Compare Extension v2.1.3 - Service Worker Starting (FORM-BASED TRACKING)');

class PropFirmExtension {
  constructor() {
    // Default settings
    this.defaultSettings = {
      enabled: true,
      autoApply: true,
      showCheckoutReminders: true,
      showFloatingIcon: true,
      automaticCodeFilling: true
    };
    
    // Initialize settings in memory (will be loaded from storage)
    this.userSettings = { ...this.defaultSettings };
    
    // Initialize cache system
    this.cache = {
      data: null,
      timestamp: null,
      maxAge: 5 * 60 * 1000 // 5 minutes cache
    };
    
    this.setupEventListeners();
    this.loadUserSettings(); // Load settings from storage first
    this.loadPropFirmsData();
  }

  async loadUserSettings() {
    try {
      const result = await chrome.storage.local.get('userSettings');
      if (result.userSettings) {
        // Merge stored settings with defaults (in case new settings are added)
        this.userSettings = { ...this.defaultSettings, ...result.userSettings };
        debugLog('✅ Settings loaded from storage:', this.userSettings);
      } else {
        // First time - save default settings
        debugLog('🆕 First time setup - using default settings');
        await this.saveUserSettings();
      }
    } catch (error) {
      debugError('❌ Failed to load settings from storage:', error);
      this.userSettings = { ...this.defaultSettings };
    }
  }

  async saveUserSettings() {
    try {
      await chrome.storage.local.set({ userSettings: this.userSettings });
      debugLog('💾 Settings saved to storage:', this.userSettings);
    } catch (error) {
      debugError('❌ Failed to save settings to storage:', error);
    }
  }

  setupEventListeners() {
    // Listen when a tab is updated - check immediately on URL change
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      // Check on URL change (faster) and also when complete
      if ((changeInfo.url || changeInfo.status === 'complete') && tab.url) {
        debugLog('🔍 Tab updated, checking for prop firm:', tab.url);
        this.checkForPropFirmSite(tab);
      }
    });

    // Also check when user switches tabs
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (tab.url) {
          debugLog('🔄 Tab activated, checking for prop firm:', tab.url);
          this.checkForPropFirmSite(tab);
        }
      } catch (error) {
        debugLog('Error getting active tab:', error);
      }
    });

    // Listen for messages from content scripts (type-based messages)
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // Only handle messages with 'type' property (not 'action' which is for auth)
      if (message.type) {
        this.handleMessage(message, sender, sendResponse);
        return true; // Keep channel open for async responses
      }
      // Return false to let other handlers process 'action' messages
      return false;
    });

    // Setup when extension is installed
    chrome.runtime.onInstalled.addListener(() => {
      debugLog('PropFirm Compare Extension installed');
      this.initializeExtension();
    });
  }

  initializeExtension() {
    // Initialize extension (storage disabled to avoid service worker issues)
    debugLog('🎯 PropFirm Compare Extension initialized successfully');
    debugLog('⚙️ Default settings: Auto-apply enabled, notifications enabled');
  }

  async loadPropFirmsData() {
    try {
      // Check cache first
      if (this.isCacheValid()) {
        debugLog('📦 Using cached prop firms data');
        this.propFirmsData = this.cache.data;
        return;
      }

      debugLog('🌐 Loading fresh prop firms data from API...');
      this.propFirmsData = await this.fetchPropFirmsData();
      
      // Cache the fresh data
      this.cache.data = this.propFirmsData;
      this.cache.timestamp = Date.now();
      
      debugLog('✅ PropFirms data loaded and cached:', this.propFirmsData.firms.length, 'firms');
    } catch (error) {
      debugError('❌ Error loading prop firms data:', error);
      
      // Fallback to cache if available, even if expired
      if (this.cache.data) {
        debugLog('⚠️ Using expired cache as fallback');
        this.propFirmsData = this.cache.data;
      } else {
        this.propFirmsData = { firms: [] };
      }
    }
  }

  isCacheValid() {
    return this.cache.data && 
           this.cache.timestamp && 
           (Date.now() - this.cache.timestamp) < this.cache.maxAge;
  }

  async fetchPropFirmsData() {
    try {
      debugLog('🌐 Fetching live data from PropFirm Compare API...');
      
      // Get data directly from API only
      const apiData = await this.fetchApiData();
      
      if (apiData && apiData.length > 0) {
        const transformedData = this.transformApiData(apiData);
        debugLog(`✅ API data processed: ${transformedData.firms.length} active firms`);
        return transformedData;
      } else {
        throw new Error('No data received from API');
      }
      
    } catch (error) {
      debugError('❌ Failed to load PropFirms data:', error);
      // Only fallback if absolutely necessary
      return this.getMinimalFallback();
    }
  }

  async fetchApiData() {
    try {
      // API Key for PropFirm Compare API authentication
      const API_KEY = 'pfc_ext_3077aa32a2cb58e6f1c0d179f878508d5d84adb6216380426585be0b398cc96a';
      
      debugLog('📡 Sending request to PropFirm Compare API...');
      
      const apiResponse = await fetch('https://propfirm.compare/api/v1/prop-firms', {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'PropFirm Compare Extension v4.3.1',
          'X-API-Key': API_KEY
        }
      });
      
      debugLog(`📊 HTTP Response: ${apiResponse.status} ${apiResponse.statusText}`);
      
      if (!apiResponse.ok) {
        throw new Error(`API request failed: ${apiResponse.status} ${apiResponse.statusText}`);
      }
      
      const responseText = await apiResponse.text();
      debugLog(`📄 Response size: ${responseText.length} characters`);
      
      let apiResult;
      try {
        apiResult = JSON.parse(responseText);
      } catch (parseError) {
        debugError('❌ JSON parse error:', parseError.message);
        debugError('📄 Response content:', responseText.substring(0, 500));
        throw new Error(`JSON parse failed: ${parseError.message}`);
      }
      
      debugLog('✅ JSON parsed successfully');
      debugLog('🔍 Response structure preview:', JSON.stringify(apiResult, null, 2).substring(0, 300));
      
      // Flexible validation - accept different response formats
      if (apiResult.success !== false && apiResult.data && Array.isArray(apiResult.data)) {
        debugLog(`🚀 API data loaded: ${apiResult.data.length} firms from ${apiResult.timestamp || 'unknown time'}`);
        return apiResult.data;
      } else if (Array.isArray(apiResult)) {
        // Handle case where response is directly an array
        debugLog(`🚀 API data loaded: ${apiResult.length} firms (direct array format)`);
        return apiResult;
      } else {
        debugWarn('❌ Unexpected response format:');
        debugWarn('- success:', apiResult.success);
        debugWarn('- data type:', typeof apiResult.data, Array.isArray(apiResult.data) ? '(array)' : '(not array)');
        debugWarn('- data length:', apiResult.data ? apiResult.data.length : 'N/A');
        throw new Error('Invalid API response format');
      }
      
    } catch (error) {
      debugWarn('⚠️ API fetch failed:', error.message);
      debugWarn('🔧 Falling back to local configuration...');
      return null;
    }
  }

  transformApiData(apiData) {
    debugLog('🔄 Transforming API data for extension...');
    debugLog(`📊 Raw API data: ${apiData.length} firms received`);
    
    const transformedFirms = apiData
      .filter(firm => {
        // Simple filtering - only require firm name (discount code is always 'LAB' and not from API)
        const hasName = firm.name;
        
        debugLog(`🔍 Filter check for ${firm.name}: ${hasName ? 'PASS' : 'FAIL'} (hasName: ${!!hasName})`);
        
        if (!hasName) {
          debugLog(`❌ Excluded firm: missing name`);
          debugLog(`   Available fields: ${Object.keys(firm).join(', ')}`);
        }
        
        return hasName;
      })
      .map(firm => {
        // Discount code is always 'LAB' - not provided by API
        const discountCode = 'LAB';
        
        // Extract discount amount with flexible field names  
        const discountAmount = firm.discount || firm.discountPercentage || firm.discountValue || 10;
        const discountText = discountAmount.toString().includes('%') ? discountAmount : `${discountAmount}%`;
        
        const transformedFirm = {
          id: this.generateId(firm.name),
          name: firm.name,
          logo: firm.logo || firm.logoUrl || firm.image,
          // Extract domains from website field or use normalized name
          domains: this.extractDomains(firm),
          codes: [
            {
              code: discountCode,
              discount: discountText,
              description: `PropFirm Compare exclusive - ${discountText} off`,
              priority: 1,
              active: true,
              affiliateLink: firm.affiliateLink || firm.website || '',
              challengeFee: firm.challengeFee || firm.fee || 0,
              maxFunding: firm.maxFunding || firm.funding || 0,
              profitSplit: firm.profitSplit || firm.profit || 0,
              isFeatured: firm.isFeatured || firm.featured || false
            }
          ],
          // Use generic selectors that work on most prop firm sites
          selectors: this.getGenericSelectors(),
          // Mark as API-sourced
          isApiEnhanced: true,
          apiData: firm
        };
        
        debugLog(`✅ Transformed: ${firm.name} - ${discountText} discount (code: ${discountCode})`);
        return transformedFirm;
      });
    
    debugLog(`🎯 Final result: ${transformedFirms.length} firms processed successfully`);
    return { firms: transformedFirms };
  }

  generateId(name) {
    return name.toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .replace(/futures?/g, '')
      .replace(/funding/g, '')
      .replace(/trader?/g, '')
      .replace(/trading/g, '');
  }

  extractDomains(firm) {
    let domains = [];
    
    // PRIORITY 1: Use affiliate link domain (this is where users actually go)
    if (firm.affiliateLink) {
      try {
        const url = new URL(firm.affiliateLink.startsWith('http') ? firm.affiliateLink : `https://${firm.affiliateLink}`);
        const fullDomain = url.hostname.replace('www.', '');
        
        // Add the specific domain
        domains.push(fullDomain);
        
        // Extract base domain (for subdomain matching)
        const baseDomain = this.extractBaseDomain(fullDomain);
        if (baseDomain !== fullDomain && !domains.includes(baseDomain)) {
          domains.push(baseDomain);
        }
        
        debugLog(`🎯 Extracted domains from affiliateLink for ${firm.name}:`);
        debugLog(`   - Specific domain: ${fullDomain}`);
        if (baseDomain !== fullDomain) {
          debugLog(`   - Base domain: ${baseDomain} (for subdomain matching)`);
        }
      } catch (e) {
        debugWarn(`Could not parse affiliate URL for ${firm.name}: ${firm.affiliateLink}`);
      }
    }
    
    // PRIORITY 2: Fallback to website field
    if (firm.website && domains.length === 0) {
      try {
        const url = new URL(firm.website.startsWith('http') ? firm.website : `https://${firm.website}`);
        const fullDomain = url.hostname.replace('www.', '');
        
        if (!domains.includes(fullDomain)) {
          domains.push(fullDomain);
          
          // Extract base domain for subdomain matching
          const baseDomain = this.extractBaseDomain(fullDomain);
          if (baseDomain !== fullDomain && !domains.includes(baseDomain)) {
            domains.push(baseDomain);
          }
        }
        
        debugLog(`📝 Extracted domains from website for ${firm.name}: [${domains.join(', ')}]`);
      } catch (e) {
        debugWarn(`Could not parse website URL for ${firm.name}: ${firm.website}`);
      }
    }
    
    // PRIORITY 3: Only if no real URLs available, generate from name (last resort)
    if (domains.length === 0) {
      debugWarn(`⚠️ No affiliate link or website found for ${firm.name}, generating fallback domain`);
      const baseName = firm.name.toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[^a-z0-9]/g, '')
        .replace(/futures?/g, '')
        .replace(/funding/g, '')
        .replace(/trader?/g, '')
        .replace(/trading/g, '');
      
      const fallbackDomain = `${baseName}.com`;
      domains.push(fallbackDomain);
      debugLog(`🔄 Generated fallback domain for ${firm.name}: ${fallbackDomain}`);
    }
    
    debugLog(`🌐 Final domains for ${firm.name}: [${domains.join(', ')}]`);
    return domains;
  }

  extractBaseDomain(domain) {
    // Extract base domain from subdomain
    // e.g., partners.ftmo.com -> ftmo.com
    // e.g., app.dashboard.ftmo.com -> ftmo.com
    
    const parts = domain.split('.');
    
    // If it's already a base domain (only 2 parts), return as is
    if (parts.length <= 2) {
      return domain;
    }
    
    // Return the last two parts (base domain)
    return parts.slice(-2).join('.');
  }

  getGenericSelectors() {
    return {
      // Generic selectors that work on most checkout pages
      couponField: 'input[name*="coupon"], input[name*="promo"], input[name*="discount"], input[id*="coupon"], input[placeholder*="code"], input[placeholder*="coupon"], input[placeholder*="promo"], input[placeholder*="discount"]',
      submitButton: 'button[type="submit"], button[class*="apply"], button[class*="coupon"], .apply-coupon, .apply-code, button:contains("Apply"), input[type="submit"][value*="apply"]',
      checkoutForm: 'form[class*="checkout"], form[class*="payment"], form[class*="order"], form[action*="checkout"], .checkout-form, .payment-form',
      successIndicators: '.success, .applied, .discount-applied, .coupon-success, .code-applied, [class*="success"], [class*="applied"]',
      errorIndicators: '.error, .invalid, .failed, .coupon-error, [class*="error"], [class*="invalid"]'
    };
  }

  getMinimalFallback() {
    debugLog('🔄 Using minimal fallback configuration (API unavailable)');
    return {
      firms: []
    };
  }

  async checkForPropFirmSite(tab) {
    if (!tab.url || !tab.url.startsWith('http')) {
      debugLog('❌ Invalid URL or non-HTTP:', tab.url);
      return;
    }

    // Use in-memory data instead of storage
    if (!this.propFirmsData) {
      debugLog('❌ No prop firms data loaded yet');
      return;
    }

    const hostname = new URL(tab.url).hostname;
    debugLog('🔍 Checking hostname:', hostname);
    
    // Explicitly exclude propfirm.compare (our own service)
    if (hostname === 'propfirm.compare' || hostname.endsWith('.propfirm.compare')) {
      debugLog('🚫 Excluding propfirm.compare (our own service)');
      return;
    }
    
    debugLog('📋 Available prop firms:', this.propFirmsData.firms.map(f => `${f.name} (${f.domains.join(', ')})`));

    const matchedFirm = this.propFirmsData.firms.find(firm => 
      firm.domains.some(domain => {
        // Exact match
        if (hostname === domain) {
          debugLog('✅ Exact match found:', domain);
          return true;
        }
        // Subdomain match (hostname ends with .domain)
        if (hostname.endsWith('.' + domain)) {
          debugLog('✅ Subdomain match found:', hostname, '→', domain);
          return true;
        }
        // www prefix specific case
        if (hostname === 'www.' + domain) {
          debugLog('✅ WWW match found:', domain);
          return true;
        }
        // Reverse subdomain check: if domain is a subdomain and hostname is the base
        // e.g., domain = partners.ftmo.com, hostname = ftmo.com
        if (domain.endsWith('.' + hostname)) {
          debugLog('✅ Base domain match found:', hostname, '←', domain);
          return true;
        }
        return false;
      })
    );

    if (matchedFirm) {
      debugLog('🎯 PropFirm matched:', matchedFirm.name, '- Codes:', matchedFirm.codes.length);
      
      // Update icon badge
      try {
        await chrome.action.setBadgeText({
          tabId: tab.id,
          text: matchedFirm.codes.length.toString()
        });
        
        await chrome.action.setBadgeBackgroundColor({
          tabId: tab.id,
          color: '#00E5A0'
        });
      } catch (error) {
        debugLog('Warning: Could not update badge:', error);
      }

      // Send data to content script with retry
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'PROP_FIRM_DETECTED',
          firm: matchedFirm
        });
        debugLog('📨 Message sent to content script successfully');
      } catch (error) {
        debugLog('❌ Failed to send message to content script:', error);
        
        // Retry after a short delay in case content script isn't ready
        setTimeout(async () => {
          try {
            await chrome.tabs.sendMessage(tab.id, {
              type: 'PROP_FIRM_DETECTED',
              firm: matchedFirm
            });
            debugLog('📨 Retry message sent successfully');
          } catch (retryError) {
            debugLog('❌ Retry also failed:', retryError);
          }
        }, 1000);
      }
    } else {
      debugLog('❌ No prop firm matched for hostname:', hostname);
      
      // Clear badge if not a prop firm
      try {
        await chrome.action.setBadgeText({
          tabId: tab.id,
          text: ''
        });
      } catch (error) {
        debugLog('Warning: Could not clear badge:', error);
      }
    }
  }

  async handleMessage(message, sender, sendResponse) {
    switch (message.type) {
      case 'GET_PROP_FIRMS_DATA':
        // Check if data is available, if not try to load fresh data
        if (!this.propFirmsData || !this.propFirmsData.firms || this.propFirmsData.firms.length === 0) {
          debugLog('🔄 No prop firms data available, attempting fresh load...');
          try {
            await this.loadPropFirmsData();
          } catch (error) {
            debugError('Failed to load fresh prop firms data:', error);
          }
        }
        
        sendResponse({ data: this.propFirmsData || { firms: [] } });
        break;

      case 'CODE_APPLIED':
        this.trackCodeUsage(message.data);
        sendResponse({ success: true });
        break;

      case 'GET_SETTINGS':
        // Return current user settings (stored in memory)
        debugLog('📋 Sending settings to popup:', this.userSettings);
        sendResponse(this.userSettings);
        break;

      case 'GET_CHECKOUT_CONFIG':
        // Return checkout configuration for specific domain
        const domain = message.domain;
        this.getCheckoutConfig(domain).then(config => {
          sendResponse({ config });
        });
        return true; // Keep channel open for async response

      case 'UPDATE_SETTINGS':
        // Update settings in memory and storage, then notify content scripts
        debugLog('⚙️ Updating settings:', message.settings);
        this.userSettings = { ...this.userSettings, ...message.settings };
        
        // Save to persistent storage
        await this.saveUserSettings();
        
        // Notify all content scripts of the settings change
        this.broadcastSettingsUpdate();
        sendResponse({ success: true });
        break;

      case 'FORCE_REFRESH_CACHE':
        // Force refresh of prop firms data cache
        debugLog('🔄 Force refreshing prop firms cache...');
        this.cache.data = null;
        this.cache.timestamp = null;
        try {
          await this.loadPropFirmsData();
          sendResponse({ success: true, firms: this.propFirmsData?.firms?.length || 0 });
        } catch (error) {
          debugError('Failed to force refresh cache:', error);
          sendResponse({ success: false, error: error.message });
        }
        break;

      default:
        // Don't respond here - let other message handlers process it
        // This allows action-based handlers (auth, etc.) to work
        return false;
    }
  }

  trackCodeUsage(data) {
    // Simple logging without chrome storage to avoid service worker issues
    debugLog(`✅ PropFirm Compare: Code "${data.code}" applied successfully (${data.discount} discount)`);
    debugLog(`💰 Estimated savings: $${data.savings || 0}`);
    
    // Stats tracking temporarily disabled to resolve service worker conflicts
    // Future versions will implement alternative storage solution
  }

  async broadcastSettingsUpdate() {
    try {
      // Get all tabs
      const tabs = await chrome.tabs.query({});
      
      // Send settings update to all content scripts
      for (const tab of tabs) {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: 'SETTINGS_UPDATED',
            settings: this.userSettings
          });
        } catch (error) {
          // Ignore errors for tabs without content scripts
          debugLog(`Settings update failed for tab ${tab.id}:`, error.message);
        }
      }
      
      debugLog('📡 Settings broadcast completed');
    } catch (error) {
      debugError('Error broadcasting settings update:', error);
    }
  }

  async getCheckoutConfig(domain) {
    try {
      // Load checkout configuration
      const response = await fetch(chrome.runtime.getURL('checkout-config.json'));
      const allConfigs = await response.json();
      
      // Find exact domain match first
      if (allConfigs[domain]) {
        debugLog(`✅ Found specific checkout config for ${domain}`);
        return allConfigs[domain];
      }
      
      // Try base domain if subdomain doesn't match
      const baseDomain = this.extractBaseDomain(domain);
      if (baseDomain !== domain && allConfigs[baseDomain]) {
        debugLog(`✅ Found checkout config for base domain ${baseDomain}`);
        return allConfigs[baseDomain];
      }
      
      // Fallback to default config
      debugLog(`⚠️ Using default checkout config for ${domain}`);
      return allConfigs.default;
      
    } catch (error) {
      debugError('Error loading checkout config:', error);
      return {
        name: "Unknown",
        checkoutSelectors: ["form[action*='checkout']"],
        couponSelectors: ["input[name*='coupon']"],
        triggerElements: [".payment-section"],
        excludeSelectors: ["nav input"]
      };
    }
  }
}

// Initialize the extension
const extensionInstance = new PropFirmExtension();

// ============================================
// V2: AUTHENTICATION HANDLING
// ============================================

// Handle auth success from auth-listener.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // AUTH_SUCCESS - User logged in via propfirm.compare
  if (message.action === "AUTH_SUCCESS") {
    debugLog('🔐 Received AUTH_SUCCESS:', { 
      email: message.email, 
      user_id: message.user_id,
      name: message.name,
      hasToken: !!message.token,
      tokenPreview: message.token ? message.token.substring(0, 20) + '...' : 'NO TOKEN'
    });
    
    const authData = {
      token: message.token,
      user_id: message.user_id,
      email: message.email,
      name: message.name,
      connected_at: Date.now()
    };
    
    debugLog('💾 Storing auth data:', { ...authData, token: authData.token ? '[REDACTED]' : 'NO TOKEN' });
    
    chrome.storage.local.set(authData, () => {
      if (chrome.runtime.lastError) {
        debugLog('❌ Error storing auth:', chrome.runtime.lastError);
        sendResponse({ success: false, error: chrome.runtime.lastError });
        return;
      }
      
      debugLog('✅ Auth credentials stored successfully');
      
      // Verify storage worked
      chrome.storage.local.get(['token', 'email'], (verify) => {
        debugLog('🔍 Verification - stored data:', { 
          hasToken: !!verify.token, 
          email: verify.email 
        });
      });
      
      // Fetch firm-specific rewards emails
      fetchRewardsEmails(authData.token);
      
      // Close only the auth TAB (not the entire window)
      if (sender.tab?.id) {
        debugLog('🚪 Closing auth tab:', sender.tab.id);
        chrome.tabs.remove(sender.tab.id).catch(() => {
          debugLog('Auth tab already closed or not found');
        });
      }
      
      // Notify all extension popups to refresh
      chrome.runtime.sendMessage({ action: "AUTH_STATE_CHANGED" }).catch(() => {
        // Popup might not be open, that's okay
      });
      
      // CRITICAL FIX: Check for pending purchase retry after login
      // This handles the case where purchase was detected before user logged in
      chrome.storage.local.get(['pending_purchase_retry', 'pending_purchase'], async (data) => {
        if (data.pending_purchase_retry) {
          debugLog('🔄 Found pending purchase retry after login:', data.pending_purchase_retry);
          debugLog('   Order number:', data.pending_purchase_retry.orderNumber);
          debugLog('   Partner:', data.pending_purchase_retry.partner);
          
          // Notify content scripts that they can retry
          try {
            const tabs = await chrome.tabs.query({});
            for (const tab of tabs) {
              if (tab.url) {
                chrome.tabs.sendMessage(tab.id, { 
                  action: 'AUTH_COMPLETED_RETRY_PURCHASE',
                  pendingRetry: data.pending_purchase_retry
                }).catch(() => {
                  // Tab might not have content script, that's okay
                });
              }
            }
          } catch (e) {
            debugLog('⚠️ Error notifying tabs of pending retry:', e);
          }
        }
      });
      
      sendResponse({ success: true });
    });
    return true; // Keep channel open for async response
  }
  
  // DISCONNECT - User wants to log out
  if (message.action === "DISCONNECT") {
    debugLog('🔓 User disconnecting...');
    chrome.storage.local.remove(['token', 'user_id', 'email', 'name', 'connected_at', 'recent_purchases'], () => {
      debugLog('✅ Auth credentials cleared');
      sendResponse({ success: true });
    });
    return true;
  }
  
  // GET_AUTH_STATE - Check if user is connected
  if (message.action === "GET_AUTH_STATE") {
    chrome.storage.local.get(['token', 'email', 'name', 'user_id', 'avatar', 'points'], (data) => {
      sendResponse({
        isConnected: !!data.token,
        email: data.email || null,
        name: data.name || null,
        user_id: data.user_id || null,
        avatar: data.avatar || null,
        points: data.points || 0
      });
    });
    return true;
  }
  
  // REFRESH_PROFILE - Fetch fresh profile data from validate-token
  if (message.action === "REFRESH_PROFILE") {
    (async () => {
      const data = await chrome.storage.local.get(['token']);
      if (!data.token) {
        sendResponse({ success: false, error: 'Not authenticated' });
        return;
      }
      
      try {
        debugLog('🔄 Calling validate-token API...');
        const response = await fetch(`${API_BASE_URL}/api/extension/validate-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: data.token })
        });
        
        const result = await response.json();
        debugLog('📡 validate-token API response:', JSON.stringify(result, null, 2));
        
        if (result.valid) {
          // Store updated profile data - handle different field names
          const profileUpdate = {};
          if (result.name) profileUpdate.name = result.name;
          if (result.avatar) profileUpdate.avatar = result.avatar;
          // Handle different possible field names for points
          const points = result.points ?? result.loyalty_points ?? result.total_points ?? result.user?.points;
          if (points !== undefined) profileUpdate.points = points;
          if (result.email) profileUpdate.email = result.email;
          
          await chrome.storage.local.set(profileUpdate);
          debugLog('📊 Profile data stored:', profileUpdate);
          
          sendResponse({
            success: true,
            name: result.name,
            avatar: result.avatar,
            points: points,
            email: result.email
          });
        } else {
          debugLog('❌ Token not valid:', result);
          sendResponse({ success: false, error: 'Token invalid' });
        }
      } catch (e) {
        debugLog('❌ Error refreshing profile:', e);
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }
  
  // OPEN_AUTH - Open authentication popup
  if (message.action === "OPEN_AUTH") {
    const authUrl = `${API_BASE_URL}/extension-auth`;
    debugLog('🔐 Opening auth URL:', authUrl);
    
    chrome.windows.create({
      url: authUrl,
      type: 'popup',
      width: 500,
      height: 700,
      focused: true
    });
    sendResponse({ success: true });
    return true;
  }
  
  // OPEN_LOGIN - Same as OPEN_AUTH but from checkout tracker warning
  if (message.action === "OPEN_LOGIN") {
    const authUrl = `${API_BASE_URL}/extension-auth`;
    debugLog('🔐 Opening login from checkout tracker:', authUrl);
    
    chrome.windows.create({
      url: authUrl,
      type: 'popup',
      width: 500,
      height: 700,
      focused: true
    });
    sendResponse({ success: true });
    return true;
  }
  
  // GET_REWARDS - Fetch user rewards from API
  if (message.action === "GET_REWARDS") {
    fetchUserRewards().then(data => {
      sendResponse(data);
    }).catch(error => {
      debugLog('❌ Error fetching rewards:', error);
      sendResponse({ error: error.message });
    });
    return true;
  }
  
  // SUBMIT_PENDING_PURCHASE - Manual submission of stuck pending purchase
  if (message.action === "SUBMIT_PENDING_PURCHASE") {
    debugLog('📤 Manual pending purchase submission requested');
    submitManualPendingPurchase(message.purchaseData).then(result => {
      sendResponse(result);
    }).catch(error => {
      debugLog('❌ Error submitting pending purchase:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
});

// Validate token on startup
chrome.runtime.onStartup.addListener(validateToken);
chrome.runtime.onInstalled.addListener(validateToken);

async function validateToken() {
  const data = await chrome.storage.local.get(['token']);
  if (!data.token) {
    debugLog('🔐 No token found, user not logged in');
    return;
  }
  
  debugLog('🔐 Validating stored token...');
  
  try {
    const response = await fetch(`${API_BASE_URL}/api/extension/validate-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: data.token })
    });
    
    const result = await response.json();
    
    if (!result.valid) {
      debugLog('❌ Token invalid or expired, clearing auth');
      chrome.storage.local.remove(['token', 'user_id', 'email', 'name', 'avatar', 'points', 'connected_at']);
    } else {
      debugLog('✅ Token validated successfully, updating profile data');
      
      // Store updated profile data from validate-token response
      const profileUpdate = {};
      if (result.name) profileUpdate.name = result.name;
      if (result.avatar) profileUpdate.avatar = result.avatar;
      if (result.points !== undefined) profileUpdate.points = result.points;
      if (result.email) profileUpdate.email = result.email;
      if (result.user_id) profileUpdate.user_id = result.user_id;
      
      if (Object.keys(profileUpdate).length > 0) {
        await chrome.storage.local.set(profileUpdate);
        debugLog('📊 Profile data updated:', profileUpdate);
      }
      
      // Also fetch firm-specific rewards emails
      await fetchRewardsEmails(data.token);
    }
  } catch (e) {
    debugLog('⚠️ Token validation failed (network error):', e.message);
    // Don't clear token on network error - might be temporary
  }
}

// Fetch firm-specific rewards emails from API
async function fetchRewardsEmails(token) {
  if (!token) return;
  
  debugLog('📧 Fetching rewards emails...');
  
  try {
    const response = await fetch(`${API_BASE_URL}/api/profile/rewards-email`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      debugLog('⚠️ Failed to fetch rewards emails:', response.status);
      return;
    }
    
    const data = await response.json();
    debugLog('📧 Raw API response:', JSON.stringify(data, null, 2));
    
    // Handle different API response formats
    let rewardsArray = null;
    if (data.success && data.rewards_emails) {
      rewardsArray = data.rewards_emails;
    } else if (Array.isArray(data.rewards_emails)) {
      rewardsArray = data.rewards_emails;
    } else if (Array.isArray(data)) {
      rewardsArray = data;
    }
    
    if (rewardsArray && Array.isArray(rewardsArray)) {
      // Transform array into object keyed by firm slug
      const rewardsEmailsByFirm = {};
      rewardsArray.forEach(re => {
        // Handle different property names: propFirmSlug, firmSlug, slug
        const slug = re.propFirmSlug || re.firmSlug || re.slug;
        const email = re.rewards_email || re.rewardsEmail || re.email;
        
        if (email && slug) {
          rewardsEmailsByFirm[slug] = email;
          debugLog(`📧 Mapped: ${slug} → ${email}`);
        }
      });
      
      // Store in extension storage
      await chrome.storage.local.set({ rewards_emails: rewardsEmailsByFirm });
      debugLog('📧 Rewards emails stored:', rewardsEmailsByFirm);
    } else {
      debugLog('⚠️ No rewards_emails array found in response');
    }
  } catch (e) {
    debugLog('⚠️ Error fetching rewards emails:', e.message);
  }
}

async function fetchUserRewards() {
  debugLog('📊 [BG] fetchUserRewards called');
  
  const authData = await chrome.storage.local.get(['token']);
  debugLog('📊 [BG] Token:', authData.token ? 'EXISTS (' + authData.token.substring(0, 10) + '...)' : 'MISSING');
  
  if (!authData.token) {
    return { error: 'Not authenticated', purchases: [], total_rewards: 0 };
  }
  
  try {
    const url = `${API_BASE_URL}/api/extension/purchases?_t=${Date.now()}`;
    debugLog('📊 [BG] Fetching from:', url);
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${authData.token}`,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });
    
    debugLog('📊 [BG] Response status:', response.status);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    debugLog('📊 [BG] Response data:', JSON.stringify(data).substring(0, 500));
    debugLog('📊 [BG] Purchases count from API:', data.purchases?.length);
    debugLog('📊 [BG] total_discount_saved:', data.total_discount_saved);
    
    // Compare with local cache to detect discrepancy
    const cache = await chrome.storage.local.get(['recent_purchases']);
    const cachedPurchases = cache.recent_purchases || [];
    debugLog('📊 [BG] Purchases in LOCAL cache:', cachedPurchases.length);
    
    // Add discrepancy info to response
    data.cached_purchases = cachedPurchases;
    data.cache_count = cachedPurchases.length;
    data.api_count = data.purchases?.length || 0;
    
    if (cachedPurchases.length > (data.purchases?.length || 0)) {
      debugLog('⚠️ DISCREPANCY DETECTED: More purchases in local cache than returned by API!');
      debugLog('   Cached order numbers:', cachedPurchases.map(p => p.order_number).filter(Boolean).join(', '));
      debugLog('   API order numbers:', (data.purchases || []).map(p => p.order_number).filter(Boolean).join(', '));
      
      // Find missing purchases
      const apiOrderNumbers = new Set((data.purchases || []).map(p => p.order_number).filter(Boolean));
      const missingOrderNumbers = cachedPurchases
        .filter(p => p.order_number && !apiOrderNumbers.has(p.order_number))
        .map(p => p.order_number);
      
      data.missing_order_numbers = missingOrderNumbers;
      
      if (missingOrderNumbers.length > 0) {
        debugLog('❌ MISSING FROM API:', missingOrderNumbers.join(', '));
        debugLog('   These purchases were submitted (got success response) but are NOT in the API response!');
        debugLog('   This indicates a BACKEND issue - the API accepted but did not store these purchases.');
      }
    }
    
    return data;
  } catch (error) {
    debugLog('❌ [BG] Failed to fetch rewards:', error);
    throw error;
  }
}

// ============================================
// V2.1: FORM-BASED PURCHASE TRACKING
// ============================================

// Listen for purchase data from content script (form-based tracking)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "PURCHASE_DETECTED") {
    debugLog('═══════════════════════════════════════');
    debugLog('📦 PURCHASE DETECTED FROM CONTENT SCRIPT');
    debugLog('═══════════════════════════════════════');
    debugLog('📧 Email:', message.data?.email);
    debugLog('🎟️ Coupon:', message.data?.coupon_code);
    debugLog('📦 Product:', message.data?.product_name);
    debugLog('💰 Original Price:', message.data?.original_price);
    debugLog('💸 Final Price:', message.data?.final_price);
    debugLog('🏷️ Discount:', message.data?.discount, `(${message.data?.discount_percentage}%)`);
    debugLog('🔢 Order Number:', message.data?.order_number);
    debugLog('🏢 Partner:', message.data?.partner);
    debugLog('═══════════════════════════════════════');
    
    // CRITICAL: Wait for handlePurchaseDetected to complete before sending response
    handlePurchaseDetected(message.data).then(result => {
      debugLog('📤 Sending response to content script:', result);
      sendResponse(result);
    }).catch(error => {
      debugLog('❌ Error in handlePurchaseDetected:', error);
      sendResponse({ success: false, error: error.message });
    });
    
    return true; // Keep message channel open for async response
  }
});

async function handlePurchaseDetected(purchaseData) {
  debugLog('🔍 Processing purchase data for order:', purchaseData.order_number);
  
  // Only track if logged in
  const authData = await chrome.storage.local.get(['token', 'user_id', 'email']);
  debugLog('🔐 Auth check - Has token:', !!authData.token, 'User:', authData.email);
  
  if (!authData.token) {
    debugLog('❌ SKIPPED: User not logged in');
    return { success: false, error: 'User not logged in', reason: 'NOT_LOGGED_IN' };
  }
  
  // Only track if a valid coupon code was used
  const couponUsed = purchaseData.coupon_code?.toUpperCase();
  debugLog('🎟️ Coupon check - Used:', couponUsed, 'Valid codes:', VALID_COUPONS.join(', '));
  
  if (!couponUsed || !VALID_COUPONS.includes(couponUsed)) {
    debugLog('❌ SKIPPED: Not using a tracked coupon code');
    return { success: false, error: 'Not using a tracked coupon code', reason: 'WRONG_COUPON' };
  }
  
  // Duplicate check
  const isDuplicate = await checkDuplicate(purchaseData);
  debugLog('🔄 Duplicate check:', isDuplicate ? 'IS DUPLICATE' : 'Not duplicate');
  
  if (isDuplicate) {
    debugLog('❌ SKIPPED: Duplicate purchase');
    return { success: true, skipped: true, reason: 'DUPLICATE' }; // Return success but indicate it was skipped
  }
  
  debugLog('✅ All checks passed - submitting order', purchaseData.order_number, 'to API...');
  
  // Submit to API and return result
  const result = await submitPurchase({
    ...purchaseData,
    purchase_email: purchaseData.email || authData.email
  }, authData);
  
  return result;
}

async function checkDuplicate(purchaseData) {
  const cache = await chrome.storage.local.get(['recent_purchases']);
  const recentPurchases = cache.recent_purchases || [];
  const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
  
  // Primary check: If we have an order number, use that (most reliable)
  if (purchaseData.order_number) {
    const orderDuplicate = recentPurchases.some(p => 
      p.order_number === purchaseData.order_number
    );
    if (orderDuplicate) {
      debugLog('🔄 Duplicate detected by order_number:', purchaseData.order_number);
      return true;
    }
    // Has unique order number - NOT a duplicate
    return false;
  }
  
  // Fallback: Only if NO order number, use price-based check (less reliable)
  // This is a safety net for purchases where order_number wasn't captured
  const priceDuplicate = recentPurchases.some(p => 
    p.partner === purchaseData.partner && 
    !p.order_number && // Only compare with other no-order-number entries
    Math.abs((p.final_price || 0) - (purchaseData.final_price || 0)) < 0.01 &&
    p.timestamp > fiveMinutesAgo
  );
  
  if (priceDuplicate) {
    debugLog('🔄 Duplicate detected by price match (no order_number available)');
  }
  
  return priceDuplicate;
}

async function submitPurchase(purchaseData, authData) {
  debugLog('═══════════════════════════════════════');
  debugLog('📤 SUBMITTING PURCHASE TO API');
  debugLog('   Order Number:', purchaseData.order_number);
  debugLog('═══════════════════════════════════════');
  debugLog('📍 API URL:', `${API_BASE_URL}/api/extension/purchase`);
  debugLog('📦 Purchase Data:', JSON.stringify(purchaseData, null, 2));
  
  const payload = {
    token: authData.token,
    user_id: authData.user_id,
    ...purchaseData,
    timestamp: new Date().toISOString(),
    extension_version: chrome.runtime.getManifest().version
  };
  
  debugLog('📝 Full Payload:', JSON.stringify(payload, null, 2));
  
  try {
    const response = await fetch(`${API_BASE_URL}/api/extension/purchase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    debugLog('📡 Response Status:', response.status, response.statusText);
    
    const result = await response.json();
    debugLog('📥 API Response Body:', JSON.stringify(result, null, 2));
    
    if (result.success) {
      debugLog('✅ API SUCCESS! Purchase stored on backend');
      debugLog('   Purchase ID from API:', result.purchase_id || result.id || 'not returned');
      debugLog('   Order number submitted:', purchaseData.order_number);
      
      // Cache purchase to prevent duplicates
      const cache = await chrome.storage.local.get(['recent_purchases']);
      const recentPurchases = cache.recent_purchases || [];
      recentPurchases.push({
        partner: purchaseData.partner,
        final_price: purchaseData.final_price,
        order_number: purchaseData.order_number || null, // Store order number for reliable duplicate detection
        timestamp: Date.now(),
        api_response_id: result.purchase_id || result.id || null // Store API response ID for debugging
      });
      await chrome.storage.local.set({ 
        recent_purchases: recentPurchases.slice(-20) // Keep more for better duplicate detection
      });
      
      debugLog('📊 Total purchases in cache:', recentPurchases.length);
      debugLog('📊 Order numbers in cache:', recentPurchases.map(p => p.order_number).join(', '));
      
      // Notify user
      showPurchaseNotification(result);
      
      return { 
        success: true, 
        order_number: purchaseData.order_number,
        purchase_id: result.purchase_id || result.id 
      };
    } else {
      debugLog('❌ API returned error:', result.message || result.error);
      debugLog('❌ Full API response:', JSON.stringify(result));
      return { 
        success: false, 
        error: result.message || result.error || 'API returned error',
        order_number: purchaseData.order_number
      };
    }
  } catch (e) {
    debugLog('❌ Failed to submit purchase:', e);
    return { 
      success: false, 
      error: e.message,
      order_number: purchaseData.order_number
    };
  }
}

// Manual submission of stuck pending purchases from popup
async function submitManualPendingPurchase(pendingData) {
  debugLog('═══════════════════════════════════════');
  debugLog('📤 MANUAL PENDING PURCHASE SUBMISSION');
  debugLog('═══════════════════════════════════════');
  debugLog('📦 Pending Data:', JSON.stringify(pendingData, null, 2));
  
  // Get auth data
  const authData = await chrome.storage.local.get(['token', 'email', 'user_id']);
  
  if (!authData.token) {
    throw new Error('Not authenticated');
  }
  
  // Build purchase data from pending data
  const purchaseData = {
    partner: pendingData.partner,
    coupon_code: pendingData.coupon,
    email: pendingData.email || authData.email,
    purchase_email: pendingData.email || authData.email,
    product_name: pendingData.product_name,
    original_price: pendingData.original_price,
    final_price: pendingData.final_price,
    discount_amount: pendingData.discount_amount,
    discount_percentage: pendingData.discount_percentage,
    customer_name: pendingData.customer_name,
    account_size: pendingData.account_size,
    platform: pendingData.platform,
    source: 'manual-submit',
    checkout_url: pendingData.checkout_url
  };
  
  // Check for duplicates first
  const isDuplicate = await checkDuplicate({
    partner: purchaseData.partner,
    final_price: parseFloat(purchaseData.final_price) || 0
  });
  
  if (isDuplicate) {
    debugLog('⚠️ Duplicate purchase detected, skipping');
    // Clear the pending purchase anyway since it was already submitted
    await chrome.storage.local.remove(['pending_purchase']);
    return { success: true, message: 'Purchase already recorded' };
  }
  
  // Submit to API
  const payload = {
    token: authData.token,
    user_id: authData.user_id,
    ...purchaseData,
    timestamp: new Date().toISOString(),
    extension_version: chrome.runtime.getManifest().version
  };
  
  debugLog('📝 Full Payload:', JSON.stringify(payload, null, 2));
  
  try {
    const response = await fetch(`${API_BASE_URL}/api/extension/purchase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    debugLog('📡 Response Status:', response.status, response.statusText);
    
    const result = await response.json();
    debugLog('📥 API Response Body:', JSON.stringify(result, null, 2));
    
    if (result.success) {
      // Cache purchase to prevent duplicates
      const cache = await chrome.storage.local.get(['recent_purchases']);
      const recentPurchases = cache.recent_purchases || [];
      recentPurchases.push({
        partner: purchaseData.partner,
        final_price: parseFloat(purchaseData.final_price) || 0,
        timestamp: Date.now()
      });
      await chrome.storage.local.set({ 
        recent_purchases: recentPurchases.slice(-10) 
      });
      
      // Clear pending purchase
      await chrome.storage.local.remove(['pending_purchase']);
      debugLog('✅ Pending purchase cleared');
      
      // Show notification
      showPurchaseNotification(result);
      
      return { success: true, reward_issued: result.reward_issued, reward_amount: result.reward_amount };
    } else {
      throw new Error(result.message || result.error || 'API error');
    }
  } catch (e) {
    debugLog('❌ Failed to submit pending purchase:', e);
    throw e;
  }
}

function showPurchaseNotification(result) {
  if (result.reward_issued) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Purchase Tracked! 🎉',
      message: `+$${result.reward_amount?.toFixed(2) || '0.00'} reward earned`,
      priority: 2
    });
    debugLog('🔔 Reward notification shown: +$' + (result.reward_amount?.toFixed(2) || '0.00'));
  } else {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Purchase Tracked',
      message: result.message || 'Purchase recorded successfully',
      priority: 1
    });
    debugLog('🔔 Purchase notification shown');
  }
}

debugLog('✅ V2.1 Authentication and Form-Based Purchase Tracking initialized');

// ═══════════════════════════════════════════════════════════════════════════════
// SMART SESSION RECORDER - PERSISTENT ACROSS PAGE NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════════
// 
// THE PROBLEM: Content scripts die when the page navigates (checkout → success).
// THE SOLUTION: Store data in background script - it NEVER dies during navigation.
// 
// HOW IT WORKS:
// 1. Content script detects checkout → tells background "start recording"
// 2. Content script captures network/DOM → sends to background immediately
// 3. Page navigates → content script dies, but background has the data
// 4. New page loads → content script asks background "am I recording?"
// 5. If yes, content script continues sending data
// 6. Success page detected → content script tells background "stop and extract"
// ═══════════════════════════════════════════════════════════════════════════════

class BackgroundSessionRecorder {
  constructor() {
    this.activeSession = null;
    this.isRecording = false;
    this.loadActiveSession();
    debugLog('🎬 Background Session Recorder initialized');
  }

  async loadActiveSession() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['active_recording_session'], (result) => {
        if (result.active_recording_session) {
          this.activeSession = result.active_recording_session;
          this.isRecording = true;
          debugLog('🎬 Resumed active recording:', this.activeSession.id);
        }
        resolve();
      });
    });
  }

  startRecording(partnerId, startUrl) {
    if (this.isRecording) {
      debugLog('⚠️ Already recording, continuing session');
      return { success: true, sessionId: this.activeSession.id, continued: true };
    }

    this.activeSession = {
      id: 'session_' + Date.now(),
      partnerId,
      startTime: Date.now(),
      startUrl,
      networkRequests: [],
      domSnapshots: [],
      storageChanges: [],
      urlHistory: [{ url: startUrl, timestamp: Date.now() }],
      events: [],
      purchaseDataFound: {}
    };

    this.isRecording = true;
    this.persistSession();
    debugLog(`🎬 Recording started: ${this.activeSession.id} for ${partnerId}`);
    return { success: true, sessionId: this.activeSession.id };
  }

  addNetworkRequest(request) {
    if (!this.isRecording || !this.activeSession) return;
    this.activeSession.networkRequests.push({ ...request, capturedAt: Date.now() });
    this.checkForPurchaseData(request);
    this.persistSession();
  }

  addDomSnapshot(snapshot) {
    if (!this.isRecording || !this.activeSession) return;
    this.activeSession.domSnapshots.push({ ...snapshot, capturedAt: Date.now() });
    // Don't persist on every snapshot (too frequent), batched via persistSession calls
  }

  addStorageChange(change) {
    if (!this.isRecording || !this.activeSession) return;
    this.activeSession.storageChanges.push({ ...change, capturedAt: Date.now() });
  }

  addUrlChange(url) {
    if (!this.isRecording || !this.activeSession) return;
    this.activeSession.urlHistory.push({ url, timestamp: Date.now() });
    this.persistSession();
    debugLog('🔗 URL recorded:', url);
  }

  addEvent(event) {
    if (!this.isRecording || !this.activeSession) return;
    this.activeSession.events.push({ ...event, capturedAt: Date.now() });
  }

  addDomPurchaseData(data) {
    if (!this.isRecording || !this.activeSession) return;
    const found = this.activeSession.purchaseDataFound;
    for (const [key, value] of Object.entries(data)) {
      if (value && !found[key]) {
        found[key] = { value, source: 'dom', confidence: 'medium' };
        debugLog(`💰 Found ${key} in DOM:`, value);
      }
    }
    this.persistSession();
  }

  checkForPurchaseData(request) {
    const response = request.responseBody;
    if (!response || typeof response !== 'object') return;

    const found = this.activeSession.purchaseDataFound;
    this.searchObject(response, '', found);
  }

  searchObject(obj, path, found) {
    if (!obj || typeof obj !== 'object') return;

    for (const [key, value] of Object.entries(obj)) {
      const currentPath = path ? `${path}.${key}` : key;
      const k = key.toLowerCase();

      // Order ID
      if (!found.order_number && this.isOrderKey(k) && this.isOrderValue(value)) {
        found.order_number = { value, source: `network:${currentPath}`, confidence: 'high' };
        debugLog('💰 Order in network:', value);
      }
      // Email
      if (!found.email && this.isEmailKey(k) && this.isEmail(value)) {
        found.email = { value: String(value).toLowerCase(), source: `network:${currentPath}`, confidence: 'high' };
        debugLog('💰 Email in network:', value);
      }
      // Price
      if (!found.final_price && this.isPriceKey(k)) {
        const price = this.parsePrice(value);
        if (price > 0 && price < 10000) {
          found.final_price = { value: price, source: `network:${currentPath}`, confidence: 'high' };
          debugLog('💰 Price in network:', price);
        }
      }
      // Product
      if (!found.product_name && this.isProductKey(k) && typeof value === 'string' && value.length > 2 && value.length < 200) {
        found.product_name = { value, source: `network:${currentPath}`, confidence: 'high' };
        debugLog('💰 Product in network:', value);
      }
      // Coupon
      if (!found.coupon_code && this.isCouponKey(k) && typeof value === 'string' && value.length >= 2 && value.length <= 30) {
        found.coupon_code = { value: value.toUpperCase(), source: `network:${currentPath}`, confidence: 'high' };
        debugLog('💰 Coupon in network:', value);
      }

      // Recurse into nested objects
      if (typeof value === 'object' && value !== null) {
        if (Array.isArray(value)) {
          value.forEach((item, i) => this.searchObject(item, `${currentPath}[${i}]`, found));
        } else {
          this.searchObject(value, currentPath, found);
        }
      }
    }
  }

  // Pattern matchers
  isOrderKey(k) { return ['order', 'orderid', 'order_id', 'ordernumber', 'confirmation', 'confirmationid', 'reference', 'transaction', 'txid', 'invoice'].some(p => k.includes(p)); }
  isOrderValue(v) { return typeof v === 'string' && v.length >= 4 && v.length <= 50 && /^[A-Z0-9][-A-Z0-9]*$/i.test(v); }
  isEmailKey(k) { return ['email', 'mail', 'useremail', 'customeremail', 'buyeremail'].some(p => k.includes(p)); }
  isEmail(v) { return typeof v === 'string' && /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(v.trim()); }
  isPriceKey(k) { return ['total', 'amount', 'price', 'finalprice', 'final_price', 'grandtotal', 'subtotal', 'paid', 'charge', 'cost'].some(p => k.includes(p)); }
  isProductKey(k) { return ['product', 'productname', 'product_name', 'plan', 'planname', 'item', 'package', 'challenge'].some(p => k.includes(p)); }
  isCouponKey(k) { return ['coupon', 'couponcode', 'coupon_code', 'discount', 'discountcode', 'promo', 'promocode', 'voucher'].some(p => k.includes(p)); }
  parsePrice(v) {
    if (typeof v === 'number') return v;
    if (typeof v !== 'string') return null;
    const n = parseFloat(v.replace(/[^0-9.]/g, ''));
    return isNaN(n) ? null : n;
  }

  stopRecording() {
    if (!this.isRecording || !this.activeSession) {
      return { success: false, error: 'Not recording' };
    }

    const session = {
      ...this.activeSession,
      endTime: Date.now(),
      duration: Date.now() - this.activeSession.startTime
    };

    this.isRecording = false;
    this.activeSession = null;
    chrome.storage.local.remove('active_recording_session');
    this.saveCompletedSession(session);

    // Build purchase data from what we found
    const purchaseData = { partner: session.partnerId };
    const found = session.purchaseDataFound;
    if (found.order_number) purchaseData.order_number = found.order_number.value;
    if (found.email) purchaseData.email = found.email.value;
    if (found.final_price) purchaseData.final_price = found.final_price.value;
    if (found.product_name) purchaseData.product_name = found.product_name.value;
    if (found.coupon_code) purchaseData.coupon_code = found.coupon_code.value;

    purchaseData._metadata = {
      sessionId: session.id,
      duration: session.duration,
      pagesVisited: session.urlHistory.length,
      networkRequests: session.networkRequests.length,
      sources: Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.source]))
    };

    debugLog('🎬 Recording stopped. Data:', purchaseData);
    return { success: true, session, purchaseData };
  }

  persistSession() {
    if (this.activeSession) {
      chrome.storage.local.set({ active_recording_session: this.activeSession });
    }
  }

  saveCompletedSession(session) {
    chrome.storage.local.get(['completed_sessions'], (result) => {
      const sessions = result.completed_sessions || [];
      sessions.push(session);
      // Keep last 20 sessions
      while (sessions.length > 20) sessions.shift();
      chrome.storage.local.set({ completed_sessions: sessions });
      debugLog('💾 Session saved to history');
    });
  }

  getStatus() {
    return {
      isRecording: this.isRecording,
      sessionId: this.activeSession?.id || null,
      partnerId: this.activeSession?.partnerId || null,
      networkRequestCount: this.activeSession?.networkRequests?.length || 0,
      purchaseDataFound: this.activeSession?.purchaseDataFound || {},
      urlHistory: this.activeSession?.urlHistory || []
    };
  }

  getCompletedSessions() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['completed_sessions'], (result) => {
        resolve(result.completed_sessions || []);
      });
    });
  }
}

// Initialize the background session recorder
const bgRecorder = new BackgroundSessionRecorder();

// Add message handlers for the smart recorder (extend existing onMessage listener)
const originalOnMessageHandler = chrome.runtime.onMessage.hasListeners();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Smart Recorder message handlers
  switch (message.action) {
    case 'SMART_RECORDER_START':
      sendResponse(bgRecorder.startRecording(message.partnerId, message.url));
      return true;
    
    case 'SMART_RECORDER_STOP':
      sendResponse(bgRecorder.stopRecording());
      return true;
    
    case 'SMART_RECORDER_STATUS':
      sendResponse(bgRecorder.getStatus());
      return true;
    
    case 'SMART_RECORDER_NETWORK':
      bgRecorder.addNetworkRequest(message.data);
      sendResponse({ success: true });
      return true;
    
    case 'SMART_RECORDER_SNAPSHOT':
      bgRecorder.addDomSnapshot(message.data);
      sendResponse({ success: true });
      return true;
    
    case 'SMART_RECORDER_STORAGE':
      bgRecorder.addStorageChange(message.data);
      sendResponse({ success: true });
      return true;
    
    case 'SMART_RECORDER_URL':
      bgRecorder.addUrlChange(message.url);
      sendResponse({ success: true });
      return true;
    
    case 'SMART_RECORDER_EVENT':
      bgRecorder.addEvent(message.data);
      sendResponse({ success: true });
      return true;
    
    case 'SMART_RECORDER_DOM_DATA':
      bgRecorder.addDomPurchaseData(message.data);
      sendResponse({ success: true });
      return true;
    
    case 'SMART_RECORDER_GET_SESSIONS':
      bgRecorder.getCompletedSessions().then(sessions => {
        sendResponse({ success: true, sessions });
      });
      return true;
  }
  
  // Return false for messages not handled by smart recorder
  return false;
});

debugLog('🎬 Background Session Recorder ready');

// ═══════════════════════════════════════════════════════════════════════════════
// PURCHASE QUEUE ENGINE - Queue-based capture with deduplication
// ═══════════════════════════════════════════════════════════════════════════════
// 
// CRITICAL DISCOVERY: localStorage('purchasePlanInfo') is CLEARED after payment!
// Solution: Capture on checkout page, detect success separately, submit from queue.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * IMMUTABLE PURCHASE ENGINE
 * 
 * From CURSOR_IMMUTABLE_CAPTURE.md:
 * - Every capture creates a NEW entry with unique capture_id
 * - Data fields are NEVER modified after creation (Object.freeze)
 * - Only 'status' field changes (pending → submitted)
 * - Deduplication only on order_number (not fingerprint)
 * - FIFO matching (oldest pending first)
 * 
 * Supports FundedNext (no order_number) by using capture_id as fallback unique key
 */
class PurchaseEngine {
  constructor() {
    this.queue = [];
    this.submittedOrderNumbers = new Set(); // Only store order numbers for dedup
    this.initialized = false;
  }

  async init() {
    const data = await chrome.storage.local.get(['purchase_queue', 'submitted_order_numbers']);
    this.queue = data.purchase_queue || [];
    this.submittedOrderNumbers = new Set(data.submitted_order_numbers || []);
    this.initialized = true;
    debugLog('[ENGINE] Ready. Queue:', this.queue.length, 'Submitted orders:', this.submittedOrderNumbers.size);
  }

  async saveState() {
    await chrome.storage.local.set({
      purchase_queue: this.queue,
      submitted_order_numbers: [...this.submittedOrderNumbers]
    });
  }

  // Generate unique capture ID (NOT for deduplication - every capture is unique)
  generateCaptureId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `CAP-${timestamp}-${random}`;
  }

  // Called from content script when checkout data is captured
  // EVERY capture creates a NEW entry - no fingerprint blocking
  async capturePurchase(purchaseData) {
    const captureId = this.generateCaptureId();
    
    // Create immutable entry
    const entry = Object.freeze({
      // Unique identifier
      capture_id: captureId,
      
      // Timestamps
      captured_at: new Date().toISOString(),
      captured_timestamp: Date.now(),
      
      // Purchase data (copied, not referenced)
      partner: purchaseData.partner || null,
      email: purchaseData.email || null,
      customer_name: purchaseData.customer_name || null,
      product_name: purchaseData.product_name || null,
      account_size: purchaseData.account_size || null,
      original_price: purchaseData.original_price || null,
      final_price: purchaseData.final_price || null,
      discount_amount: purchaseData.discount_amount || null,
      coupon_code: purchaseData.coupon_code || null,
      checkout_url: purchaseData.checkout_url || null,
      
      // Order number - filled on success page
      order_number: purchaseData.order_number || null,
      
      // Status tracking
      status: 'pending'
    });
    
    this.queue.push(entry);
    await this.saveState();
    
    debugLog('[ENGINE] Added capture:', captureId, {
      partner: entry.partner,
      product: entry.product_name,
      price: entry.final_price
    });
    
    // Return fingerprint for backwards compatibility
    return { success: true, fingerprint: captureId, captureId, queueLength: this.queue.length };
  }

  // Find the matching purchase when success is detected
  // FIFO: Returns OLDEST pending match first
  findMatchingPurchase(successData) {
    const maxAge = 30 * 60 * 1000; // 30 minutes
    const now = Date.now();
    
    const candidates = this.queue
      .filter(p => p.status === 'pending')
      .filter(p => now - p.captured_timestamp < maxAge)
      .sort((a, b) => a.captured_timestamp - b.captured_timestamp); // FIFO: oldest first
    
    for (const purchase of candidates) {
      // Partner must match
      if (successData.partner && purchase.partner !== successData.partner) continue;
      
      // Email should match if both exist
      if (successData.email && purchase.email) {
        if (successData.email.toLowerCase() !== purchase.email.toLowerCase()) continue;
      }
      
      debugLog('[ENGINE] FIFO match found:', purchase.capture_id);
      return purchase;
    }
    
    // Fallback: oldest for this partner
    return candidates.find(p => p.partner === successData.partner) || null;
  }

  // Check if already submitted - ORDER NUMBER ONLY (not fingerprint!)
  isAlreadySubmitted(orderNumberOrCaptureId) {
    if (!orderNumberOrCaptureId) return false;
    return this.submittedOrderNumbers.has(orderNumberOrCaptureId);
  }

  // Record successful submission
  recordSubmission(orderNumberOrCaptureId) {
    if (!orderNumberOrCaptureId) return;
    this.submittedOrderNumbers.add(orderNumberOrCaptureId);
    
    // Keep last 1000 order numbers
    if (this.submittedOrderNumbers.size > 1000) {
      const arr = [...this.submittedOrderNumbers];
      this.submittedOrderNumbers = new Set(arr.slice(-1000));
    }
  }

  // Merge checkout data with success page data (creates NEW object)
  mergeData(checkoutData, successData) {
    const merged = { ...checkoutData };
    
    for (const [key, value] of Object.entries(successData || {})) {
      if (value !== null && value !== undefined && value !== '') {
        if (merged[key] === null || merged[key] === undefined || merged[key] === '') {
          merged[key] = value;
        }
      }
    }
    
    merged.success_detected_at = new Date().toISOString();
    return merged;
  }

  // Called when success page is detected
  async handleSuccess(successData) {
    debugLog('[ENGINE] Success detected for:', successData.partner);
    
    const match = this.findMatchingPurchase(successData);
    
    if (!match) {
      debugLog('[ENGINE] No matching purchase in queue');
      return { success: false, error: 'No matching purchase in queue' };
    }
    
    // Determine unique key for deduplication
    // Use order_number if available, otherwise use capture_id (for FundedNext)
    const orderNumber = successData.order_number || match.order_number;
    const uniqueKey = orderNumber || match.capture_id;
    
    if (this.isAlreadySubmitted(uniqueKey)) {
      debugLog('[ENGINE] Duplicate, skipping:', uniqueKey);
      // Remove from queue
      this.queue = this.queue.filter(p => p.capture_id !== match.capture_id);
      await this.saveState();
      return { success: true, skipped: true, reason: 'duplicate' };
    }
    
    // Merge data (creates new object, doesn't mutate)
    const finalData = this.mergeData(match, successData);
    finalData.order_number = orderNumber;
    
    // Update status (replace with new frozen object)
    const idx = this.queue.findIndex(p => p.capture_id === match.capture_id);
    if (idx >= 0) {
      this.queue[idx] = Object.freeze({
        ...match,
        status: 'processing',
        order_number: orderNumber
      });
    }
    await this.saveState();
    
    const result = await this.submitPurchaseToAPI(finalData, match.capture_id);
    
    if (result.success) {
      // Record the submission (by order_number or capture_id)
      this.recordSubmission(uniqueKey);
      
      // Remove from queue
      this.queue = this.queue.filter(p => p.capture_id !== match.capture_id);
      debugLog('[ENGINE] ✅ Submitted successfully:', uniqueKey);
    } else {
      // Update to failed status (replace with new object)
      const failIdx = this.queue.findIndex(p => p.capture_id === match.capture_id);
      if (failIdx >= 0) {
        const original = this.queue[failIdx];
        this.queue[failIdx] = Object.freeze({
          ...original,
          status: 'failed',
          last_error: result.error,
          retry_count: (original.retry_count || 0) + 1
        });
      }
      debugLog('[ENGINE] ❌ Submit failed:', result.error);
    }
    
    await this.saveState();
    return result;
  }

  // Submit to API (uses existing API_BASE_URL)
  async submitPurchaseToAPI(data, captureId) {
    // Get auth data
    const authData = await chrome.storage.local.get(['token', 'user_id', 'email']);
    
    if (!authData.token) {
      debugLog('[ENGINE] Not authenticated');
      return { success: false, error: 'Not authenticated' };
    }
    
    // TPT RESET PURCHASES: Skip coupon validation (coupons don't work on TPT resets)
    // Other firms' resets may still allow coupon codes
    const isTPTReset = data.partner === 'takeprofittrader' && data.purchase_type === 'reset';
    
    if (!isTPTReset) {
      // Validate coupon for all purchases except TPT resets
      const couponUsed = data.coupon_code?.toUpperCase();
      if (!couponUsed || !VALID_COUPONS.includes(couponUsed)) {
        debugLog('[ENGINE] Invalid coupon:', couponUsed);
        return { success: false, error: 'Not using a tracked coupon code' };
      }
    } else {
      debugLog('[ENGINE] TPT Reset purchase - skipping coupon validation (coupons not supported on TPT resets)');
    }
    
    const payload = {
      token: authData.token,
      user_id: authData.user_id,
      partner: data.partner,
      email: data.email || authData.email,
      purchase_email: data.email || authData.email,
      customer_name: data.customer_name,
      product_name: data.product_name,
      original_price: data.original_price,
      final_price: data.final_price,
      discount: data.discount_amount,
      coupon_code: data.coupon_code,
      order_number: data.order_number || null,
      capture_id: captureId, // Include for API tracing
      captured_at: data.captured_at,
      timestamp: new Date().toISOString(),
      extension_version: chrome.runtime.getManifest().version,
      source: 'immutable-queue-engine'
    };
    
    debugLog('[ENGINE] Submitting:', captureId, payload.order_number || '(no order#)');
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/extension/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const result = await response.json();
      
      if (result.success) {
        debugLog('[ENGINE] ✅ API Success');
        
        // Show notification
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'Purchase Tracked! 🎉',
          message: `${data.product_name || 'Purchase'} - $${data.final_price || '?'}`,
          priority: 2
        });
        
        return { success: true, result };
      } else {
        debugLog('[ENGINE] API error:', result.message || result.error);
        return { success: false, error: result.message || result.error || 'API returned error' };
      }
      
    } catch (error) {
      debugLog('[ENGINE] API exception:', error.message);
      return { success: false, error: error.message };
    }
  }

  getStatus() {
    return {
      queueLength: this.queue.length,
      submittedCount: this.submittedOrderNumbers.size,
      queue: this.queue.map(p => ({
        capture_id: p.capture_id,
        partner: p.partner,
        email: p.email,
        price: p.final_price,
        status: p.status,
        age: Math.round((Date.now() - p.captured_timestamp) / 1000) + 's'
      }))
    };
  }

  async cleanup() {
    const oneHour = 60 * 60 * 1000;
    
    // Remove stale pending (abandoned checkouts)
    this.queue = this.queue.filter(p => {
      if (p.status === 'pending' && Date.now() - p.captured_timestamp > oneHour) return false;
      if (p.status === 'failed' && (p.retry_count || 0) >= 3) return false;
      return true;
    });
    
    await this.saveState();
  }
}

// Initialize the purchase engine
const purchaseEngine = new PurchaseEngine();
purchaseEngine.init();

// Cleanup every 10 minutes
setInterval(() => purchaseEngine.cleanup(), 10 * 60 * 1000);

// Message handlers for the purchase engine
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  
  if (message.action === 'CAPTURE_PURCHASE') {
    purchaseEngine.capturePurchase(message.data).then(sendResponse);
    return true;
  }
  
  if (message.action === 'SUCCESS_DETECTED') {
    purchaseEngine.handleSuccess(message.data).then(sendResponse);
    return true;
  }
  
  if (message.action === 'GET_QUEUE_STATUS') {
    sendResponse(purchaseEngine.getStatus());
    return false;
  }
  
  if (message.action === 'RETRY_FAILED') {
    const failed = purchaseEngine.queue.filter(p => p.status === 'failed');
    failed.forEach(p => p.status = 'pending');
    purchaseEngine.saveState().then(() => sendResponse({ retriggered: failed.length }));
    return true;
  }
  
  if (message.action === 'CLEAR_QUEUE') {
    purchaseEngine.queue = [];
    purchaseEngine.saveState().then(() => sendResponse({ success: true }));
    return true;
  }
});

debugLog('[ENGINE] Purchase Queue Engine ready');

// ═══════════════════════════════════════════════════════════════════════════════
// ADAPTER-BASED EXTRACTION SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════
// 
// This modular system allows adding new prop firms by creating adapter configs
// instead of writing new extraction code.
// ═══════════════════════════════════════════════════════════════════════════════

// Adapter Registry - Add new adapters here
const AdapterRegistry = {
  
  // FundedNext Adapter
  fundednext: {
    id: 'fundednext',
    name: 'FundedNext',
    matches: ['*://*.fundednext.com/*', '*://fundednext.com/*'],
    pages: {
      checkout: (url) => url.includes('/checkout') && !url.includes('/thank-you'),
      success: (url) => url.includes('/thank-you') || url.includes('/success')
    },
    successTriggers: [
      { type: 'localStorage', key: 'paymentProcessed', value: 'true' },
      { type: 'url', pattern: '/thank-you' }
    ],
    extraction: {
      sources: [
        {
          type: 'localStorage',
          key: 'purchasePlanInfo',
          available: 'checkout',
          fields: {
            coupon_code: (d) => d.couponCode || d.coupon || null,
            final_price: 'totalPrice',
            original_price: 'plan_value',
            discount_amount: 'discount_price',
            product_name: (d) => d.plan_name || d.name || null,
            plan_id: (d) => d.plan_id || d.id || null,
            email: 'email',
            customer_name: (d) => d.personalInfo ? 
              `${d.personalInfo.firstName || ''} ${d.personalInfo.lastName || ''}`.trim() || null : null
          }
        },
        {
          type: 'localStorage',
          key: 'user',
          available: 'always',
          fields: { email: 'email', customer_name: 'full_name' }
        },
        {
          type: 'dom',
          available: 'checkout',
          fields: { coupon_code: 'input.tw-bg-transparent.tw-outline-none' }
        }
      ]
    },
    providedFields: { order_number: false, coupon_code: true, discount_amount: true },
    timing: { captureDelay: 1000, successDelay: 500, dataClearedAfterPayment: true }
  },
  
  // MyFundedFutures Adapter
  // KEY: Same URL for checkout AND success - detect by DOM content
  // Coupon NOT shown on success page - must capture on checkout
  // ONLY track purchases with coupon code "LAB"
  myfundedfutures: {
    id: 'myfundedfutures',
    name: 'MyFundedFutures',
    matches: ['*://*.myfundedfutures.com/*', '*://myfundedfutures.com/*'],
    requiredCoupon: 'LAB',
    pages: {
      // Same URL for both - detect by content
      checkout: (url, doc) => {
        const text = doc?.body?.innerText || '';
        return text.includes('Apply a discount') && !text.includes('Order number');
      },
      success: (url, doc) => {
        const text = doc?.body?.innerText || '';
        return text.includes('Order number') && text.includes("You're all set");
      }
    },
    successTriggers: [
      { type: 'domText', contains: 'Order number' },
      { type: 'domText', contains: "You're all set" }
    ],
    extraction: {
      sources: [
        // User data from localStorage (always available)
        {
          type: 'localStorage',
          key: 'ajs_user_traits',
          available: 'always',
          fields: {
            email: 'email',
            customer_name: (d) => `${d.firstName || ''} ${d.lastName || ''}`.trim() || null
          }
        }
        // Note: Most MFF data comes from DOM text parsing in content-myfundedfutures.js
      ]
    },
    providedFields: { order_number: true, coupon_code: true, discount_amount: true },
    timing: { captureDelay: 1000, successDelay: 1000, dataClearedAfterPayment: false }
  },
  
  // Tradeify Adapter (placeholder)
  tradeify: {
    id: 'tradeify',
    name: 'Tradeify',
    matches: ['*://*.tradeify.co/*', '*://tradeify.co/*'],
    pages: {
      checkout: (url) => url.includes('/checkout'),
      success: (url) => url.includes('/thank-you') || url.includes('/success')
    },
    successTriggers: [
      { type: 'url', pattern: '/thank-you' }
    ],
    extraction: {
      sources: []
    },
    providedFields: { order_number: true, coupon_code: true, discount_amount: true },
    timing: { captureDelay: 1000, successDelay: 500, dataClearedAfterPayment: false }
  }
};

// Get adapter for URL
function getAdapterForUrl(url) {
  for (const adapter of Object.values(AdapterRegistry)) {
    for (const pattern of adapter.matches) {
      const regex = pattern
        .replace(/\*/g, '.*')
        .replace(/\//g, '\\/')
        .replace(/\./g, '\\.');
      if (new RegExp(regex).test(url)) {
        return adapter;
      }
    }
  }
  return null;
}

// Serialize adapter for sending to content script (functions → strings)
function serializeAdapter(adapter) {
  return JSON.parse(JSON.stringify(adapter, (key, value) => {
    if (typeof value === 'function') {
      return value.toString();
    }
    return value;
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// ADAPTER QUEUE - Separate queue for adapter-based captures
// ─────────────────────────────────────────────────────────────────────────────

class AdapterQueue {
  constructor() {
    this.queue = [];
    this.submitted = [];
    this.loaded = false;
  }

  async load() {
    const data = await chrome.storage.local.get(['adapter_queue', 'adapter_submitted']);
    this.queue = data.adapter_queue || [];
    this.submitted = data.adapter_submitted || [];
    this.loaded = true;
    debugLog('[ADAPTER-Q] Loaded', this.queue.length, 'pending,', this.submitted.length, 'submitted');
  }

  async save() {
    await chrome.storage.local.set({
      adapter_queue: this.queue,
      adapter_submitted: this.submitted
    });
  }

  generateFingerprint(data) {
    const hour = Math.floor(Date.now() / 3600000);
    return [
      data.partner || 'unknown',
      (data.email || 'unknown').toLowerCase(),
      data.final_price || data.original_price || '0',
      data.plan_id || data.product_name || 'unknown',
      hour
    ].join('|').toLowerCase();
  }

  async add(data) {
    if (!this.loaded) await this.load();
    
    const fingerprint = this.generateFingerprint(data);
    const existing = this.queue.findIndex(p => p.fingerprint === fingerprint);
    
    if (existing >= 0) {
      // Update existing
      this.queue[existing] = {
        ...this.queue[existing],
        ...data,
        fingerprint,
        updatedAt: Date.now()
      };
      debugLog('[ADAPTER-Q] Updated:', fingerprint);
    } else {
      // Add new
      this.queue.push({
        ...data,
        fingerprint,
        capturedAt: Date.now(),
        status: 'pending'
      });
      debugLog('[ADAPTER-Q] Added:', fingerprint);
    }
    
    await this.save();
    return { success: true, fingerprint, queueLength: this.queue.length };
  }

  async findMatch(partner, email) {
    if (!this.loaded) await this.load();
    
    const maxAge = 30 * 60 * 1000; // 30 minutes
    const candidates = this.queue
      .filter(p => p.status === 'pending')
      .filter(p => Date.now() - p.capturedAt < maxAge)
      .sort((a, b) => b.capturedAt - a.capturedAt);
    
    // Try to match by partner and email
    for (const p of candidates) {
      if (partner && p.partner !== partner) continue;
      if (email && p.email && email.toLowerCase() !== p.email.toLowerCase()) continue;
      return p;
    }
    
    // Fallback: most recent for this partner
    return candidates.find(p => p.partner === partner) || null;
  }

  async isDuplicate(purchase) {
    if (!this.loaded) await this.load();
    
    // Check by fingerprint
    if (this.submitted.some(s => s.fingerprint === purchase.fingerprint)) {
      return true;
    }
    
    // Check by email + price + partner within 2 hours
    const twoHours = 2 * 60 * 60 * 1000;
    return this.submitted.some(s => {
      if (Date.now() - s.submittedAt > twoHours) return false;
      if (s.email?.toLowerCase() !== purchase.email?.toLowerCase()) return false;
      if (Math.abs(parseFloat(s.final_price || 0) - parseFloat(purchase.final_price || 0)) > 1) return false;
      if (s.partner !== purchase.partner) return false;
      return true;
    });
  }

  async submit(purchase) {
    // Check for duplicates first
    if (await this.isDuplicate(purchase)) {
      debugLog('[ADAPTER-Q] Skipping duplicate:', purchase.fingerprint);
      await this.remove(purchase.fingerprint);
      return { success: true, skipped: true };
    }
    
    // Mark as processing
    purchase.status = 'processing';
    await this.save();
    
    // Get auth token
    const authData = await chrome.storage.local.get(['authToken']);
    if (!authData.authToken) {
      debugLog('[ADAPTER-Q] No auth token, cannot submit');
      purchase.status = 'failed';
      purchase.lastError = 'Not authenticated';
      await this.save();
      return { success: false, error: 'Not authenticated' };
    }
    
    // Build payload
    const payload = {
      partner: purchase.partner,
      email: purchase.email,
      customer_name: purchase.customer_name,
      product_name: purchase.product_name,
      original_price: purchase.original_price,
      final_price: purchase.final_price,
      discount_amount: purchase.discount_amount,
      coupon_code: purchase.coupon_code,
      order_number: purchase.order_number || null,
      source: 'adapter-system',
      client_fingerprint: purchase.fingerprint
    };
    
    debugLog('[ADAPTER-Q] Submitting:', payload.partner, payload.email);
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/extension/purchase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authData.authToken}`
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        throw new Error(`API ${response.status}`);
      }
      
      const result = await response.json();
      debugLog('[ADAPTER-Q] ✅ Submitted successfully');
      
      // Record submission
      this.submitted.push({
        fingerprint: purchase.fingerprint,
        partner: purchase.partner,
        email: purchase.email,
        final_price: purchase.final_price,
        submittedAt: Date.now()
      });
      
      // Keep only last 100 submissions
      if (this.submitted.length > 100) {
        this.submitted = this.submitted.slice(-100);
      }
      
      // Remove from queue
      await this.remove(purchase.fingerprint);
      
      return { success: true, result };
      
    } catch (error) {
      debugLog('[ADAPTER-Q] ❌ Submit failed:', error.message);
      purchase.status = 'failed';
      purchase.lastError = error.message;
      purchase.retryCount = (purchase.retryCount || 0) + 1;
      await this.save();
      return { success: false, error: error.message };
    }
  }

  async remove(fingerprint) {
    this.queue = this.queue.filter(p => p.fingerprint !== fingerprint);
    await this.save();
  }

  async cleanup() {
    if (!this.loaded) await this.load();
    
    const oneHour = 60 * 60 * 1000;
    const oneDay = 24 * 60 * 60 * 1000;
    
    // Remove stale pending
    this.queue = this.queue.filter(p => {
      if (p.status === 'pending' && Date.now() - p.capturedAt > oneHour) return false;
      if (p.status === 'failed' && (p.retryCount || 0) >= 3) return false;
      return true;
    });
    
    // Remove old submitted records
    this.submitted = this.submitted.filter(s => Date.now() - s.submittedAt < oneDay);
    
    await this.save();
  }

  getStatus() {
    return {
      queue: {
        total: this.queue.length,
        pending: this.queue.filter(p => p.status === 'pending').length,
        processing: this.queue.filter(p => p.status === 'processing').length,
        failed: this.queue.filter(p => p.status === 'failed').length
      },
      submitted: this.submitted.length,
      items: this.queue.map(p => ({
        partner: p.partner,
        email: p.email,
        price: p.final_price,
        status: p.status,
        age: Math.round((Date.now() - p.capturedAt) / 1000) + 's'
      }))
    };
  }
}

// Initialize adapter queue
const adapterQueue = new AdapterQueue();
adapterQueue.load();

// Cleanup every 10 minutes
setInterval(() => adapterQueue.cleanup(), 10 * 60 * 1000);

// ─────────────────────────────────────────────────────────────────────────────
// ADAPTER MESSAGE HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  
  // Get adapter for URL
  if (message.action === 'GET_ADAPTER_FOR_URL') {
    const adapter = getAdapterForUrl(message.url);
    if (adapter) {
      sendResponse({ adapter: serializeAdapter(adapter) });
    } else {
      sendResponse({ adapter: null });
    }
    return false;
  }
  
  // Capture purchase from adapter system
  if (message.action === 'ADAPTER_CAPTURE_PURCHASE') {
    adapterQueue.add(message.data).then(sendResponse);
    return true;
  }
  
  // Success detected from adapter system
  if (message.action === 'ADAPTER_SUCCESS_DETECTED') {
    (async () => {
      const { partner, email, successPageData } = message.data;
      
      // Find matching purchase in queue
      const match = await adapterQueue.findMatch(partner, email);
      
      if (!match) {
        debugLog('[ADAPTER] No matching purchase found for:', partner, email);
        sendResponse({ success: false, error: 'No matching purchase in queue' });
        return;
      }
      
      // Merge any data from success page
      if (successPageData) {
        for (const [key, value] of Object.entries(successPageData)) {
          if (value && !match[key]) {
            match[key] = value;
          }
        }
      }
      
      // Submit the purchase
      const result = await adapterQueue.submit(match);
      sendResponse(result);
    })();
    return true;
  }
  
  // Get adapter queue status
  if (message.action === 'ADAPTER_GET_STATUS') {
    sendResponse(adapterQueue.getStatus());
    return false;
  }
  
  // Get all registered adapters
  if (message.action === 'GET_ALL_ADAPTERS') {
    const adapters = Object.values(AdapterRegistry).map(a => ({
      id: a.id,
      name: a.name,
      matches: a.matches
    }));
    sendResponse({ adapters });
    return false;
  }
});

debugLog('[ADAPTER] Adapter system ready');
debugLog('[ADAPTER] Registered adapters:', Object.keys(AdapterRegistry).join(', '));                                                                                                                                                                                            
