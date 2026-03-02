/**
 * LUCID TRADING ADAPTER v1.0
 *
 * WooCommerce-based checkout tracking for Lucid Trading.
 *
 * DATA CAPTURE:
 * | Stage | Source                        | Data Captured                              |
 * |-------|-------------------------------|---------------------------------------------|
 * | 1     | Network /?wc-ajax=update_order| product_name, original_price, coupon, final_price |
 * | 2     | Network request body          | email, customer_name, phone                |
 * | 3     | DOM checkout form             | billing fields fallback                    |
 * | 4     | Success page/redirect         | order_id from URL or page                  |
 *
 * Coupon auto-apply is handled by lucid-net-intercept.js in MAIN world.
 */

(function() {
  'use strict';

  // Prevent double initialization
  if (window.__pfcLucidAdapterInstalled) return;
  window.__pfcLucidAdapterInstalled = true;

  const PARTNER = 'lucidtrading';
  const ADAPTER_VERSION = '1.0';

  // ═══════════════════════════════════════════════════════════════════
  // PURCHASE DATA STATE
  // ═══════════════════════════════════════════════════════════════════

  const purchaseData = {
    email: null,
    customer_name: null,
    phone: null,
    product_name: null,
    original_price: null,
    discount_amount: null,
    discount_percent: null,
    final_price: null,
    coupon_code: null,
    order_id: null
  };

  let captureStatus = 'initializing';
  let tracker = null;
  let couponConfirmed = false;

  // Network data from intercept script
  const networkData = {
    orderReview: null,
    billingData: null,
    lastNetworkUpdate: 0,
    network_log: []
  };

  // ═══════════════════════════════════════════════════════════════════
  // TRACKER UI
  // ═══════════════════════════════════════════════════════════════════

  function initTracker() {
    if (window.__pfcTracker) {
      tracker = window.__pfcTracker;
      return tracker;
    }

    if (!window.TrackerUI) {
      console.log('[PFC-Lucid] TrackerUI not loaded yet, retrying...');
      return null;
    }

    tracker = new window.TrackerUI({
      partner: PARTNER,
      partnerName: 'Lucid Trading',
      fields: ['coupon', 'product', 'price', 'email', 'order_id'],
      fieldLabels: {
        coupon: 'Coupon Code',
        product: 'Account',
        price: 'Price',
        email: 'Email',
        order_id: 'Order ID'
      },
      afterPurchaseFields: ['order_id']
    });

    window.__pfcTracker = tracker;
    console.log('[PFC-Lucid] TrackerUI initialized');
    return tracker;
  }

  function showTracker() {
    const t = tracker || initTracker();
    if (t) {
      t.show();
      if (t.startRecording) t.startRecording();
      updateTrackerUI();
    }
  }

  function updateTrackerUI() {
    const t = tracker || window.__pfcTracker;
    if (!t) return;

    if (purchaseData.product_name) {
      t.updateField('product', purchaseData.product_name);
    }

    if (purchaseData.original_price) {
      if (couponConfirmed && purchaseData.final_price && purchaseData.final_price < purchaseData.original_price) {
        t.updateField('price', purchaseData.final_price, t.formatPrice(purchaseData.original_price, purchaseData.final_price));
      } else {
        t.updateField('price', purchaseData.original_price, '$' + purchaseData.original_price);
      }
    }

    if (purchaseData.email) {
      t.updateField('email', purchaseData.email);
    }

    if (couponConfirmed && purchaseData.coupon_code) {
      t.updateField('coupon', purchaseData.coupon_code);
    }

    if (purchaseData.order_id) {
      t.updateField('order_id', purchaseData.order_id);
    }
  }

  function setStatus(status, text) {
    captureStatus = status;
    console.log('[PFC-Lucid] Status:', status);

    const t = tracker || window.__pfcTracker;
    if (t) {
      t.setStatus(status, text || status);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // NETWORK EVENT LISTENER
  // ═══════════════════════════════════════════════════════════════════

  document.addEventListener('__pfc_lucid_net', function(e) {
    try {
      let detail;
      try { detail = JSON.parse(e.detail); } catch(ex) { detail = e.detail; }
      if (!detail || !detail.type || !detail.data) return;

      const d = detail.data;
      networkData.lastNetworkUpdate = Date.now();

      // Store in network log
      networkData.network_log.push({
        type: detail.type,
        url: d.url,
        status: d.status,
        time: new Date().toISOString()
      });
      if (networkData.network_log.length > 50) {
        networkData.network_log.splice(0, networkData.network_log.length - 50);
      }

      // Process based on event type
      if (detail.type === 'fetch' || detail.type === 'xhr') {
        processNetworkResponse(d.url, d.responseData, d.responseText, d.parsedRequestBody);
      } else if (detail.type === 'coupon_applied' || detail.type === 'coupon_already_applied') {
        couponConfirmed = true;
        purchaseData.coupon_code = d.coupon_code || 'LAB';
        console.log('[PFC-Lucid] Coupon confirmed:', purchaseData.coupon_code);

        const t = tracker || window.__pfcTracker;
        if (t) {
          t.setAutoFillStatus('success', 'Code "LAB" applied! ✓');
          t.updateField('coupon', 'LAB');
          setTimeout(() => t.setAutoFillStatus('hidden', ''), 3000);
        }
        updateTrackerUI();
      }
    } catch (err) {
      console.error('[PFC-Lucid] Network event error:', err);
    }
  });

  function processNetworkResponse(url, jsonData, responseText, requestBody) {
    const urlLower = (url || '').toLowerCase();

    // /?wc-ajax=update_order_review - Main cart/pricing data
    if (urlLower.includes('wc-ajax=update_order_review') || urlLower.includes('update_order_review')) {
      console.log('[PFC-Lucid] Processing order review response');

      // Extract billing data from request body
      if (requestBody) {
        if (requestBody.billing_email) {
          purchaseData.email = requestBody.billing_email;
        }
        if (requestBody.billing_first_name || requestBody.billing_last_name) {
          purchaseData.customer_name = [requestBody.billing_first_name, requestBody.billing_last_name].filter(Boolean).join(' ');
        }
        if (requestBody.billing_phone) {
          purchaseData.phone = requestBody.billing_phone;
        }

        console.log('[PFC-Lucid] Billing data:', {
          email: purchaseData.email,
          name: purchaseData.customer_name
        });
      }

      // Parse pricing from response HTML fragments
      if (jsonData && jsonData.fragments) {
        const tableHtml = jsonData.fragments['.woocommerce-checkout-review-order-table'] || '';
        parsePricingFromHtml(tableHtml);
      } else if (responseText) {
        // Try parsing as HTML if not JSON
        parsePricingFromHtml(responseText);
      }

      networkData.orderReview = {
        timestamp: Date.now(),
        purchaseData: { ...purchaseData }
      };

      updateTrackerUI();
    }

    // apply_coupon_action - Coupon application response
    if (urlLower.includes('apply_coupon') || (requestBody && requestBody.action === 'apply_coupon_action')) {
      console.log('[PFC-Lucid] Coupon action detected');

      if (requestBody && requestBody.coupon_code) {
        purchaseData.coupon_code = requestBody.coupon_code.toUpperCase();
      }

      // Check response for success
      if (responseText && (responseText.includes('success') || responseText.includes('applied') || responseText.includes('Coupon'))) {
        couponConfirmed = true;
        console.log('[PFC-Lucid] Coupon confirmed via response');
      }

      updateTrackerUI();
    }

    // Checkout form submission - look for order confirmation
    if (urlLower.includes('checkout') && jsonData) {
      if (jsonData.result === 'success' && jsonData.redirect) {
        // Extract order ID from redirect URL
        const orderMatch = jsonData.redirect.match(/order[_-]?(?:id|received)[=\/](\d+)/i);
        if (orderMatch) {
          purchaseData.order_id = orderMatch[1];
          console.log('[PFC-Lucid] Order ID from redirect:', purchaseData.order_id);
          onPurchaseComplete();
        }
      }
    }
  }

  function parsePricingFromHtml(html) {
    if (!html) return;

    // Create a temporary div to parse HTML
    const temp = document.createElement('div');
    temp.innerHTML = html;

    // Extract product name
    const productCell = temp.querySelector('.product-name');
    if (productCell) {
      const productText = productCell.textContent.trim();
      // Clean up product name (remove quantity markers)
      const cleanProduct = productText.replace(/×\s*\d+/g, '').trim();
      if (cleanProduct && !purchaseData.product_name) {
        purchaseData.product_name = cleanProduct;
        console.log('[PFC-Lucid] Product:', purchaseData.product_name);
      }
    }

    // Extract subtotal (original price)
    const subtotalRow = temp.querySelector('.cart-subtotal td');
    if (subtotalRow) {
      const subtotalMatch = subtotalRow.textContent.match(/\$?([\d,]+\.?\d*)/);
      if (subtotalMatch) {
        purchaseData.original_price = parseFloat(subtotalMatch[1].replace(',', ''));
        console.log('[PFC-Lucid] Original price:', purchaseData.original_price);
      }
    }

    // Extract coupon discount
    const couponRow = temp.querySelector('[class*="cart-discount"], [class*="coupon-"]');
    if (couponRow) {
      const couponText = couponRow.textContent;

      // Extract coupon code
      const codeMatch = couponText.match(/coupon[:\s]*([a-zA-Z0-9_-]+)/i);
      if (codeMatch) {
        purchaseData.coupon_code = codeMatch[1].toUpperCase();
        couponConfirmed = true;
      }

      // Extract discount percent
      const percentMatch = couponText.match(/(\d+)%/);
      if (percentMatch) {
        purchaseData.discount_percent = parseInt(percentMatch[1], 10);
      }

      // Extract discount amount
      const discountMatch = couponText.match(/-?\$?([\d,]+\.?\d*)/);
      if (discountMatch) {
        purchaseData.discount_amount = parseFloat(discountMatch[1].replace(',', ''));
      }

      console.log('[PFC-Lucid] Coupon:', purchaseData.coupon_code, purchaseData.discount_percent + '% off');
    }

    // Extract total (final price)
    const totalRow = temp.querySelector('.order-total td');
    if (totalRow) {
      const totalMatch = totalRow.textContent.match(/\$?([\d,]+\.?\d*)/);
      if (totalMatch) {
        purchaseData.final_price = parseFloat(totalMatch[1].replace(',', ''));
        console.log('[PFC-Lucid] Final price:', purchaseData.final_price);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // DOM-BASED DATA CAPTURE (Fallback)
  // ═══════════════════════════════════════════════════════════════════

  function captureBillingFromDOM() {
    // Try to get billing data from form fields
    const emailInput = document.querySelector('#billing_email, input[name="billing_email"]');
    const firstNameInput = document.querySelector('#billing_first_name, input[name="billing_first_name"]');
    const lastNameInput = document.querySelector('#billing_last_name, input[name="billing_last_name"]');
    const phoneInput = document.querySelector('#billing_phone, input[name="billing_phone"]');

    if (emailInput && emailInput.value && !purchaseData.email) {
      purchaseData.email = emailInput.value;
    }

    if ((firstNameInput || lastNameInput) && !purchaseData.customer_name) {
      purchaseData.customer_name = [
        firstNameInput?.value,
        lastNameInput?.value
      ].filter(Boolean).join(' ');
    }

    if (phoneInput && phoneInput.value && !purchaseData.phone) {
      purchaseData.phone = phoneInput.value;
    }

    return !!(purchaseData.email || purchaseData.customer_name);
  }

  function capturePricingFromDOM() {
    // Try to get pricing from cart table
    const cartTable = document.querySelector('.woocommerce-checkout-review-order-table');
    if (cartTable) {
      parsePricingFromHtml(cartTable.outerHTML);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // DASHBOARD DATA CAPTURE (dash.lucidtrading.com)
  // ═══════════════════════════════════════════════════════════════════

  function captureDashboardData() {
    // Try common selectors for SPA checkout pages
    // Email
    if (!purchaseData.email) {
      const emailEl = document.querySelector('input[type="email"], input[name*="email" i], input[placeholder*="email" i]');
      if (emailEl && emailEl.value) {
        purchaseData.email = emailEl.value;
      }
    }

    // Product name — look for selected account/plan text
    if (!purchaseData.product_name) {
      const selectedPlan = document.querySelector('[class*="selected"] [class*="title"], [class*="active"] [class*="plan"], [class*="selected"] h3, [class*="selected"] h4');
      if (selectedPlan) {
        purchaseData.product_name = selectedPlan.textContent.trim();
      }
    }

    // Price — look for total/price elements
    if (!purchaseData.original_price) {
      const priceEl = document.querySelector('[class*="total"] [class*="price"], [class*="price"], [class*="amount"]');
      if (priceEl) {
        const priceMatch = priceEl.textContent.match(/\$?([\d,]+\.?\d*)/);
        if (priceMatch) {
          purchaseData.original_price = parseFloat(priceMatch[1].replace(',', ''));
        }
      }
    }

    return !!(purchaseData.email || purchaseData.product_name || purchaseData.original_price);
  }

  // ═══════════════════════════════════════════════════════════════════
  // SUCCESS DETECTION
  // ═══════════════════════════════════════════════════════════════════

  function checkForOrderSuccess() {
    const url = window.location.href;

    // Check URL for order confirmation
    const orderMatch = url.match(/order[_-]?(?:id|received)[=\/](\d+)/i);
    if (orderMatch && !purchaseData.order_id) {
      purchaseData.order_id = orderMatch[1];
      console.log('[PFC-Lucid] Order ID from URL:', purchaseData.order_id);
      onPurchaseComplete();
      return true;
    }

    // Check for order-received page
    if (url.includes('order-received') || url.includes('thank-you') || url.includes('confirmation')) {
      // Try to get order ID from page content
      const orderIdEl = document.querySelector('.woocommerce-order-overview__order strong, .order-number');
      if (orderIdEl) {
        const orderId = orderIdEl.textContent.trim().replace('#', '');
        if (orderId && !purchaseData.order_id) {
          purchaseData.order_id = orderId;
          console.log('[PFC-Lucid] Order ID from page:', purchaseData.order_id);
          onPurchaseComplete();
          return true;
        }
      }
    }

    return false;
  }

  function onPurchaseComplete() {
    if (captureStatus === 'success') return;

    console.log('[PFC-Lucid] Purchase complete!');
    setStatus('submitting', 'Submitting purchase...');

    // Final DOM capture
    captureBillingFromDOM();
    capturePricingFromDOM();

    submitPurchase();
  }

  // ═══════════════════════════════════════════════════════════════════
  // SUBMIT PURCHASE
  // ═══════════════════════════════════════════════════════════════════

  function submitPurchase() {
    if (captureStatus === 'success') {
      console.log('[PFC-Lucid] Already submitted, skipping');
      return;
    }

    // Validate minimum data
    if (!purchaseData.email && !purchaseData.order_id) {
      console.log('[PFC-Lucid] Missing email and order_id, cannot submit yet');
      return;
    }

    // Calculate discount if not set
    if (!purchaseData.discount_amount && purchaseData.original_price && purchaseData.final_price) {
      purchaseData.discount_amount = purchaseData.original_price - purchaseData.final_price;
    }

    const payload = {
      partner: PARTNER,
      email: purchaseData.email,
      customer_name: purchaseData.customer_name,
      product_name: purchaseData.product_name,
      original_price: purchaseData.original_price,
      final_price: purchaseData.final_price || purchaseData.original_price,
      discount_amount: purchaseData.discount_amount,
      coupon_code: couponConfirmed ? purchaseData.coupon_code : null,
      order_number: purchaseData.order_id,
      checkout_url: window.location.href,

      // Enriched data
      _enriched: {
        adapter_version: ADAPTER_VERSION,
        phone: purchaseData.phone,
        discount_percent: purchaseData.discount_percent,
        coupon_confirmed: couponConfirmed,
        network_data: networkData,
        timestamp: new Date().toISOString()
      }
    };

    console.log('[PFC-Lucid] Submitting:', {
      email: payload.email,
      product: payload.product_name,
      price: payload.final_price,
      order: payload.order_number
    });

    // Send to background
    chrome.runtime.sendMessage({
      action: 'CAPTURE_PURCHASE',
      data: payload
    }, (captureResponse) => {
      if (chrome.runtime.lastError) {
        console.error('[PFC-Lucid] Capture error:', chrome.runtime.lastError);
        return;
      }

      console.log('[PFC-Lucid] Captured:', captureResponse);

      // Then trigger success
      chrome.runtime.sendMessage({
        action: 'SUCCESS_DETECTED',
        data: {
          partner: PARTNER,
          order_number: purchaseData.order_id,
          email: purchaseData.email,
          coupon_code: purchaseData.coupon_code,
          successData: payload
        }
      }, (successResponse) => {
        if (chrome.runtime.lastError) {
          console.error('[PFC-Lucid] Success error:', chrome.runtime.lastError);
          return;
        }

        console.log('[PFC-Lucid] Success response:', successResponse);

        const t = tracker || window.__pfcTracker;
        if (t) {
          if (successResponse?.skipped) {
            setStatus('success', 'Already tracked');
            t.showMessage('success', 'This purchase was already tracked!');
          } else if (successResponse?.success) {
            setStatus('success', 'Reward tracked!');
            t.showMessage('success', 'Your purchase has been submitted for rewards!');
          } else {
            setStatus('warning', 'Purchase detected');
            t.showMessage('warning', successResponse?.error || 'Data captured but API did not confirm');
          }

        }
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // CHECKOUT DETECTION
  // ═══════════════════════════════════════════════════════════════════

  function isDashboardCheckout() {
    const hostname = window.location.hostname.toLowerCase();
    const hash = window.location.hash.toLowerCase();
    return hostname.includes('dash.lucidtrading') || hash.includes('add-account');
  }

  function detectCheckout() {
    const path = window.location.pathname.toLowerCase();

    // WooCommerce checkout (lucidtrading.com/checkout)
    if (path.includes('checkout') || document.querySelector('.woocommerce-checkout')) {
      console.log('[PFC-Lucid] Checkout page detected');
      showTracker();
      setStatus('waiting', 'Waiting for checkout...');

      // Initial data capture
      captureBillingFromDOM();
      capturePricingFromDOM();
      updateTrackerUI();

      return true;
    }

    // Dashboard checkout (dash.lucidtrading.com/#/add-account)
    if (isDashboardCheckout()) {
      console.log('[PFC-Lucid] Dashboard checkout detected');
      showTracker();
      setStatus('waiting', 'Watching for purchase...');

      captureDashboardData();
      updateTrackerUI();

      return true;
    }

    // Check for order success page
    if (checkForOrderSuccess()) {
      showTracker();
      return true;
    }

    return false;
  }

  // ═══════════════════════════════════════════════════════════════════
  // WATCHERS
  // ═══════════════════════════════════════════════════════════════════

  function startWatchers() {
    // Poll for DOM changes and order success
    setInterval(() => {
      if (isDashboardCheckout()) {
        // Dashboard checkout — poll dashboard-specific selectors
        captureDashboardData();
      } else {
        // WooCommerce checkout — poll WooCommerce selectors
        captureBillingFromDOM();
        capturePricingFromDOM();
      }
      updateTrackerUI();

      // Check for order success
      checkForOrderSuccess();
    }, 2000);

    // Watch for form field changes
    document.addEventListener('change', (e) => {
      if (e.target.matches('input[name^="billing_"]')) {
        captureBillingFromDOM();
        updateTrackerUI();
      }
    });

    // Watch for URL changes (SPA navigation)
    let lastUrl = window.location.href;
    setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        console.log('[PFC-Lucid] URL changed:', lastUrl);
        detectCheckout();
      }
    }, 1000);
  }

  // ═══════════════════════════════════════════════════════════════════
  // DEBUG INTERFACE
  // ═══════════════════════════════════════════════════════════════════

  window.lucidDebug = {
    data: () => purchaseData,
    status: () => captureStatus,
    network: () => networkData,
    showTracker,
    submit: submitPurchase,
    recapture: () => {
      captureBillingFromDOM();
      capturePricingFromDOM();
      updateTrackerUI();
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // MESSAGE LISTENER
  // ═══════════════════════════════════════════════════════════════════

  chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.action === 'GET_LIVE_EXTRACTION') {
      sendResponse({
        partner: PARTNER,
        captureStatus: captureStatus,
        purchaseData: purchaseData,
        networkData: networkData
      });
      return false;
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════════════

  function init() {
    console.log('[PFC-Lucid] Lucid Trading Adapter v' + ADAPTER_VERSION + ' initializing');

    // Initialize tracker (may need to wait for TrackerUI to load)
    const tryInitTracker = () => {
      if (initTracker()) {
        detectCheckout();
      } else {
        setTimeout(tryInitTracker, 100);
      }
    };

    tryInitTracker();
    startWatchers();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
