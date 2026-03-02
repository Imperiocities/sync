// ══════════════════════════════════════════════════════════════════════════════
// CONTENT-AUTOFILL.JS
// Auto-fill coupon codes - uses TrackerUI for all notifications
// NO purchase tracking - that's handled by adapters
// ══════════════════════════════════════════════════════════════════════════════

const DEBUG_MODE = false;

const log = (...args) => {
  if (DEBUG_MODE) console.log('[AutoFill]', ...args);
};

// Prevent double initialization
if (window.__autofillLoaded) {
  log('Already loaded, skipping');
} else {
  window.__autofillLoaded = true;

// ══════════════════════════════════════════════════════════════════════════════
// TRACKER INTEGRATION
// ══════════════════════════════════════════════════════════════════════════════

let tracker = null;

function getOrCreateTracker() {
  // Check if tracker already exists (created by adapter)
  if (window.__pfcTracker) {
    return window.__pfcTracker;
  }
  
  // Create new tracker if TrackerUI is available
  if (window.TrackerUI && !tracker) {
    const hostname = window.location.hostname.replace('www.', '');
    const partnerMap = {
      'fundednext.com': { id: 'fundednext', name: 'FundedNext' },
      'app.fundednext.com': { id: 'fundednext', name: 'FundedNext' },
      'myfundedfutures.com': { id: 'myfundedfutures', name: 'MyFundedFutures' },
      'tradeify.co': { id: 'tradeify', name: 'Tradeify' },
      'app-f.tradeify.co': { id: 'tradeify', name: 'Tradeify' },
      'lucidtrading.com': { id: 'lucidtrading', name: 'Lucid Trading' },
      'alpha-futures.com': { id: 'alphafutures', name: 'Alpha Futures' },
      'takeprofittrader.com': { id: 'takeprofittrader', name: 'Take Profit Trader' },
      'apextraderfunding.com': { id: 'apextraderfunding', name: 'Apex Trader Funding' }
    };
    
    const partner = partnerMap[hostname] || { id: 'unknown', name: 'Prop Firm' };
    
    tracker = new window.TrackerUI({
      partner: partner.id,
      partnerName: partner.name,
      fields: ['coupon', 'product', 'price', 'email'],
      fieldLabels: {
        coupon: 'Coupon Code',
        product: 'Account',
        price: 'Price',
        email: 'Email'
      },
      afterPurchaseFields: []
    });
    
    // Store globally so adapter can access
    window.__pfcTracker = tracker;
  }
  
  return tracker || window.__pfcTracker;
}

function showTrackerWithAutoFill(status, text) {
  const t = getOrCreateTracker();
  if (t) {
    t.show();
    t.setAutoFillStatus(status, text);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ══════════════════════════════════════════════════════════════════════════════

let checkoutConfig = null;
let settings = null;
let autoFillCompleted = false;
let autoFillInProgress = false;
let autoFillTimeout = null;

// ══════════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ══════════════════════════════════════════════════════════════════════════════

async function init() {
  log('Initializing on:', window.location.hostname);
  
  // Load settings
  settings = await getSettings();
  
  // Load checkout config
  checkoutConfig = await loadCheckoutConfig();
  
  if (!checkoutConfig) {
    log('No checkout config for this domain');
    return;
  }
  
  log('Loaded config for:', checkoutConfig.name);
  
  // Detect checkout moment
  detectCheckoutMoment();
  
  // Watch for SPA navigation
  setupNavigationWatcher();
}

async function getSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(['settings'], data => {
      resolve(data.settings || {
        showFloatingIcon: true,
        automaticCodeFilling: true,
        showCheckoutReminders: true
      });
    });
  });
}

