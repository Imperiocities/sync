/**
 * TAKEPROFITTRADER ADAPTER v5.1
 * 
 * Staged Capture with Visual Widget (using shared TrackerUI)
 * 
 * Supports TWO purchase flows:
 * 
 * 1. NEW ACCOUNT PURCHASE (checkout modal)
 *    - Captures via checkout modal (.account-flow-modal)
 *    - Supports coupon code autofill
 *    - Waits for /Accounts/pending API for account_id
 * 
 * 2. ACCOUNT RESET (control center page)
 *    - Triggered by RESET button click on existing account
 *    - Account ID captured from clicked row
 *    - NO coupon codes (not supported for resets)
 *    - Submits immediately on nuveiResponse APPROVED
 * 
 * DATA CAPTURE - NEW PURCHASE:
 * | Stage | Trigger                  | Data Captured                              |
 * |-------|--------------------------|---------------------------------------------|
 * | 1     | Page load                | email, name, user_id (JWT cookie)          |
 * | 2     | Page load                | product_name, original_price (localStorage)|
 * | 3     | Page load                | coupon_code (localStorage)                 |
 * | 4     | Pricing modal visible    | discount_percent, final_price (DOM)        |
 * | 5     | `nuveiResponse APPROVED` | Validate all data present                  |
 * | 6     | /Accounts/pending API    | account_id (Network intercept)             |
 * | 7     | All complete             | Push to API                                |
 * 
 * DATA CAPTURE - RESET:
 * | Stage | Trigger                  | Data Captured                              |
 * |-------|--------------------------|---------------------------------------------|
 * | 1     | RESET button click       | account_id, product_name, price (from row) |
 * | 2     | `nuveiResponse APPROVED` | transaction_id                             |
 * | 3     | Immediate                | Push to API                                |
 */

// ═══════════════════════════════════════════════════════════════════════════
// NETWORK INTERCEPTION - MUST BE FIRST!
// ═══════════════════════════════════════════════════════════════════════════

