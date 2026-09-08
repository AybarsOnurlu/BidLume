import { StorageHelper } from '../utils/storage.js';
import { t, getLanguage, setLanguage } from '../utils/i18n.js';

export async function initTour() {
  const settings = await StorageHelper.getSettings();
  if (settings.hasSeenTour) return;

  // Start Tour
  const tour = new OnboardingTour();
  tour.start();
}

class OnboardingTour {
  constructor() {
    this.steps = [
      {
        isLanguageSelect: true
      },
      {
        target: 'footer',
        tab: 'panel-settings',
        text: () => t('ui.tourStepPrivacy')
      },
      {
        target: '#api-key',
        tab: 'panel-settings',
        text: () => t('ui.tourStep1')
      },
      {
        target: '#cv-text',
        tab: 'panel-settings',
        text: () => t('ui.tourStep2')
      },
      {
        target: '[data-tab="panel-analysis"]',
        tab: 'panel-analysis',
        text: () => t('ui.tourStep3')
      }
    ];
    this.currentStep = 0;
    this.ended = false;
    this.stepTimer = null;
    this.positionTimer = null;
    this.overlay = null;
    this.tooltip = null;
    this.languageBox = null;
    this.activeTarget = null;
    this.originalStyles = new Map();
    this.handleEscape = (event) => {
      if (event.key === 'Escape') this.end();
    };
  }

  start() {
    this.createOverlay();
    this.createTooltip();
    document.addEventListener('keydown', this.handleEscape);
    this.showStep();
  }