async function loadCheckoutConfig() {
  return new Promise(resolve => {
    const hostname = window.location.hostname.replace('www.', '');
    
    fetch(chrome.runtime.getURL('checkout-config.json'))
      .then(r => r.json())
      .then(config => {
        // Try exact match first
        if (config[hostname]) {
          resolve(config[hostname]);
          return;
        }
        
        // Try subdomain match
        for (const domain of Object.keys(config)) {
          if (hostname.includes(domain) || domain.includes(hostname)) {
            resolve(config[domain]);
            return;
          }
        }
        
        resolve(null);
      })
      .catch(e => {
        log('Error loading config:', e);
        resolve(null);
      });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// CHECKOUT DETECTION
// ══════════════════════════════════════════════════════════════════════════════

function detectCheckoutMoment() {
  if (!checkoutConfig) return;
  
  // Check if coupon already in URL
  const url = window.location.href;
  if (url.includes('couponCode=LAB') || url.includes('coupon=LAB') || url.includes('promo=LAB')) {
    log('Coupon already in URL, skipping auto-fill');
    autoFillCompleted = true;
    
    // Still show tracker with coupon already applied
    const t = getOrCreateTracker();
    if (t) {
      t.show();
      t.updateField('coupon', 'LAB');
      t.setAutoFillStatus('success', 'Code "LAB" already applied ✓');
      setTimeout(() => t.setAutoFillStatus('hidden', ''), 3000);
    }
    return;
  }
  
  // Prevent multiple executions
  if (autoFillInProgress || autoFillCompleted) {
    return;
  }
  
  // Check if on checkout page
  const detection = checkoutConfig.checkoutDetection;
  let isCheckout = false;
  
  if (detection.type === 'url') {
    isCheckout = url.includes(detection.pattern);
  } else if (detection.type === 'element') {
    isCheckout = !!document.querySelector(detection.selector);
  }
  
  if (!isCheckout) {
    return;
  }
  
  log('Checkout detected!');
  
  // Show tracker immediately on checkout detection
  const t = getOrCreateTracker();
  if (t) {
    t.show();
    t.setStatus('', 'Checkout detected...');
  }
  
  // Auto-fill if enabled
  if (settings?.automaticCodeFilling !== false) {
    log('Starting auto-fill in 1 second...');
    autoFillInProgress = true;
    
    if (autoFillTimeout) {
      clearTimeout(autoFillTimeout);
    }
    
    autoFillTimeout = setTimeout(() => {
      if (!autoFillCompleted && autoFillInProgress) {
        triggerAutoFill();
      }
    }, 1000);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// AUTO-FILL EXECUTION
// ══════════════════════════════════════════════════════════════════════════════

async function triggerAutoFill() {
  if (!checkoutConfig?.autoFillSequence) {
    log('No auto-fill sequence configured');
    return;
  }
  
  if (checkoutConfig.disabled) {
    log('Auto-fill disabled for this domain');
    return;
  }
  
  log(`Executing auto-fill for ${checkoutConfig.name}`);
  log(`Sequence has ${checkoutConfig.autoFillSequence.length} steps`);
  
  // Show tracker with auto-fill status
  showTrackerWithAutoFill('applying', 'Applying discount code "LAB"...');
  
  // Validate sequence (unless skipValidation is true)
  if (!checkoutConfig.skipValidation) {
    const validation = await validateSequence(checkoutConfig.autoFillSequence);
    if (!validation.isValid) {
      log('Validation failed:', validation.reason);
      showTrackerWithAutoFill('error', 'Could not find coupon field');
      autoFillInProgress = false;
      return;
    }
  }
  
  try {
    await executeSequence(checkoutConfig.autoFillSequence);
    log('Auto-fill completed successfully!');
    
    autoFillCompleted = true;
    autoFillInProgress = false;
    
    // Update tracker with success
    const t = getOrCreateTracker();
    if (t) {
      t.setAutoFillStatus('success', 'Code "LAB" applied! ✓');
      t.updateField('coupon', 'LAB');
      // Hide auto-fill status after 3 seconds
      setTimeout(() => t.setAutoFillStatus('hidden', ''), 3000);
    }
    
  } catch (error) {
    log('Auto-fill error:', error);
    
    // Check if code was actually applied despite error
    const successIndicators = checkForSuccessIndicators();
    if (successIndicators) {
      log('Success indicators found despite error');
      autoFillCompleted = true;
      autoFillInProgress = false;
      
      const t = getOrCreateTracker();
      if (t) {
        t.setAutoFillStatus('success', 'Code appears applied ✓');
        t.updateField('coupon', 'LAB');
        setTimeout(() => t.setAutoFillStatus('hidden', ''), 3000);
      }
      return;
    }
    
    autoFillInProgress = false;
    autoFillCompleted = true; // Prevent retry loops
    showTrackerWithAutoFill('error', 'Auto-fill failed - apply "LAB" manually');
  }
}

async function validateSequence(sequence) {
  const missingElements = [];
  
  for (let i = 0; i < sequence.length; i++) {
    const step = sequence[i];
    
    if (step.action === 'fill' || step.action === 'click') {
      const element = findElement(step.selector, step.content);
      
      if (!element && !step.optional) {
        missingElements.push(`Step ${i + 1}: ${step.selector}`);
      }
    }
  }
  
  return {
    isValid: missingElements.length === 0,
    reason: missingElements.length > 0 ? `Missing elements: ${missingElements.join(', ')}` : 'Valid',
    missingElements
  };
}

async function executeSequence(sequence) {
  for (let i = 0; i < sequence.length; i++) {
    const step = sequence[i];
    log(`Step ${i + 1}/${sequence.length}: ${step.action}${step.optional ? ' (optional)' : ''}`);
    
    try {
      await executeStep(step);
      log(`Step ${i + 1} completed`);
    } catch (error) {
      log(`Step ${i + 1} failed:`, error);
      
      if (step.optional) {
        log('Step is optional, continuing...');
        continue;
      }
      
      throw error;
    }
  }
}

async function executeStep(step) {
  switch (step.action) {
    case 'fill':
      await fillInput(step.selector, step.value);
      break;
      
    case 'click':
      await clickElement(step.selector, step.content, step.waitForEnabled, step.maxWait);
      break;
      
    case 'wait':
      await wait(step.duration);
      break;
      
    case 'waitForVisible':
      await waitForVisible(step.selector, step.content, step.maxWait || 5000);
      break;
      
    default:
      throw new Error(`Unknown action: ${step.action}`);
  }
}

async function fillInput(selector, value) {
  const input = findElement(selector);
  if (!input) {
    throw new Error(`Input not found: ${selector}`);
  }
  
  log(`Filling "${selector}" with "${value}"`);
  
  input.focus();
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  
  // Visual feedback
  input.style.border = '2px solid #00cc66';
  input.style.boxShadow = '0 0 10px rgba(0, 204, 102, 0.3)';
  setTimeout(() => {
    input.style.border = '';
    input.style.boxShadow = '';
  }, 2000);
}

async function clickElement(selector, content = null, waitForEnabled = false, maxWait = 3000) {
  const element = findElement(selector, content);
  if (!element) {
    throw new Error(`Element not found: ${selector}${content ? ` with "${content}"` : ''}`);
  }
  
  log(`Clicking "${selector}"${content ? ` with "${content}"` : ''}`);
  
  if (waitForEnabled) {
    const enabled = await waitForElementEnabled(element, maxWait);
    if (!enabled && maxWait !== -1) {
      throw new Error(`Element disabled after ${maxWait}ms`);
    }
  }
  
  if (element.disabled) {
    throw new Error(`Cannot click disabled element: ${selector}`);
  }
  
  element.style.outline = '2px solid #007bff';
  element.click();
  
  setTimeout(() => {
    element.style.outline = '';
  }, 1000);
  
  await wait(200);
}

async function waitForVisible(selector, content = null, maxWait = 5000) {
  const startTime = Date.now();
  const checkInterval = 100;
  const isIndefinite = maxWait === -1;
  
  log(`Waiting for: ${selector}${content ? ` with "${content}"` : ''}`);
  
  while (isIndefinite || Date.now() - startTime < maxWait) {
    const element = findElement(selector, content);
    if (element && isElementVisible(element)) {
      log('Element found and visible');
      return true;
    }
    await wait(checkInterval);
  }
  
  if (!isIndefinite) {
    throw new Error(`Element not visible after ${maxWait}ms: ${selector}`);
  }
  
  return false;
}

async function waitForElementEnabled(element, maxWait = 3000) {
  const startTime = Date.now();
  const checkInterval = 100;
  const isIndefinite = maxWait === -1;
  
  while (isIndefinite || Date.now() - startTime < maxWait) {
    const isDisabled = element.disabled || 
                      element.hasAttribute('disabled') || 
                      element.classList.contains('disabled');
    
    if (!isDisabled) {
      return true;
    }
    
    await wait(checkInterval);
  }
  
  return false;
}

function findElement(selector, content = null) {
  const elements = document.querySelectorAll(selector);
  
  for (const element of elements) {
    if (!isElementVisible(element)) continue;
    
    if (content) {
      if (element.textContent.trim().includes(content)) {
        return element;
      }
    } else {
      return element;
    }
  }
  
  return null;
}

function isElementVisible(element) {
  if (!element) return false;
  
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function checkForSuccessIndicators() {
  // Check URL for coupon
  if (window.location.href.includes('LAB')) return true;
  
  // Check for success elements
  const successSelectors = [
    '[class*="success"]',
    '[class*="applied"]',
    '[class*="discount"]'
  ];
  
  for (const selector of successSelectors) {
    if (document.querySelector(selector)) return true;
  }
  
  // Check for disabled coupon input (means code applied)
  const couponInputs = document.querySelectorAll('input[placeholder*="code" i], input[name*="coupon" i]');
  for (const input of couponInputs) {
    if (input.disabled || input.value === 'LAB') return true;
  }
  
  return false;
}

// ══════════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS - Now handled via TrackerUI
// ══════════════════════════════════════════════════════════════════════════════

// All notifications are now shown in the tracker widget

// ══════════════════════════════════════════════════════════════════════════════
// SPA NAVIGATION WATCHER
// ══════════════════════════════════════════════════════════════════════════════

function setupNavigationWatcher() {
  let lastPathname = window.location.pathname;
  
  setInterval(() => {
    if (window.location.pathname !== lastPathname) {
      log('Page changed, resetting auto-fill state');
      autoFillCompleted = false;
      autoFillInProgress = false;
      
      if (autoFillTimeout) {
        clearTimeout(autoFillTimeout);
        autoFillTimeout = null;
      }
      
      lastPathname = window.location.pathname;
      
      // Re-detect checkout
      setTimeout(detectCheckoutMoment, 500);
    }
  }, 1000);
}

// ══════════════════════════════════════════════════════════════════════════════
// DEBUG COMMANDS
// ══════════════════════════════════════════════════════════════════════════════

window.autofillDebug = {
  getConfig: () => checkoutConfig,
  getSettings: () => settings,
  getState: () => ({ autoFillCompleted, autoFillInProgress }),
  forceAutoFill: () => {
    autoFillCompleted = false;
    autoFillInProgress = false;
    triggerAutoFill();
  },
  detectCheckout: detectCheckoutMoment
};

// ══════════════════════════════════════════════════════════════════════════════
// START
// ══════════════════════════════════════════════════════════════════════════════

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

} // End of double-init guard