(function() {
  'use strict';
  
  // Prevent double initialization
  if (window.__tptAdapterV5Installed) return;
  window.__tptAdapterV5Installed = true;
  
  const originalLog = console.log;
  const PARTNER = 'takeprofittrader';
  
  // Product mapping for TPT subscription IDs
  const TPT_PRODUCTS = {
    2: { name: '25K', price: 150 },
    3: { name: '50K', price: 170 },
    4: { name: '75K', price: 245 },
    5: { name: '100K', price: 330 },
    6: { name: '150K', price: 360 }
  };
  
  // ═══════════════════════════════════════════════════════════════════
  // PURCHASE DATA STATE
  // ═══════════════════════════════════════════════════════════════════
  
  const purchaseData = {
    email: null,
    customer_name: null,
    user_id: null,
    product_name: null,
    original_price: null,
    discount_percent: null,
    final_price: null,
    coupon_code: null,
    account_id: null,
    transaction_id: null,
    platform: null,
    purchase_type: 'new'  // 'new' for new account, 'reset' for account reset
  };
  
  // Reset pricing - flat $100 for all account sizes
  const RESET_PRICE = 100;
  
  let captureStatus = 'initializing';
  let tracker = null;
  let lastSeenAccountSizeId = null;
  let couponConfirmed = false;  // Only true after network confirms promo code applied
  let previousFirstAccountId = null;  // The first account ID BEFORE purchase (to detect new one)
  let watchingForNewAccount = false;  // True after payment success, waiting for new account in DOM
  let resetFlowActive = false;  // True when user clicked RESET button
  
  // ═══════════════════════════════════════════════════════════════════
  // NETWORK INTERCEPTION (for account_id from /Accounts/pending)
  // ═══════════════════════════════════════════════════════════════════
  
  const originalFetch = window.fetch;
  
  window.fetch = async function(...args) {
    const [resource, options] = args;
    const url = typeof resource === 'string' ? resource : resource?.url || '';
    
    // Call original fetch
    const response = await originalFetch.apply(this, args);
    
    // Only process TPT API calls
    if (url.includes('takeprofittrader.com')) {
      // Clone response IMMEDIATELY before any processing
      const clone = response.clone();
      
      // Process async (don't block the response)
      processInterceptedRequest(url, options, clone).catch((e) => {
        originalLog.call(console, '[TPT] Process error:', e.message);
      });
    }
    
    return response;
  };
  
  // XHR interception (backup)
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._tptUrl = url;
    this._tptMethod = method;
    return originalOpen.apply(this, [method, url, ...rest]);
  };
  
  XMLHttpRequest.prototype.send = function(body) {
    this._tptBody = body;
    
    this.addEventListener('load', function() {
      if (this._tptUrl && this._tptUrl.includes('takeprofittrader.com')) {
        processInterceptedXHR(this._tptUrl, this._tptBody, this.responseText).catch(() => {});
      }
    });
    
    return originalSend.apply(this, [body]);
  };
  
  originalLog.call(console, '[TPT] ✅ Network interception installed');
  
  async function processInterceptedRequest(url, options, response) {
    try {
      const body = options?.body ? JSON.parse(options.body) : null;
      const data = await response.json();
      const urlLower = url.toLowerCase();
      
      // ─────────────────────────────────────────────────────────────────────
      // PROMO CODE VALIDATION - This confirms the coupon is actually applied!
      // ─────────────────────────────────────────────────────────────────────
      if (urlLower.includes('/promocodes/validate') && data?.isSuccess) {
        purchaseData.coupon_code = body?.code || null;
        purchaseData.original_price = body?.amount || null;
        purchaseData.discount_percent = data.result?.discount || null;
        purchaseData.final_price = data.result?.total || null;
        
        // NOW the coupon is confirmed as applied
        couponConfirmed = true;
        
        originalLog.call(console, '[TPT] 🎫 Promo CONFIRMED:', purchaseData.coupon_code);
        originalLog.call(console, '[TPT]    Original:', purchaseData.original_price);
        originalLog.call(console, '[TPT]    Discount:', purchaseData.discount_percent + '%');
        originalLog.call(console, '[TPT]    Final:', purchaseData.final_price);
        
        updateTrackerUI();
        setStatus('waiting', 'Discount applied ✓');
      }
      
      // ─────────────────────────────────────────────────────────────────────
      // ACCOUNT PENDING (product selected, account created) - KEY FOR ACCOUNT ID!
      // ─────────────────────────────────────────────────────────────────────
      else if (urlLower.includes('/accounts/pending') && data?.isSuccess) {
        const subId = body?.SubscriptionId;
        const product = TPT_PRODUCTS[subId];
        
        purchaseData.product_name = product?.name || `Subscription ${subId}`;
        purchaseData.account_id = String(data.result);  // THIS IS THE CORRECT ACCOUNT ID!
        purchaseData.platform = body?.PlatformType === 1 ? 'CQG' : 'Rithmic';
        
        // Set original price if not already set by promo validation
        if (!purchaseData.original_price && product) {
          purchaseData.original_price = product.price;
        }
        
        originalLog.call(console, '[TPT] 📦 Account created:', purchaseData.account_id);
        originalLog.call(console, '[TPT]    Product:', purchaseData.product_name);
        originalLog.call(console, '[TPT]    Platform:', purchaseData.platform);
        
        updateTrackerUI();
      }
      
      // ─────────────────────────────────────────────────────────────────────
      // SUBSCRIPTION SUCCESS - PURCHASE COMPLETE!
      // ─────────────────────────────────────────────────────────────────────
      else if (urlLower.includes('/subscriptions/nuvei') && data?.isSuccess) {
        purchaseData.transaction_id = body?.transactionId || null;
        
        // Fallback: get account_id from request if we missed /Accounts/pending
        if (!purchaseData.account_id && body?.info?.accountId) {
          purchaseData.account_id = String(body.info.accountId);
        }
        
        originalLog.call(console, '[TPT] 🎉 PURCHASE COMPLETE (Network)!');
        originalLog.call(console, '[TPT]    Order (account_id):', purchaseData.account_id);
        originalLog.call(console, '[TPT]    Transaction:', purchaseData.transaction_id);
        
        // If we have account_id, submit immediately
        if (purchaseData.account_id) {
          submitPurchase();
        } else {
          // Otherwise, start watching for new account in DOM
          originalLog.call(console, '[TPT] ⏳ No account_id yet, watching DOM for new account...');
          startWatchingForNewAccount();
        }
      }
      
    } catch (e) {
      // JSON parse failed - not a JSON response, ignore
    }
  }
  
  async function processInterceptedXHR(url, requestBody, responseText) {
    try {
      const body = requestBody ? JSON.parse(requestBody) : null;
      const data = responseText ? JSON.parse(responseText) : null;
      const urlLower = url.toLowerCase();
      
      // PROMO VALIDATION - Confirms coupon is applied
      if (urlLower.includes('/promocodes/validate') && data?.isSuccess) {
        purchaseData.coupon_code = body?.code || null;
        purchaseData.original_price = body?.amount || null;
        purchaseData.discount_percent = data.result?.discount || null;
        purchaseData.final_price = data.result?.total || null;
        
        // NOW the coupon is confirmed as applied
        couponConfirmed = true;
        
        originalLog.call(console, '[TPT] 🎫 Promo CONFIRMED (XHR):', purchaseData.coupon_code);
        updateTrackerUI();
        setStatus('waiting', 'Discount applied ✓');
      }
      
      // ACCOUNT PENDING - KEY FOR ACCOUNT ID!
      else if (urlLower.includes('/accounts/pending') && data?.isSuccess) {
        const subId = body?.SubscriptionId;
        const product = TPT_PRODUCTS[subId];
        
        purchaseData.product_name = product?.name || `Subscription ${subId}`;
        purchaseData.account_id = String(data.result);
        purchaseData.platform = body?.PlatformType === 1 ? 'CQG' : 'Rithmic';
        
        if (!purchaseData.original_price && product) {
          purchaseData.original_price = product.price;
        }
        
        originalLog.call(console, '[TPT] 📦 Account created (XHR):', purchaseData.account_id);
        updateTrackerUI();
      }
      
      // SUBSCRIPTION SUCCESS
      else if (urlLower.includes('/subscriptions/nuvei') && data?.isSuccess) {
        purchaseData.transaction_id = body?.transactionId || null;
        
        if (!purchaseData.account_id && body?.info?.accountId) {
          purchaseData.account_id = String(body.info.accountId);
        }
        
        originalLog.call(console, '[TPT] 🎉 PURCHASE COMPLETE (XHR)!');
        
        // If we have account_id, submit immediately
        if (purchaseData.account_id) {
          submitPurchase();
        } else {
          // Otherwise, start watching for new account in DOM
          originalLog.call(console, '[TPT] ⏳ No account_id yet, watching DOM for new account...');
          startWatchingForNewAccount();
        }
      }
      
    } catch (e) {
      // JSON parse failed - ignore
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // TRACKER UI (Using shared TrackerUI)
  // ═══════════════════════════════════════════════════════════════════
  
  function initTracker() {
    if (window.__pfcTracker) {
      tracker = window.__pfcTracker;
      return tracker;
    }
    
    if (!window.TrackerUI) {
      originalLog.call(console, '[TPT] ⚠️ TrackerUI not loaded yet, retrying...');
      return null;
    }
    
    tracker = new window.TrackerUI({
      partner: PARTNER,
      partnerName: 'Take Profit Trader',
      fields: ['coupon', 'product', 'price', 'email', 'order_id'],
      fieldLabels: {
        coupon: 'Coupon Code',
        product: 'Account',
        price: 'Price',
        email: 'Email',
        order_id: 'Account ID'
      },
      afterPurchaseFields: ['order_id']
    });
    
    window.__pfcTracker = tracker;
    originalLog.call(console, '[TPT] ✅ TrackerUI initialized');
    return tracker;
  }
  
  function showTracker() {
    const t = tracker || initTracker();
    if (t) {
      t.show();
      updateTrackerUI();
    }
  }
  
  function updateTrackerUI() {
    const t = tracker || window.__pfcTracker;
    if (!t) return;
    
    const isReset = purchaseData.purchase_type === 'reset';
    
    if (purchaseData.product_name) {
      t.updateField('product', purchaseData.product_name);
    }
    
    // Show price: full price until coupon confirmed, then discounted (resets don't have discounts)
    if (purchaseData.original_price) {
      if (!isReset && couponConfirmed && purchaseData.final_price && purchaseData.final_price < purchaseData.original_price) {
        // Coupon confirmed - show discounted price with strikethrough
        t.updateField('price', purchaseData.final_price, t.formatPrice(purchaseData.original_price, purchaseData.final_price));
      } else {
        // No coupon or reset flow - show full price
        t.updateField('price', purchaseData.original_price, `$${purchaseData.original_price}`);
      }
    }
    
    if (purchaseData.email) {
      t.updateField('email', purchaseData.email);
    }
    
    // Coupon handling: for resets show "N/A", for new purchases show when confirmed
    if (isReset) {
      t.updateField('coupon', 'N/A', 'Not available for resets');
    } else if (couponConfirmed && purchaseData.coupon_code) {
      t.updateField('coupon', purchaseData.coupon_code);
    }
    
    if (purchaseData.account_id) {
      t.updateField('order_id', purchaseData.account_id);
    }
  }
  
  function setStatus(status, text) {
    captureStatus = status;
    originalLog.call(console, `[TPT] 📊 Status: ${status}`);
    
    const t = tracker || window.__pfcTracker;
    if (t) {
      t.setStatus(status, text || status);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // EARLY EMAIL VALIDATION - Warn before purchase, not after
  // ═══════════════════════════════════════════════════════════════════
  
  function checkEmailBeforePurchase() {
    const t = tracker || window.__pfcTracker;
    if (!t) return;
    
    // Get TPT email (from JWT - what user has on TPT)
    const tptWebsiteEmail = purchaseData.email?.toLowerCase()?.trim();
    
    // Get extension's configured email for TPT (check firm-specific first, then general)
    chrome.storage.local.get(['rewards_emails', 'email'], (stored) => {
      // Debug: Log the full storage data
      originalLog.call(console, '[TPT] 📧 Storage check - rewards_emails:', JSON.stringify(stored.rewards_emails || {}));
      
      // Check for both key formats: 'take-profit-trader' (API format) and 'takeprofittrader' (legacy)
      const firmSpecificEmail = (
        stored.rewards_emails?.['take-profit-trader'] || 
        stored.rewards_emails?.['takeprofittrader'] ||
        stored.rewards_emails?.['TakeProfitTrader']
      )?.toLowerCase()?.trim();
      
      const generalEmail = stored.email?.toLowerCase()?.trim();
      const extensionTptEmail = firmSpecificEmail || generalEmail;
      
      originalLog.call(console, '[TPT] 📧 Email check:');
      originalLog.call(console, '[TPT]    TPT website:', tptWebsiteEmail || '(not set)');
      originalLog.call(console, '[TPT]    Extension (firm-specific):', firmSpecificEmail || '(not set)');
      originalLog.call(console, '[TPT]    Extension (general):', generalEmail || '(not set)');
      originalLog.call(console, '[TPT]    Using for comparison:', extensionTptEmail || '(none)');
      
      if (!extensionTptEmail) {
        // No email configured in extension at all
        originalLog.call(console, '[TPT] ❌ No email in extension - BLOCKING');
        t.showMessage('error', '⚠️ Please log in to the extension to track your rewards!');
        setStatus('error', 'Login required');
      } else if (!tptWebsiteEmail) {
        // Can't get email from TPT website
        originalLog.call(console, '[TPT] ⚠️ Could not get email from TPT website');
        t.showMessage('warning', '⚠️ Could not verify TPT email. Make sure you are logged in.');
        setStatus('warning', 'Cannot verify');
      } else if (extensionTptEmail !== tptWebsiteEmail) {
        // Emails don't match - show which email type is being used
        const emailSource = firmSpecificEmail ? 'TPT-specific' : 'general';
        originalLog.call(console, `[TPT] ❌ Email mismatch! Using ${emailSource} email from extension`);
        t.showMessage('error', `⚠️ Email mismatch! TPT: ${tptWebsiteEmail} ≠ Extension (${emailSource}): ${extensionTptEmail}. Update your emails to match.`);
        setStatus('warning', 'Email mismatch');
      } else {
        // Emails match - good to go
        originalLog.call(console, '[TPT] ✅ Emails match - ready for purchase');
        t.showMessage('success', '✅ Emails verified - ready to track purchase!');
      }
    });
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // STAGE 1: USER DATA
  // - Email comes from extension storage (set during login)
  // - Website rewards email from data attribute (for verification only)
  // - Customer name/user_id from JWT cookie
  // ═══════════════════════════════════════════════════════════════════
  
  function captureUser() {
    try {
      // Get email from TPT website (JWT cookie) - this is what user has on TPT
      const match = document.cookie.match(/access_token=([^;]+)/);
      if (match) {
        const parts = match[1].split('.');
        if (parts.length >= 2) {
          let payload = parts[1];
          payload += '='.repeat((4 - payload.length % 4) % 4);
          const decoded = JSON.parse(atob(payload));
          
          purchaseData.email = decoded.email || null;
          purchaseData.customer_name = [decoded.given_name, decoded.family_name].filter(Boolean).join(' ') || null;
          purchaseData.user_id = decoded.sub || null;
          
          originalLog.call(console, '[TPT] ✅ Stage 1: TPT email -', purchaseData.email);
          updateTrackerUI();
        }
      }
      
      if (!purchaseData.email) {
        originalLog.call(console, '[TPT] ⚠️ Stage 1: No email found on TPT');
      }
      
      return true;
    } catch (e) {
      originalLog.call(console, '[TPT] ⚠️ Stage 1 failed:', e.message);
      return false;
    }
  }
  
  
  // ═══════════════════════════════════════════════════════════════════
  // STAGE 2: PRODUCT FROM LOCALSTORAGE (selectedAccountSizeId)
  // ═══════════════════════════════════════════════════════════════════
  
  function captureProduct() {
    try {
      const sizeId = localStorage.getItem('selectedAccountSizeId');
      if (!sizeId) return false;
      
      const product = TPT_PRODUCTS[parseInt(sizeId, 10)];
      if (!product) {
        originalLog.call(console, '[TPT] ⚠️ Unknown account size ID:', sizeId);
        return false;
      }
      
      purchaseData.product_name = product.name;
      purchaseData.original_price = product.price;
      
      originalLog.call(console, '[TPT] ✅ Stage 2: Product -', purchaseData.product_name, '$' + purchaseData.original_price);
      updateTrackerUI();
      return true;
    } catch (e) {
      originalLog.call(console, '[TPT] ⚠️ Stage 2 failed:', e.message);
      return false;
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // STAGE 3: COUPON FROM LOCALSTORAGE (stored but NOT shown until confirmed)
  // ═══════════════════════════════════════════════════════════════════
  
  function captureCoupon() {
    const coupon = localStorage.getItem('urlReferralCode');
    if (coupon) {
      purchaseData.coupon_code = coupon;
      originalLog.call(console, '[TPT] 📝 Stage 3: Coupon stored (pending confirmation) -', coupon);
      // Don't update tracker yet - wait for network to confirm it's applied
      return true;
    }
    return false;
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // STAGE 4: PRICING FROM DOM - Captures AND confirms discount when visible
  // ═══════════════════════════════════════════════════════════════════
  
  function capturePricing() {
    const modal = document.querySelector('.account-flow-modal') || document.body;
    const modalText = modal.innerText;
    let foundNew = false;
    
    // Look for: Discount 40 % (only appears after code is applied)
    const discountMatch = modalText.match(/Discount\s*(\d+)\s*%/i);
    if (discountMatch) {
      const newDiscount = parseInt(discountMatch[1], 10);
      if (purchaseData.discount_percent !== newDiscount) {
        purchaseData.discount_percent = newDiscount;
        originalLog.call(console, '[TPT] ✅ Stage 4: Discount CONFIRMED from DOM -', purchaseData.discount_percent + '%');
        foundNew = true;
        
        // If we see a discount in DOM, the coupon IS confirmed
        if (!couponConfirmed && purchaseData.discount_percent > 0) {
          couponConfirmed = true;
          // Get coupon from input if we don't have it
          if (!purchaseData.coupon_code) {
            const codeInput = document.querySelector('input[name="code"]');
            if (codeInput && codeInput.value) {
              purchaseData.coupon_code = codeInput.value;
            }
          }
          originalLog.call(console, '[TPT] ✅ Coupon CONFIRMED via DOM discount:', purchaseData.coupon_code);
        }
      }
    }
    
    // Look for: Total $147 / month or Total $147
    const totalMatch = modalText.match(/Total\s*\$(\d+(?:\.\d{2})?)/i) || 
                       modalText.match(/\$(\d+(?:\.\d{2})?)\s*\/\s*month/i);
    if (totalMatch) {
      const newFinal = parseFloat(totalMatch[1]);
      if (purchaseData.final_price !== newFinal) {
        purchaseData.final_price = newFinal;
        originalLog.call(console, '[TPT] ✅ Stage 4: Final price -', '$' + purchaseData.final_price);
        foundNew = true;
      }
    }
    
    // Look for: Amount $245 (original price)
    const amountMatch = modalText.match(/Amount\s*\$(\d+(?:\.\d{2})?)/i);
    if (amountMatch) {
      const origPrice = parseFloat(amountMatch[1]);
      if (!purchaseData.original_price || purchaseData.original_price !== origPrice) {
        purchaseData.original_price = origPrice;
        originalLog.call(console, '[TPT] ✅ Stage 4: Original price -', '$' + purchaseData.original_price);
        foundNew = true;
      }
    }
    
    if (foundNew) {
      updateTrackerUI();
    }
    
    return purchaseData.discount_percent !== null && purchaseData.final_price !== null;
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // STAGE 5: WATCH CONSOLE FOR PAYMENT SUCCESS (Backup trigger)
  // ═══════════════════════════════════════════════════════════════════
  
  console.log = function(...args) {
    originalLog.apply(console, args);
    
    for (const arg of args) {
      if (arg && typeof arg === 'object' && arg.result === 'APPROVED' && arg.transactionId) {
        originalLog.call(console, '[TPT] 🎯 PAYMENT APPROVED (Console)!');
        purchaseData.transaction_id = arg.transactionId;
        
        const t = tracker || window.__pfcTracker;
        if (t) {
          const message = resetFlowActive ? 'Reset payment approved! 🎉' : 'Payment approved! 🎉';
          t.showMessage('success', message);
        }
        
        // For RESET flow: Submit immediately since we already have account_id from click
        if (resetFlowActive && purchaseData.account_id) {
          originalLog.call(console, '[TPT] 🔄 Reset flow - submitting immediately...');
          submitPurchase();
          break;
        }
        
        // For NEW purchase flow: Network intercept should handle submission, but set a fallback
        setTimeout(() => {
          if (captureStatus !== 'success') {
            originalLog.call(console, '[TPT] ⚠️ Network intercept may have missed, trying submission...');
            submitPurchase();
          }
        }, 3000);
        
        break;
      }
    }
  };
  
  // ═══════════════════════════════════════════════════════════════════
  // SUBMIT PURCHASE
  // ═══════════════════════════════════════════════════════════════════
  
  function submitPurchase() {
    // Prevent duplicate submissions
    if (captureStatus === 'success' || captureStatus === 'submitting') {
      originalLog.call(console, '[TPT] ⏭️ Already submitted or submitting, skipping');
      return;
    }
    
    // Validate minimum data
    if (!purchaseData.email) {
      originalLog.call(console, '[TPT] ❌ Cannot submit - missing website email');
      handleSubmissionBlocked('Missing TPT email - please log in to TPT');
      return;
    }
    
    if (!purchaseData.account_id) {
      originalLog.call(console, '[TPT] ❌ Cannot submit - missing account_id');
      handleSubmissionBlocked('Missing account ID - please try again');
      return;
    }
    
    // Get extension's configured TPT email for verification (firm-specific first, then general)
    chrome.storage.local.get(['rewards_emails', 'email'], (stored) => {
      // Debug: Log the full storage data
      originalLog.call(console, '[TPT] 📧 Submit check - rewards_emails:', JSON.stringify(stored.rewards_emails || {}));
      
      // Check for multiple key formats
      const firmSpecificEmail = (
        stored.rewards_emails?.['take-profit-trader'] || 
        stored.rewards_emails?.['takeprofittrader'] ||
        stored.rewards_emails?.['TakeProfitTrader']
      )?.toLowerCase()?.trim();
      
      const generalEmail = stored.email?.toLowerCase()?.trim();
      const extensionTptEmail = firmSpecificEmail || generalEmail;
      const tptWebsiteEmail = purchaseData.email?.toLowerCase()?.trim();
      
      originalLog.call(console, '[TPT] 📧 Submit check:');
      originalLog.call(console, '[TPT]    TPT website:', tptWebsiteEmail || '(not set)');
      originalLog.call(console, '[TPT]    Extension (firm):', firmSpecificEmail || '(not set)');
      originalLog.call(console, '[TPT]    Extension (general):', generalEmail || '(not set)');
      
      if (!extensionTptEmail) {
        originalLog.call(console, '[TPT] ❌ No email in extension - BLOCKING');
        handleSubmissionBlocked('Please log in to the extension to track your rewards!');
        return;
      }
      
      if (!tptWebsiteEmail) {
        originalLog.call(console, '[TPT] ❌ No email from TPT website - BLOCKING');
        handleSubmissionBlocked('Could not get email from TPT. Make sure you are logged in.');
        return;
      }
      
      if (extensionTptEmail !== tptWebsiteEmail) {
        const emailSource = firmSpecificEmail ? 'TPT-specific' : 'general';
        originalLog.call(console, `[TPT] ❌ Email mismatch - BLOCKING (using ${emailSource} email)`);
        handleSubmissionBlocked(`Email mismatch! TPT: ${tptWebsiteEmail} ≠ Extension (${emailSource}): ${extensionTptEmail}`);
        return;
      }
      
      originalLog.call(console, '[TPT] ✅ Emails match - submitting with:', purchaseData.email);
      
      // Proceed with submission (using TPT website email)
      doSubmit();
    });
  }
  
  // Handle submission blocked (email mismatch, etc.) - reset state properly
  function handleSubmissionBlocked(message) {
    setStatus('error', 'Blocked');
    const t = tracker || window.__pfcTracker;
    if (t) {
      t.showMessage('error', message);
    }
    
    // Reset state after delay so user can try again
    setTimeout(() => {
      // Keep user data but clear purchase-specific data
      const { email, customer_name, user_id } = purchaseData;
      Object.assign(purchaseData, {
        email,
        customer_name,
        user_id,
        product_name: null,
        original_price: null,
        final_price: null,
        coupon_code: null,
        discount_percent: null,
        account_id: null,
        transaction_id: null,
        platform: null,
        purchase_type: 'new'
      });
      
      couponConfirmed = false;
      resetFlowActive = false;
      
      setStatus('waiting', 'Fix emails to continue');
      
      // CLEAR THE TRACKER UI FIELDS - so old data doesn't persist
      if (t) {
        t.clearField('product');
        t.clearField('price');
        t.clearField('coupon');
        t.clearField('order_id');
        // Keep email field since user is still logged in
      }
      
      originalLog.call(console, '[TPT] ⚠️ Submission blocked - ready to retry after email fix');
    }, 5000);
  }
  
  function doSubmit() {
    // If no promo was used, final = original
    if (!purchaseData.final_price && purchaseData.original_price) {
      purchaseData.final_price = purchaseData.original_price;
    }
    
    const isReset = purchaseData.purchase_type === 'reset';
    setStatus('submitting', isReset ? 'Submitting reset...' : 'Submitting to API...');
    
    const payload = {
      partner: PARTNER,
      email: purchaseData.email,
      customer_name: purchaseData.customer_name,
      product_name: purchaseData.product_name,
      original_price: purchaseData.original_price,
      final_price: purchaseData.final_price,
      discount_amount: purchaseData.original_price && purchaseData.final_price 
        ? purchaseData.original_price - purchaseData.final_price 
        : null,
      coupon_code: isReset ? null : purchaseData.coupon_code,  // No coupons for resets
      order_number: purchaseData.account_id,
      platform: purchaseData.platform,
      transaction_id: purchaseData.transaction_id,
      checkout_url: window.location.href,
      purchase_type: purchaseData.purchase_type  // 'new' or 'reset'
    };
    
    originalLog.call(console, '[TPT] 📤 Submitting:', JSON.stringify(payload, null, 2));
    
    // First capture
    chrome.runtime.sendMessage({
      action: 'CAPTURE_PURCHASE',
      data: payload
    }, (captureResponse) => {
      if (chrome.runtime.lastError) {
        originalLog.call(console, '[TPT] ❌ Capture error:', chrome.runtime.lastError);
        setStatus('error', 'Error submitting');
        return;
      }
      
      originalLog.call(console, '[TPT] ✅ Captured:', captureResponse);
      
      // Then trigger success
      chrome.runtime.sendMessage({
        action: 'SUCCESS_DETECTED',
        data: {
          partner: PARTNER,
          order_number: purchaseData.account_id,
          email: purchaseData.email,
          coupon_code: purchaseData.coupon_code,
          successData: payload
        }
      }, (successResponse) => {
        if (chrome.runtime.lastError) {
          originalLog.call(console, '[TPT] ❌ Success trigger error:', chrome.runtime.lastError);
          return;
        }
        
        originalLog.call(console, '[TPT] ✅ Success response:', successResponse);
        
        // Update tracker with success
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
      });
    });
    
    // Reset for next purchase (keep user data)
    const { email, customer_name, user_id, account_id, purchase_type } = purchaseData;
    
    // IMPORTANT: Set the just-captured account as the new baseline (only for NEW purchases)
    // So we can immediately detect the NEXT purchase without refresh
    if (account_id && purchase_type !== 'reset') {
      previousFirstAccountId = account_id;
      localStorage.setItem('__pfc_previous_account_id', account_id);
      originalLog.call(console, '[TPT] 🔄 New baseline set for next purchase:', account_id);
    }
    
    // Reset purchase data after short delay (keep user data)
    setTimeout(() => {
      Object.assign(purchaseData, {
        email,
        customer_name,
        user_id,
        product_name: null,
        original_price: null,
        final_price: null,
        discount_percent: null,
        coupon_code: null,
        account_id: null,
        transaction_id: null,
        platform: null,
        purchase_type: 'new'  // Reset back to 'new' for next purchase
      });
      
      // Reset state flags
      couponConfirmed = false;
      resetFlowActive = false;
      
      // Reset capture status to waiting
      setStatus('waiting', 'Ready for next purchase');
      
      // CLEAR THE TRACKER UI FIELDS - so old data doesn't persist
      const t = tracker || window.__pfcTracker;
      if (t) {
        t.clearField('product');
        t.clearField('price');
        t.clearField('coupon');
        t.clearField('order_id');
        // Keep email field since user is still logged in
        t.showMessage('success', '✅ Ready to track next purchase');
      }
      
      originalLog.call(console, '[TPT] ✅ Ready to track next purchase');
    }, 3000);
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // STAGE 6B: CAPTURE ACCOUNT ID FROM SUBSCRIPTIONS LIST (DOM fallback)
  // ═══════════════════════════════════════════════════════════════════
  
  // Get the current first account ID from the subscriptions list
  function getFirstAccountIdFromDOM() {
    try {
      const firstRecord = document.querySelector('app-test-subscription-record a[href^="/control-center/"]');
      if (firstRecord) {
        const href = firstRecord.getAttribute('href');
        const match = href.match(/\/control-center\/(\d+)/);
        if (match && match[1]) {
          return match[1];
        }
      }
    } catch (e) {
      // Ignore errors
    }
    return null;
  }
  
  // Store the current first account ID (called when checkout modal opens)
  function storeCurrentFirstAccountId() {
    const currentFirst = getFirstAccountIdFromDOM();
    if (currentFirst) {
      previousFirstAccountId = currentFirst;
      // Persist to localStorage so it survives PayPal redirects
      localStorage.setItem('__pfc_previous_account_id', currentFirst);
      localStorage.setItem('__pfc_checkout_started', Date.now().toString());
      originalLog.call(console, '[TPT] 📋 Stored current first account ID:', previousFirstAccountId);
    }
  }
  
  // Start watching for a NEW account ID after purchase
  function startWatchingForNewAccount() {
    if (watchingForNewAccount) return;  // Already watching
    
    watchingForNewAccount = true;
    originalLog.call(console, '[TPT] 👀 Watching for new account ID (current first:', previousFirstAccountId, ')');
    
    // Show message to user
    const t = tracker || window.__pfcTracker;
    if (t) {
      t.showMessage('info', 'Please wait, capturing your reward...');
    }
  }
  
  // Check if a new account has appeared (called by polling)
  function checkForNewAccountId() {
    if (purchaseData.account_id) return false;  // Already have it
    if (!previousFirstAccountId) return false;  // No baseline to compare
    
    const currentFirst = getFirstAccountIdFromDOM();
    
    // If the first account ID has CHANGED, that's the new purchase!
    if (currentFirst && currentFirst !== previousFirstAccountId) {
      purchaseData.account_id = currentFirst;
      watchingForNewAccount = false;
      
      // Clear stored previous ID so we don't re-detect on next page load
      localStorage.removeItem('__pfc_previous_account_id');
      localStorage.removeItem('__pfc_checkout_started');
      
      originalLog.call(console, '[TPT] ✅ Stage 6: NEW Account ID detected!');
      originalLog.call(console, '[TPT]    Previous first:', previousFirstAccountId);
      originalLog.call(console, '[TPT]    New account:', purchaseData.account_id);
      
      // Get additional data from the record
      const firstRecord = document.querySelector('app-test-subscription-record a[href^="/control-center/"]');
      if (firstRecord) {
        // Product name
        if (!purchaseData.product_name) {
          const productDiv = firstRecord.querySelector('.text-subtitle-3');
          if (productDiv) {
            purchaseData.product_name = productDiv.textContent.trim();
            originalLog.call(console, '[TPT]    Product:', purchaseData.product_name);
          }
        }
        
        // Platform
        if (!purchaseData.platform) {
          const platformDiv = firstRecord.querySelector('.text-body-8.text-start.color-white-60');
          if (platformDiv) {
            const platformText = platformDiv.textContent.trim();
            if (platformText === 'CQG' || platformText === 'Rithmic') {
              purchaseData.platform = platformText;
              originalLog.call(console, '[TPT]    Platform:', purchaseData.platform);
            }
          }
        }
      }
      
      updateTrackerUI();
      
      // Now we have the account_id, submit!
      if (purchaseData.email && captureStatus !== 'success') {
        originalLog.call(console, '[TPT] 📤 New account detected, submitting...');
        submitPurchase();
      }
      
      return true;
    }
    
    return false;
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // AUTOFILL - Direct implementation
  // ═══════════════════════════════════════════════════════════════════
  
  let autofillAttempted = false;
  let autofillInProgress = false;
  
  async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  async function waitForElement(selector, textContent = null, maxWait = 10000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWait) {
      const elements = document.querySelectorAll(selector);
      
      for (const el of elements) {
        if (!textContent || el.textContent.trim().toUpperCase().includes(textContent.toUpperCase())) {
          // Check if visible
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden') {
            return el;
          }
        }
      }
      
      await sleep(100);
    }
    
    return null;
  }
  
  async function performAutofill() {
    // Skip autofill for reset flows - coupons don't work on resets
    if (resetFlowActive || purchaseData.purchase_type === 'reset') {
      originalLog.call(console, '[TPT] ⏭️ Skipping autofill - reset flow (coupons don\'t work)');
      return;
    }
    
    if (autofillAttempted || autofillInProgress) {
      originalLog.call(console, '[TPT] ⏭️ Autofill already attempted/in progress');
      return;
    }
    
    autofillInProgress = true;
    originalLog.call(console, '[TPT] 🚀 Starting autofill...');
    
    try {
      // Step 1: Find and click the "Add" button to reveal promo input
      // Button has class: ant-btn ant-btn-color-primary ant-btn-link
      originalLog.call(console, '[TPT] Step 1: Looking for Add button...');
      
      let addButton = null;
      const allButtons = document.querySelectorAll('button');
      for (const btn of allButtons) {
        const text = btn.textContent.trim().toUpperCase();
        const isLinkStyle = btn.classList.contains('ant-btn-link') || btn.getAttribute('nztype') === 'link';
        if (text === 'ADD' && isLinkStyle) {
          addButton = btn;
          break;
        }
      }
      
      if (!addButton) {
        // Maybe input is already visible?
        const existingInput = document.querySelector('input[name="code"]');
        if (!existingInput) {
          originalLog.call(console, '[TPT] ⚠️ No Add button found, checking if input exists...');
          // Try waiting for it
          addButton = await waitForElement('button', 'Add', 5000);
          if (!addButton) {
            throw new Error('Could not find Add button or promo input');
          }
        } else {
          originalLog.call(console, '[TPT] Input already visible, skipping Add button');
        }
      }
      
      if (addButton) {
        originalLog.call(console, '[TPT] ✅ Found Add button, clicking...');
        addButton.click();
        await sleep(800);
      }
      
      // Step 2: Wait for input to appear
      originalLog.call(console, '[TPT] Step 2: Waiting for promo input...');
      const input = await waitForElement('input[name="code"]', null, 5000);
      
      if (!input) {
        throw new Error('Promo input not found after clicking Add');
      }
      
      originalLog.call(console, '[TPT] ✅ Found input');
      
      // Check if already filled
      if (input.value === 'LAB') {
        originalLog.call(console, '[TPT] ✅ Code already filled');
        autofillAttempted = true;
        autofillInProgress = false;
        return;
      }
      
      // Step 3: Fill the input
      originalLog.call(console, '[TPT] Step 3: Filling input with LAB...');
      input.focus();
      input.value = '';
      
      // Use native setter for React/Angular compatibility
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(input, 'LAB');
      
      // Dispatch all events Angular needs
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true }));
      
      // Visual feedback
      input.style.border = '2px solid #00cc66';
      input.style.boxShadow = '0 0 10px rgba(0, 204, 102, 0.3)';
      
      originalLog.call(console, '[TPT] ✅ Input filled with LAB');
      
      await sleep(500);
      
      // Step 4: Click APPLY button
      // Button has class: ant-btn ant-btn-default
      originalLog.call(console, '[TPT] Step 4: Looking for APPLY button...');
      
      let applyButton = null;
      const allBtns = document.querySelectorAll('button');
      for (const btn of allBtns) {
        const text = btn.textContent.trim().toUpperCase();
        const isDefaultStyle = btn.classList.contains('ant-btn-default') || btn.getAttribute('nztype') === 'default';
        if (text === 'APPLY' && isDefaultStyle) {
          applyButton = btn;
          break;
        }
      }
      
      if (!applyButton) {
        // Fallback: find any button with APPLY text
        applyButton = await waitForElement('button', 'APPLY', 3000);
      }
      
      if (!applyButton) {
        throw new Error('APPLY button not found');
      }
      
      originalLog.call(console, '[TPT] ✅ Found APPLY button, clicking...');
      applyButton.click();
      
      // Success!
      autofillAttempted = true;
      autofillInProgress = false;
      
      originalLog.call(console, '[TPT] ✅ Autofill completed!');
      
      // Clean up visual feedback
      setTimeout(() => {
        if (input) {
          input.style.border = '';
          input.style.boxShadow = '';
        }
      }, 2000);
      
    } catch (error) {
      originalLog.call(console, '[TPT] ❌ Autofill error:', error.message);
      autofillInProgress = false;
      autofillAttempted = true; // Don't retry on error
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // RESET FLOW DETECTION
  // ═══════════════════════════════════════════════════════════════════
  
  function setupResetButtonListeners() {
    // Use event delegation on the document body to catch all RESET buttons
    document.body.addEventListener('click', (e) => {
      const resetButton = e.target.closest('button');
      if (!resetButton) return;
      
      const buttonText = resetButton.textContent.trim().toUpperCase();
      const isResetButton = buttonText === 'RESET' && 
                            resetButton.classList.contains('ant-btn-color-error');
      
      if (!isResetButton) return;
      
      originalLog.call(console, '[TPT] 🔄 RESET button clicked!');
      
      // Find the account row this button belongs to
      const accountRow = resetButton.closest('app-test-subscription-record, app-subscription-record, [class*="subscription"]');
      
      if (accountRow) {
        // Extract account ID from the row's link
        const accountLink = accountRow.querySelector('a[href*="/control-center/"]');
        if (accountLink) {
          const href = accountLink.getAttribute('href');
          const match = href.match(/\/control-center\/(\d+)/);
          if (match && match[1]) {
            purchaseData.account_id = match[1];
            originalLog.call(console, '[TPT] 📋 Reset account ID:', purchaseData.account_id);
          }
        }
        
        // Extract product name from the row
        const productDiv = accountRow.querySelector('.text-subtitle-3, .subscription-name');
        if (productDiv) {
          const productText = productDiv.textContent.trim();
          // Extract account size (e.g., "$ 25k" -> "25K")
          const sizeMatch = productText.match(/\$?\s*(\d+)\s*[kK]/);
          if (sizeMatch) {
            const size = sizeMatch[1] + 'K';
            purchaseData.product_name = size + ' Reset';
            purchaseData.original_price = RESET_PRICE;
            originalLog.call(console, '[TPT] 📦 Reset product:', purchaseData.product_name, '- $' + purchaseData.original_price);
          }
        }
        
        // Extract platform from the row
        const platformDiv = accountRow.querySelector('.text-body-8, [class*="platform"]');
        if (platformDiv) {
          const platformText = platformDiv.textContent.trim();
          if (platformText === 'CQG' || platformText === 'Rithmic') {
            purchaseData.platform = platformText;
            originalLog.call(console, '[TPT] 🖥️ Reset platform:', purchaseData.platform);
          }
        }
      }
      
      // If we couldn't get product from row, try localStorage
      if (!purchaseData.product_name) {
        try {
          const accountSizeStr = localStorage.getItem('accountSize');
          if (accountSizeStr) {
            const accountSize = JSON.parse(accountSizeStr);
            // Extract size from name like "$ 25k"
            const sizeMatch = accountSize.name?.match(/\$?\s*(\d+)\s*[kK]/);
            if (sizeMatch) {
              const size = sizeMatch[1] + 'K';
              purchaseData.product_name = size + ' Reset';
              purchaseData.original_price = RESET_PRICE;
              originalLog.call(console, '[TPT] 📦 Reset product (from localStorage):', purchaseData.product_name);
            }
          }
        } catch (e) {
          originalLog.call(console, '[TPT] ⚠️ Could not parse accountSize:', e.message);
        }
      }
      
      // Mark as reset flow
      purchaseData.purchase_type = 'reset';
      purchaseData.coupon_code = null;  // Coupons don't work on resets
      resetFlowActive = true;
      couponConfirmed = false;
      
      // Capture user email from JWT cookie (if not already captured)
      if (!purchaseData.email) {
        captureUser();
      }
      
      // Show tracker
      showTracker();
      updateTrackerUI();
      setStatus('waiting', 'Waiting for reset payment...');
      
      // Check email BEFORE purchase - warn user early if mismatch
      checkEmailBeforePurchase();
      
      originalLog.call(console, '[TPT] ✅ Reset flow started - listening for payment...');
    }, true);  // Use capture phase to catch before other handlers
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // WATCHERS
  // ═══════════════════════════════════════════════════════════════════
  
  function startWatchers() {
    // Poll for product selection changes (frameworks may bypass setItem)
    setInterval(() => {
      const currentSizeId = localStorage.getItem('selectedAccountSizeId');
      if (currentSizeId && currentSizeId !== lastSeenAccountSizeId) {
        lastSeenAccountSizeId = currentSizeId;
        originalLog.call(console, '[TPT] 🔄 Account size changed to:', currentSizeId);
        captureProduct();
      }
    }, 500);
    
    // Poll for pricing every second (fallback for network intercept)
    setInterval(() => {
      if (purchaseData.discount_percent === null || purchaseData.final_price === null) {
        capturePricing();
      }
    }, 1000);
    
    // Poll for NEW account ID in subscriptions list
    // Always check if we have a stored previous ID (handles PayPal in new tab)
    let lastLoggedPreviousId = null;
    setInterval(() => {
      // Check if we have a stored previous account ID (checkout was started)
      if (!previousFirstAccountId) {
        const stored = localStorage.getItem('__pfc_previous_account_id');
        if (stored) {
          previousFirstAccountId = stored;
          originalLog.call(console, '[TPT] 👀 Restored previous account ID from storage:', stored);
        }
      }
      
      // If we have a previous ID and no captured account yet, watch for changes
      if (previousFirstAccountId && !purchaseData.account_id) {
        // Log once when we start watching
        if (lastLoggedPreviousId !== previousFirstAccountId) {
          lastLoggedPreviousId = previousFirstAccountId;
          originalLog.call(console, '[TPT] 👀 Watching for account change (current baseline:', previousFirstAccountId + ')');
        }
        checkForNewAccountId();
      }
    }, 500);  // Check every 500ms for faster detection
    
    // Watch localStorage changes (backup)
    const origSetItem = localStorage.setItem;
    localStorage.setItem = function(key, value) {
      origSetItem.apply(this, arguments);
      if (key === 'selectedAccountSizeId') {
        lastSeenAccountSizeId = value;
        captureProduct();
      }
      if (key === 'urlReferralCode') captureCoupon();
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // CHECKOUT MODAL DETECTION
  // ═══════════════════════════════════════════════════════════════════
  
  let discountPollInterval = null;
  let promoInputWasVisible = false;
  
  let modalWasOpen = false;
  
  function startDiscountPolling() {
    // Poll for discount every 500ms when modal is open
    if (discountPollInterval) return;
    
    discountPollInterval = setInterval(() => {
      const modal = document.querySelector('.account-flow-modal');
      if (!modal) {
        // Modal closed!
        if (modalWasOpen) {
          // Modal was open but now closed - purchase may have completed
          originalLog.call(console, '[TPT] 💳 Modal closed - starting to watch for new account...');
          modalWasOpen = false;
          
          // Start watching for new account ID (purchase likely completed)
          startWatchingForNewAccount();
        }
        
        // Stop polling and reset autofill state
        clearInterval(discountPollInterval);
        discountPollInterval = null;
        autofillAttempted = false;
        autofillInProgress = false;
        promoInputWasVisible = false;
        return;
      }
      
      // Track that modal is open
      modalWasOpen = true;
      
      // Check if promo input is visible
      const promoInput = modal.querySelector('input[name="code"]');
      const promoInputVisible = promoInput && promoInput.offsetParent !== null;
      
      // If input was visible but now isn't (user clicked X/Close), reset autofill
      if (promoInputWasVisible && !promoInputVisible) {
        originalLog.call(console, '[TPT] 🔄 Promo input closed, resetting autofill state');
        autofillAttempted = false;
        autofillInProgress = false;
        
        // Try autofill again after a delay
        setTimeout(() => {
          if (!autofillAttempted) {
            performAutofill();
          }
        }, 1000);
      }
      
      promoInputWasVisible = promoInputVisible;
      
      capturePricing();
    }, 500);
  }
  
  function watchForCheckoutModal() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) {
            if (node.classList?.contains('account-flow-modal') ||
                node.querySelector?.('.account-flow-modal')) {
              originalLog.call(console, '[TPT] 💳 Checkout modal detected');
              showTracker();
              
              // Store current first account ID BEFORE purchase
              storeCurrentFirstAccountId();
              
              // Check email BEFORE purchase - warn user early if mismatch
              checkEmailBeforePurchase();
              
              // Start polling for discount
              startDiscountPolling();
              
              // Start autofill after a short delay
              setTimeout(() => {
                performAutofill();
              }, 1500);
            }
          }
        }
      }
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
    
    // Check if modal already exists
    if (document.querySelector('.account-flow-modal')) {
      originalLog.call(console, '[TPT] 💳 Checkout modal already present');
      showTracker();
      
      // Store current first account ID BEFORE purchase
      storeCurrentFirstAccountId();
      
      // Check email BEFORE purchase - warn user early if mismatch
      checkEmailBeforePurchase();
      
      // Start polling for discount
      startDiscountPolling();
      
      // Start autofill after a short delay
      setTimeout(() => {
        performAutofill();
      }, 1500);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // DEBUG INTERFACE
  // ═══════════════════════════════════════════════════════════════════
  
  window.tptDebug = {
    data: () => purchaseData,
    status: () => captureStatus,
    isReset: () => resetFlowActive,
    showTracker,
    submit: submitPurchase,
    extractUser: captureUser,
    autofill: () => {
      autofillAttempted = false;
      autofillInProgress = false;
      performAutofill();
    },
    recapture: () => {
      captureUser();
      captureProduct();
      captureCoupon();
      capturePricing();
    },
    // Test reset flow manually
    simulateReset: (accountId, productSize) => {
      purchaseData.account_id = accountId || '12345';
      purchaseData.product_name = (productSize || '25K') + ' Reset';
      purchaseData.original_price = RESET_PRICE;
      purchaseData.purchase_type = 'reset';
      resetFlowActive = true;
      showTracker();
      updateTrackerUI();
      setStatus('waiting', 'Waiting for reset payment...');
    }
  };
  
  // ═══════════════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════════════
  
  function init() {
    originalLog.call(console, '[TPT] 🚀 TakeProfitTrader Adapter v5.5 (Skip Funded Resets)');
    
    // ════════════════════════════════════════════════════════════════════
    // SKIP FUNDED ACCOUNT RESETS - /control-center/pro
    // These are funded account resets - we don't get paid on them and
    // don't need to track them. Skip entirely on this page.
    // ════════════════════════════════════════════════════════════════════
    if (window.location.pathname.includes('/control-center/pro')) {
      originalLog.call(console, '[TPT] ⏭️ Skipping - Funded account page (no tracking needed)');
      return; // Exit early - don't initialize anything
    }
    
    // Initialize tracker (may need to wait for TrackerUI to load)
    const tryInitTracker = () => {
      if (initTracker()) {
        captureUser();
        captureProduct();
        captureCoupon();
        capturePricing();
        setStatus('waiting', 'Waiting for checkout...');
      } else {
        setTimeout(tryInitTracker, 100);
      }
    };
    
    // Initialize lastSeenAccountSizeId with current value
    lastSeenAccountSizeId = localStorage.getItem('selectedAccountSizeId');
    
    tryInitTracker();
    startWatchers();
    watchForCheckoutModal();
    setupResetButtonListeners();  // Listen for RESET button clicks (evaluation resets only)
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
})();
