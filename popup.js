// JavaScript for PropFirm Compare Extension popup v2.4.3
// V2 Features: Account connection, rewards display

// Production logging control - set to false for production builds
const DEBUG_MODE = false; // Set to false for production builds

// V2: API Configuration
const API_BASE_URL = 'https://propfirm.compare';

// Local firm logo map — bundled with extension, no network needed
const FIRM_LOGOS = {
  // 'fundednext': 'logos/fundednext-futures.png',  // disabled — no active rewards program
  // 'fundednext futures': 'logos/fundednext-futures.png',
  'tradeify': 'logos/tradeify.png',
  'lucid trading': 'logos/lucid-trading.png',
  'lucidtrading': 'logos/lucid-trading.png',
  'alpha futures': 'logos/alpha-futures.png',
  'alphafutures': 'logos/alpha-futures.png',
  'apex trader funding': 'logos/apex-trader-funding.png',
  'apextraderfunding': 'logos/apex-trader-funding.png',
  'take profit trader': 'logos/take-profit-trader.png',
  'takeprofittrader': 'logos/take-profit-trader.png',
  'my funded futures': 'logos/my-funded-futures.png',
  'myfundedfutures': 'logos/my-funded-futures.png',
};

function getLocalLogo(firmName) {
  if (!firmName) return '';
  const key = firmName.toLowerCase().replace(/[^a-z ]/g, '').trim();
  return FIRM_LOGOS[key] || FIRM_LOGOS[key.replace(/\s+/g, '')] || '';
}

// Controlled logging functions
const debugLog = (...args) => {
  if (DEBUG_MODE) {
    console.log(...args);
  }
};

const debugError = (...args) => {
  if (DEBUG_MODE) {
    console.error(...args);
  }
};

class PopupManager {
  constructor() {
    this.currentTab = null;
    this.currentFirm = null;
    this.settings = {};
    
    this.init();
  }

  async init() {
    // Check if this is the first time opening the extension
    const hasSeenOnboarding = await this.checkOnboardingStatus();
    
    if (!hasSeenOnboarding) {
      this.showOnboarding();
      return; // Don't initialize the main app until onboarding is complete
    }
    
    // Reset animation state on popup open
    this.resetAnimationState();
    
    await this.loadCurrentTab();
    await this.loadSettings();
    
    // Show loading skeleton immediately
    this.showLoadingSkeleton();
    
    this.setupEventListeners();
    this.checkCurrentSite();
    
    // Load data and update UI
    await this.loadPropFirmsData();
    this.updateUI();
    
    // V2: Initialize account section
    await this.initAccountSection();
  }