  createOverlay() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'tour-overlay transition-opacity duration-300';
    document.body.appendChild(this.overlay);
  }

  createTooltip() {
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'tour-tooltip absolute z-[101] w-64 border rounded-xl p-4 shadow-2xl opacity-0 transition-opacity duration-300 pointer-events-auto';
    
    this.tooltip.innerHTML = `
      <p id="tour-text" class="text-sm mb-4 font-medium leading-relaxed"></p>
      <div class="flex justify-between items-center">
        <button id="tour-skip" type="button" class="text-xs hover:opacity-75 font-medium transition-opacity"></button>
        <div class="flex items-center gap-2">
          <span id="tour-indicator" class="text-[10px] font-bold"></span>
          <button id="tour-next" type="button" class="tour-primary-button px-3 py-1.5 text-xs font-bold rounded-lg transition-colors"></button>
        </div>
      </div>
    `;
    
    document.body.appendChild(this.tooltip);

    document.getElementById('tour-skip').addEventListener('click', () => this.end());
    document.getElementById('tour-next').addEventListener('click', () => {
      this.currentStep++;
      if (this.currentStep >= this.steps.length) {
        this.end();
      } else {
        this.showStep();
      }
    });
  }

  showStep() {
    if (this.ended) return;
    clearTimeout(this.stepTimer);
    clearTimeout(this.positionTimer);
    this.clearHighlight();
    const step = this.steps[this.currentStep];

    if (step.isLanguageSelect) {
      this.showLanguageSelect();
      return;
    }

    // Switch tab
    const tabBtn = document.querySelector(`[data-tab="${step.tab}"]`);
    if (tabBtn) tabBtn.click();

    this.stepTimer = setTimeout(() => {
      if (this.ended) return;
      const targetEl = document.querySelector(step.target);
      if (!targetEl) {
        this.end();
        return;
      }

      this.highlight(targetEl);
      
      // Update Tooltip content
      document.getElementById('tour-text').textContent = step.text();
      document.getElementById('tour-skip').textContent = t('ui.tourSkip');
      document.getElementById('tour-indicator').textContent = `${this.currentStep + 1} / ${this.steps.length}`;
      document.getElementById('tour-next').textContent = this.currentStep === this.steps.length - 1 ? t('ui.tourFinish') : t('ui.tourNext');

      this.positionTooltip(targetEl);
      this.tooltip.classList.remove('opacity-0');
      this.tooltip.classList.add('opacity-100');
    }, 50); // Wait for tab switch
  }

  showLanguageSelect() {
    this.tooltip.classList.add('opacity-0');
    
    const box = document.createElement('div');
    this.languageBox = box;
    box.id = 'tour-lang-box';
    box.className = 'tour-lang-box absolute z-[101] border rounded-xl p-6 shadow-2xl flex flex-col items-center justify-center gap-4 pointer-events-auto';
    box.style.top = '50%';
    box.style.left = '50%';
    box.style.transform = 'translate(-50%, -50%)';
    box.style.width = '320px';

    box.innerHTML = `
      <h2 id="tour-lang-title" class="text-lg font-bold text-center">${t('ui.tourWelcome')}</h2>
      <p id="tour-lang-prompt" class="text-sm text-center mb-2">${t('ui.tourLangSelect')}</p>
      <select id="tour-lang-select" class="w-full border rounded-lg p-3 text-sm focus:border-blue-500 focus:outline-none mb-2">
        <option value="en">English (EN)</option>
        <option value="tr">Türkçe (TR)</option>
        <option value="de">Deutsch (DE)</option>
        <option value="fr">Français (FR)</option>
        <option value="es">Español (ES)</option>
        <option value="pt">Português (PT)</option>
        <option value="ar">العربية (SA)</option>
      </select>
      <button id="tour-lang-start" type="button" class="tour-primary-button w-full py-3 text-sm font-bold rounded-lg transition-colors mt-2 flex justify-center items-center gap-2">
        <span id="tour-lang-start-label">${t('ui.tourStart')}</span>
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
      </button>
      <button id="tour-lang-skip" type="button" class="text-xs underline hover:opacity-75">${t('ui.tourSkipSetup')}</button>
    `;
    
    document.body.appendChild(box);
    const languageSelect = document.getElementById('tour-lang-select');
    languageSelect.value = getLanguage();

    const refreshLanguageBox = (language) => {
      setLanguage(language);
      document.getElementById('tour-lang-title').textContent = t('ui.tourWelcome');
      document.getElementById('tour-lang-prompt').textContent = t('ui.tourLangSelect');
      document.getElementById('tour-lang-start-label').textContent = t('ui.tourStart');
      document.getElementById('tour-lang-skip').textContent = t('ui.tourSkipSetup');
      window.dispatchEvent(new CustomEvent('languageChanged', { detail: language }));
    };

    languageSelect.addEventListener('change', () => refreshLanguageBox(languageSelect.value));

    document.getElementById('tour-lang-skip').addEventListener('click', async () => {
      const selectedLang = languageSelect.value;
      const settings = await StorageHelper.getSettings();
      await StorageHelper.saveSettings({ ...settings, language: selectedLang });
      if (this.ended) return;
      refreshLanguageBox(selectedLang);
      await this.end();
    });

    document.getElementById('tour-lang-start').addEventListener('click', async () => {
      const selectedLang = languageSelect.value;
      const settings = await StorageHelper.getSettings();
      await StorageHelper.saveSettings({ ...settings, language: selectedLang });
      if (this.ended) return;
      
      refreshLanguageBox(selectedLang);
      
      // Clean up box and move to next step
      box.remove();
      this.languageBox = null;
      this.currentStep++;
      this.showStep();
    });
  }

  highlight(el) {
    this.activeTarget = el;
    
    // Scroll into view if needed
    el.scrollIntoView({ behavior: 'instant', block: 'center' });

    // Store original styles that we might change
    this.originalStyles.set(el, {
      position: el.style.position,
      zIndex: el.style.zIndex,
      backgroundColor: el.style.backgroundColor,
      boxShadow: el.style.boxShadow,
      outline: el.style.outline,
      outlineOffset: el.style.outlineOffset,
      borderRadius: el.style.borderRadius
    });

    // Make element pop over overlay
    const computedStyle = window.getComputedStyle(el);
    if (computedStyle.position === 'static') {
      el.style.position = 'relative';
    }
    el.style.zIndex = '102';
    
    // Add distinct glowing border to highlight the target
    el.style.outline = '3px solid #10b981'; // emerald-500
    el.style.outlineOffset = '4px';
    el.style.boxShadow = '0 0 25px rgba(16, 185, 129, 0.4)';
    el.style.borderRadius = computedStyle.borderRadius !== '0px' ? computedStyle.borderRadius : '8px';
    
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.style.backgroundColor = document.body.classList.contains('dark') ? '#1e293b' : '#f8fafc'; // slate-800 or slate-50
    } else {
      el.style.backgroundColor = computedStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' ? computedStyle.backgroundColor : (document.body.classList.contains('dark') ? '#0f172a' : '#ffffff');
    }
  }

  clearHighlight() {
    if (this.activeTarget && this.originalStyles.has(this.activeTarget)) {
      const orig = this.originalStyles.get(this.activeTarget);
      this.activeTarget.style.position = orig.position;
      this.activeTarget.style.zIndex = orig.zIndex;
      this.activeTarget.style.backgroundColor = orig.backgroundColor;
      this.activeTarget.style.boxShadow = orig.boxShadow;
      this.activeTarget.style.outline = orig.outline;
      this.activeTarget.style.outlineOffset = orig.outlineOffset;
      this.activeTarget.style.borderRadius = orig.borderRadius;
      this.activeTarget = null;
    }
    this.tooltip.classList.remove('opacity-100');
    this.tooltip.classList.add('opacity-0');
  }

  positionTooltip(targetEl) {
    // Need a tiny delay to ensure element is in viewport after scrollIntoView
    this.positionTimer = setTimeout(() => {
      if (this.ended) return;
      const rect = targetEl.getBoundingClientRect();
      const tooltipRect = this.tooltip.getBoundingClientRect();
      
      let top = rect.bottom + 10;
      let left = rect.left;

      // If tooltip goes below window, put it above target
      if (top + tooltipRect.height > window.innerHeight) {
        top = rect.top - tooltipRect.height - 10;
      }
      
      // If it goes above window (very rare), adjust
      if (top < 0) {
        top = 10;
      }

      // If tooltip goes off right edge
      if (left + tooltipRect.width > window.innerWidth) {
        left = window.innerWidth - tooltipRect.width - 10;
      }

      this.tooltip.style.top = `${top}px`;
      this.tooltip.style.left = `${left}px`;
    }, 100);
  }

  async end() {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this.stepTimer);
    clearTimeout(this.positionTimer);
    this.clearHighlight();
    if (this.overlay) this.overlay.remove();
    if (this.tooltip) this.tooltip.remove();
    if (this.languageBox) this.languageBox.remove();
    document.removeEventListener('keydown', this.handleEscape);
    
    const settings = await StorageHelper.getSettings();
    await StorageHelper.saveSettings({ ...settings, hasSeenTour: true });
  }
}
