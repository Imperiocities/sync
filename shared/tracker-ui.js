// tracker-ui.js — Real-time checkout tracking widget for PropFirm Compare
// Provides the on-page floating UI that shows tracking status, captured fields,
// and status messages during checkout-to-purchase flow.
(function () {
  'use strict';

  const FIELD_LABELS = {
    product: 'Product',
    price: 'Price',
    coupon: 'Coupon',
    email: 'Email',
    order_id: 'Order #'
  };

  class TrackerUI {
    constructor(config = {}) {
      this.fields = config.fields || ['product', 'price', 'coupon', 'email'];
      this.afterPurchaseFields = config.afterPurchaseFields || [];
      this.fieldValues = {};
      this.currentStatus = '';
      this.currentStatusMessage = '';
      this.isVisible = false;
      this.isMinimized = false;
      this.container = null;
      this.autoFillEl = null;
      this.messageTimeout = null;

      this._buildDOM();

      // Store globally so other scripts can access
      window.__pfcTracker = this;
    }

    _buildDOM() {
      // Remove any existing tracker
      const existing = document.getElementById('pfc-checkout-tracker');
      if (existing) existing.remove();

      this.container = document.createElement('div');
      this.container.id = 'pfc-checkout-tracker';
      this.container.className = 'propfirm-checkout-tracker';
      this.container.innerHTML = this._html();

      // Wire up close/minimize button
      const closeBtn = this.container.querySelector('.propfirm-tracker-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => this._toggleMinimize());
      }

      // Wire up manual download button
      const dlBtn = this.container.querySelector('.propfirm-tracker-download-btn');
      if (dlBtn) {
        dlBtn.addEventListener('click', () => this._manualDownload());
      }

      // Add inline styles for tracker item label/value layout
      const style = document.createElement('style');
      style.textContent = `
        .propfirm-tracker-item-label {
          font-weight: 600 !important;
          min-width: 55px !important;
          font-size: 11px !important;
          text-transform: uppercase !important;
          letter-spacing: 0.3px !important;
          opacity: 0.7 !important;
        }
        .propfirm-tracker-item-value {
          flex: 1 !important;
          text-align: right !important;
          font-size: 12px !important;
          font-weight: 500 !important;
          color: inherit !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          white-space: nowrap !important;
        }
        .propfirm-tracker-item.captured .propfirm-tracker-item-value {
          color: #00E5A0 !important;
        }
        .propfirm-tracker-body {
          padding: 0 !important;
        }
        .propfirm-tracker-autofill {
          margin: 0 0 8px 0 !important;
        }
        .propfirm-tracker-recording {
          display: inline-flex !important;
          align-items: center !important;
          gap: 5px !important;
          font-size: 10px !important;
          font-weight: 700 !important;
          color: #ff4444 !important;
          text-transform: uppercase !important;
          letter-spacing: 1px !important;
          margin-right: 8px !important;
        }
        .rec-dot {
          width: 8px !important;
          height: 8px !important;
          border-radius: 50% !important;
          background: #ff4444 !important;
          display: inline-block !important;
          animation: pfc-rec-pulse 1.2s ease-in-out infinite !important;
        }
        @keyframes pfc-rec-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.8); }
        }
        .propfirm-tracker-download-btn {
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          gap: 6px !important;
          width: 100% !important;
          margin-top: 10px !important;
          padding: 8px 12px !important;
          background: rgba(255, 255, 255, 0.08) !important;
          border: 1px solid rgba(255, 255, 255, 0.15) !important;
          border-radius: 8px !important;
          color: rgba(255, 255, 255, 0.8) !important;
          font-size: 11px !important;
          font-weight: 600 !important;
          cursor: pointer !important;
          transition: all 0.2s ease !important;
          font-family: inherit !important;
        }
        .propfirm-tracker-download-btn:hover {
          background: rgba(0, 229, 160, 0.15) !important;
          border-color: rgba(0, 229, 160, 0.4) !important;
          color: #00E5A0 !important;
        }
        .propfirm-tracker-download-btn svg {
          flex-shrink: 0 !important;
        }
        .propfirm-tracker-download-notice {
          margin-top: 8px !important;
          padding: 8px 10px !important;
          background: rgba(0, 229, 160, 0.1) !important;
          border: 1px solid rgba(0, 229, 160, 0.3) !important;
          border-radius: 8px !important;
          font-size: 11px !important;
          color: #00E5A0 !important;
          text-align: center !important;
        }
      `;
      this.container.appendChild(style);

      document.documentElement.appendChild(this.container);
    }

    _html() {
      const fieldItems = this.fields.map(f => {
        const label = FIELD_LABELS[f] || f;
        return `<li class="propfirm-tracker-item pending" data-field="${f}">
          <span class="propfirm-tracker-item-icon"></span>
          <span class="propfirm-tracker-item-label">${label}:</span>
          <span class="propfirm-tracker-item-value" data-field-value="${f}">--</span>
        </li>`;
      }).join('');

      return `
        <div class="propfirm-tracker-header">
          <span class="propfirm-tracker-recording" style="display:none;">
            <span class="rec-dot"></span> REC
          </span>
          <span class="propfirm-tracker-title">PropFirm Tracker</span>
          <button class="propfirm-tracker-close" title="Minimize">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        </div>
        <div class="propfirm-tracker-body">
          <div class="propfirm-tracker-status">
            <div class="propfirm-tracker-spinner"></div>
            <span class="propfirm-tracker-status-text">Initializing...</span>
          </div>
          <div class="propfirm-tracker-autofill" style="display:none;"></div>
          <ul class="propfirm-tracker-checklist">${fieldItems}</ul>
          <div class="propfirm-tracker-message" style="display:none;"></div>
          <button class="propfirm-tracker-download-btn" title="Download tracking data">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7,10 12,15 17,10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Download Data
          </button>
        </div>
      `;
    }

    // --- Public API ---

    show() {
      if (!this.container) this._buildDOM();
      this.isVisible = true;
      this.isMinimized = false;
      this.container.classList.add('visible');
      const body = this.container.querySelector('.propfirm-tracker-body');
      if (body) body.style.display = '';
    }

    hide() {
      this.isVisible = false;
      if (this.container) this.container.classList.remove('visible');
    }

    setStatus(status, message) {
      this.currentStatus = status;
      this.currentStatusMessage = message || '';

      const statusEl = this.container?.querySelector('.propfirm-tracker-status');
      const textEl = this.container?.querySelector('.propfirm-tracker-status-text');
      if (!statusEl || !textEl) return;

      // Remove old state classes
      statusEl.classList.remove('success', 'error', 'warning', 'waiting-order', 'order-confirmed');

      // Map status to CSS class
      const classMap = {
        success: 'success',
        error: 'error',
        warning: 'warning',
        waiting: '',
        capturing: '',
        submitting: '',
        idle: ''
      };

      const cls = classMap[status];
      if (cls) statusEl.classList.add(cls);

      // Update border color on container
      if (this.container) {
        this.container.classList.remove('success', 'warning', 'error');
        if (cls === 'success' || cls === 'warning' || cls === 'error') {
          this.container.classList.add(cls);
        }
      }

      textEl.textContent = message || status || 'Ready';
    }

    showMessage(type, message) {
      const msgEl = this.container?.querySelector('.propfirm-tracker-message');
      if (!msgEl) return;

      // Clear previous timeout
      if (this.messageTimeout) {
        clearTimeout(this.messageTimeout);
        this.messageTimeout = null;
      }

      // Set class based on type
      msgEl.className = 'propfirm-tracker-message';
      if (type === 'success') msgEl.className += ' propfirm-tracker-success';
      else if (type === 'error') msgEl.className += ' propfirm-tracker-error';
      else if (type === 'warning') msgEl.className += ' propfirm-tracker-warning';
      else msgEl.className += ' propfirm-tracker-success'; // info defaults to success style

      msgEl.textContent = message;
      msgEl.style.display = 'block';

      // Auto-hide after 8 seconds for success/info, keep errors visible
      if (type !== 'error') {
        this.messageTimeout = setTimeout(() => {
          msgEl.style.display = 'none';
        }, 8000);
      }
    }

    updateField(fieldName, value, displayText) {
      this.fieldValues[fieldName] = { value, displayText };

      const itemEl = this.container?.querySelector(`.propfirm-tracker-item[data-field="${fieldName}"]`);
      const valueEl = this.container?.querySelector(`[data-field-value="${fieldName}"]`);
      if (!itemEl || !valueEl) return;

      // Mark as captured
      itemEl.classList.remove('pending', 'waiting-purchase');
      itemEl.classList.add('captured');

      // Show display text if provided, otherwise value
      const display = displayText || value || '--';
      // Truncate long values
      valueEl.textContent = String(display).length > 40
        ? String(display).substring(0, 37) + '...'
        : String(display);
      valueEl.title = String(display);
    }

    clearField(fieldName) {
      delete this.fieldValues[fieldName];

      const itemEl = this.container?.querySelector(`.propfirm-tracker-item[data-field="${fieldName}"]`);
      const valueEl = this.container?.querySelector(`[data-field-value="${fieldName}"]`);
      if (!itemEl || !valueEl) return;

      itemEl.classList.remove('captured', 'waiting-purchase');
      itemEl.classList.add('pending');
      valueEl.textContent = '--';
      valueEl.title = '';
    }

    setAutoFillStatus(status, message) {
      const el = this.container?.querySelector('.propfirm-tracker-autofill');
      if (!el) return;

      if (status === 'hidden' || !message) {
        el.style.display = 'none';
        el.textContent = '';
        return;
      }

      el.style.display = 'block';
      el.textContent = message;
      el.className = 'propfirm-tracker-autofill';

      if (status === 'success') {
        el.style.color = '#00E5A0';
        el.style.background = 'rgba(0, 229, 160, 0.1)';
        el.style.border = '1px solid rgba(0, 229, 160, 0.3)';
      } else if (status === 'error') {
        el.style.color = '#ff5252';
        el.style.background = 'rgba(255, 82, 82, 0.1)';
        el.style.border = '1px solid rgba(255, 82, 82, 0.3)';
      } else if (status === 'warning') {
        el.style.color = '#ff9800';
        el.style.background = 'rgba(255, 152, 0, 0.1)';
        el.style.border = '1px solid rgba(255, 152, 0, 0.3)';
      }

      el.style.padding = '6px 10px';
      el.style.borderRadius = '6px';
      el.style.fontSize = '11px';
      el.style.marginBottom = '8px';

      // Auto-hide after 5 seconds
      setTimeout(() => {
        el.style.display = 'none';
      }, 5000);
    }

    formatPrice(originalPrice, finalPrice) {
      const fmt = (v) => {
        if (v === null || v === undefined || v === '') return null;
        const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
        if (isNaN(n)) return String(v);
        return '$' + n.toFixed(2);
      };

      const orig = fmt(originalPrice);
      const final_ = fmt(finalPrice);

      if (orig && final_ && orig !== final_) {
        return `${orig} → ${final_}`;
      }
      return final_ || orig || '';
    }

    // --- Recording indicator ---

    startRecording() {
      const el = this.container?.querySelector('.propfirm-tracker-recording');
      if (el) el.style.display = 'inline-flex';
    }

    stopRecording() {
      const el = this.container?.querySelector('.propfirm-tracker-recording');
      if (el) el.style.display = 'none';
    }

    // --- Auto-download tracking data ---

    downloadData(payload, apiResponse) {
      try {
        // Separate _enriched from core purchase fields
        const enriched = payload?._enriched || {};
        const purchase = {};
        if (payload) {
          for (const [k, v] of Object.entries(payload)) {
            if (k !== '_enriched') purchase[k] = v;
          }
        }

        const exportData = {
          exportedAt: new Date().toISOString(),
          extensionVersion: (typeof chrome !== 'undefined' && chrome.runtime?.getManifest)
            ? chrome.runtime.getManifest().version
            : 'unknown',
          partner: payload?.partner || 'unknown',
          purchase: purchase,
          enriched: enriched,
          apiResponse: apiResponse || null,
          trackerFields: Object.assign({}, this.fieldValues)
        };

        const json = JSON.stringify(exportData, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const orderNum = payload?.order_number || payload?.transaction_id || '';
        const dateStr = new Date().toISOString().replace(/[:.]/g, '-').split('T');
        const safeName = orderNum
          ? `pfc-tpt-${String(orderNum).replace(/[^a-zA-Z0-9_-]/g, '')}-${dateStr[0]}`
          : `pfc-tpt-${dateStr[0]}-${dateStr[1].substring(0, 8)}`;

        const a = document.createElement('a');
        a.href = url;
        a.download = safeName + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        // Show download notice in tracker
        const msgEl = this.container?.querySelector('.propfirm-tracker-message');
        if (msgEl) {
          msgEl.className = 'propfirm-tracker-message propfirm-tracker-download-notice';
          msgEl.textContent = 'Tracking data saved to Downloads';
          msgEl.style.display = 'block';
          setTimeout(() => { msgEl.style.display = 'none'; }, 6000);
        }
      } catch (err) {
        console.error('[TrackerUI] downloadData error:', err);
      }
    }

    // --- Private helpers ---

    _manualDownload() {
      // Grab live data from the content script's debug interface
      const debug = window.tptDebug || window.PropFirmDebugTracker;
      const liveData = {};

      if (window.tptDebug) {
        try {
          liveData.purchaseData = window.tptDebug.data();
          liveData.captureStatus = window.tptDebug.status();
          liveData.eventTimeline = window.tptDebug.events();
          liveData.networkLog = window.tptDebug.network();
          liveData.priceHistory = window.tptDebug.prices();
          liveData.errorLog = window.tptDebug.errors();
          liveData.session = window.tptDebug.session();
          liveData.snapshot = window.tptDebug.snapshot();
        } catch (e) {
          liveData._debugError = e.message;
        }
      }

      const exportData = {
        exportedAt: new Date().toISOString(),
        exportType: 'manual_download',
        extensionVersion: (typeof chrome !== 'undefined' && chrome.runtime?.getManifest)
          ? chrome.runtime.getManifest().version
          : 'unknown',
        pageUrl: window.location.href,
        trackerFields: Object.assign({}, this.fieldValues),
        trackerStatus: this.currentStatus,
        trackerStatusMessage: this.currentStatusMessage,
        liveData: liveData
      };

      const json = JSON.stringify(exportData, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const dateStr = new Date().toISOString().replace(/[:.]/g, '-').split('T');
      const host = window.location.hostname.replace(/[^a-zA-Z0-9]/g, '-');
      const filename = `pfc-${host}-${dateStr[0]}-${dateStr[1].substring(0, 8)}.json`;

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Visual feedback
      const btn = this.container?.querySelector('.propfirm-tracker-download-btn');
      if (btn) {
        btn.textContent = 'Downloaded!';
        btn.style.color = '#00E5A0';
        setTimeout(() => {
          btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download Data';
          btn.style.color = '';
        }, 2000);
      }
    }

    _toggleMinimize() {
      if (this.isMinimized) {
        // Expand
        this.isMinimized = false;
        const body = this.container.querySelector('.propfirm-tracker-body');
        if (body) body.style.display = '';
        const closeBtn = this.container.querySelector('.propfirm-tracker-close svg');
        if (closeBtn) {
          closeBtn.innerHTML = '<line x1="5" y1="12" x2="19" y2="12"/>';
        }
      } else {
        // Minimize
        this.isMinimized = true;
        const body = this.container.querySelector('.propfirm-tracker-body');
        if (body) body.style.display = 'none';
        const closeBtn = this.container.querySelector('.propfirm-tracker-close svg');
        if (closeBtn) {
          closeBtn.innerHTML = '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>';
        }
      }
    }
  }

  // Expose globally
  window.TrackerUI = TrackerUI;
})();
