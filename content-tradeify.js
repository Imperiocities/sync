/**
 * TRADEIFY CONTENT SCRIPT v1.2
 * Handles checkout capture, success detection, and LAB coupon autofill for Tradeify
 *
 * Data Sources:
 * - Network: /api/dashboard/plandetails - plan info, price, coupon
 * - Network: /api/dashboard/plan-list - all plans
 * - Network: /api/dashboard/profile - user id, email, name, phone
 * - Network: Intercom ping - email, user_id, name (fallback)
 * - Network: Klaviyo events - email, user ID (fallback)
 * - LocalStorage: Intercom user data
 * - URL: plan_id parameter
 * - DOM: Success page detection
 *
 * Features:
 * - LAB coupon auto-fill on checkout page
 * - User profile data capture (email, user_id, name, phone)
 * - Price tracking with discount calculation
 */

(function() {
  'use strict';

  // Prevent double initialization
  if (window.__tradeifyContentLoaded) return;
  window.__tradeifyContentLoaded = true;

  const PARTNER = 'tradeify';
  const PARTNER_NAME = 'Tradeify';
  const DEBUG = false;
  const VERSION = 'v1.2';
  const VALID_COUPONS = ['LAB'];

  function log(...args) {
    if (DEBUG) console.log('[Tradeify]', ...args);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // NETWORK DATA
  // ═══════════════════════════════════════════════════════════════════════

  const networkData = {
    plan: null,           // Selected plan details
    plans: {},            // All plans by ID
    email: null,
    userId: null,
    userName: null,
    username: null,       // Tradeify username
    phone: null,
    couponCode: null,
    couponDiscount: null,
    couponDiscountType: null,
    couponLockedByExtension: false, // True when we applied LAB — don't let API overwrite
    couponDiscountAmount: null,
    orderPaidAmount: null,   // Actual amount paid (from couponsCheck final_price)
    lastNetworkUpdate: 0,
    network_log: []
  };

  // Persist coupon + price to session storage (survives full-page nav)
  function persistCouponToSession() {
    try {
      chrome.storage.session.set({
        pfc_tradeify_coupon: {
          couponCode: networkData.couponCode,
          email: networkData.email,
          orderPaidAmount: networkData.orderPaidAmount,
          couponDiscount: networkData.couponDiscount,
          couponDiscountType: networkData.couponDiscountType,
          timestamp: Date.now()
        }
      });
    } catch (e) { /* session storage not available */ }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // INTERCOM DATA FROM LOCALSTORAGE
  // ═══════════════════════════════════════════════════════════════════════

  function extractIntercomData() {
    try {
      // Intercom stores data in localStorage with various keys
      const intercomKeys = Object.keys(localStorage).filter(k =>
        k.includes('intercom') || k.includes('intercom-state')
      );

      for (const key of intercomKeys) {
        try {
          const data = JSON.parse(localStorage.getItem(key));
          if (data?.user?.email) {
            networkData.email = data.user.email;
            log('✅ Email from Intercom localStorage:', networkData.email);
          }
          if (data?.user?.user_id) {
            networkData.userId = data.user.user_id;
            log('✅ User ID from Intercom localStorage:', networkData.userId);
          }
          if (data?.user?.name) {
            networkData.userName = data.user.name;
          }
        } catch (e) {}
      }

      // Also check window.Intercom for settings
      if (window.Intercom && window.intercomSettings) {
        if (window.intercomSettings.email && !networkData.email) {
          networkData.email = window.intercomSettings.email;
          log('✅ Email from intercomSettings:', networkData.email);
        }
        if (window.intercomSettings.user_id && !networkData.userId) {
          networkData.userId = window.intercomSettings.user_id;
        }
        if (window.intercomSettings.name && !networkData.userName) {
          networkData.userName = window.intercomSettings.name;
        }
      }
    } catch (e) {
      log('⚠️ Error extracting Intercom data:', e);
    }
  }

  // Listen for network events from intercept script
  document.addEventListener('__pfc_tradeify_net', function(e) {
    try {
      const detail = typeof e.detail === 'string' ? JSON.parse(e.detail) : e.detail;
      if (!detail || !detail.type || !detail.data) return;

      const d = detail.data;

      // Handle coupon_applied from net-intercept (LAB was submitted by us)
      // d = { coupon_code, response: { success, data: { success, status, data: { coupon_applied, original_price, discount_amount, discount_percent, final_price } } } }
      if (detail.type === 'coupon_applied') {
        log('✅ LAB coupon applied by extension (net-intercept confirmed)');
        networkData.couponCode = 'LAB';
        networkData.couponLockedByExtension = true;

        // Extract discount + final price from couponsCheck response
        const couponResp = d.response?.data?.data || d.response?.data || d.response;
        if (couponResp) {
          log('📋 coupon_applied response:', JSON.stringify(couponResp).substring(0, 300));
          if (couponResp.discount_percent) {
            networkData.couponDiscount = parseFloat(couponResp.discount_percent) || 0;
            networkData.couponDiscountType = 'percentage';
          }
          if (couponResp.final_price) {
            networkData.orderPaidAmount = parseFloat(couponResp.final_price) || 0;
            log('✅ Final price from coupon response:', networkData.orderPaidAmount);
          }
          if (couponResp.discount_amount) {
            networkData.couponDiscountAmount = parseFloat(couponResp.discount_amount) || 0;
          }
        }

        persistCouponToSession();
        updateTrackerFromNetwork();
        // Re-attempt capture now that LAB is confirmed
        if (isCheckoutPage() && !purchaseCaptured) {
          setTimeout(captureCheckout, 300);
        }
        return;
      }

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
          processNetworkResponse(d.url, d.responseData, d.requestBody);
        }
      }
    } catch (err) {
      log('⚠️ Error processing network event:', err);
    }
  });

  function processNetworkResponse(url, data, requestBody) {
    if (!data || typeof data !== 'object') return;

    const urlLower = url.toLowerCase();

    // ─────────────────────────────────────────────────────────────────
    // Plan details endpoint
    // /api/dashboard/plandetails?id=xxx
    // ─────────────────────────────────────────────────────────────────
    if (urlLower.includes('plandetails')) {
      log('🔍 Processing plandetails response');
      // Try multiple response structures (API may vary)
      let plan = null;
      if (data.success && data.data?.data) {
        plan = data.data.data;
      } else if (data.data && typeof data.data === 'object' && data.data.name) {
        plan = data.data;
      } else if (data.success && data.data && typeof data.data === 'object') {
        plan = data.data;
      } else if (typeof data === 'object' && data.name && data.price) {
        plan = data;
      }

      if (plan) {
        networkData.plan = plan;
        networkData.lastNetworkUpdate = Date.now();

        // Only store coupon if it's a valid tracked coupon (LAB).
        // The API returns the plan's default promo (e.g. "Feb") which would
        // poison networkData before our LAB autofill runs.
        if (plan.coupon_code && VALID_COUPONS.includes(plan.coupon_code.toUpperCase())) {
          if (!networkData.couponLockedByExtension) {
            networkData.couponCode = plan.coupon_code;
          }
          networkData.couponDiscount = parseFloat(plan.coupon_discount_value) || 0;
          networkData.couponDiscountType = plan.coupon_discount_type;
        } else if (plan.coupon_code) {
          log('⏭️ Ignoring non-tracked API coupon "' + plan.coupon_code + '"');
        }

        log('✅ Plan details:', plan.name, plan.price, 'coupon:', plan.coupon_code);

        // Update tracker
        updateTrackerFromNetwork();
      } else {
        log('⚠️ plandetails response structure not recognized:', JSON.stringify(data).substring(0, 200));
      }
      return;
    }

    // ─────────────────────────────────────────────────────────────────
    // Plan list endpoint
    // /api/dashboard/plan-list
    // ─────────────────────────────────────────────────────────────────
    if (urlLower.includes('plan-list')) {
      log('🔍 Processing plan-list response');
      if (data.success && data.data?.data && Array.isArray(data.data.data)) {
        for (const plan of data.data.data) {
          if (plan.id) {
            networkData.plans[plan.id] = plan;
          }
        }
        log('✅ Loaded', Object.keys(networkData.plans).length, 'plans');
      }
      return;
    }

    // ─────────────────────────────────────────────────────────────────
    // User profile endpoint - best source of user data
    // /api/dashboard/profile
    // ─────────────────────────────────────────────────────────────────
    if (urlLower.includes('/profile') && !urlLower.includes('sumsub')) {
      log('🔍 Processing profile response');
      if (data.success && data.data) {
        const profile = data.data;
        if (profile.id) {
          networkData.userId = profile.id;
          log('✅ User ID from profile:', networkData.userId);
        }
        if (profile.email) {
          networkData.email = profile.email;
          log('✅ Email from profile:', networkData.email);
        }
        if (profile.first_name || profile.last_name) {
          networkData.userName = `${profile.first_name || ''} ${profile.last_name || ''}`.trim();
          log('✅ Name from profile:', networkData.userName);
        }
        if (profile.username) {
          networkData.username = profile.username;
        }
        if (profile.phone) {
          networkData.phone = profile.phone;
        }
        updateTrackerFromNetwork();
      }
      return;
    }

    // ─────────────────────────────────────────────────────────────────
    // Order details endpoint (called on success/thank-you page)
    // /api/dashboard/orderdetails?id=xxx
    // ─────────────────────────────────────────────────────────────────
    if (urlLower.includes('orderdetails')) {
      log('🔍 Processing orderdetails response');
      let order = null;
      if (data.success && data.data?.data) {
        order = data.data.data;
      } else if (data.data && typeof data.data === 'object') {
        order = data.data;
      } else if (data.success && data.data) {
        order = data.data;
      }

      if (order) {
        // Extract order number
        if (order.id || order.order_id) {
          networkData.orderId = String(order.id || order.order_id);
          log('✅ Order ID from orderdetails:', networkData.orderId);
        }

        // Extract actual paid price from order (most accurate source)
        // Log order keys for debugging (helps identify field names)
        log('📋 Order keys:', Object.keys(order).join(', '));
        const paidAmount = parseFloat(
          order.amount_paid || order.paid_amount || order.total || order.total_paid ||
          order.final_price || order.final_amount || order.price_paid ||
          order.final_price_paid || order.discounted_price || order.net_amount || order.subtotal ||
          order.amount || order.charge_amount || order.payment_amount || 0
        ) || 0;
        if (paidAmount > 0 && paidAmount !== parseFloat(networkData.plan?.price || 0)) {
          // Only use if it differs from the base price (meaning discount was applied)
          networkData.orderPaidAmount = paidAmount;
          log('✅ Paid amount from orderdetails:', paidAmount);
        } else if (paidAmount > 0) {
          log('ℹ️ Order amount matches plan price:', paidAmount, '— checking for discount fields');
          // Check if order has its own discount info
          const orderDiscount = parseFloat(order.discount || order.discount_amount || order.coupon_discount || 0) || 0;
          if (orderDiscount > 0) {
            networkData.orderPaidAmount = paidAmount - orderDiscount;
            log('✅ Calculated paid amount:', paidAmount, '-', orderDiscount, '=', networkData.orderPaidAmount);
          } else if (networkData.couponCode === 'LAB' && networkData.plan?.coupon_discount_value) {
            // Fallback: calculate from plan's discount if LAB coupon is active
            const discountPct = parseFloat(networkData.plan.coupon_discount_value) || 0;
            const originalPrice = parseFloat(networkData.plan.price) || 0;
            if (discountPct > 0 && originalPrice > 0) {
              networkData.orderPaidAmount = originalPrice * (1 - discountPct / 100);
              log('✅ Calculated paid amount from plan discount:', networkData.orderPaidAmount);
            }
          }
        }

        // Extract coupon from order if present
        const orderCoupon = order.coupon_code || order.coupon || order.applied_coupon;
        if (orderCoupon && VALID_COUPONS.includes(String(orderCoupon).toUpperCase()) && !networkData.couponCode) {
          networkData.couponCode = String(orderCoupon).toUpperCase();
          networkData.couponLockedByExtension = true;
          log('✅ LAB coupon confirmed from orderdetails');
        }

        // If plan data is missing, try to recover from order
        if (!networkData.plan) {
          if (order.plan_id && networkData.plans[order.plan_id]) {
            networkData.plan = networkData.plans[order.plan_id];
            log('🔗 Recovered plan from orderdetails plan_id:', order.plan_id);
          } else if (order.plan) {
            networkData.plan = order.plan;
            log('🔗 Got plan from orderdetails response');
          }
          if (networkData.plan) {
            networkData.lastNetworkUpdate = Date.now();
            // Only store valid tracked coupons — don't let default promos (e.g. "Feb") leak in
            if (networkData.plan.coupon_code && VALID_COUPONS.includes(networkData.plan.coupon_code.toUpperCase()) && !networkData.couponLockedByExtension) {
              networkData.couponCode = networkData.plan.coupon_code;
              networkData.couponDiscount = parseFloat(networkData.plan.coupon_discount_value) || 0;
              networkData.couponDiscountType = networkData.plan.coupon_discount_type;
            }
            updateTrackerFromNetwork();
          }
        }
      }
      return;
    }

    // ─────────────────────────────────────────────────────────────────
    // Intercom ping (contains user_data with email, user_id, name)
    // ─────────────────────────────────────────────────────────────────
    if (urlLower.includes('intercom') && urlLower.includes('ping')) {
      log('🔍 Processing Intercom ping');
      // Parse from request body (form-urlencoded)
      if (requestBody) {
        try {
          // user_data is URL encoded JSON in the request body
          const params = new URLSearchParams(requestBody);
          const userDataStr = params.get('user_data');
          if (userDataStr) {
            const userData = JSON.parse(decodeURIComponent(userDataStr));
            if (userData.email) {
              networkData.email = userData.email;
              log('✅ Email from Intercom:', networkData.email);
            }
            if (userData.user_id) {
              networkData.userId = userData.user_id;
              log('✅ User ID from Intercom:', networkData.userId);
            }
            if (userData.name) {
              networkData.userName = userData.name;
              log('✅ Name from Intercom:', networkData.userName);
            }
            updateTrackerFromNetwork();
          }
        } catch (e) {
          log('⚠️ Error parsing Intercom data:', e);
        }
      }
      return;
    }

    // ─────────────────────────────────────────────────────────────────
    // Coupon check endpoint — confirms LAB was applied server-side
    // /api/dashboard/couponsCheck/{planId}
    // ─────────────────────────────────────────────────────────────────
    if (urlLower.includes('couponscheck')) {
      log('🔍 Processing couponsCheck response');
      // Check the request body to see which coupon was submitted
      let submittedCoupon = null;
      if (requestBody) {
        try {
          const req = typeof requestBody === 'string' ? JSON.parse(requestBody) : requestBody;
          submittedCoupon = req.coupon_code;
        } catch (e) {}
      }

      // Also check response data for coupon_applied field (fallback if request body parsing fails)
      const couponRespData = data?.data?.data || data?.data || data;
      const responseCoupon = couponRespData?.coupon_applied || couponRespData?.coupon_code;

      if ((submittedCoupon && submittedCoupon.toUpperCase() === 'LAB') ||
          (responseCoupon && String(responseCoupon).toUpperCase() === 'LAB')) {
        log('✅ LAB coupon confirmed via couponsCheck API');
        networkData.couponCode = 'LAB';
        networkData.couponLockedByExtension = true;
        persistCouponToSession();

        // Extract discount info from couponsCheck response
        // Actual structure: { success, data: { success, status, data: { coupon_applied, original_price, discount_amount, discount_percent, final_price } } }
        const couponData = couponRespData;
        log('📋 couponsCheck response data:', JSON.stringify(couponData).substring(0, 300));
        if (couponData) {
          // discount_percent is the percentage value (e.g. "30.00")
          if (couponData.discount_percent) {
            networkData.couponDiscount = parseFloat(couponData.discount_percent) || 0;
            networkData.couponDiscountType = 'percentage';
          }
          // final_price is the actual amount to pay after discount
          if (couponData.final_price) {
            networkData.orderPaidAmount = parseFloat(couponData.final_price) || 0;
            log('✅ Final price from couponsCheck:', networkData.orderPaidAmount);
          }
          // Also store discount_amount for reference
          if (couponData.discount_amount) {
            networkData.couponDiscountAmount = parseFloat(couponData.discount_amount) || 0;
          }
        }

        updateTrackerFromNetwork();

        // Re-attempt capture now that LAB is confirmed
        if (isCheckoutPage() && !purchaseCaptured) {
          setTimeout(captureCheckout, 300);
        }
      }
      return;
    }

    // ─────────────────────────────────────────────────────────────────
    // Klaviyo analytics (fallback for email)
    // ─────────────────────────────────────────────────────────────────
    if (urlLower.includes('klaviyo') || urlLower.includes('event-bulk-create')) {
      log('🔍 Processing Klaviyo event');
      // Parse from request body
      if (requestBody) {
        try {
          const req = typeof requestBody === 'string' ? JSON.parse(requestBody) : requestBody;
          const profile = req.data?.attributes?.profile?.data?.attributes;
          if (profile?.email && !networkData.email) {
            networkData.email = profile.email;
            log('✅ Email from Klaviyo:', networkData.email);
          }
          const events = req.data?.attributes?.events?.data;
          if (events && events[0]?.attributes?.properties) {
            const props = events[0].attributes.properties;
            if (props.Email && !networkData.email) networkData.email = props.Email;
            if (props.UserID && !networkData.userId) networkData.userId = props.UserID;
          }
        } catch (e) {}
      }
      return;
    }
  }

  function updateTrackerFromNetwork() {
    // Update user data even without plan
    if (networkData.email || networkData.userId) {
      updateTrackerData({
        email: networkData.email,
        user_id: networkData.userId
      });
    }

    if (!networkData.plan) return;

    const plan = networkData.plan;
    const originalPrice = parseFloat(plan.price) || 0;
    let finalPrice = originalPrice;

    // Get discount info — prefer networkData, fallback to plan's coupon fields
    let discountValue = networkData.couponDiscount;
    let discountType = networkData.couponDiscountType;
    if (!discountValue && networkData.couponCode && plan.coupon_discount_value) {
      discountValue = parseFloat(plan.coupon_discount_value) || 0;
      discountType = plan.coupon_discount_type;
    }

    // Use actual paid amount if available, otherwise calculate from discount
    if (networkData.orderPaidAmount && networkData.orderPaidAmount > 0) {
      finalPrice = networkData.orderPaidAmount;
    } else if (discountValue && discountType === 'percentage') {
      finalPrice = originalPrice * (1 - discountValue / 100);
    } else if (discountValue && discountType === 'fixed') {
      finalPrice = originalPrice - discountValue;
    }

    const productName = `${plan.plan_type || ''} ${plan.account_type || plan.name}`.trim();

    updateTrackerData({
      product_name: productName,
      original_price: originalPrice,
      final_price: finalPrice,
      coupon_code: networkData.couponCode,
      email: networkData.email,
      user_id: networkData.userId
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TRACKER UI
  // ═══════════════════════════════════════════════════════════════════════

  let tracker = null;

  function initTracker() {
    if (window.__pfcTracker) {
      tracker = window.__pfcTracker;
      log('Using existing tracker');
      return;
    }

    if (!window.TrackerUI) {
      log('TrackerUI not loaded, retrying...');
      setTimeout(initTracker, 500);
      return;
    }

    if (tracker) return;

    tracker = new window.TrackerUI({
      partner: PARTNER,
      partnerName: PARTNER_NAME,
      fields: ['coupon', 'product', 'price', 'email', 'user_id', 'order_id'],
      fieldLabels: {
        coupon: 'Coupon Code',
        product: 'Account',
        price: 'Price',
        email: 'Email',
        user_id: 'Account ID',
        order_id: 'Order ID'
      },
      afterPurchaseFields: ['order_id']
    });

    window.__pfcTracker = tracker;
    log('Tracker initialized');
  }

  function showTracker() {
    if (!tracker) initTracker();
    if (tracker) tracker.show();
  }

  function updateTrackerData(data) {
    if (!tracker) return;

    if (data.product_name) {
      tracker.updateField('product', data.product_name);
    }
    if (data.final_price || data.original_price) {
      const origPrice = data.original_price;
      const finalPrice = data.final_price || origPrice;
      const priceDisplay = origPrice && finalPrice && origPrice > finalPrice
        ? tracker.formatPrice(origPrice, finalPrice)
        : `$${parseFloat(finalPrice || origPrice).toFixed(2)}`;
      tracker.updateField('price', finalPrice || origPrice, priceDisplay);
    }
    if (data.email) {
      tracker.updateField('email', data.email);
    }
    if (data.user_id) {
      tracker.updateField('user_id', data.user_id);
    }
    if (data.coupon_code) {
      tracker.updateField('coupon', data.coupon_code);
    }
    if (data.order_id) {
      tracker.updateField('order_id', data.order_id);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE DETECTION
  // ═══════════════════════════════════════════════════════════════════════

  function isCheckoutPage() {
    return window.location.pathname.includes('/checkout') ||
           window.location.href.includes('plan_id=');
  }

  function isSelectPlanPage() {
    return window.location.pathname.includes('/select-plan');
  }

  function isSuccessPage() {
    const text = document.body?.innerText || '';
    return text.includes('Payment Successful') ||
           text.includes('Thank you for your purchase') ||
           text.includes('Order confirmed') ||
           window.location.pathname.includes('/success') ||
           window.location.pathname.includes('/thank-you');
  }

  function getUrlPlanId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('plan_id');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // DATA EXTRACTION
  // ═══════════════════════════════════════════════════════════════════════

  function extractPurchaseData() {
    // Try to get Intercom data if not already captured
    if (!networkData.email && !networkData.userId) {
      extractIntercomData();
    }

    // If no plan loaded yet, try to match from URL plan_id against loaded plans
    if (!networkData.plan) {
      const urlPlanId = getUrlPlanId();
      if (urlPlanId && networkData.plans[urlPlanId]) {
        log('🔗 Matched plan from URL plan_id:', urlPlanId);
        networkData.plan = networkData.plans[urlPlanId];
        networkData.lastNetworkUpdate = Date.now();

        // Don't copy plan's default coupon here — coupon should only come from
        // coupon_applied event or plandetails response handler to avoid race
        // with LAB auto-apply

        updateTrackerFromNetwork();
      }
    }

    const plan = networkData.plan || {};
    const originalPrice = parseFloat(plan.price) || 0;
    let finalPrice = originalPrice;

    // Get discount info — prefer networkData, fallback to plan's coupon fields
    let discountValue = networkData.couponDiscount;
    let discountType = networkData.couponDiscountType;
    if (!discountValue && networkData.couponCode && plan.coupon_discount_value) {
      discountValue = parseFloat(plan.coupon_discount_value) || 0;
      discountType = plan.coupon_discount_type;
      log('ℹ️ Using plan coupon_discount_value for price calculation:', discountValue, discountType);
    }

    // Use actual paid amount if available, otherwise calculate from discount
    if (networkData.orderPaidAmount && networkData.orderPaidAmount > 0) {
      finalPrice = networkData.orderPaidAmount;
    } else if (discountValue && discountType === 'percentage') {
      finalPrice = originalPrice * (1 - discountValue / 100);
    } else if (discountValue && discountType === 'fixed') {
      finalPrice = originalPrice - discountValue;
    }

    const productName = plan.account_type || plan.name || null;

    // URL-based coupon detection — Tradeify puts couponCode=LAB in the URL after apply
    const urlParams = new URLSearchParams(window.location.search);
    const urlCoupon = urlParams.get('couponCode') || urlParams.get('coupon_code');
    if (urlCoupon && urlCoupon.toUpperCase() === 'LAB' && !networkData.couponCode) {
      log('✅ LAB coupon detected from URL parameter');
      networkData.couponCode = 'LAB';
      networkData.couponLockedByExtension = true;
    }

    // Extract orderID from URL (thank-you page has ?orderID=xxx)
    const urlOrderId = urlParams.get('orderID') || urlParams.get('orderId') || urlParams.get('order_id');
    if (urlOrderId && !networkData.orderId) {
      networkData.orderId = urlOrderId;
      log('✅ Order ID from URL params:', urlOrderId);
    }

    return {
      partner: PARTNER,
      email: networkData.email,
      user_id: networkData.userId,
      username: networkData.username,
      customer_name: networkData.userName,
      phone: networkData.phone,
      product_name: productName ? `${plan.plan_type || ''} ${productName}`.trim() : null,
      account_size: plan.additional_info?.initial_balance || null,
      original_price: originalPrice || null,
      final_price: finalPrice || null,
      discount_amount: originalPrice - finalPrice || null,
      coupon_code: networkData.couponCode,
      order_number: networkData.orderId || urlOrderId || null,
      plan_id: plan.id || getUrlPlanId(),
      broker: plan.broker || null,
      checkout_url: window.location.href,
      purchase_status: hasTriggeredSuccess ? 'success' : 'checkout'
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CAPTURE LOGIC
  // ═══════════════════════════════════════════════════════════════════════

  let hasTriggeredSuccess = false;
  let purchaseCaptured = false;

  function captureCheckout() {
    const data = extractPurchaseData();

    // Update tracker
    updateTrackerData(data);

    // Validate coupon
    if (!data.coupon_code) {
      log('⏭️ No coupon code found');
      if (tracker) tracker.showMessage('warning', 'Apply code "LAB" to track rewards');
      return;
    }

    const couponUpper = data.coupon_code.toUpperCase();
    if (!VALID_COUPONS.includes(couponUpper)) {
      log('⏭️ Coupon not tracked:', data.coupon_code);
      if (tracker) tracker.showMessage('info', `Code "${data.coupon_code}" applied`);
      return;
    }

    if (purchaseCaptured) {
      log('⏭️ Already captured');
      return;
    }

    if (!data.email && !data.final_price) {
      log('⏭️ Not enough data yet');
      if (tracker) tracker.setStatus('', 'Waiting for checkout data...');
      return;
    }

    log('✅ Capturing checkout:', data);
    if (tracker) {
      tracker.showMessage('success', `✓ Coupon "${data.coupon_code}" validated!`);
      tracker.setStatus('waiting', 'Waiting for payment...');
    }

    let captureRetries = 0;
    const MAX_CAPTURE_RETRIES = 3;

    function sendCapture() {
      chrome.runtime.sendMessage({ action: 'CAPTURE_PURCHASE', data }, (response) => {
        if (chrome.runtime.lastError) {
          log('❌ Capture error:', chrome.runtime.lastError.message, '(attempt', captureRetries + 1 + ')');
          captureRetries++;
          if (captureRetries < MAX_CAPTURE_RETRIES) {
            log('🔄 Retrying capture in', captureRetries * 2, 'seconds...');
            setTimeout(sendCapture, captureRetries * 2000);
          } else {
            log('❌ Capture failed after', MAX_CAPTURE_RETRIES, 'attempts');
            if (tracker) tracker.setStatus('error', 'Capture failed — reload page and retry');
          }
          return;
        }
        if (response?.success) {
          purchaseCaptured = true;
          log('✅ Queued with fingerprint:', response.fingerprint);
          // Persist checkout data so success page can recover it after navigation
          try {
            chrome.storage.session.set({ pfc_tradeify_checkout: data });
          } catch (e) { /* session storage not available in older Chrome */ }
        } else {
          log('❌ Capture returned failure:', response?.error);
          captureRetries++;
          if (captureRetries < MAX_CAPTURE_RETRIES) {
            log('🔄 Retrying capture in', captureRetries * 2, 'seconds...');
            setTimeout(sendCapture, captureRetries * 2000);
          } else {
            log('❌ Capture failed after', MAX_CAPTURE_RETRIES, 'attempts');
            if (tracker) tracker.setStatus('error', 'Capture failed — reload page and retry');
          }
        }
      });
    }

    sendCapture();
  }

  async function triggerSuccess() {
    if (hasTriggeredSuccess) return;
    hasTriggeredSuccess = true;

    log('🎉 Success page detected');

    // Wait for discount data to arrive (orderdetails may still be loading)
    const waitStart = Date.now();
    while (!networkData.orderPaidAmount && Date.now() - waitStart < 3000) {
      await new Promise(r => setTimeout(r, 500));
    }
    if (networkData.orderPaidAmount) {
      log('✅ Discount data available after', Date.now() - waitStart, 'ms');
    } else {
      log('⚠️ No discount data after 3s wait — proceeding with available data');
    }

    const data = extractPurchaseData();

    // Fallback: Try to extract order ID from DOM if not found via URL/network
    if (!data.order_number) {
      const text = document.body?.innerText || '';
      const orderMatch = text.match(/order[:\s#]*([A-Z0-9-]+)/i) ||
                         text.match(/confirmation[:\s#]*([A-Z0-9-]+)/i);
      if (orderMatch) {
        data.order_number = orderMatch[1];
        log('✅ Order number from DOM:', data.order_number);
      }
    }

    // Also try to get orderID from URL (Tradeify thank-you page has ?orderID=xxx)
    if (!data.order_number) {
      const urlOrderId = new URLSearchParams(window.location.search).get('orderID');
      if (urlOrderId) {
        data.order_number = urlOrderId;
        log('✅ Order number from URL param:', data.order_number);
      }
    }

    // Recover checkout data from session storage if coupon or price is missing
    // This handles full-page navigation where networkData is lost
    if (!data.coupon_code || !data.final_price || data.final_price === data.original_price) {
      try {
        const stored = await chrome.storage.session.get(['pfc_tradeify_checkout', 'pfc_tradeify_coupon']);
        // Try full checkout data first
        if (stored.pfc_tradeify_checkout) {
          const cached = stored.pfc_tradeify_checkout;
          log('📦 Recovered checkout data from session storage:', cached.coupon_code);
          data.coupon_code = data.coupon_code || cached.coupon_code;
          data.email = data.email || cached.email;
          data.final_price = data.final_price || cached.final_price;
          data.original_price = data.original_price || cached.original_price;
          data.product_name = data.product_name || cached.product_name;
          data.account_size = data.account_size || cached.account_size;
          data.plan_id = data.plan_id || cached.plan_id;
          data.customer_name = data.customer_name || cached.customer_name;
          data.discount_amount = data.discount_amount || cached.discount_amount;
        }
        // Also try coupon-only storage (has price from couponsCheck)
        if (stored.pfc_tradeify_coupon) {
          const couponStore = stored.pfc_tradeify_coupon;
          if (!data.coupon_code) {
            log('📦 Recovered coupon from session storage:', couponStore.couponCode);
            data.coupon_code = couponStore.couponCode;
          }
          data.email = data.email || couponStore.email;
          // Recover discounted price from couponsCheck response
          if (couponStore.orderPaidAmount && (!data.final_price || data.final_price === data.original_price)) {
            data.final_price = couponStore.orderPaidAmount;
            data.discount_amount = (data.original_price || 0) - couponStore.orderPaidAmount;
            log('📦 Recovered final_price from session:', couponStore.orderPaidAmount);
          }
        }
      } catch (e) {
        log('⚠️ Could not recover from session storage:', e.message);
      }
    }

    // Last resort: if still no coupon, force LAB if we're on the thank-you page
    // (user can only reach thank-you if they paid, and our extension applies LAB)
    if (!data.coupon_code && isSuccessPage()) {
      log('⚠️ No coupon found on success page — defaulting to LAB');
      data.coupon_code = 'LAB';
    }

    updateTrackerData(data);

    let successRetries = 0;
    const MAX_SUCCESS_RETRIES = 5;

    function sendSuccess() {
      chrome.runtime.sendMessage({
        action: 'SUCCESS_DETECTED',
        data: {
          partner: PARTNER,
          order_number: data.order_number,
          email: data.email,
          coupon_code: data.coupon_code,
          successData: data
        }
      }, (response) => {
        if (chrome.runtime.lastError) {
          log('❌ SUCCESS_DETECTED error:', chrome.runtime.lastError.message, '(attempt', successRetries + 1 + ')');
          successRetries++;
          if (successRetries < MAX_SUCCESS_RETRIES) {
            const delay = successRetries * 2000;
            log('🔄 Retrying SUCCESS_DETECTED in', delay / 1000, 'seconds...');
            if (tracker) tracker.setStatus('waiting', 'Submitting... (retry ' + successRetries + ')');
            setTimeout(sendSuccess, delay);
          } else {
            log('❌ SUCCESS_DETECTED failed after', MAX_SUCCESS_RETRIES, 'attempts');
            if (tracker) tracker.setStatus('error', 'Tracking failed — check extension login');
            // Save to persistent storage for retry on next page load or service worker restart
            log('💾 Saving to persistent retry storage...');
            chrome.storage.local.set({
              pfc_tradeify_stuck_purchase: {
                data: data,
                timestamp: Date.now(),
                retries: 0,
                order_number: data.order_number
              }
            });
          }
          return;
        }

        if (response?.success) {
          purchaseCaptured = false;
          log('✅ SUCCESS_DETECTED accepted:', response);
          if (tracker) {
            tracker.setStatus('success', response.skipped ? 'Already tracked' : 'Reward tracked!');
          }
        } else {
          log('❌ SUCCESS_DETECTED returned failure:', response?.error, '(attempt', successRetries + 1 + ')');
          successRetries++;
          if (successRetries < MAX_SUCCESS_RETRIES) {
            const delay = successRetries * 2000;
            log('🔄 Retrying SUCCESS_DETECTED in', delay / 1000, 'seconds...');
            if (tracker) tracker.setStatus('waiting', 'Submitting... (retry ' + successRetries + ')');
            setTimeout(sendSuccess, delay);
          } else {
            log('❌ SUCCESS_DETECTED failed after', MAX_SUCCESS_RETRIES, 'attempts — error:', response?.error);
            if (tracker) tracker.setStatus('error', response?.error || 'Tracking failed');
            // Save to persistent storage for retry on next page load or service worker restart
            log('💾 Saving to persistent retry storage...');
            chrome.storage.local.set({
              pfc_tradeify_stuck_purchase: {
                data: data,
                timestamp: Date.now(),
                retries: 0,
                order_number: data.order_number
              }
            });
          }
        }
      });
    }

    sendSuccess();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // AUTOFILL - Direct implementation (like TakeProfitTrader)
  // ═══════════════════════════════════════════════════════════════════════

  let autofillAttempted = false;
  let autofillInProgress = false;

  async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function performAutofill() {
    if (autofillAttempted || autofillInProgress) {
      return;
    }

    // Check if LAB coupon already applied (look for chip with LAB text)
    const existingChip = document.querySelector('.promo_chip');
    if (existingChip && existingChip.textContent?.toUpperCase().includes('LAB')) {
      log('✅ LAB coupon already applied (chip detected)');
      autofillAttempted = true;
      // Ensure networkData has LAB even if coupon_applied event was missed
      if (!networkData.couponCode) {
        networkData.couponCode = 'LAB';
        networkData.couponLockedByExtension = true;
        persistCouponToSession();
        updateTrackerFromNetwork();
      }
      if (tracker) {
        tracker.updateField('coupon', 'LAB');
        tracker.setAutoFillStatus('success', 'Code "LAB" already applied ✓');
        setTimeout(() => tracker.setAutoFillStatus('hidden', ''), 3000);
      }
      // Trigger capture if on checkout and not yet captured
      if (isCheckoutPage() && !purchaseCaptured) {
        setTimeout(captureCheckout, 300);
      }
      return;
    }

    autofillInProgress = true;
    log('🔄 Starting coupon autofill...');

    if (tracker) {
      tracker.setAutoFillStatus('applying', 'Applying code "LAB"...');
    }

    try {
      // Step 1: Find "Add promo code" button
      let promoBtn = document.querySelector('.promo_btn');
      if (!promoBtn) {
        // Fallback: search by text
        const allButtons = document.querySelectorAll('button');
        for (const btn of allButtons) {
          const text = btn.textContent?.toLowerCase() || '';
          if (text.includes('add promo') || text.includes('promo code')) {
            promoBtn = btn;
            break;
          }
        }
      }

      if (!promoBtn) {
        log('⚠️ Promo button not found');
        autofillAttempted = true;
        autofillInProgress = false;
        if (tracker) tracker.setAutoFillStatus('error', 'Promo button not found');
        return;
      }

      // Click promo button with proper event simulation
      log('📍 Found promo button, clicking...');
      promoBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      // Wait for input to appear
      await sleep(300);

      // Step 2: Find promo input - try multiple selectors
      let input = null;
      const inputSelectors = [
        "input[placeholder*='promo' i]",
        "input[placeholder*='coupon' i]",
        "input[placeholder*='code' i]",
        "input[name*='promo' i]",
        "input[name*='coupon' i]",
        ".MuiInputBase-input"
      ];

      // Poll for input appearance
      for (let attempt = 0; attempt < 10 && !input; attempt++) {
        for (const selector of inputSelectors) {
          const found = document.querySelector(selector);
          // Make sure it's visible and not the search input
          if (found && found.offsetParent !== null &&
              !found.placeholder?.toLowerCase().includes('search') &&
              !found.placeholder?.toLowerCase().includes('address')) {
            input = found;
            break;
          }
        }
        if (!input) {
          await sleep(100);
        }
      }

      if (!input) {
        log('⚠️ Promo input not found after clicking button');
        autofillAttempted = true;
        autofillInProgress = false;
        if (tracker) tracker.setAutoFillStatus('error', 'Input not found - try manually');
        return;
      }

      log('📍 Found input:', input.placeholder || input.name || 'no-name');

      // Check if already filled with LAB
      if (input.value?.toUpperCase() === 'LAB') {
        log('✅ Input already has LAB');
        autofillAttempted = true;
        autofillInProgress = false;
        if (tracker) {
          tracker.updateField('coupon', 'LAB');
          tracker.setAutoFillStatus('success', 'Code "LAB" ready ✓');
          setTimeout(() => tracker.setAutoFillStatus('hidden', ''), 3000);
        }
        return;
      }

      // Step 3: Fill the input with proper React/MUI simulation
      log('📝 Filling input with LAB...');

      // Clear and focus
      input.focus();
      input.select && input.select();

      // Set value using native setter to trigger React state
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeInputValueSetter.call(input, 'LAB');

      // Dispatch events that React listens to
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      // Also try keyup for good measure
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

      await sleep(150);

      // Step 4: Find and click Apply button
      let applyButton = null;
      const allButtons = document.querySelectorAll('button');
      for (const btn of allButtons) {
        const text = btn.textContent?.trim().toLowerCase() || '';
        if (text === 'apply' || (text.includes('apply') && !text.includes('pay'))) {
          applyButton = btn;
          break;
        }
      }

      if (applyButton) {
        log('📍 Found Apply button, clicking...');

        // Brief wait for button to be enabled
        for (let i = 0; i < 5 && applyButton.disabled; i++) {
          await sleep(50);
        }

        if (!applyButton.disabled) {
          applyButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          log('✅ Clicked Apply button');
        }
      }

      autofillAttempted = true;
      autofillInProgress = false;

      log('✅ Autofill completed');

      // Set networkData — don't rely solely on coupon_applied event from net-intercept
      // The couponsCheck XHR handler will also set this if it fires, but this is the fallback
      if (!networkData.couponCode) {
        networkData.couponCode = 'LAB';
        networkData.couponLockedByExtension = true;
        log('✅ Set networkData.couponCode = LAB from autofill');
      }

      updateTrackerFromNetwork();

      if (tracker) {
        tracker.updateField('coupon', 'LAB');
        tracker.setAutoFillStatus('success', 'Code "LAB" applied! ✓');
        setTimeout(() => tracker.setAutoFillStatus('hidden', ''), 2000);
      }

      // Re-attempt capture now that LAB is set
      if (isCheckoutPage() && !purchaseCaptured) {
        setTimeout(captureCheckout, 500);
      }

    } catch (error) {
      log('❌ Autofill error:', error.message);
      autofillInProgress = false;
      autofillAttempted = true;
      if (tracker) tracker.setAutoFillStatus('error', 'Autofill failed');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE CHECK
  // ═══════════════════════════════════════════════════════════════════════

  function checkPage() {
    log('📄 Checking page:', window.location.pathname);

    if (isCheckoutPage()) {
      log('📦 Checkout page detected');
      showTracker();
      if (tracker) tracker.setStatus('', 'Detecting checkout data...');
      setTimeout(captureCheckout, 1000);
      // Attempt autofill quickly
      setTimeout(performAutofill, 800);
    } else if (isSelectPlanPage()) {
      log('📋 Select plan page detected');
      // Don't show tracker yet, but capture profile data
      // Profile API will be captured by network intercept
    } else if (isSuccessPage()) {
      log('🎉 Success page detected');
      showTracker();
      setTimeout(triggerSuccess, 1000);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // URL OBSERVER (SPA navigation)
  // ═══════════════════════════════════════════════════════════════════════

  let lastUrl = window.location.href;

  function setupUrlObserver() {
    if (!document.body) {
      setTimeout(setupUrlObserver, 100);
      return;
    }

    const observer = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        log('🔗 URL changed:', lastUrl);

        // Reset flags for new page
        hasTriggeredSuccess = false;
        purchaseCaptured = false;
        autofillAttempted = false;
        autofillInProgress = false;

        // Only clear plan data if navigating back to plan selection
        // Keep it when navigating from checkout to success page
        const newPath = window.location.pathname.toLowerCase();
        if (newPath.includes('select-plan') || newPath.includes('/dashboard')) {
          networkData.plan = null;
          networkData.lastNetworkUpdate = 0;
          log('🔄 Reset plan data (navigated to plan selection)');
        } else {
          log('📦 Keeping plan data for success page');
        }

        setTimeout(checkPage, 500);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // DEBUG INTERFACE
  // ═══════════════════════════════════════════════════════════════════════

  window.tradeifyDebug = {
    extract: extractPurchaseData,
    network: () => networkData,
    networkLog: () => networkData.network_log,
    showNetwork: () => {
      console.log('[Tradeify] Network Data:');
      console.log('  Plan:', networkData.plan?.name);
      console.log('  Price:', networkData.plan?.price);
      console.log('  Coupon:', networkData.couponCode, networkData.couponDiscount ? networkData.couponDiscount + '%' : 'N/A');
      console.log('  Email:', networkData.email);
      console.log('  User ID:', networkData.userId);
      console.log('  Username:', networkData.username);
      console.log('  Name:', networkData.userName);
      console.log('  Phone:', networkData.phone);
      console.log('  Requests logged:', networkData.network_log.length);
      return networkData;
    },
    status: () => ({
      isCheckout: isCheckoutPage(),
      isSuccess: isSuccessPage(),
      purchaseCaptured,
      hasTriggeredSuccess,
      planLoaded: !!networkData.plan
    }),
    recheck: () => {
      purchaseCaptured = false;
      checkPage();
    },
    extractIntercom: extractIntercomData,
    autofill: () => {
      autofillAttempted = false;
      autofillInProgress = false;
      performAutofill();
    },
    exportAll: () => {
      return JSON.stringify({
        exportTimestamp: new Date().toISOString(),
        extensionVersion: VERSION,
        url: window.location.href,
        pageType: {
          isCheckout: isCheckoutPage(),
          isSuccess: isSuccessPage(),
          isSelectPlan: isSelectPlanPage()
        },
        captureStatus: {
          purchaseCaptured,
          hasTriggeredSuccess
        },
        purchaseData: extractPurchaseData(),
        networkData: {
          plan: networkData.plan,
          email: networkData.email,
          userId: networkData.userId,
          userName: networkData.userName,
          username: networkData.username,
          phone: networkData.phone,
          couponCode: networkData.couponCode,
          couponDiscount: networkData.couponDiscount,
          couponDiscountType: networkData.couponDiscountType,
          couponDiscountAmount: networkData.couponDiscountAmount,
          orderPaidAmount: networkData.orderPaidAmount,
          couponLockedByExtension: networkData.couponLockedByExtension
        },
        networkLog: networkData.network_log
      }, null, 2);
    },
    download: () => {
      const data = window.tradeifyDebug.exportAll();
      const orderNum = extractPurchaseData().order_number || 'unknown';
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pfc-tradeify-${orderNum}-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  // ═══════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════

  function init() {
    log(`📦 Tradeify Content Script ${VERSION} loaded`);
    log('   URL:', window.location.href);
    log('   isCheckout:', isCheckoutPage());

    setupUrlObserver();

    // Try to extract Intercom data from localStorage on load
    setTimeout(() => {
      extractIntercomData();
      if (networkData.email || networkData.userId) {
        updateTrackerFromNetwork();
      }
    }, 2000);

    // Initial check after page settles
    setTimeout(checkPage, 1500);

    // Periodic re-check for late-loading data
    setInterval(() => {
      // Try to match plan from URL if not yet matched but plans are loaded
      if (!networkData.plan && Object.keys(networkData.plans).length > 0) {
        const urlPlanId = getUrlPlanId();
        if (urlPlanId && networkData.plans[urlPlanId]) {
          log('🔗 Late match: plan from URL plan_id:', urlPlanId);
          networkData.plan = networkData.plans[urlPlanId];
          networkData.lastNetworkUpdate = Date.now();
          // Don't copy plan's default coupon — same race condition as extractPurchaseData
          updateTrackerFromNetwork();
        }
      }
      if (isCheckoutPage() && !purchaseCaptured && networkData.plan) {
        captureCheckout();
      }
      // Re-check Intercom data periodically
      if (!networkData.email) {
        extractIntercomData();
        if (networkData.email) {
          updateTrackerFromNetwork();
        }
      }
    }, 3000);

    // Check for stuck purchases from previous failed submissions
    chrome.storage.local.get(['pfc_tradeify_stuck_purchase'], (stored) => {
      if (stored.pfc_tradeify_stuck_purchase) {
        const stuck = stored.pfc_tradeify_stuck_purchase;
        if (Date.now() - stuck.timestamp < 24 * 60 * 60 * 1000) { // < 24 hours old
          log('🔄 Found stuck purchase, retrying:', stuck.order_number);
          chrome.runtime.sendMessage({
            action: 'SUCCESS_DETECTED',
            data: {
              partner: PARTNER,
              order_number: stuck.data.order_number,
              email: stuck.data.email,
              coupon_code: stuck.data.coupon_code,
              successData: stuck.data
            }
          }, (response) => {
            if (!chrome.runtime.lastError && response?.success) {
              log('✅ Stuck purchase submitted successfully');
              chrome.storage.local.remove(['pfc_tradeify_stuck_purchase']);
            } else {
              log('⚠️ Stuck purchase retry failed:', chrome.runtime.lastError?.message || response?.error);
            }
          });
        } else {
          log('🗑️ Removing expired stuck purchase (> 24h old)');
          chrome.storage.local.remove(['pfc_tradeify_stuck_purchase']);
        }
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // MESSAGE LISTENER - responds to popup/background requests
  // ═══════════════════════════════════════════════════════════════════════

  chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.action === 'GET_LIVE_EXTRACTION') {
      const data = extractPurchaseData();
      sendResponse({
        partner: PARTNER,
        extractedData: data,
        networkData: {
          plan: networkData.plan,
          plans: networkData.plans,
          email: networkData.email,
          userId: networkData.userId,
          userName: networkData.userName,
          username: networkData.username,
          phone: networkData.phone,
          couponCode: networkData.couponCode,
          couponDiscount: networkData.couponDiscount,
          couponDiscountType: networkData.couponDiscountType,
          couponLockedByExtension: networkData.couponLockedByExtension,
          orderPaidAmount: networkData.orderPaidAmount,
          lastNetworkUpdate: networkData.lastNetworkUpdate,
          network_log: networkData.network_log
        },
        pageStatus: {
          isCheckout: isCheckoutPage(),
          isSuccess: isSuccessPage(),
          purchaseCaptured: purchaseCaptured,
          hasTriggeredSuccess: hasTriggeredSuccess,
          planLoaded: !!networkData.plan
        }
      });
      return false;
    }
  });

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
