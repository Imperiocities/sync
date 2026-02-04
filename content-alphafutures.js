/**
 * Alpha Futures Purchase Adapter v2.0
 *
 * Captures purchase data from Alpha Futures (app.alpha-futures.com) checkout flow.
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │                           DATA CAPTURE SOURCES                              │
 * ├─────────────────────────────────────────────────────────────────────────────┤
 * │ Field                 │ Source                                              │
 * ├───────────────────────┼─────────────────────────────────────────────────────┤
 * │ email                 │ Network: /user/billing/address/ API                 │
 * │ customer_name         │ Network: /user/billing/address/ API                 │
 * │ phone                 │ Network: /user/billing/address/ API                 │
 * │ user_id (profile)     │ Network: /user/billing/address/ API                 │
 * │ coupon_code           │ Network: /payment/final-price/ API                  │
 * │ original_price        │ Network: /payment/final-price/ API (actual_price)   │
 * │ final_price           │ Network: /payment/final-price/ API                  │
 * │ discount              │ Network: /payment/final-price/ API                  │
 * │ account_size          │ Safecharge URL → item_name_1= param                 │
 * │ account_type          │ Backend API URL → payment_type= param               │
 * │ transaction_id        │ Success URL → TransactionID= param                  │
 * └───────────────────────┴─────────────────────────────────────────────────────┘
 *
 * Success Detection:
 * - URL matches: app.alpha-futures.com/evaluation/payment/success/?TransactionID=*
 *
 * Auto-Coupon:
 * - Network intercept automatically calls final-price API with LAB coupon
 */