  async loadCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      this.currentTab = tab;
    } catch (error) {
      debugError('Error getting current tab:', error);
    }
  }

  async loadSettings() {
    try {
      this.settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    } catch (error) {
      debugError('Error loading settings:', error);
      this.settings = { 
        autoApply: true, 
        enabled: true,
        showCheckoutReminders: true,
        showFloatingIcon: true,
        automaticCodeFilling: true
      };
    }
  }



  async loadPropFirmsData() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_PROP_FIRMS_DATA' });
      this.propFirmsData = response.data;
    } catch (error) {
      debugError('Error loading prop firms data:', error);
      this.propFirmsData = { firms: [] };
    }
  }

  setupEventListeners() {
    // Tab navigation
    this.setupTabNavigation();

    // Checkout reminder toggle
    const checkoutReminderToggle = document.getElementById('checkout-reminder-toggle');
    if (checkoutReminderToggle) {
      checkoutReminderToggle.checked = this.settings.showCheckoutReminders ?? true;
      checkoutReminderToggle.addEventListener('change', (e) => {
        this.updateSetting('showCheckoutReminders', e.target.checked);
      });
    }

    // Floating icon toggle
    const floatingIconToggle = document.getElementById('floating-icon-toggle');
    if (floatingIconToggle) {
      floatingIconToggle.checked = this.settings.showFloatingIcon ?? true;
      floatingIconToggle.addEventListener('change', (e) => {
        this.updateSetting('showFloatingIcon', e.target.checked);
      });
    }

    // Automatic code filling toggle
    const automaticFillingToggle = document.getElementById('automatic-filling-toggle');
    if (automaticFillingToggle) {
      automaticFillingToggle.checked = this.settings.automaticCodeFilling ?? true;
      automaticFillingToggle.addEventListener('change', (e) => {
        this.updateSetting('automaticCodeFilling', e.target.checked);
      });
    }

  }

  async updateSetting(key, value) {
    this.settings[key] = value;
    try {
      // Update in background script
      await chrome.runtime.sendMessage({
        type: 'UPDATE_SETTINGS',
        settings: { [key]: value }
      });
      
      // Also notify content script if we have an active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url && tab.url.startsWith('http')) {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: 'SETTINGS_UPDATED',
            settings: this.settings
          });
        } catch (error) {
          debugLog('Content script not ready or not on prop firm page');
        }
      }
    } catch (error) {
      debugError('Error updating settings:', error);
    }
  }

  async checkCurrentSite() {
    if (!this.currentTab?.url || !this.propFirmsData?.firms) return;

    const hostname = new URL(this.currentTab.url).hostname;
    this.currentFirm = this.propFirmsData.firms.find(firm => 
      firm.domains.some(domain => {
        // Exact match
        if (hostname === domain) return true;
        // Subdomain match (ends with .domain)
        if (hostname.endsWith('.' + domain)) return true;
        // www prefix specific case
        if (hostname === 'www.' + domain) return true;
        return false;
      })
    );
  }

  updateUI() {
    if (this.currentFirm) {
      this.showPropFirmDetectedState();
    } else {
      this.showNoPropFirmState();
    }
  }



  showNoPropFirmState() {
    document.getElementById('no-propfirm-state').style.display = 'block';
    document.getElementById('propfirm-detected-state').style.display = 'none';

    // Fill list of supported prop firms with live API data only
    const supportedFirmsList = document.getElementById('supported-firms-list');
    if (supportedFirmsList && this.propFirmsData?.firms) {
      // Filter to only show firms with API data (exclude FundedNext — no active rewards program)
      const apiFirms = this.propFirmsData.firms.filter(firm =>
        firm.isApiEnhanced &&
        firm.apiData &&
        firm.apiData.discount &&
        firm.apiData.discount !== "" &&
        !firm.name?.toLowerCase().includes('fundednext')
      );

      // Sort firms by priority: featured first, then by discount
      const sortedFirms = [...apiFirms].sort((a, b) => {
        // 1. Prioritize featured firms
        if (a.apiData?.isFeatured && !b.apiData?.isFeatured) return -1;
        if (!a.apiData?.isFeatured && b.apiData?.isFeatured) return 1;
        
        // 3. Finally sort by discount percentage (highest first)
        const aDiscount = parseInt(a.codes[0]?.discount?.replace('%', '') || '0');
        const bDiscount = parseInt(b.codes[0]?.discount?.replace('%', '') || '0');
        return bDiscount - aDiscount;
      });

      // Clear skeleton and add real data with animation trigger
      supportedFirmsList.innerHTML = '';
      
      // Add each firm with entrance animation
      const firmsHTML = sortedFirms
        .map(firm => {
          const bestCode = firm.codes && firm.codes.length > 0 ? firm.codes[0] : null;
          const discountPercent = bestCode ? bestCode.discount : '';
          const discountCode = bestCode ? bestCode.code : 'LAB';
          const affiliateLink = firm.apiData?.affiliateLink || '';
          
          // Gift icon SVG
          const giftIcon = `<span class="discount-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#07E88A" stroke-width="2"><rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13"/><path d="M3 13h18"/><path d="M12 8c-2-3-6-3-6 0s4 0 6-3c2 3 6 3 6 0s-4 0-6 3"/></svg></span>`;
          
          // Build discount badge HTML
          const discountBadgeHTML = discountPercent ? `
            <span class="firm-discount">
              ${giftIcon}
              <span class="discount-text">${discountPercent} OFF</span>
              <span class="discount-code">| ${discountCode}</span>
            </span>
          ` : '';
          
          // If we have an affiliate link, make it clickable
          if (affiliateLink && affiliateLink.trim() !== '') {
            const logoUrl = getLocalLogo(firm.name) || firm.logo || '';
            const logoHtml = logoUrl ? `<img src="${logoUrl}" alt="${firm.name}" class="firm-logo" onerror="this.style.display='none'">` : '';
            
            return `<li>
              <a href="${affiliateLink}" target="_blank" rel="noopener noreferrer" class="firm-link">
                <span class="firm-name">
                  ${logoHtml}
                  ${firm.name}
                </span>
                ${discountBadgeHTML}
              </a>
            </li>`;
          } else {
            // No affiliate link, just display as text
            const logoUrl = getLocalLogo(firm.name) || firm.logo || '';
            const logoHtml = logoUrl ? `<img src="${logoUrl}" alt="${firm.name}" class="firm-logo" onerror="this.style.display='none'">` : '';
            
            return `<li>
              <span class="firm-name">
                ${logoHtml}
                ${firm.name}
              </span>
              ${discountBadgeHTML}
            </li>`;
          }
        })
        .join('');

      // Set the HTML content and trigger animations
      supportedFirmsList.innerHTML = firmsHTML;
      
      // Force reflow to ensure animations work
      supportedFirmsList.offsetHeight;
      
      // Add animation class to the supported-firms container with small delay
      // to ensure smooth transition from skeleton
      const supportedFirmsContainer = supportedFirmsList.parentNode;
      setTimeout(() => {
        supportedFirmsContainer.classList.add('firms-loaded');
        debugLog('🎬 Firm cards entrance animation started');
      }, 50);

      // Add a note about live data
      // First remove any existing note
      const existingNote = supportedFirmsList.parentNode.querySelector('.api-note');
      if (existingNote) {
        existingNote.remove();
      }
      
      if (sortedFirms.length > 0) {
        const noteElement = document.createElement('div');
        noteElement.className = 'api-note';
        noteElement.innerHTML = `${sortedFirms.length} prop firms with live discounts - Click to visit with discount applied`;
        supportedFirmsList.parentNode.appendChild(noteElement);
      } else {
        // Show message if no API firms are available
        const noteElement = document.createElement('div');
        noteElement.className = 'api-note';
        noteElement.innerHTML = 'Loading live discounts from propfirm.compare API...';
        supportedFirmsList.parentNode.appendChild(noteElement);
      }
    }
  }

  resetAnimationState() {
    const supportedFirmsList = document.getElementById('supported-firms-list');
    if (!supportedFirmsList) return;

    const supportedFirmsContainer = supportedFirmsList.parentNode;
    
    // Remove any animation classes
    supportedFirmsContainer.classList.remove('firms-loaded');
    
    // Clear any existing content
    supportedFirmsList.innerHTML = '';
    
    // Remove any existing notes
    const existingNote = supportedFirmsContainer.querySelector('.api-note');
    if (existingNote) {
      existingNote.remove();
    }
    
    debugLog('🔄 Animation state reset - popup ready for fresh animations');
  }

  showLoadingSkeleton() {
    const supportedFirmsList = document.getElementById('supported-firms-list');
    if (!supportedFirmsList) return;

    // Create skeleton items
    const skeletonItems = Array.from({ length: 6 }, (_, i) => `
      <li class="skeleton-item">
        <span class="firm-name">
          <div class="skeleton-logo"></div>
          <div class="skeleton-text skeleton-name"></div>
        </span>
        <div class="skeleton-text skeleton-discount"></div>
      </li>
    `).join('');

    supportedFirmsList.innerHTML = skeletonItems;

    // Remove any existing note and add loading note
    const existingNote = supportedFirmsList.parentNode.querySelector('.api-note');
    if (existingNote) {
      existingNote.remove();
    }
    
    const noteElement = document.createElement('div');
    noteElement.className = 'api-note loading-note';
    noteElement.innerHTML = `
      <div class="loading-dots">
        <span>Loading live discounts</span>
        <div class="dots">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </div>
      </div>
    `;
    supportedFirmsList.parentNode.appendChild(noteElement);
  }

  showPropFirmDetectedState() {
    document.getElementById('no-propfirm-state').style.display = 'none';
    document.getElementById('propfirm-detected-state').style.display = 'block';

    // Show available codes in new design
    this.renderNewPopupDesign();
  }

  renderNewPopupDesign() {
    if (!this.currentFirm || !this.currentFirm.codes || this.currentFirm.codes.length === 0) return;

    // Get the best code (first one or highest discount)
    const bestCode = this.currentFirm.codes[0];

    // Update firm title
    const firmTitleElement = document.getElementById('popup-firm-title');
    if (firmTitleElement) {
      firmTitleElement.textContent = `Discount code for ${this.currentFirm.name}`;
    }

    // Update firm logo
    const firmLogoElement = document.getElementById('popup-firm-logo');
    const firmLogoSrc = getLocalLogo(this.currentFirm.name) || this.currentFirm.logo;
    if (firmLogoElement && firmLogoSrc) {
      firmLogoElement.src = firmLogoSrc;
      firmLogoElement.alt = this.currentFirm.name;
      firmLogoElement.style.display = 'block';
    }

    // Update discount value
    const discountValueElement = document.getElementById('popup-discount-value');
    if (discountValueElement) {
      discountValueElement.textContent = bestCode.discount;
    }

    // Update firm name
    const firmNameElement = document.getElementById('popup-firm-name');
    if (firmNameElement) {
      firmNameElement.textContent = `${this.currentFirm.name} - Challenges`;
    }

    // Update firm description
    const firmDescriptionElement = document.getElementById('popup-firm-description');
    if (firmDescriptionElement) {
      firmDescriptionElement.textContent = `up to ${bestCode.discount} OFF | Code: ${bestCode.code}`;
    }

    // Update copy button
    const copyCodeButton = document.getElementById('popup-copy-code');
    if (copyCodeButton) {
      copyCodeButton.innerHTML = `
        <span class="icon">
          <svg width="14" height="14" viewBox="0 0 448 512">
            <path fill="currentColor" d="M320 448v40c0 13.255-10.745 24-24 24H24c-13.255 0-24-10.745-24-24V120c0-13.255 10.745-24 24-24h72v296c0 30.879 25.121 56 56 56h168zm0-344V0H152c-13.255 0-24 10.745-24 24v368c0 13.255 10.745 24 24 24h272c13.255 0 24-10.745 24-24V128H344c-13.255 0-24-10.745-24-24zm120.971-31.029L375.029 7.029A24 24 0 0 0 358.059 0H344v96h96V81.941a24 24 0 0 0-7.029-16.97z"/>
          </svg>
        </span>
        Copy code ${bestCode.code}
      `;
      copyCodeButton.disabled = false;
      // Ensure the button has the primary (green) class
      copyCodeButton.className = 'propfirm-apply-btn propfirm-primary';
    }

    // Setup event listeners for new buttons
    this.setupNewPopupEventListeners(bestCode);
  }

  setupNewPopupEventListeners(bestCode) {
    // Setup copy button
    const copyCodeButton = document.getElementById('popup-copy-code');
    if (copyCodeButton) {
      copyCodeButton.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(bestCode.code);
          
          // Update button to show success
          copyCodeButton.innerHTML = `
            <span class="icon">
              <svg width="14" height="14" viewBox="0 0 512 512">
                <path fill="currentColor" d="M173.898 439.404l-166.4-166.4c-9.997-9.997-9.997-26.206 0-36.204l36.203-36.204c9.997-9.998 26.207-9.998 36.204 0L192 312.69 432.095 72.596c9.997-9.997 26.207-9.997 36.204 0l36.203 36.204c9.997 9.997 9.997 26.206 0 36.204l-294.4 294.401c-9.998 9.997-26.207 9.997-36.204-.001z"/>
              </svg>
            </span>
            Copied!
          `;
          copyCodeButton.style.background = '#00cc66';
          
          // Reset after 2 seconds
          setTimeout(() => {
            copyCodeButton.innerHTML = `
              <span class="icon">
                <svg width="14" height="14" viewBox="0 0 448 512">
                  <path fill="currentColor" d="M320 448v40c0 13.255-10.745 24-24 24H24c-13.255 0-24-10.745-24-24V120c0-13.255 10.745-24 24-24h72v296c0 30.879 25.121 56 56 56h168zm0-344V0H152c-13.255 0-24 10.745-24 24v368c0 13.255 10.745 24 24 24h272c13.255 0 24-10.745 24-24V128H344c-13.255 0-24-10.745-24-24zm120.971-31.029L375.029 7.029A24 24 0 0 0 358.059 0H344v96h96V81.941a24 24 0 0 0-7.029-16.97z"/>
                </svg>
              </span>
              Copy code ${bestCode.code}
            `;
            copyCodeButton.style.background = '';
          }, 2000);
          
          this.showToast(`Copied code: ${bestCode.code}`, 'success');
        } catch (error) {
          debugError('Error copying code:', error);
          this.showToast('Error copying code', 'error');
        }
      });
    }


  }

  setupCodeEventListeners() {
    // Copy buttons
    document.querySelectorAll('.copy-code-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const code = e.target.dataset.code;
        this.copyCodeToClipboard(code, e.target);
      });
    });

    // Click on entire code item to copy it
    document.querySelectorAll('.code-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (!e.target.classList.contains('code-btn')) {
          const code = item.dataset.code;
          this.copyCodeToClipboard(code);
        }
      });
    });
  }

  async copyCodeToClipboard(code, buttonElement = null) {
    try {
      await navigator.clipboard.writeText(code);
      
      if (buttonElement) {
        const originalText = buttonElement.textContent;
        buttonElement.textContent = 'Copied!';
        buttonElement.style.background = '#00E5A0';
        buttonElement.style.color = '#000';
        
        setTimeout(() => {
          buttonElement.textContent = originalText;
          buttonElement.style.background = '';
          buttonElement.style.color = '';
        }, 2000);
      }

      // Show visual feedback
      this.showToast(`Code ${code} copied to clipboard`);
    } catch (error) {
      debugError('Error copying code:', error);
      this.showToast('Error copying code', 'error');
    }
  }





  showLoading(message = 'Loading...') {
    const overlay = document.getElementById('loading-overlay');
    const messageElement = overlay.querySelector('p');
    
    if (messageElement) {
      messageElement.textContent = message;
    }
    
    overlay.style.display = 'flex';
  }

  hideLoading() {
    document.getElementById('loading-overlay').style.display = 'none';
  }

  showToast(message, type = 'success') {
    // Create toast notification
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${type === 'error' ? '#ff6b6b' : '#00E5A0'};
      color: ${type === 'error' ? 'white' : '#000'};
      padding: 12px 16px;
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 10000;
      font-size: 14px;
      max-width: 250px;
      animation: slideInRight 0.3s ease-out;
    `;

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'slideOutRight 0.3s ease-out';
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }, 3000);
  }

  async checkOnboardingStatus() {
    try {
      const result = await chrome.storage.local.get(['hasSeenOnboarding']);
      return result.hasSeenOnboarding || false;
    } catch (error) {
      debugError('Error checking onboarding status:', error);
      return false;
    }
  }

  async markOnboardingComplete() {
    try {
      await chrome.storage.local.set({ hasSeenOnboarding: true });
      debugLog('📚 Onboarding marked as complete');
    } catch (error) {
      debugError('Error saving onboarding status:', error);
    }
  }

  showOnboarding() {
    const overlay = document.getElementById('onboarding-overlay');
    if (overlay) {
      overlay.style.display = 'flex';
      // Reset to ensure proper animation on first show
      this.currentOnboardingStep = null;
      this.setupOnboardingGlobals();
      this.showOnboardingStep(1);
      debugLog('📚 Onboarding started');
    }
  }

  hideOnboarding() {
    const overlay = document.getElementById('onboarding-overlay');
    if (overlay) {
      overlay.style.display = 'none';
      debugLog('📚 Onboarding hidden');
    }
  }

  setupOnboardingGlobals() {
    // Setup event listeners for onboarding buttons
    this.setupOnboardingEventListeners();
  }

  setupOnboardingEventListeners() {
    // Step 1: Start Onboarding button
    const startBtn = document.getElementById('start-onboarding-btn');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        this.showOnboardingStep(2);
      });
    }

    // Setup navigation for steps 2-5
    for (let step = 2; step <= 5; step++) {
      const backBtn = document.getElementById(`onboarding-back-btn-${step}`);
      const nextBtn = document.getElementById(`onboarding-next-btn-${step}`);
      
      if (backBtn) {
        backBtn.addEventListener('click', () => {
          this.navigateOnboarding('back');
        });
      }
      
      if (nextBtn) {
        nextBtn.addEventListener('click', () => {
          this.navigateOnboarding('next');
        });
      }
    }
  }

  navigateOnboarding(direction) {
    const currentStep = this.currentOnboardingStep || 1;
    
    if (direction === 'back' && currentStep > 1) {
      this.showOnboardingStep(currentStep - 1);
    } else if (direction === 'next') {
      if (currentStep < 5) {
        this.showOnboardingStep(currentStep + 1);
      } else if (currentStep === 5) {
        // Finish onboarding
        this.finishOnboarding();
      }
    }
  }

  async finishOnboarding() {
    await this.markOnboardingComplete();
    this.hideOnboarding();
    
    // Now initialize the main app
    this.resetAnimationState();
    await this.loadCurrentTab();
    await this.loadSettings();
    this.showLoadingSkeleton();
    this.setupEventListeners();
    this.checkCurrentSite();
    await this.loadPropFirmsData();
    this.updateUI();
    
    // V2: Initialize account section after onboarding
    await this.initAccountSection();
  }



  showOnboardingStep(stepNumber) {
    const previousStep = this.currentOnboardingStep;
    
    // Add exit animation to current step
    if (previousStep && previousStep !== stepNumber) {
      const exitingStep = document.getElementById(`onboarding-step-${previousStep}`);
      if (exitingStep) {
        exitingStep.classList.add('exiting');
        exitingStep.classList.remove('active');
      }
    }

    // Hide all steps after animation
    setTimeout(() => {
      for (let i = 1; i <= 5; i++) {
        const step = document.getElementById(`onboarding-step-${i}`);
        if (step) {
          if (i === stepNumber) {
            step.style.display = 'flex';
            step.classList.remove('exiting');
            // Trigger entrance animation
            setTimeout(() => {
              step.classList.add('active');
            }, 50);
          } else {
            step.style.display = 'none';
            step.classList.remove('active', 'exiting');
          }
        }
      }
    }, previousStep && previousStep !== stepNumber ? 200 : 0);

    // Update progress
    this.updateOnboardingProgress(stepNumber);
    this.currentOnboardingStep = stepNumber;
    
    // Show/hide confetti header on step 5 with animation
    const confettiHeader = document.getElementById('confetti-header');
    if (confettiHeader) {
      if (stepNumber === 5) {
        confettiHeader.style.display = 'block';
        // Delay confetti animation
        setTimeout(() => {
          confettiHeader.classList.add('visible');
        }, 600); // Show confetti after step transition
      } else {
        confettiHeader.classList.remove('visible');
        setTimeout(() => {
          confettiHeader.style.display = 'none';
        }, 300);
      }
    }
    
    debugLog(`📚 Showing onboarding step ${stepNumber}`);
  }

  updateOnboardingProgress(stepNumber) {
    // Update dots
    const dots = document.querySelectorAll('.progress-dots .dot');
    dots.forEach((dot, index) => {
      if (index + 1 <= stepNumber) {
        dot.classList.add('active');
      } else {
        dot.classList.remove('active');
      }
    });

    // Update text
    const currentStepText = document.getElementById('current-step');
    if (currentStepText) {
      currentStepText.textContent = stepNumber;
    }
  }

  // ============================================
  // TAB NAVIGATION
  // ============================================

  setupTabNavigation() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tabId = btn.dataset.tab;
        this.switchTab(tabId);
      });
    });
  }

  switchTab(tabId) {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    
    // Update tab panels
    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === `tab-${tabId}`);
    });
    
    debugLog(`📑 Switched to tab: ${tabId}`);
  }

  // ============================================
  // V2: Account Management Methods
  // ============================================

  async initAccountSection() {
    console.log('🔐 [POPUP] initAccountSection called');
    debugLog('🔐 Initializing account section...');
    
    // Setup event listeners first - they should work regardless of auth state
    this.setupAccountEventListeners();
    
    try {
      // Get current auth state
      console.log('🔐 [POPUP] Sending GET_AUTH_STATE message...');
      let authState = await chrome.runtime.sendMessage({ action: "GET_AUTH_STATE" });
      console.log('🔐 [POPUP] Auth state received:', JSON.stringify(authState));
      debugLog('📊 Initial auth state:', authState);
      
      if (authState && authState.isConnected) {
        console.log('🔐 [POPUP] User is connected, loading rewards...');
        
        // Refresh profile data first to get latest points/avatar
        const freshData = await this.refreshProfileData();
        
        // Merge fresh data with auth state
        if (freshData) {
          authState = { ...authState, ...freshData };
        }
        
        // Show connected state with updated data
        this.showConnectedState(authState);
        
        // Load rewards
        console.log('🔐 [POPUP] Calling loadRewards...');
        await this.loadRewards();
        console.log('🔐 [POPUP] loadRewards completed');
        
        // Check for pending purchases that weren't submitted
        await this.checkPendingPurchase();
      } else {
        console.log('🔐 [POPUP] User NOT connected, authState:', authState);
        this.showNotConnectedState();
      }
      
    } catch (error) {
      console.error('❌ [POPUP] Error initializing account section:', error);
      debugLog('❌ Error initializing account section:', error);
      this.showNotConnectedState();
    }
  }

  async refreshProfileData() {
    debugLog('🔄 Refreshing profile data from API...');
    
    try {
      const result = await chrome.runtime.sendMessage({ action: "REFRESH_PROFILE" });
      debugLog('📡 REFRESH_PROFILE result:', result);
      
      if (result && result.success) {
        debugLog('✅ Profile data refreshed - name:', result.name, 'points:', result.points, 'avatar:', result.avatar ? 'yes' : 'no');
        return {
          name: result.name,
          points: result.points,
          avatar: result.avatar,
          email: result.email
        };
      } else {
        debugLog('⚠️ REFRESH_PROFILE failed:', result?.error);
        return null;
      }
    } catch (error) {
      debugLog('❌ Error refreshing profile:', error);
      return null;
    }
  }

  setupAccountEventListeners() {
    // Connect button in rewards tab
    const rewardsConnectBtn = document.getElementById('rewards-connect-btn');
    if (rewardsConnectBtn) {
      rewardsConnectBtn.addEventListener('click', () => this.handleConnect());
    }
    
    // Disconnect button
    const disconnectBtn = document.getElementById('disconnect-btn');
    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', () => this.handleDisconnect());
    }
    
    // Update view rewards link with proper URL
    const viewRewardsLink = document.getElementById('view-rewards-link');
    if (viewRewardsLink) {
      viewRewardsLink.href = `${API_BASE_URL}/profile/rewards`;
    }
  }

  showConnectedState(authState) {
    // Update rewards tab states
    const rewardsNotConnected = document.getElementById('rewards-not-connected');
    const rewardsConnected = document.getElementById('rewards-connected');
    
    if (rewardsNotConnected) rewardsNotConnected.classList.add('hidden');
    if (rewardsConnected) rewardsConnected.classList.remove('hidden');
    
    // Update displayname
    const displayNameEl = document.getElementById('user-displayname');
    if (displayNameEl) {
      displayNameEl.textContent = authState.name || authState.email?.split('@')[0] || 'User';
    }
    
    // Update avatar
    const avatarImg = document.getElementById('user-avatar-img');
    const avatarFallback = document.querySelector('.avatar-fallback');
    
    if (authState.avatar && avatarImg) {
      avatarImg.src = authState.avatar;
      avatarImg.style.display = 'block';
      avatarImg.onerror = () => {
        avatarImg.style.display = 'none';
        if (avatarFallback) avatarFallback.style.display = 'block';
      };
      if (avatarFallback) avatarFallback.style.display = 'none';
    }
    
    // Update loyalty points
    const loyaltyPointsEl = document.getElementById('loyalty-points');
    if (loyaltyPointsEl) {
      const points = authState.points || 0;
      loyaltyPointsEl.textContent = points.toLocaleString();
    }
    
    debugLog('✅ Showing connected state:', { 
      name: authState.name, 
      avatar: authState.avatar ? 'yes' : 'no',
      points: authState.points 
    });
  }

  showNotConnectedState() {
    // Update rewards tab states
    const rewardsNotConnected = document.getElementById('rewards-not-connected');
    const rewardsConnected = document.getElementById('rewards-connected');
    
    if (rewardsNotConnected) rewardsNotConnected.classList.remove('hidden');
    if (rewardsConnected) rewardsConnected.classList.add('hidden');
    
    debugLog('🔓 Showing not connected state');
  }

  handleConnect() {
    debugLog('🔐 Opening auth popup...');
    
    // Check if Chrome extension APIs are available
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ action: "OPEN_AUTH" });
      
      // Close popup after initiating auth
      setTimeout(() => {
        window.close();
      }, 100);
    } else {
      // Fallback for testing in browser - open auth page directly
      const authUrl = `${API_BASE_URL}/extension-auth`;
      window.open(authUrl, '_blank', 'width=500,height=700');
    }
  }

  async handleDisconnect() {
    debugLog('🔓 Disconnecting user...');
    
    try {
      await chrome.runtime.sendMessage({ action: "DISCONNECT" });
      
      // Update UI to show not connected state
      this.showNotConnectedState();
      
      // Clear savings display
      const totalSaved = document.getElementById('total-saved');
      if (totalSaved) totalSaved.textContent = '$0.00';
      
      const recentPurchases = document.getElementById('recent-purchases');
      if (recentPurchases) recentPurchases.innerHTML = '';
      
      this.showToast('Account disconnected', 'success');
      
    } catch (error) {
      debugLog('❌ Error disconnecting:', error);
      this.showToast('Error disconnecting account', 'error');
    }
  }

  async checkPendingPurchase() {
    debugLog('🔍 Checking for stuck pending purchases...');
    
    try {
      const result = await chrome.storage.local.get(['pending_purchase']);
      const pending = result.pending_purchase;
      
      if (!pending || !pending.timestamp) {
        this.hidePendingPurchaseAlert();
        return;
      }
      
      // Check if the pending purchase is older than 2 minutes (120,000ms)
      // This indicates the thank-you page wasn't detected
      const now = Date.now();
      const ageMs = now - pending.timestamp;
      const twoMinutes = 2 * 60 * 1000;
      
      if (ageMs > twoMinutes && pending.partner && pending.coupon) {
        debugLog('⚠️ Found stuck pending purchase:', pending);
        this.showPendingPurchaseAlert(pending);
      } else {
        this.hidePendingPurchaseAlert();
      }
    } catch (error) {
      debugLog('❌ Error checking pending purchase:', error);
      this.hidePendingPurchaseAlert();
    }
  }

  showPendingPurchaseAlert(pending) {
    const alertEl = document.getElementById('pending-purchase-alert');
    const detailsEl = document.getElementById('pending-purchase-details');
    const submitBtn = document.getElementById('submit-pending-btn');
    const dismissBtn = document.getElementById('dismiss-pending-btn');
    const wrongDataBtn = document.getElementById('wrong-data-btn');
    
    if (!alertEl) return;
    
    // Format the details
    const partnerName = this.formatPartnerName(pending.partner);
    const product = pending.product_name || 'Unknown product';
    const price = pending.final_price ? `$${parseFloat(pending.final_price).toFixed(2)}` : 'Unknown price';
    
    // Calculate age for display
    const ageMs = Date.now() - pending.timestamp;
    const ageMinutes = Math.floor(ageMs / 60000);
    const ageDisplay = ageMinutes > 60 
      ? `${Math.floor(ageMinutes / 60)}h ${ageMinutes % 60}m ago`
      : `${ageMinutes}m ago`;
    
    if (detailsEl) {
      detailsEl.innerHTML = `${partnerName}: ${product} (${price})<br><small style="opacity: 0.7;">Captured ${ageDisplay}</small>`;
    }
    
    // Setup submit button click handler
    if (submitBtn) {
      submitBtn.onclick = () => this.submitPendingPurchase(pending);
    }
    
    // Setup dismiss/clear button handlers
    if (dismissBtn) {
      dismissBtn.onclick = () => this.clearPendingPurchase();
    }
    if (wrongDataBtn) {
      wrongDataBtn.onclick = () => this.clearPendingPurchase();
    }
    
    alertEl.style.display = 'block';
  }

  async clearPendingPurchase() {
    debugLog('🗑️ Clearing pending purchase data...');
    
    try {
      await chrome.storage.local.remove(['pending_purchase']);
      this.hidePendingPurchaseAlert();
      this.showToast('Pending purchase cleared', 'success');
      debugLog('✅ Pending purchase cleared');
    } catch (error) {
      debugLog('❌ Error clearing pending purchase:', error);
      this.showToast('Failed to clear', 'error');
    }
  }

  hidePendingPurchaseAlert() {
    const alertEl = document.getElementById('pending-purchase-alert');
    if (alertEl) {
      alertEl.style.display = 'none';
    }
  }

  formatPartnerName(partner) {
    const names = {
      'myfundedfutures': 'My Funded Futures',
      'fundednext': 'FundedNext',
      'tradeify': 'Tradeify',
      'takeprofittrader': 'Take Profit Trader',
      'lucidtrading': 'Lucid Trading',
      'apextraderfunding': 'Apex Trader Funding'
    };
    return names[partner?.toLowerCase()] || partner || 'Unknown Firm';
  }

  async submitPendingPurchase(pending) {
    debugLog('📤 Manually submitting pending purchase:', pending);
    
    const submitBtn = document.getElementById('submit-pending-btn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting...';
    }
    
    try {
      // Send to background script for submission
      const result = await chrome.runtime.sendMessage({
        action: 'SUBMIT_PENDING_PURCHASE',
        purchaseData: pending
      });
      
      if (result && result.success) {
        debugLog('✅ Pending purchase submitted successfully');
        this.showToast('Purchase submitted successfully!', 'success');
        this.hidePendingPurchaseAlert();
        
        // Refresh rewards to show the new purchase
        await this.loadRewards(true);
      } else {
        throw new Error(result?.error || 'Failed to submit purchase');
      }
    } catch (error) {
      debugLog('❌ Error submitting pending purchase:', error);
      this.showToast('Failed to submit purchase: ' + error.message, 'error');
      
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Now';
      }
    }
  }

  async loadRewards(forceRefresh = false) {
    console.log('📊 [POPUP] loadRewards() called, forceRefresh:', forceRefresh);
    debugLog('📊 Loading rewards...');
    
    const recentPurchasesEl = document.getElementById('recent-purchases');
    const totalSavedEl = document.getElementById('total-saved');
    
    console.log('📊 [POPUP] Elements found:', { 
      recentPurchasesEl: !!recentPurchasesEl, 
      totalSavedEl: !!totalSavedEl 
    });
    
    // Show loading state
    if (recentPurchasesEl) {
      recentPurchasesEl.innerHTML = '<div class="rewards-loading">Loading purchases</div>';
    }
    
    try {
      // Use background script to fetch rewards (avoids potential popup fetch issues)
      console.log('📊 [POPUP] Requesting rewards via background script...');
      const data = await chrome.runtime.sendMessage({ action: "GET_REWARDS", forceRefresh });
      console.log('📊 [POPUP] Rewards data from background:', JSON.stringify(data).substring(0, 500));
      console.log('📊 [POPUP] total_discount_saved:', data.total_discount_saved);
      console.log('📊 [POPUP] purchases count:', data.purchases?.length);
      debugLog('📊 Purchases data received:', data);
      debugLog('📊 Number of purchases:', data.purchases?.length || 0);
      
      // Check for error from background
      if (data.error) {
        console.log('❌ [POPUP] Error from background:', data.error);
        throw new Error(data.error);
      }
      
      // Update total saved display
      if (totalSavedEl) {
        // Calculate from purchases, excluding unreconciled FundedNext
        let totalSaved = 0;
        
        if (data.purchases && data.purchases.length > 0) {
          totalSaved = data.purchases.reduce((sum, p) => {
            // FundedNext purchases only count when reconciled via lead_id
            const isFundedNext = p.partner?.toLowerCase() === 'fundednext';
            const isReconciled = p.lead_id || p.reconciled === true;
            
            if (isFundedNext && !isReconciled) {
              // Skip unreconciled FundedNext purchases from total
              return sum;
            }
            
            const discount = parseFloat(p.discount_amount) || 
                             parseFloat(p.discount) || 
                             (p.original_price && p.final_price ? parseFloat(p.original_price) - parseFloat(p.final_price) : 0);
            return sum + discount;
          }, 0);
        }
        
        // Override with API total if it accounts for reconciliation
        if (data.total_discount_saved_reconciled !== undefined) {
          totalSaved = data.total_discount_saved_reconciled;
        }
        
        totalSavedEl.textContent = `$${totalSaved.toFixed(2)}`;
      }
      
      // Update recent purchases list
      if (recentPurchasesEl) {
        if (data.purchases && data.purchases.length > 0) {
          debugLog('🛒 Rendering', data.purchases.length, 'purchases');
          
          // Check for discrepancy between local cache and API response
          const cachedPurchases = data.cached_purchases || [];
          const apiPurchaseCount = data.purchases.length;
          const cachedPurchaseCount = cachedPurchases.length;
          
          if (cachedPurchaseCount > apiPurchaseCount) {
            console.warn('⚠️ DISCREPANCY: Local cache has', cachedPurchaseCount, 'purchases but API returned', apiPurchaseCount);
            // Show warning banner
            const warningBanner = document.createElement('div');
            warningBanner.className = 'purchase-discrepancy-warning';
            warningBanner.innerHTML = `
              <div class="warning-icon">⚠️</div>
              <div class="warning-text">
                <strong>${cachedPurchaseCount - apiPurchaseCount} purchase(s) may be missing</strong>
                <span>The extension detected more purchases than the server returned. Contact support if this persists.</span>
              </div>
            `;
            recentPurchasesEl.parentNode.insertBefore(warningBanner, recentPurchasesEl);
          }
          
          // Log each purchase's order_number status for debugging
          data.purchases.slice(0, 3).forEach((p, i) => {
            console.log(`📦 Purchase ${i + 1}:`, {
              id: p.purchase_id,
              partner: p.partner,
              order_number: p.order_number,
              hasOrderNumber: !!p.order_number
            });
          });
          
          recentPurchasesEl.innerHTML = data.purchases.slice(0, 3).map(p => {
            let discountSaved = parseFloat(p.discount_amount) || 
                                parseFloat(p.discount) || 
                                (p.original_price && p.final_price ? parseFloat(p.original_price) - parseFloat(p.final_price) : 0);
            
            // Parse product_name to extract clean plan type and account size
            const parsed = this.parseProductName(p.product_name);
            
            // Use parsed values (they're already cleaned/normalized)
            let planType = parsed.planType || '';
            let accountSize = '';
            
            // Use API account_size if available, otherwise use parsed
            if (p.account_size) {
              accountSize = this.formatAccountSize(p.account_size);
            } else {
              accountSize = parsed.accountSize;
            }
            
            // If account_type is a clean type (not raw product name), use it
            // Clean types are short words like "Pro", "Core", "Legacy", etc.
            // Exclude "$" and other invalid single-character types
            if (p.account_type && 
                p.account_type.length >= 2 && 
                p.account_type.length <= 15 && 
                !p.account_type.includes('Futures') && 
                !p.account_type.includes('Plan') &&
                !/^[\$\s]+$/.test(p.account_type)) {
              planType = p.account_type;
            }
            
            const firmName = this.formatPartnerName(p.partner);
            const firmLogo = this.getFirmLogo(p.partner);
            
            // Format savings display
            let savingsDisplay = '';
            if (discountSaved > 0) {
              savingsDisplay = `<div class="purchase-saved">-$${discountSaved.toFixed(2)}</div>`;
            }
            
            // Format points display with icon
            let pointsDisplay = '';
            const rewardAmount = parseFloat(p.reward_amount) || 0;
            const pointsIcon = `<svg class="points-icon-small" width="10" height="8" viewBox="0 0 22 14" fill="none"><path d="M18.4646 0H6.91033L4.52387 2.29847H17.4761L18.6251 3.4054L10.9998 10.7492L3.37488 3.4054L4.52387 2.29847H1.14899L0 3.4054L10.9998 14L22 3.4054L18.4646 0Z" fill="currentColor"/></svg>`;
            
            // FundedNext rewards are always pending until manually reconciled via lead_id
            const isFundedNext = p.partner?.toLowerCase() === 'fundednext';
            const isReconciled = p.lead_id || p.reconciled === true;
            
            if (isFundedNext && !isReconciled) {
              // FundedNext: Always show pending until manually linked
              pointsDisplay = `<div class="purchase-points pending">${pointsIcon}Pending</div>`;
            } else if (rewardAmount > 0 && p.reward_issued) {
              pointsDisplay = `<div class="purchase-points">${pointsIcon}+${rewardAmount.toFixed(0)}</div>`;
            } else if (p.reward_issued === false) {
              pointsDisplay = `<div class="purchase-points pending">${pointsIcon}Pending</div>`;
            }
            
            // Check if order identifier is missing for this partner
            const orderConfig = this.getOrderConfig(p.partner);
            const needsOrderNumber = orderConfig && !p.order_number;
            const orderNumberAction = needsOrderNumber ? `
              <div class="purchase-action" data-purchase-id="${p.purchase_id}" data-partner="${p.partner}">
                <button class="add-order-btn" title="Add ${orderConfig.label}">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                  Add ${orderConfig.label}
                </button>
              </div>
            ` : '';
            
            return `
            <div class="purchase-item ${needsOrderNumber ? 'needs-action' : ''}">
              <div class="purchase-left">
                <div class="purchase-logo">
                  ${firmLogo ? `<img src="${firmLogo}" alt="${firmName}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">` : ''}
                  <div class="purchase-logo-fallback" ${firmLogo ? 'style="display:none"' : ''}>
                    <span>${firmName.charAt(0)}</span>
                  </div>
                </div>
                <div class="purchase-details">
                  <div class="purchase-firm">${firmName}</div>
                  <div class="purchase-plan">${[planType, accountSize].filter(Boolean).join(' • ')}</div>
                  ${orderNumberAction}
                </div>
              </div>
              <div class="purchase-right">
                ${savingsDisplay}
                ${pointsDisplay}
              </div>
            </div>
          `;
          }).join('');
          // Add click handlers for "Add Order #" buttons
          this.setupOrderNumberHandlers();
          
        } else {
          debugLog('⚠️ No purchases in response');
          recentPurchasesEl.innerHTML = `
            <div class="rewards-empty">
              <div>No purchases yet. Shop at a supported prop firm to start saving!</div>
            </div>
          `;
        }
      }
      
    } catch (error) {
      console.error('❌ [POPUP] Error loading purchases:', error);
      debugLog('❌ Error loading purchases:', error);
      
      if (recentPurchasesEl) {
        recentPurchasesEl.innerHTML = `
          <div class="rewards-empty">
            <div>Unable to load purchases. Please try again later.</div>
          </div>
        `;
      }
    }
  }

  formatPartnerName(partner) {
    const names = {
      'fundednext': 'FundedNext',
      'lucidtrading': 'Lucid Trading',
      'myfundedfutures': 'My Funded Futures',
      'apex': 'Apex Trader',
      'apextraderfunding': 'Apex Trader Funding',
      'tradeify': 'Tradeify',
      'takeprofittrader': 'Take Profit Trader',
      'alphafutures': 'Alpha Futures'
    };
    return names[partner?.toLowerCase()] || partner || 'Unknown';
  }

  parseProductName(productName) {
    if (!productName) return { planType: 'Challenge', accountSize: '' };
    
    let cleanName = productName;
    
    // Clean up FundedNext format: "Futures Legacy Challenge 25000 USD" → "Legacy"
    // Remove "Futures" prefix
    cleanName = cleanName.replace(/^Futures\s+/i, '');
    // Remove "USD" suffix
    cleanName = cleanName.replace(/\s*USD\s*$/i, '');
    // Remove "Challenge" and "Evaluation" words
    cleanName = cleanName.replace(/\s*(Challenge|Evaluation)\s*/gi, ' ');
    
    // Clean up MFF format: "Pro Plan - $150000" → "Pro"
    // Remove "Plan" suffix
    cleanName = cleanName.replace(/\s*Plan\s*/gi, ' ');
    // Remove "- $" separator
    cleanName = cleanName.replace(/\s*-\s*\$?\s*/g, ' ');
    
    // Extract plan type (e.g., "Pro", "Core", "Rapid", "Legacy", "Express", "Stellar")
    let planType = '';
    const planMatch = cleanName.match(/(Pro|Core|Rapid|Express|Stellar|Standard|Elite|Legacy)/i);
    if (planMatch) {
      planType = planMatch[1].charAt(0).toUpperCase() + planMatch[1].slice(1).toLowerCase();
    }
    
    // Extract and format account size
    let accountSize = '';
    // Try to match various formats: "25000", "$150,000", "150K", etc.
    const sizeMatch = productName.match(/(\d{2,3})[,.]?(\d{3})|(\d+)K/i);
    if (sizeMatch) {
      let amount;
      if (sizeMatch[3]) {
        // Already in K format
        amount = parseInt(sizeMatch[3]) * 1000;
      } else {
        amount = parseInt((sizeMatch[1] || '') + (sizeMatch[2] || ''));
      }
      if (amount) {
        accountSize = this.formatAccountSize(amount);
      }
    }
    
    return { planType, accountSize };
  }

  formatAccountSize(amount) {
    if (!amount || isNaN(amount)) return '';
    
    const num = parseFloat(amount);
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(num % 1000000 === 0 ? 0 : 1)}M`;
    } else if (num >= 1000) {
      return `${Math.round(num / 1000)}K`;
    } else {
      return num.toString();
    }
  }

  // Partner-specific order identifier configuration (also used by modal)
  // Returns null if partner doesn't require order tracking
  getOrderConfig(partner) {
    // Partners requiring manual order number input for commission reconciliation
    // 
    // NOT included (auto-matched):
    // - FundedNext: Uses email pattern + timestamp matching from their reports
    // - Lucid Trading: Receives all purchase data via API webhook (order info always present)
    //
    const configs = {
      'myfundedfutures': { 
        label: 'Order #', 
        placeholder: 'e.g., ORD-abc123',
        hint: 'Found in your confirmation email or MFF dashboard'
      },
      'apextraderfunding': { 
        label: 'Order ID', 
        placeholder: 'e.g., APX-12345',
        hint: 'Found in your Apex confirmation email'
      },
      'tradeify': { 
        label: 'Transaction ID', 
        placeholder: 'e.g., TRD-12345',
        hint: 'Found in your confirmation email'
      },
      'takeprofittrader': { 
        label: 'Order #', 
        placeholder: 'e.g., TPT-12345',
        hint: 'Found in your confirmation email'
      },
      // 'lucidtrading' - EXCLUDED: All data comes via API webhook with order info
      'alphafutures': { 
        label: 'Order #', 
        placeholder: 'e.g., AF-12345',
        hint: 'Found in your confirmation email'
      }
    };
    return configs[partner?.toLowerCase()] || null;
  }

  setupOrderNumberHandlers() {
    const addOrderBtns = document.querySelectorAll('.add-order-btn');
    addOrderBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const actionEl = btn.closest('.purchase-action');
        const purchaseId = actionEl.dataset.purchaseId;
        const partner = actionEl.dataset.partner;
        this.showOrderNumberModal(purchaseId, partner);
      });
    });
  }

  showOrderNumberModal(purchaseId, partner) {
    const config = this.getOrderConfig(partner) || { label: 'Order #', placeholder: 'Enter order number', hint: '' };
    const firmName = this.formatPartnerName(partner);
    
    // Remove any existing modal
    const existingModal = document.querySelector('.order-modal-overlay');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.className = 'order-modal-overlay';
    modal.innerHTML = `
      <div class="order-modal">
        <div class="order-modal-header">
          <h3>Add ${config.label}</h3>
          <button class="order-modal-close">&times;</button>
        </div>
        <div class="order-modal-body">
          <p>Enter your ${firmName} ${config.label.toLowerCase()} to link this purchase.</p>
          <input type="text" class="order-input" placeholder="${config.placeholder}" maxlength="50">
          <div class="order-modal-hint">${config.hint}</div>
        </div>
        <div class="order-modal-actions">
          <button class="order-cancel-btn">Cancel</button>
          <button class="order-submit-btn">Save ${config.label}</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Event handlers
    const closeBtn = modal.querySelector('.order-modal-close');
    const cancelBtn = modal.querySelector('.order-cancel-btn');
    const submitBtn = modal.querySelector('.order-submit-btn');
    const input = modal.querySelector('.order-input');

    const closeModal = () => modal.remove();

    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    input.focus();

    submitBtn.addEventListener('click', async () => {
      const orderNumber = input.value.trim();
      if (!orderNumber) {
        input.classList.add('error');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving...';

      try {
        console.log('📝 Starting order number save for purchase:', purchaseId);
        const result = await this.submitOrderNumber(purchaseId, orderNumber);
        console.log('📝 Order number save result:', result);
        
        this.showToast('Order number saved!', 'success');
        closeModal();
        
        // Small delay to ensure database commit before fetching
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Reload rewards to refresh the display (force refresh to bypass any caching)
        console.log('📝 Reloading rewards after save...');
        await this.loadRewards(true);
        console.log('📝 Rewards reloaded');
      } catch (error) {
        console.error('❌ Error saving order number:', error);
        this.showToast('Failed to save order number', 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = `Save ${config.label}`;
      }
    });

    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') submitBtn.click();
    });
  }

  async submitOrderNumber(purchaseId, orderNumber) {
    const authData = await chrome.storage.local.get(['token']);
    if (!authData.token) throw new Error('Not authenticated');

    console.log('📝 Submitting order number:', { purchaseId, orderNumber });

    const response = await fetch(`${API_BASE_URL}/api/extension/purchase/${purchaseId}/order-number`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${authData.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ order_number: orderNumber })
    });

    console.log('📝 Order number response status:', response.status);

    if (!response.ok) {
      const error = await response.text();
      console.error('📝 Order number save failed:', error);
      throw new Error(error || `HTTP ${response.status}`);
    }

    // Handle both JSON and empty responses
    const text = await response.text();
    console.log('📝 Order number response:', text);
    
    try {
      return text ? JSON.parse(text) : { success: true };
    } catch {
      return { success: true };
    }
  }

  getFirmLogo(partner) {
    // Use local bundled logos
    const local = getLocalLogo(partner);
    if (local) return local;
    return null;
  }

  formatDate(dateString) {
    if (!dateString) return '';
    
    try {
      const date = new Date(dateString);
      const now = new Date();
      const diffMs = now - date;
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      
      if (diffDays === 0) return 'Today';
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return `${diffDays} days ago`;
      
      return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric' 
      });
    } catch {
      return '';
    }
  }
}

// Add styles for toast animations
const style = document.createElement('style');
style.textContent = `
  @keyframes slideInRight {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  
  @keyframes slideOutRight {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(100%);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const popup = new PopupManager();
  
  // V2: Listen for auth state changes from background script
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "AUTH_STATE_CHANGED") {
      debugLog('🔄 Auth state changed, reinitializing account section');
      popup.initAccountSection();
    }
  });
  
}); 