(function() {
  'use strict';
  
  const hostname = window.location.hostname.toLowerCase();
  
  // Determine which domain we're on
  const isAlphaFutures = hostname.includes('alpha-futures.com');
  const isSafecharge = hostname.includes('safecharge.com') || hostname.includes('nuvei.com');
  
  // Only run on supported domains
  if (!isAlphaFutures && !isSafecharge) {
    return;
  }
  
  const PARTNER = 'alphafutures';
  const PARTNER_NAME = 'Alpha Futures';
  const ADAPTER_VERSION = '1.0.0';
  const STORAGE_KEY = '__pfc_alphafutures_data';
  
  // Store original console.log for our own logging
  const originalLog = console.log;
  
  originalLog.call(console, `[AlphaFutures] 🚀 Adapter v${ADAPTER_VERSION} loaded on ${window.location.href}`);
  
  // ═══════════════════════════════════════════════════════════════════
  // SAFECHARGE/NUVEI DOMAIN - Capture URL params and store
  // ═══════════════════════════════════════════════════════════════════
  
  if (isSafecharge) {
    originalLog.call(console, '[AlphaFutures] 💳 Payment page detected');
    
    // Define the tracker function BEFORE calling it
    function showPaymentPageTracker(data) {
      // Wait for TrackerUI to be available
      const waitForTracker = () => {
        if (typeof window.TrackerUI === 'undefined') {
          originalLog.call(console, '[AlphaFutures] ⏳ Waiting for TrackerUI...');
          setTimeout(waitForTracker, 500);
          return;
        }
        
        originalLog.call(console, '[AlphaFutures] ✅ TrackerUI available, showing tracker');
        originalLog.call(console, '[AlphaFutures] 📦 Data to display:', data);
        
        const tracker = new window.TrackerUI({
          partner: PARTNER,
          partnerName: PARTNER_NAME,
          fields: ['coupon', 'product', 'price', 'email'],
          fieldLabels: {
            coupon: 'Coupon Code',
            product: 'Account',
            price: 'Price',
            email: 'Email'
          },
          afterPurchaseFields: []
        });
        
        tracker.show();
        
        // Function to set all the tracker content
        function updatePaymentTracker() {
          tracker.setStatus('waiting', 'Waiting for checkout...');
          
          // Display all the data we have
          if (data.coupon_code) {
            tracker.updateField('coupon', data.coupon_code);
          }
          if (data.account_size) {
            tracker.updateField('product', data.account_size);
          }
          if (data.final_price) {
            // Show with original price if we have discount
            if (data.original_price && data.original_price > data.final_price) {
              tracker.updateField('price', `$${data.final_price} (was $${data.original_price})`);
            } else {
              tracker.updateField('price', `$${data.final_price}`);
            }
          }
          if (data.email) {
            tracker.updateField('email', data.email);
          }
          
          // Show security message - green colored for visibility
          setTimeout(() => {
            const messageEl = tracker.element?.querySelector('#pfc-tracker-message');
            if (messageEl) {
              messageEl.className = 'pfc-tracker-message success';
              messageEl.innerHTML = '🔒 We do not monitor any payment information on this page.';
              messageEl.style.display = 'block';
              messageEl.style.marginTop = '12px';
              messageEl.style.color = '#00E5A0';
              messageEl.style.backgroundColor = 'rgba(0, 229, 160, 0.1)';
              messageEl.style.border = '1px solid rgba(0, 229, 160, 0.3)';
              messageEl.style.borderRadius = '8px';
              messageEl.style.padding = '10px 12px';
              messageEl.style.fontSize = '11px';
              messageEl.style.textAlign = 'center';
              originalLog.call(console, '[AlphaFutures] ✅ Security message displayed');
            } else {
              originalLog.call(console, '[AlphaFutures] ⚠️ Message element not found');
            }
          }, 100);
        }
        
        // Set initial content
        setTimeout(updatePaymentTracker, 200);
        
        // Keep updating in case tracker gets recreated by the page
        setInterval(() => {
          if (tracker.element && document.body.contains(tracker.element)) {
            // Check if status got reset
            const statusText = tracker.element.querySelector('.pfc-tracker-status-text');
            if (statusText && !statusText.textContent.includes('Waiting')) {
              originalLog.call(console, '[AlphaFutures] 🔄 Restoring tracker status...');
              updatePaymentTracker();
            }
          }
        }, 1000);
      };
      
      // Start checking for TrackerUI
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', waitForTracker);
      } else {
        waitForTracker();
      }
    }
    
    // Get URL params first (these are authoritative for email, account_size, final_price)
    const urlParams = new URLSearchParams(window.location.search);
    const urlData = {
      email: urlParams.get('email'),
      customer_name: [urlParams.get('first_name'), urlParams.get('last_name')].filter(Boolean).join(' '),
      user_id: urlParams.get('userid'),
      account_size: urlParams.get('item_name_1'),
      final_price: parseFloat(urlParams.get('total_amount')) || null,
      plan_id: urlParams.get('planId')
    };
    
    originalLog.call(console, '[AlphaFutures] 📦 Data from URL:', urlData);
    
    // Use chrome.storage.local (shared across domains) to get checkout data
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        let storedData = result[STORAGE_KEY] || {};
        originalLog.call(console, '[AlphaFutures] 📥 Restored data from chrome.storage:', storedData);
        
        // Merge: URL params take precedence, but keep checkout data (coupon, original_price)
        const mergedData = {
          // From checkout page (keep these - they're not in URL)
          coupon_code: storedData.coupon_code || null,
          original_price: storedData.original_price || null,
          discount_percent: storedData.discount_percent || null,
          account_type: storedData.account_type || null,
          
          // From URL (authoritative)
          email: urlData.email || storedData.email,
          customer_name: urlData.customer_name || storedData.customer_name,
          user_id: urlData.user_id || storedData.user_id,
          account_size: urlData.account_size || storedData.account_size,
          final_price: urlData.final_price || storedData.final_price,
          plan_id: urlData.plan_id || storedData.plan_id,
          
          captured_at: Date.now()
        };
        
        originalLog.call(console, '[AlphaFutures] 📦 Merged data for payment page:', mergedData);
        
        // Store merged data for success page (in chrome.storage for cross-domain)
        chrome.storage.local.set({ [STORAGE_KEY]: mergedData });
        
        originalLog.call(console, '[AlphaFutures] ✅ Data stored for success page');
        
        // Show tracker UI with merged data
        showPaymentPageTracker(mergedData);
      });
    } else {
      // Fallback if chrome.storage not available
      originalLog.call(console, '[AlphaFutures] ⚠️ chrome.storage not available');
      showPaymentPageTracker(urlData);
    }
    
    // Don't run the rest of the adapter on payment pages
    return;
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // ALPHA FUTURES DOMAIN - Full adapter
  // ═══════════════════════════════════════════════════════════════════
  
  // Purchase data store
  const purchaseData = {
    email: null,
    customer_name: null,
    user_id: null,
    phone: null,
    product_name: null,
    account_size: null,
    account_type: null,
    original_price: null,
    final_price: null,
    discount_percent: null,
    discount_amount: null,
    coupon_code: null,
    transaction_id: null,
    platform: null
  };

  // Network data from intercept
  const networkData = {
    billingAddress: null,
    finalPrice: null,
    lastNetworkUpdate: 0,
    network_log: []
  };

  // Listen for network events from intercept script
  document.addEventListener('__pfc_af_net', function(e) {
    try {
      const detail = typeof e.detail === 'string' ? JSON.parse(e.detail) : e.detail;
      if (!detail || !detail.type || !detail.data) return;

      const d = detail.data;

      // Log network requests
      if (detail.type === 'fetch' || detail.type === 'xhr') {
        networkData.network_log.push({
          type: detail.type,
          url: d.url,
          method: d.method,
          status: d.status,
          time: new Date().toISOString()
        });
        if (networkData.network_log.length > 100) {
          networkData.network_log.splice(0, networkData.network_log.length - 100);
        }

        if (d.responseData) {
          processNetworkResponse(d.url, d.responseData);
        }
      }

      // Handle coupon applied event
      if (detail.type === 'coupon_applied' && d.response) {
        originalLog.call(console, '[AlphaFutures] Coupon applied via network:', d.response);
        if (d.response.coupon_applied) {
          purchaseData.coupon_code = d.response.coupon_applied;
        }
        if (d.response.actual_price) {
          purchaseData.original_price = parseFloat(d.response.actual_price);
        }
        if (d.response.final_price) {
          purchaseData.final_price = parseFloat(d.response.final_price);
        }
        if (d.response.discount) {
          purchaseData.discount_amount = parseFloat(d.response.discount);
        }
        networkData.lastNetworkUpdate = Date.now();
        updateTrackerUI();
      }
    } catch (err) {
      originalLog.call(console, '[AlphaFutures] Error processing network event:', err);
    }
  });

  function processNetworkResponse(url, data) {
    if (!data) return;
    const urlLower = url.toLowerCase();

    // /user/billing/address/ - user profile data
    if (urlLower.includes('/user/billing/address')) {
      originalLog.call(console, '[AlphaFutures] Processing billing address response');
      // Response is an array
      const address = Array.isArray(data) ? data[0] : data;
      if (address) {
        networkData.billingAddress = address;
        if (address.email && !purchaseData.email) {
          purchaseData.email = address.email;
          originalLog.call(console, '[AlphaFutures] Email from API:', purchaseData.email);
        }
        if (address.first_name || address.last_name) {
          purchaseData.customer_name = [address.first_name, address.last_name].filter(Boolean).join(' ');
          originalLog.call(console, '[AlphaFutures] Name from API:', purchaseData.customer_name);
        }
        if (address.number && !purchaseData.phone) {
          purchaseData.phone = address.number;
          originalLog.call(console, '[AlphaFutures] Phone from API:', purchaseData.phone);
        }
        if (address.profile && !purchaseData.user_id) {
          purchaseData.user_id = String(address.profile);
          originalLog.call(console, '[AlphaFutures] User ID (profile) from API:', purchaseData.user_id);
        }
        networkData.lastNetworkUpdate = Date.now();
        updateTrackerUI();
      }
      return;
    }

    // /payment/final-price/ - pricing and coupon data
    if (urlLower.includes('/payment/final-price')) {
      originalLog.call(console, '[AlphaFutures] Processing final-price response:', data);
      networkData.finalPrice = data;
      if (data.coupon_applied) {
        purchaseData.coupon_code = data.coupon_applied;
        originalLog.call(console, '[AlphaFutures] Coupon from API:', purchaseData.coupon_code);
      }
      if (data.actual_price) {
        purchaseData.original_price = parseFloat(data.actual_price);
        originalLog.call(console, '[AlphaFutures] Original price from API:', purchaseData.original_price);
      }
      if (data.final_price) {
        purchaseData.final_price = parseFloat(data.final_price);
        originalLog.call(console, '[AlphaFutures] Final price from API:', purchaseData.final_price);
      }
      if (data.discount) {
        purchaseData.discount_amount = parseFloat(data.discount);
        // Calculate discount percent
        if (purchaseData.original_price && purchaseData.original_price > 0) {
          purchaseData.discount_percent = Math.round((purchaseData.discount_amount / purchaseData.original_price) * 100);
        }
        originalLog.call(console, '[AlphaFutures] Discount from API:', purchaseData.discount_amount, '(' + purchaseData.discount_percent + '%)');
      }
      networkData.lastNetworkUpdate = Date.now();
      updateTrackerUI();
      return;
    }
  }

  // Base prices from console log interception
  let basePrices = {};
  
  // Tracker state
  let tracker = null;
  let captureStatus = 'waiting'; // waiting, capturing, submitting, success, error
  let purchaseComplete = false;
  
  // Try to restore data from payment page
  function restoreFromPaymentPage() {
    try {
      // Try localStorage first
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        originalLog.call(console, '[AlphaFutures] 📥 Restored data from payment page:', data);
        
        if (data.email) purchaseData.email = data.email;
        if (data.customer_name) purchaseData.customer_name = data.customer_name;
        if (data.user_id) purchaseData.user_id = data.user_id;
        if (data.account_size) {
          purchaseData.account_size = data.account_size;
          purchaseData.product_name = data.account_size;
        }
        if (data.final_price) purchaseData.final_price = data.final_price;
        
        return true;
      }
    } catch (e) {
      originalLog.call(console, '[AlphaFutures] ⚠️ Error restoring data:', e.message);
    }
    return false;
  }
  
  // Also try chrome.storage (async)
  function restoreFromChromeStorage(callback) {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        if (result[STORAGE_KEY]) {
          const data = result[STORAGE_KEY];
          originalLog.call(console, '[AlphaFutures] 📥 Restored data from chrome.storage:', data);
          
          // Restore ALL fields, not just some!
          if (data.email && !purchaseData.email) purchaseData.email = data.email;
          if (data.customer_name && !purchaseData.customer_name) purchaseData.customer_name = data.customer_name;
          if (data.user_id && !purchaseData.user_id) purchaseData.user_id = data.user_id;
          if (data.account_size && !purchaseData.account_size) {
            purchaseData.account_size = data.account_size;
            purchaseData.product_name = data.account_size;
          }
          if (data.final_price && !purchaseData.final_price) purchaseData.final_price = data.final_price;
          
          // CRITICAL: Also restore coupon, original_price, discount - these were missing!
          if (data.coupon_code && !purchaseData.coupon_code) purchaseData.coupon_code = data.coupon_code;
          if (data.original_price && !purchaseData.original_price) purchaseData.original_price = data.original_price;
          if (data.discount_percent && !purchaseData.discount_percent) purchaseData.discount_percent = data.discount_percent;
          if (data.account_type && !purchaseData.account_type) purchaseData.account_type = data.account_type;
        }
        if (callback) callback();
      });
    } else if (callback) {
      callback();
    }
  }
  
  // Clear stored data after successful submission
  function clearStoredData() {
    localStorage.removeItem(STORAGE_KEY);
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.remove([STORAGE_KEY]);
    }
    originalLog.call(console, '[AlphaFutures] 🗑️ Cleared stored payment data');
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // CONSOLE LOG INTERCEPTION - Capture base prices from sortedNumbers
  // ═══════════════════════════════════════════════════════════════════
  
  const originalConsoleLog = console.log;
  console.log = function(...args) {
    // Call original first - MUST happen regardless of our code
    originalConsoleLog.apply(console, args);
    
    // Check for sortedNumbers log (contains plan pricing)
    try {
      if (args[0] === 'sortedNumbers' && Array.isArray(args[1])) {
        originalLog.call(console, '[AlphaFutures] 📊 Intercepted plan pricing data');
        args[1].forEach(plan => {
          if (plan.name && plan.price) {
            basePrices[plan.name] = parseFloat(plan.price);
            originalLog.call(console, `[AlphaFutures]    ${plan.name}: $${plan.price}`);
          }
        });
      }
    } catch (e) {
      // Don't let our code break the page's console.log
    }
  };
  
  // ═══════════════════════════════════════════════════════════════════
  // NETWORK INTERCEPTION - Capture coupon and payment data
  // ═══════════════════════════════════════════════════════════════════
  
  function processUrl(url) {
    if (!url || purchaseComplete) return;
    
    try {
      const urlStr = typeof url === 'string' ? url : url.toString();
      
      // 1. Coupon validation request
      // URL: backend.alpha-futures.com/payment/final-price/{planId}/?coupon=XXX&payment_type=purchase_challenge
      if (urlStr.includes('backend.alpha-futures.com/payment/final-price')) {
        const urlObj = new URL(urlStr);
        const coupon = urlObj.searchParams.get('coupon');
        const paymentType = urlObj.searchParams.get('payment_type');
        
        if (coupon) {
          purchaseData.coupon_code = coupon.toUpperCase();
          originalLog.call(console, '[AlphaFutures] 🎫 Coupon captured:', purchaseData.coupon_code);
          updateTrackerUI();
        }
        
        if (paymentType) {
          purchaseData.account_type = paymentType;
          originalLog.call(console, '[AlphaFutures] 📦 Account type:', purchaseData.account_type);
        }
      }
      
      // 2. Safecharge/Nuvei payment redirect
      // URL: secure.safecharge.com/ppp/purchase.do?email=...&item_name_1=...&total_amount=...
      if (urlStr.includes('secure.safecharge.com/ppp/purchase.do') || 
          urlStr.includes('secure.nuvei.com')) {
        const urlObj = new URL(urlStr);
        
        // Email
        const email = urlObj.searchParams.get('email');
        if (email) {
          purchaseData.email = email;
          originalLog.call(console, '[AlphaFutures] 📧 Email captured:', purchaseData.email);
        }
        
        // Account size (item_name_1)
        const itemName = urlObj.searchParams.get('item_name_1');
        if (itemName) {
          purchaseData.account_size = itemName;
          purchaseData.product_name = itemName; // Use account size as product name
          originalLog.call(console, '[AlphaFutures] 📦 Account size:', purchaseData.account_size);
          
          // Look up base price
          if (basePrices[itemName]) {
            purchaseData.original_price = basePrices[itemName];
            originalLog.call(console, '[AlphaFutures] 💰 Original price from lookup:', purchaseData.original_price);
          }
        }
        
        // Final price (total_amount)
        const totalAmount = urlObj.searchParams.get('total_amount');
        if (totalAmount) {
          purchaseData.final_price = parseFloat(totalAmount);
          originalLog.call(console, '[AlphaFutures] 💵 Final price:', purchaseData.final_price);
          
          // If no original price from lookup, use final price
          if (!purchaseData.original_price) {
            purchaseData.original_price = purchaseData.final_price;
          }
          
          // Calculate discount percentage
          if (purchaseData.original_price && purchaseData.final_price < purchaseData.original_price) {
            purchaseData.discount_percent = Math.round(
              ((purchaseData.original_price - purchaseData.final_price) / purchaseData.original_price) * 100
            );
            originalLog.call(console, '[AlphaFutures] 🏷️ Discount:', purchaseData.discount_percent + '%');
          }
        }
        
        // User ID
        const userId = urlObj.searchParams.get('userid');
        if (userId) {
          purchaseData.user_id = userId;
          originalLog.call(console, '[AlphaFutures] 👤 User ID:', purchaseData.user_id);
        }
        
        updateTrackerUI();
        setStatus('capturing', 'Payment in progress...');
      }
      
    } catch (e) {
      originalLog.call(console, '[AlphaFutures] ⚠️ Error processing URL:', e.message);
    }
  }
  
  // Intercept fetch requests (with safety wrapper)
  const originalFetch = window.fetch;
  window.fetch = function(input, init) {
    try {
      const url = typeof input === 'string' ? input : input?.url;
      if (url) {
        processUrl(url);
      }
    } catch (e) {
      // Don't let our code break the page's fetch
    }
    return originalFetch.apply(this, arguments);
  };
  
  // Intercept XHR requests (with safety wrapper)
  const originalXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    try {
      if (url) {
        processUrl(url);
      }
    } catch (e) {
      // Don't let our code break the page's XHR
    }
    return originalXHROpen.apply(this, arguments);
  };
  
  // ═══════════════════════════════════════════════════════════════════
  // SUCCESS DETECTION - Monitor for success page
  // ═══════════════════════════════════════════════════════════════════
  
  function checkForSuccess() {
    const url = window.location.href;
    
    // Success URL: app.alpha-futures.com/evaluation/payment/success/?TransactionID=XXX
    if (url.includes('alpha-futures.com') && url.includes('/payment/success')) {
      const urlObj = new URL(url);
      const transactionId = urlObj.searchParams.get('TransactionID');
      
      if (transactionId && !purchaseComplete) {
        purchaseData.transaction_id = transactionId;
        originalLog.call(console, '[AlphaFutures] ✅ SUCCESS PAGE DETECTED!');
        originalLog.call(console, '[AlphaFutures] 🆔 Transaction ID:', transactionId);
        
        purchaseComplete = true;
        
        // Restore data from payment page before submitting
        restoreFromPaymentPage();
        
        // Show tracker and update UI
        showTracker();
        updateTrackerUI();
        setStatus('success', 'Purchase detected!');
        
        // Also try chrome.storage, then submit
        restoreFromChromeStorage(() => {
          updateTrackerUI();
          originalLog.call(console, '[AlphaFutures] 📦 Final data before submit:', purchaseData);
          
          // Submit after short delay
          setTimeout(() => {
            submitPurchase();
          }, 500);
        });
      }
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // TRACKER UI INTEGRATION
  // ═══════════════════════════════════════════════════════════════════
  
  function initTrackerUI() {
    if (typeof window.TrackerUI === 'undefined') {
      originalLog.call(console, '[AlphaFutures] ⚠️ TrackerUI not available, retrying...');
      setTimeout(initTrackerUI, 500);
      return null;
    }
    
    tracker = new window.TrackerUI({
      partner: PARTNER,
      partnerName: PARTNER_NAME,
      fields: ['coupon', 'product', 'price', 'email', 'user_id', 'order_id'],
      fieldLabels: {
        coupon: 'Coupon Code',
        product: 'Account',
        price: 'Price',
        email: 'Email',
        user_id: 'Profile ID',
        order_id: 'Transaction ID'
      },
      afterPurchaseFields: ['order_id']
    });
    
    window.__pfcTracker = tracker;
    originalLog.call(console, '[AlphaFutures] ✅ TrackerUI initialized');
    return tracker;
  }
  
  function showTracker() {
    const t = tracker || initTrackerUI();
    if (t) {
      t.show();
      setStatus('waiting', 'Ready to track purchase');
      updateTrackerUI();
    }
  }
  
  function setStatus(status, message) {
    captureStatus = status;
    const t = tracker || window.__pfcTracker;
    if (t) {
      t.setStatus(status, message);
    }
  }
  
  function updateTrackerUI() {
    const t = tracker || window.__pfcTracker;
    if (!t) return;
    
    if (purchaseData.product_name || purchaseData.account_size) {
      t.updateField('product', purchaseData.product_name || purchaseData.account_size);
    }
    
    if (purchaseData.final_price) {
      const priceDisplay = purchaseData.original_price && purchaseData.original_price > purchaseData.final_price
        ? `$${purchaseData.final_price} (was $${purchaseData.original_price})`
        : `$${purchaseData.final_price}`;
      t.updateField('price', priceDisplay);
    }
    
    if (purchaseData.coupon_code) {
      t.updateField('coupon', purchaseData.coupon_code);
    }

    if (purchaseData.email) {
      t.updateField('email', purchaseData.email);
    }

    if (purchaseData.user_id) {
      t.updateField('user_id', purchaseData.user_id);
    }

    if (purchaseData.transaction_id) {
      t.updateField('order_id', purchaseData.transaction_id);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // SUBMIT PURCHASE TO API
  // ═══════════════════════════════════════════════════════════════════
  
  function submitPurchase() {
    if (captureStatus === 'submitting') {
      originalLog.call(console, '[AlphaFutures] ⏭️ Already submitting, skipping');
      return;
    }
    
    if (!purchaseData.transaction_id) {
      originalLog.call(console, '[AlphaFutures] ❌ Cannot submit - missing transaction ID');
      return;
    }
    
    // Check synced email before submitting
    chrome.storage.local.get(['email'], (stored) => {
      const syncedEmail = stored.email?.toLowerCase()?.trim();
      const websiteEmail = purchaseData.email?.toLowerCase()?.trim();
      
      originalLog.call(console, '[AlphaFutures] 📧 Email check - Synced:', syncedEmail || '(not set)', '| Website:', websiteEmail);
      
      // Logic:
      // - No synced email → Push (website can set email later)
      // - Synced email matches → Push
      // - Synced email doesn't match → Block
      if (syncedEmail && websiteEmail && syncedEmail !== websiteEmail) {
        originalLog.call(console, '[AlphaFutures] ❌ Email mismatch! Synced:', syncedEmail, '≠ Website:', websiteEmail);
        setStatus('error', 'Email mismatch');
        const t = tracker || window.__pfcTracker;
        if (t) {
          t.showMessage('error', `Email mismatch: Your extension email (${syncedEmail}) doesn't match the website (${websiteEmail}). Update your rewards email on Alpha Futures to match.`);
        }
        return;
      }
      
      if (!syncedEmail) {
        originalLog.call(console, '[AlphaFutures] ℹ️ No synced email - will push with website email');
      } else {
        originalLog.call(console, '[AlphaFutures] ✅ Emails match - proceeding');
      }
      
      doSubmit();
    });
  }
  
  function doSubmit() {
    setStatus('submitting', 'Submitting to API...');
    
    const payload = {
      partner: PARTNER,
      email: purchaseData.email,
      customer_name: purchaseData.customer_name,
      product_name: purchaseData.product_name || purchaseData.account_size,
      account_size: purchaseData.account_size,
      account_type: purchaseData.account_type,
      original_price: purchaseData.original_price,
      final_price: purchaseData.final_price,
      discount_amount: purchaseData.original_price && purchaseData.final_price 
        ? purchaseData.original_price - purchaseData.final_price 
        : null,
      discount_percent: purchaseData.discount_percent,
      coupon_code: purchaseData.coupon_code,
      order_number: purchaseData.transaction_id,
      transaction_id: purchaseData.transaction_id,
      user_id: purchaseData.user_id,
      checkout_url: window.location.href
    };
    
    originalLog.call(console, '[AlphaFutures] 📤 Submitting:', JSON.stringify(payload, null, 2));
    
    // First capture
    chrome.runtime.sendMessage({
      action: 'CAPTURE_PURCHASE',
      data: payload
    }, (captureResponse) => {
      if (chrome.runtime.lastError) {
        originalLog.call(console, '[AlphaFutures] ❌ Capture error:', chrome.runtime.lastError);
        setStatus('error', 'Error submitting');
        return;
      }
      
      originalLog.call(console, '[AlphaFutures] ✅ Captured:', captureResponse);
      
      // Then trigger success
      chrome.runtime.sendMessage({
        action: 'SUCCESS_DETECTED',
        data: {
          partner: PARTNER,
          order_number: purchaseData.transaction_id,
          email: purchaseData.email,
          coupon_code: purchaseData.coupon_code,
          successData: payload
        }
      }, (successResponse) => {
        if (chrome.runtime.lastError) {
          originalLog.call(console, '[AlphaFutures] ❌ Success trigger error:', chrome.runtime.lastError);
          return;
        }
        
        originalLog.call(console, '[AlphaFutures] ✅ Success response:', successResponse);
        
        // Clear stored payment data
        clearStoredData();
        
        const t = tracker || window.__pfcTracker;
        if (t) {
          if (successResponse?.skipped) {
            setStatus('success', 'Already tracked');
            t.showMessage('success', 'This purchase was already tracked!');
          } else if (successResponse?.success) {
            setStatus('success', 'Reward tracked!');
            t.showMessage('success', 'Your purchase has been submitted for rewards! 🎉');
          }
        }
        
        // Reset for potential next purchase after delay
        setTimeout(() => {
          resetForNextPurchase();
        }, 5000);
      });
    });
  }
  
  function resetForNextPurchase() {
    // Keep email/user info, reset purchase-specific data
    const { email, customer_name, user_id } = purchaseData;
    
    Object.assign(purchaseData, {
      email,
      customer_name,
      user_id,
      product_name: null,
      account_size: null,
      account_type: null,
      original_price: null,
      final_price: null,
      discount_percent: null,
      coupon_code: null,
      transaction_id: null,
      platform: null
    });
    
    purchaseComplete = false;
    captureStatus = 'idle';
    setStatus('waiting', 'Ready to track next purchase');
    
    // Clear the UI fields properly (not updateField which would show "null")
    const t = tracker || window.__pfcTracker;
    if (t && t.clearField) {
      t.clearField('product');
      t.clearField('price');
      t.clearField('coupon');
      t.clearField('order_id');
      // Keep email displayed
      if (email) {
        t.updateField('email', email);
      }
    }
    
    originalLog.call(console, '[AlphaFutures] 🔄 Reset for next purchase');
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // DOM EXTRACTION - Capture data from checkout page
  // ═══════════════════════════════════════════════════════════════════
  
  function extractFromDOM() {
    try {
      const pageText = document.body?.innerText || '';
      let foundNew = false;
      
      // Extract coupon code from input field or applied badge
      // Look for coupon input with value
      const couponInputs = document.querySelectorAll('input[placeholder*="coupon" i], input[placeholder*="code" i]');
      for (const input of couponInputs) {
        if (input.value && input.value.length >= 2 && input.value.length <= 20) {
          const newCoupon = input.value.toUpperCase();
          if (newCoupon !== purchaseData.coupon_code) {
            purchaseData.coupon_code = newCoupon;
            originalLog.call(console, '[AlphaFutures] 🎫 Coupon from DOM:', purchaseData.coupon_code);
            foundNew = true;
          }
          break;
        }
      }
      
      // Also check for "Applied" badge near coupon text
      if (!purchaseData.coupon_code) {
        const appliedMatch = pageText.match(/([A-Z0-9]{2,15})\s*Applied/i);
        if (appliedMatch) {
          const newCoupon = appliedMatch[1].toUpperCase();
          if (newCoupon !== purchaseData.coupon_code) {
            purchaseData.coupon_code = newCoupon;
            originalLog.call(console, '[AlphaFutures] 🎫 Coupon from Applied badge:', purchaseData.coupon_code);
            foundNew = true;
          }
        }
      }
      
      // Extract account size (50K, 100K, 150K) - ALWAYS check for changes
      const sizeMatch = pageText.match(/Account\s*Size\s*(\d+K)/i);
      if (sizeMatch) {
        const newSize = sizeMatch[1];
        if (newSize !== purchaseData.account_size) {
          const oldSize = purchaseData.account_size;
          purchaseData.account_size = newSize;
          purchaseData.product_name = newSize;
          originalLog.call(console, '[AlphaFutures] 📦 Account size changed:', oldSize, '→', purchaseData.account_size);
          foundNew = true;
          
          // Reset prices when account size changes - they'll be recaptured
          purchaseData.original_price = null;
          purchaseData.final_price = null;
          purchaseData.discount_percent = null;
          
          // Plan change often clears coupon - re-apply after short delay
          if (oldSize) {
            originalLog.call(console, '[AlphaFutures] 🔄 Plan changed - will re-apply coupon if needed');
            setTimeout(() => {
              checkAndReapplyCoupon();
            }, 1000);
          }
        }
      }
      
      // Extract account type (Zero Plan, Advanced Plan, Standard Plan) - ALWAYS check for changes
      const typeMatch = pageText.match(/Account\s*Type\s*(Zero\s*Plan|Advanced\s*Plan|Standard\s*Plan)/i);
      if (typeMatch) {
        const newType = typeMatch[1];
        if (newType !== purchaseData.account_type) {
          const oldType = purchaseData.account_type;
          purchaseData.account_type = newType;
          originalLog.call(console, '[AlphaFutures] 📋 Account type changed:', oldType, '→', purchaseData.account_type);
          foundNew = true;
          
          // Account type change may also clear coupon
          if (oldType) {
            originalLog.call(console, '[AlphaFutures] 🔄 Account type changed - will re-apply coupon if needed');
            setTimeout(() => {
              checkAndReapplyCoupon();
            }, 1000);
          }
        }
      }
      
      // Extract prices from page text - ALWAYS update (they change with plan selection)
      // Look for "Price $419.00" pattern (original price before discount)
      const priceMatch = pageText.match(/Price\s*\$?([\d,]+(?:\.\d{2})?)/i);
      if (priceMatch) {
        const newPrice = parseFloat(priceMatch[1].replace(/,/g, ''));
        if (newPrice !== purchaseData.original_price) {
          purchaseData.original_price = newPrice;
          originalLog.call(console, '[AlphaFutures] 💰 Original price:', purchaseData.original_price);
          foundNew = true;
        }
      }
      
      // Look for "Total Price $377.1" pattern (final price after discount)
      const totalMatch = pageText.match(/Total\s*Price\s*\$?([\d,]+(?:\.\d{1,2})?)/i);
      if (totalMatch) {
        const newTotal = parseFloat(totalMatch[1].replace(/,/g, ''));
        if (newTotal !== purchaseData.final_price) {
          purchaseData.final_price = newTotal;
          originalLog.call(console, '[AlphaFutures] 💵 Final price:', purchaseData.final_price);
          foundNew = true;
        }
      }
      
      // Extract email from billing details (only if not already set)
      if (!purchaseData.email) {
        const emailMatch = pageText.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        if (emailMatch) {
          purchaseData.email = emailMatch[1];
          originalLog.call(console, '[AlphaFutures] 📧 Email from DOM:', purchaseData.email);
          foundNew = true;
        }
      }
      
      // Calculate discount if we have both prices
      if (purchaseData.original_price && purchaseData.final_price) {
        if (purchaseData.original_price > purchaseData.final_price) {
          const newDiscount = Math.round(
            ((purchaseData.original_price - purchaseData.final_price) / purchaseData.original_price) * 100
          );
          if (newDiscount !== purchaseData.discount_percent) {
            purchaseData.discount_percent = newDiscount;
            originalLog.call(console, '[AlphaFutures] 🏷️ Discount:', purchaseData.discount_percent + '%');
            foundNew = true;
          }
        }
      }
      
      if (foundNew) {
        updateTrackerUI();
        // Store data for Safecharge page (so it has coupon, original price, etc.)
        storeCheckoutData();
      }
      
      return foundNew;
    } catch (e) {
      originalLog.call(console, '[AlphaFutures] ⚠️ Error extracting from DOM:', e.message);
      return false;
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // AUTOFILL FUNCTIONALITY
  // ═══════════════════════════════════════════════════════════════════
  
  // Check if coupon is still applied, re-apply if cleared (e.g., after plan change)
  async function checkAndReapplyCoupon() {
    const pageText = document.body?.innerText || '';
    const referralCode = localStorage.getItem('urlReferralCode') || 'LAB';
    
    // Check if coupon is still showing as applied
    const hasAppliedBadge = pageText.includes('Applied') && pageText.includes(referralCode);
    
    // Check if coupon input has a value
    const couponInputs = document.querySelectorAll('input[placeholder*="coupon" i], input[placeholder*="code" i]');
    let inputHasValue = false;
    for (const input of couponInputs) {
      if (input.value && input.value.length > 0) {
        inputHasValue = true;
        break;
      }
    }
    
    // If coupon is NOT applied, re-apply it
    if (!hasAppliedBadge && !inputHasValue) {
      originalLog.call(console, '[AlphaFutures] 🔄 Coupon was cleared - re-applying...');
      
      // Clear the stored coupon so autofill will re-apply
      purchaseData.coupon_code = null;
      
      // Re-run autofill
      await tryAutofill();
    } else {
      originalLog.call(console, '[AlphaFutures] ✅ Coupon still applied');
    }
  }
  
  async function tryAutofill() {
    // Only on checkout pages
    if (!window.location.pathname.includes('checkout') && 
        !window.location.pathname.includes('Assessments-checkout')) {
      return;
    }
    
    // Check if LAB code should be applied
    const referralCode = localStorage.getItem('urlReferralCode') || 'LAB';
    
    originalLog.call(console, '[AlphaFutures] 🔧 Attempting autofill with code:', referralCode);
    
    // Wait for coupon field to appear
    const couponInput = await waitForElement("input[placeholder='Enter Coupon Code'], input[placeholder*='coupon' i], input[name*='coupon' i]", 5000);
    
    if (!couponInput) {
      originalLog.call(console, '[AlphaFutures] ⚠️ Coupon input not found');
      return;
    }
    
    // Check if already filled
    if (couponInput.value && couponInput.value.length > 0) {
      originalLog.call(console, '[AlphaFutures] ℹ️ Coupon field already has value:', couponInput.value);
      // Capture the existing coupon code
      if (!purchaseData.coupon_code) {
        purchaseData.coupon_code = couponInput.value.toUpperCase();
        originalLog.call(console, '[AlphaFutures] 🎫 Captured existing coupon:', purchaseData.coupon_code);
        updateTrackerUI();
        // Store to localStorage for Safecharge page
        storeCheckoutData();
      }
      return;
    }
    
    // Fill the coupon code
    couponInput.focus();
    couponInput.value = referralCode;
    couponInput.dispatchEvent(new Event('input', { bubbles: true }));
    couponInput.dispatchEvent(new Event('change', { bubbles: true }));
    couponInput.dispatchEvent(new Event('blur', { bubbles: true }));
    
    originalLog.call(console, '[AlphaFutures] ✅ Filled coupon code:', referralCode);
    
    // Look for apply button
    await sleep(500);
    
    const applyButton = document.querySelector("button");
    const buttons = document.querySelectorAll('button');
    
    for (const btn of buttons) {
      const text = btn.textContent?.toLowerCase() || '';
      if (text.includes('apply')) {
        btn.click();
        originalLog.call(console, '[AlphaFutures] ✅ Clicked apply button');
        
        // Capture the coupon code we just applied
        purchaseData.coupon_code = referralCode.toUpperCase();
        updateTrackerUI();
        // Store to localStorage for Safecharge page
        storeCheckoutData();
        
        const t = tracker || window.__pfcTracker;
        if (t) {
          t.setAutoFillStatus('success', `Code "${referralCode}" applied`);
        }
        
        // Extract other data from DOM after coupon is applied
        setTimeout(() => {
          extractFromDOM();
        }, 1500);
        
        break;
      }
    }
  }
  
  // Helper function to store checkout data for Safecharge page
  // Uses chrome.storage.local which is shared across all domains
  function storeCheckoutData() {
    const dataToStore = {
      email: purchaseData.email,
      customer_name: purchaseData.customer_name,
      user_id: purchaseData.user_id,
      account_size: purchaseData.account_size,
      account_type: purchaseData.account_type,
      original_price: purchaseData.original_price,
      final_price: purchaseData.final_price,
      discount_percent: purchaseData.discount_percent,
      coupon_code: purchaseData.coupon_code,
      captured_at: Date.now()
    };
    
    // Use chrome.storage.local (shared across domains) instead of localStorage
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ [STORAGE_KEY]: dataToStore }, () => {
        originalLog.call(console, '[AlphaFutures] 💾 Stored checkout data to chrome.storage:', dataToStore);
      });
    } else {
      // Fallback to localStorage (won't work cross-domain but better than nothing)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToStore));
      originalLog.call(console, '[AlphaFutures] 💾 Stored checkout data to localStorage:', dataToStore);
    }
  }
  
  function waitForElement(selector, timeout = 5000) {
    return new Promise((resolve) => {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }
      
      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });
      
      observer.observe(document.body, { childList: true, subtree: true });
      
      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }
  
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════
  
  function isCheckoutPage() {
    const path = window.location.pathname.toLowerCase();
    return path.includes('checkout') || path.includes('assessments-checkout');
  }
  
  let trackerShown = false;
  
  function init() {
    originalLog.call(console, '[AlphaFutures] 🎬 Initializing adapter...');
    
    // Initialize TrackerUI (but don't show yet)
    initTrackerUI();
    
    // Try to restore any data from payment page (localStorage first)
    restoreFromPaymentPage();
    
    // Also try chrome.storage (async)
    restoreFromChromeStorage(() => {
      // Log restored data
      if (purchaseData.email || purchaseData.account_size) {
        originalLog.call(console, '[AlphaFutures] 📥 Data restored:', {
          email: purchaseData.email,
          account_size: purchaseData.account_size,
          final_price: purchaseData.final_price
        });
      }
    });
    
    // Show tracker immediately if on checkout page
    if (isCheckoutPage()) {
      originalLog.call(console, '[AlphaFutures] 💳 Checkout page detected');
      showTracker();
      trackerShown = true;
      
      // Extract data from DOM
      setTimeout(() => {
        extractFromDOM();
      }, 1000);
      
      // Try autofill after short delay
      setTimeout(() => {
        tryAutofill();
      }, 1500);
      
      // Then extract again after autofill might have applied
      setTimeout(() => {
        extractFromDOM();
      }, 3000);
    }
    
    // Poll for DOM changes on checkout pages (capture coupon, prices, etc.)
    setInterval(() => {
      if (isCheckoutPage() && !purchaseComplete) {
        extractFromDOM();
      }
    }, 2000);
    
    // Check if we're on success page already
    checkForSuccess();
    
    // Monitor URL changes (for SPA navigation) - simple polling, no MutationObserver
    let lastUrl = window.location.href;
    setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        originalLog.call(console, '[AlphaFutures] 🔗 URL changed:', lastUrl);
        
        // Show tracker when entering checkout (only once)
        if (isCheckoutPage() && !trackerShown) {
          showTracker();
          trackerShown = true;
          tryAutofill();
        }
        
        checkForSuccess();
      }
    }, 500);
    
    // NO MutationObserver - it was causing infinite loops and crashes
    
    originalLog.call(console, '[AlphaFutures] ✅ Adapter initialized');
  }
  
  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
})();
