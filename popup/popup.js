import { StorageHelper, STORAGE_KEYS } from '../utils/storage.js';
import { t, setLanguage, getLanguage } from '../utils/i18n.js';
import { extractSkillsFromCV, fetchAvailableModels } from '../utils/ai.js';
import { MSG } from '../utils/messaging.js';
import { initTour } from './tour.js';

let currentTheme = 'auto';
let currentSettings = null;
let systemThemeQuery = null;
const DATE_LOCALES = {
  tr: 'tr-TR',
  en: 'en-US',
  de: 'de-DE',
  fr: 'fr-FR',
  es: 'es-ES',
  pt: 'pt-PT',
  ar: 'ar-SA'
};

function isLocalApiUrl(url) {
  return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
}

function getApiAccessPattern(profile) {
  const apiKey = (profile.openAIApiKey || '').trim();
  let provider = profile.apiProvider || 'auto';
  let endpoint = (profile.apiBaseUrl || '').trim();

  if (provider === 'auto') {
    if (apiKey.startsWith('AIza') || apiKey.startsWith('AQ.')) provider = 'gemini';
    else if (apiKey.startsWith('gsk_')) provider = 'groq';
    else provider = 'openai';
  }

  if (provider === 'gemini') endpoint = 'https://generativelanguage.googleapis.com/';
  else if (provider === 'groq') endpoint = 'https://api.groq.com/';
  else if (provider === 'openai' && (!endpoint || endpoint.includes('api.openai.com'))) endpoint = 'https://api.openai.com/';

  if (!endpoint) throw new Error(t('api.errorInvalidUrl'));

  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error(t('api.errorInvalidUrl'));
  }

  if (parsed.protocol !== 'https:' && !isLocalApiUrl(parsed)) {
    throw new Error(t('api.errorSecureUrl'));
  }

  // Chrome match patterns do not include ports; a host pattern covers every port.
  return `${parsed.protocol}//${parsed.hostname}/*`;
}

async function ensureApiAccess(profile, requestIfMissing = false) {
  const apiKey = (profile.openAIApiKey || '').trim();
  const isCustom = profile.apiProvider === 'custom';
  if (!apiKey && !isCustom) return true;

  const origin = getApiAccessPattern(profile);
  const originUrl = new URL(origin.replace(/\*$/, ''));
  if (!apiKey && !isLocalApiUrl(originUrl)) {
    throw new Error(t('api.errorMissingKey'));
  }
  if (!chrome.permissions?.contains) return true;
  if (requestIfMissing) {
    try {
      // Call request directly from the click handler path so Chrome retains the user gesture.
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (!granted) throw new Error(t('api.permissionDenied'));
      return true;
    } catch (error) {
      if (error.message === t('api.permissionDenied')) throw error;
      throw new Error(t('api.unsupportedHost', { host: originUrl.hostname }));
    }
  }

  return chrome.permissions.contains({ origins: [origin] });
}

document.addEventListener('DOMContentLoaded', async () => {
  // Load language first so all subsequent renders use it
  const settings = await StorageHelper.getSettings();
  if (settings.language) {
    setLanguage(settings.language);
  }
  
  initTabs();
  await initTheme();
  await loadSettings();
  await loadAnalysis();
  await loadHistory();
  initSettingsEvents();
  listenForStorageChanges();
  updateStaticUI();
  
  // Start Onboarding Tour if needed
  setTimeout(() => initTour(), 500); // small delay to let UI settle

  window.addEventListener('languageChanged', (e) => {
    setLanguage(e.detail);
    updateStaticUI();
    const settingsLang = document.getElementById('lang-select');
    if (settingsLang) settingsLang.value = e.detail;
  });
});

// Update static UI elements with current language
function updateStaticUI() {
  document.documentElement.lang = getLanguage();
  document.documentElement.dir = getLanguage() === 'ar' ? 'rtl' : 'ltr';

  // Tab labels (text nodes only, preserve SVG icons)
  const tabAnalysis = document.getElementById('tab-analysis');
  const tabHistory = document.getElementById('tab-history');
  const tabSettings = document.getElementById('tab-settings');
  setTabText(tabAnalysis, t('ui.tabAnalysis'));
  setTabText(tabHistory, t('ui.tabHistory'));
  setTabText(tabSettings, t('ui.tabSettings'));
  
  // Empty states
  const emptyTitle = document.querySelector('#empty-state h2');
  const emptyDesc = document.querySelector('#empty-state p');
  if (emptyTitle) emptyTitle.textContent = t('ui.emptyTitle');
  if (emptyDesc) emptyDesc.textContent = t('ui.emptyDesc');

  const emptyReadyLabel = document.getElementById('empty-ready-label');
  const emptyStepOpen = document.getElementById('empty-step-open');
  const emptyStepScore = document.getElementById('empty-step-score');
  const emptyStepReturn = document.getElementById('empty-step-return');
  const openUpworkJobsLabel = document.getElementById('open-upwork-jobs-label');
  if (emptyReadyLabel) emptyReadyLabel.textContent = t('ui.emptyReady');
  if (emptyStepOpen) emptyStepOpen.textContent = t('ui.emptyStepOpen');
  if (emptyStepScore) emptyStepScore.textContent = t('ui.emptyStepScore');
  if (emptyStepReturn) emptyStepReturn.textContent = t('ui.emptyStepReturn');
  if (openUpworkJobsLabel) openUpworkJobsLabel.textContent = t('ui.openUpworkJobs');
  
  const histEmpty = document.querySelector('#history-empty p');
  if (histEmpty) histEmpty.textContent = t('ui.historyEmpty');
  
  const clearHistoryBtn = document.getElementById('clear-history');
  if (clearHistoryBtn) setTabText(clearHistoryBtn, t('ui.clearHistory'));
  
  // Footer
  document.getElementById('support-patreon').textContent = t('ui.supportPatreon');
  const footer = document.querySelector('footer p');
  if (footer) {
    footer.textContent = `${t('ui.version')} • ${t('ui.developedBy')} Aybars`;
  }
  
  // Analysis Panel Headings
  const jobLink = document.getElementById('job-link');
  if (jobLink) {
    setTabText(jobLink, t('ui.viewJob'));
  }
  
  const redFlagsHeading = document.querySelector('#redflags-section h3');
  if (redFlagsHeading) setTabText(redFlagsHeading, t('ui.redFlags'));
  
  const greenFlagsHeading = document.querySelector('#greenflags-section h3');
  if (greenFlagsHeading) setTabText(greenFlagsHeading, t('ui.greenFlags'));
  
  const skillsHeading = document.querySelector('#skills-section h3');
  if (skillsHeading) setTabText(skillsHeading, t('ui.skillMatch'));
  
  const noSkillsMsg = document.getElementById('no-skills-msg');
  if (noSkillsMsg) noSkillsMsg.textContent = t('ui.addSkillsHint');
  
  // Settings Panel
  const settingsYourSkills = document.querySelector('#panel-settings label');
  if (settingsYourSkills) settingsYourSkills.textContent = t('ui.yourSkills');
  
  const skillInput = document.getElementById('skill-input');
  if (skillInput) skillInput.placeholder = t('ui.addSkillPlaceholder');
  
  const skillHint = document.querySelector('#skills-input-container + p');
  if (skillHint) skillHint.textContent = t('ui.addSkillHint');
  
  const minHourlyLabel = document.querySelector('label[for="min-hourly"]');
  if (minHourlyLabel) minHourlyLabel.textContent = t('ui.minHourly');
  
  const minFixedLabel = document.querySelector('label[for="min-fixed"]');
  if (minFixedLabel) minFixedLabel.textContent = t('ui.minFixed');
  
  // Theme Label
  const themeOptionsDiv = document.getElementById('theme-options');
  if (themeOptionsDiv && themeOptionsDiv.previousElementSibling) {
    themeOptionsDiv.previousElementSibling.textContent = t('ui.theme');
  }
  
  const themeAuto = document.querySelector('[data-theme="auto"]');
  if (themeAuto) themeAuto.textContent = t('ui.themeAuto');
  
  const themeLight = document.querySelector('[data-theme="light"]');
  if (themeLight) themeLight.textContent = t('ui.themeLight');
  
  const themeDark = document.querySelector('[data-theme="dark"]');
  if (themeDark) themeDark.textContent = t('ui.themeDark');
  
  // Provider Select Translations
  const providerLabel = document.getElementById('api-provider-label');
  if (providerLabel) providerLabel.textContent = t('ui.apiProviderLabel');
  
  const providerSelect = document.getElementById('api-provider');
  if (providerSelect) {
    const opts = providerSelect.options;
    for (let i = 0; i < opts.length; i++) {
      if (opts[i].value === 'auto') opts[i].textContent = t('ui.apiProvAuto');
      else if (opts[i].value === 'openai') opts[i].textContent = t('ui.apiProvOpenAI');
      else if (opts[i].value === 'gemini') opts[i].textContent = t('ui.apiProvGemini');
      else if (opts[i].value === 'groq') opts[i].textContent = t('ui.apiProvGroq');
      else if (opts[i].value === 'custom') opts[i].textContent = t('ui.apiProvCustom');
    }
  }
  

  const langLabel = document.querySelector('label[for="lang-select"]');
  if (langLabel) langLabel.textContent = t('ui.language');
  
  const saveBtn = document.getElementById('save-settings');
  if (saveBtn) setTabText(saveBtn, t('ui.saveSettings'));
  
  // Budget & Client Headings
  const budgetHeading = document.querySelector('#budget-section h3');
  if (budgetHeading) setTabText(budgetHeading, t('ui.budget'));
  
  const clientHeading = document.querySelector('#client-section h3');
  if (clientHeading) setTabText(clientHeading, t('ui.client'));
  
  // Main Header
  const themeToggleBtn = document.getElementById('theme-toggle');
  if (themeToggleBtn) themeToggleBtn.title = t('ui.themeToggle') || 'Toggle Theme';
  const appTitle = document.querySelector('header h1');
  if (appTitle) setTabText(appTitle, t('ui.appName'));
  
  const appDesc = document.querySelector('header p');
  if (appDesc) setTabText(appDesc, t('ui.appDesc'));
  
  const apiBaseUrlLabel = document.querySelector('label[for="api-base-url"]');
  if (apiBaseUrlLabel) apiBaseUrlLabel.textContent = t('ui.apiBaseUrl');
  
  const appSubtitle = document.getElementById('app-subtitle');
  if (appSubtitle) appSubtitle.textContent = t('ui.appSubtitle');
  
  const apiModelLabel = document.querySelector('label[for="api-model"]');
  if (apiModelLabel) apiModelLabel.textContent = t('ui.apiModel');
  
  const apiModelInput = document.getElementById('api-model');
  if (apiModelInput) apiModelInput.placeholder = t('ui.apiModelPlaceholder');

  const modelLoading = document.getElementById('model-loading');
  if (modelLoading) modelLoading.textContent = t('ui.modelLoading');
  
  const apiKeyLabel = document.querySelector('label[for="api-key"]');
  if (apiKeyLabel) setTabText(apiKeyLabel, t('ui.apiKey'));
  
  const apiTrustMsg = document.getElementById('api-trust-msg');
  if (apiTrustMsg) {
    apiTrustMsg.innerHTML = t('ui.apiTrustMsg');
    apiTrustMsg.querySelectorAll('a').forEach((link) => {
      link.rel = 'noopener noreferrer';
    });
  }
  
  const aiModeLabel = document.querySelector('label[for="ai-mode"]');
  if (aiModeLabel) aiModeLabel.textContent = t('ui.aiAnalysisMode');
  
  const aiModeAuto = document.querySelector('#ai-mode option[value="auto"]');
  if (aiModeAuto) aiModeAuto.textContent = t('ui.aiModeAuto');
  
  const aiModeManual = document.querySelector('#ai-mode option[value="manual"]');
  if (aiModeManual) aiModeManual.textContent = t('ui.aiModeManual');
  
  const cvLabel = document.querySelector('label[for="cv-text"]');
  if (cvLabel) cvLabel.textContent = t('ui.cvExtractTitle');
  
  const cvInput = document.getElementById('cv-text');
  if (cvInput) cvInput.placeholder = t('ui.cvPlaceholder');
  
  const cvBtn = document.getElementById('cv-parse-btn');
  if (cvBtn) setTabText(cvBtn, t('ui.cvBtn'));
  
  const aiSummaryTitle = document.querySelector('#ai-section h3');
  if (aiSummaryTitle) setTabText(aiSummaryTitle, t('ui.aiSummaryTitle'));
  
  const aiStartBtn = document.getElementById('start-ai-btn');
  if (aiStartBtn) aiStartBtn.textContent = t('ui.aiStartBtn');
  
  const replayTourBtn = document.getElementById('replay-tour-btn');
  if (replayTourBtn) {
    replayTourBtn.textContent = typeof t === 'function' && t('ui.tourReplay') ? t('ui.tourReplay') : 'Restart Product Tour';
  }
}

function setTabText(tabEl, text) {
  if (!tabEl) return;
  // Find the text node
  const nodes = tabEl.childNodes;
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (nodes[i].nodeType === 3 && nodes[i].textContent.trim().length > 0) {
      nodes[i].textContent = ' ' + text + ' ';
      return;
    }
  }
  // If no text node found, append one
  tabEl.appendChild(document.createTextNode(' ' + text));
}

function initTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  const indicator = document.getElementById('tab-indicator');
  
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => {
      // Update active class
      tabs.forEach(t => t.classList.remove('active', 'text-green-400'));
      tab.classList.add('active', 'text-green-400');
      
      // Move indicator
      indicator.style.left = `${index * 33.33}%`;
      
      // Show panel
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
      document.getElementById(tab.dataset.tab).classList.remove('hidden');
    });
  });
}

async function initTheme() {
  const profile = await StorageHelper.getUserProfile();
  setTheme(profile.theme || 'auto');

  systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  systemThemeQuery.addEventListener?.('change', () => {
    if (currentTheme === 'auto') setTheme('auto');
  });
  
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const nextTheme = document.body.classList.contains('dark') ? 'light' : 'dark';
    setTheme(nextTheme);
    StorageHelper.saveUserProfile({ theme: nextTheme });
  });
}

function setTheme(theme) {
  if (!['auto', 'light', 'dark'].includes(theme)) theme = 'auto';
  currentTheme = theme;
  const isDark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  
  document.body.classList.toggle('dark', isDark);
  document.body.classList.toggle('light', !isDark);
  document.body.classList.toggle('bg-slate-900', isDark);
  document.body.classList.toggle('text-slate-200', isDark);
  document.body.classList.toggle('bg-slate-50', !isDark);
  document.body.classList.toggle('text-slate-800', !isDark);
  document.documentElement.dataset.resolvedTheme = isDark ? 'dark' : 'light';
  
  document.getElementById('theme-icon-dark').classList.toggle('hidden', !isDark);
  document.getElementById('theme-icon-light').classList.toggle('hidden', isDark);
  
  document.querySelectorAll('.theme-option').forEach(btn => {
    if (btn.dataset.theme === theme) {
      // Add background and border styling for selected theme
      btn.classList.add('border-green-500', 'bg-green-500/20', 'text-green-600', 'font-medium');
      btn.classList.remove('border-slate-700', 'text-slate-400', 'text-slate-500', 'text-slate-600');
    } else {
      btn.classList.remove('border-green-500', 'bg-green-500/20', 'text-green-600', 'font-medium');
      btn.classList.add('border-slate-700', isDark ? 'text-slate-400' : 'text-slate-600');
      btn.classList.remove(isDark ? 'text-slate-600' : 'text-slate-400', 'text-slate-500');
    }
  });
}

async function loadAnalysis() {
  const analysis = await StorageHelper.getLastAnalysis();
  if (analysis) {
    renderAnalysis(analysis);
  } else {
    document.getElementById('empty-state').classList.remove('hidden');
    document.getElementById('analysis-content').classList.add('hidden');
  }
}

function renderAnalysis(data) {
  document.getElementById('empty-state').classList.add('hidden');
  const content = document.getElementById('analysis-content');
  content.classList.remove('hidden');
  
  // Header
  document.getElementById('job-title').textContent = data.jobTitle || t('ui.untitledJob');
  document.getElementById('job-link').href = safeUpworkUrl(data.jobUrl);
  
  // Score
  document.getElementById('score-value').textContent = data.overallScore;
  document.getElementById('score-label').textContent = getScoreLabel(data.scoreLabel);
  document.getElementById('score-label').setAttribute('style', getScoreLabelInlineStyle(data.scoreLabel));
  document.getElementById('score-label').className = 'mt-2 px-3 py-1 rounded-full text-xs font-semibold';
  
  animateScore(data.overallScore);
  
  // Flags
  renderRedFlags(data.redFlags);
  renderGreenFlags(data.greenFlags);
  
  // Details
  renderBudgetAnalysis(data.budgetAnalysis);
  renderClientAnalysis(data.clientAnalysis);
  renderSkillMatch(data.skillMatch);
  
  // AI Summary
  const aiSection = document.getElementById('ai-section');
  const aiSummaryContent = document.getElementById('ai-summary-content');
  const startAiBtn = document.getElementById('start-ai-btn');
  
  if (data.aiSummary) {
    aiSection.classList.remove('hidden');
    aiSummaryContent.textContent = data.aiSummary;
    startAiBtn.classList.add('hidden');
  } else if (currentSettings && currentSettings.aiAnalysisMode === 'manual') {
    aiSection.classList.remove('hidden');
    aiSummaryContent.textContent = t('ui.aiUnanalyzed');
    startAiBtn.classList.remove('hidden');
    
    startAiBtn.onclick = async () => {
      startAiBtn.disabled = true;
      startAiBtn.textContent = t('ui.aiAnalyzing');
      try {
        await ensureApiAccess(currentSettings || await StorageHelper.getUserProfile(), true);
        const response = await chrome.runtime.sendMessage({ type: MSG.RUN_AI_ANALYSIS, data: data });
        if (response && response.success && response.analysis) {
          renderAnalysis(response.analysis);
        } else {
          throw new Error(response.error || 'Unknown error');
        }
      } catch (err) {
        aiSummaryContent.textContent = t('cv.errorApi', { error: err.message });
        startAiBtn.disabled = false;
        startAiBtn.textContent = t('ui.aiTryAgain');
      }
    };
  } else {
    aiSection.classList.add('hidden');
  }
}

function animateScore(score) {
  const ring = document.getElementById('score-ring');
  const circumference = 326.73; // 2 * PI * 52
  const offset = circumference - (score / 100) * circumference;
  
  // Trigger reflow to restart animation
  ring.style.strokeDashoffset = circumference;
  ring.getBoundingClientRect(); 
  ring.style.strokeDashoffset = offset;
  
  // Set color based on score
  let color = '#14a800'; // good
  if (score <= 30) color = '#ef4444'; // high-risk
  else if (score <= 60) color = '#f59e0b'; // caution
  else if (score <= 80) color = '#22c55e'; // decent
  
  ring.style.stroke = color;
  document.getElementById('score-value').style.color = color;
}

function renderRedFlags(flags) {
  const section = document.getElementById('redflags-section');
  if (!flags || flags.length === 0) {
    section.classList.add('hidden');
    return;
  }
  
  section.classList.remove('hidden');
  document.getElementById('redflags-count').textContent = flags.length;
  
  const list = document.getElementById('redflags-list');
  list.innerHTML = flags.map(flag => `
    <div class="flex items-start gap-2 p-2 rounded bg-slate-800/50 border border-slate-700">
      <span class="text-xs mt-0.5">${getSeverityIcon(flag.severity)}</span>
      <div>
        <div class="text-xs font-medium text-slate-200">${escapeHtml(flag.title)}</div>
        <div class="text-[10px] text-slate-400 mt-0.5">${escapeHtml(flag.description)}</div>
      </div>
    </div>
  `).join('');
}

function renderGreenFlags(flags) {
  const section = document.getElementById('greenflags-section');
  if (!flags || flags.length === 0) {
    section.classList.add('hidden');
    return;
  }
  
  section.classList.remove('hidden');
  const list = document.getElementById('greenflags-list');
  list.innerHTML = flags.map(flag => `
    <div class="flex items-center gap-1.5 text-xs text-slate-300">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="text-green-500 inline-block shrink-0"><polyline points="20 6 9 17 4 12"/></svg>
      <div>
        <span class="font-medium text-slate-200">${escapeHtml(flag.title)}</span>:
        <span class="text-slate-400">${escapeHtml(flag.description)}</span>
      </div>
    </div>
  `).join('');
}

function renderBudgetAnalysis(data) {
  document.getElementById('budget-score').textContent = data.score + '/100';
  document.getElementById('budget-label').textContent = data.label;
  renderPlainDetails('budget-details', data.details);
}

function renderClientAnalysis(data) {
  document.getElementById('client-score').textContent = data.score + '/100';
  document.getElementById('client-label').textContent = data.label;
  renderPlainDetails('client-details', data.details);
}

function renderSkillMatch(data) {
  if (!data || (data.matched.length === 0 && data.unmatched.length === 0)) {
    const msgEl = document.getElementById('no-skills-msg');
    msgEl.classList.remove('hidden');
    msgEl.textContent = data && !data.hasUserSkills 
      ? t('ui.addSkillsWarning')
      : t('ui.noJobSkills');
    document.getElementById('skill-tags').innerHTML = '';
    document.getElementById('skill-bar').style.width = '0%';
    document.getElementById('skill-percentage').textContent = '';
    return;
  }
  
  if (!data.hasUserSkills) {
    const msgEl = document.getElementById('no-skills-msg');
    msgEl.classList.remove('hidden');
    msgEl.textContent = t('ui.addSkillsWarning');
  } else {
    document.getElementById('no-skills-msg').classList.add('hidden');
  }
  document.getElementById('skill-percentage').textContent = t('ui.skillMatchPercent', { percent: data.matchPercentage });
  document.getElementById('skill-bar').style.width = `${data.matchPercentage}%`;
  
  const tagsContainer = document.getElementById('skill-tags');
  let html = '';
  
  data.matched.forEach(skill => {
    html += `<span class="px-2 py-1 text-[10px] font-medium rounded-md bg-green-500/20 text-green-400 border border-green-500/30">${escapeHtml(skill)}</span>`;
  });
  
  data.unmatched.forEach(skill => {
    html += `<span class="px-2 py-1 text-[10px] rounded-md bg-slate-700 text-slate-400 border border-slate-600">${escapeHtml(skill)}</span>`;
  });
  
  tagsContainer.innerHTML = html;
}

async function loadHistory() {
  const history = await StorageHelper.getHistory();
  const list = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');
  const clearBtn = document.getElementById('clear-history');
  
  if (!history || history.length === 0) {
    empty.classList.remove('hidden');
    list.innerHTML = '';
    clearBtn.classList.add('hidden');
    return;
  }
  
  empty.classList.add('hidden');
  clearBtn.classList.remove('hidden');
  
  list.innerHTML = history.map(item => {
    // Safely parse date and format it automatically in the user's OS locale/timezone
    const time = new Date(item.analyzedAt).toLocaleString(DATE_LOCALES[getLanguage()] || 'en-US', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });

    const colorClass = getScoreColorClass(item.overallScore);
    const labelText = getScoreLabel(item.scoreLabel);
    const labelStyle = getScoreLabelInlineStyle(item.scoreLabel);
    const untitledJob = typeof t === 'function' && t('ui.untitledJob') ? t('ui.untitledJob') : 'Untitled Job';
    
    return `
      <div class="relative block p-3 rounded-xl bg-slate-800/40 border border-slate-700/50 hover:border-slate-600 transition-colors group">
        <div class="flex items-start justify-between gap-3">
          <a href="${safeUpworkUrl(item.jobUrl)}" target="_blank" rel="noopener noreferrer" class="flex-1 min-w-0">
            <h4 class="text-xs font-semibold text-slate-200 truncate">${escapeHtml(item.jobTitle || untitledJob)}</h4>
            <div class="text-[10px] text-slate-500 mt-1">${escapeHtml(time)}</div>
          </a>
          <div class="flex-shrink-0 flex flex-col items-end gap-1">
            <div class="flex items-center gap-2">
              <button data-job-id="${escapeHtml(item.jobId)}" class="delete-history-btn p-1 text-slate-500 hover:text-red-400 hover:bg-slate-700/50 rounded-md opacity-0 group-hover:opacity-100 transition-all focus:outline-none z-10" title="${escapeHtml(t('ui.deleteHistory'))}" aria-label="${escapeHtml(t('ui.deleteHistory'))}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
              </button>
              <span class="text-lg font-bold ${colorClass}">${item.overallScore}</span>
            </div>
            <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full" style="${labelStyle}">${labelText}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
  
  // Attach delete handlers
  list.querySelectorAll('.delete-history-btn').forEach(btn => {
    btn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const jobId = btn.dataset.jobId;
      if (jobId) {
        await StorageHelper.deleteAnalysisById(jobId);
        loadHistory(); // Reload UI
      }
    };
  });
  
  clearBtn.onclick = async () => {
    await StorageHelper.clearHistory();
    loadHistory();
  };
}

async function loadSettings() {
  currentSettings = await StorageHelper.getUserProfile();
  
  document.getElementById('min-hourly').value = currentSettings.minimumHourlyRate || 25;
  document.getElementById('min-fixed').value = currentSettings.minimumFixedBudget || 100;
  
  const apiKeyEl = document.getElementById('api-key');
  if (apiKeyEl) apiKeyEl.value = currentSettings.openAIApiKey || '';
  
  const apiBaseUrlEl = document.getElementById('api-base-url');
  if (apiBaseUrlEl) apiBaseUrlEl.value = currentSettings.apiBaseUrl || 'https://api.openai.com/v1/chat/completions';
  
  const apiModelEl = document.getElementById('api-model');
  if (apiModelEl) apiModelEl.value = currentSettings.apiModel || '';

  const apiProviderEl = document.getElementById('api-provider');
  const apiBaseUrlContainer = document.getElementById('api-base-url-container');
  if (apiProviderEl) {
    apiProviderEl.value = currentSettings.apiProvider || 'auto';
    apiProviderEl.onchange = () => {
      if (apiProviderEl.value === 'custom') {
        apiBaseUrlContainer.classList.remove('hidden');
      } else {
        apiBaseUrlContainer.classList.add('hidden');
      }
      populateModelsList();
    };
    // Trigger initial state
    apiProviderEl.onchange();
  }
  
  if (apiKeyEl) {
    apiKeyEl.addEventListener('blur', populateModelsList);
  }
  if (apiBaseUrlEl) {
    apiBaseUrlEl.addEventListener('blur', populateModelsList);
  }
  
  const aiModeEl = document.getElementById('ai-mode');
  if (aiModeEl) aiModeEl.value = currentSettings.aiAnalysisMode || 'auto';
  
  // Set language selector
  const settings = await StorageHelper.getSettings();
  const langSelect = document.getElementById('lang-select');
  if (langSelect) {
    langSelect.value = settings.language || getLanguage();
  }
  
  // Render skill tags
  const container = document.getElementById('skills-input-container');
  const input = document.getElementById('skill-input');
  
  // Remove existing tags
  container.querySelectorAll('.skill-tag-chip').forEach(el => el.remove());
  
  // Add chips before input
  (currentSettings.skills || []).forEach(skill => {
    addSkillChip(skill, container, input);
  });
}

async function populateModelsList() {
  const apiKeyEl = document.getElementById('api-key');
  const apiProviderEl = document.getElementById('api-provider');
  const apiBaseUrlEl = document.getElementById('api-base-url');
  const datalist = document.getElementById('models-list');
  const loadingIndicator = document.getElementById('model-loading');
  
  if (!apiKeyEl || !datalist || !loadingIndicator) return;
  
  const apiKey = apiKeyEl.value.trim();
  const provider = apiProviderEl ? apiProviderEl.value : 'auto';
  
  // Try to infer provider if auto
  let realProvider = provider;
  let baseUrl = apiBaseUrlEl ? apiBaseUrlEl.value.trim() : 'https://api.openai.com/v1/chat/completions';

  if (!apiKey) {
    try {
      if (provider !== 'custom' || !isLocalApiUrl(new URL(baseUrl))) return;
    } catch {
      return;
    }
  }
  
  if (provider === 'auto') {
    if (apiKey.startsWith('AIza') || apiKey.startsWith('AQ.')) realProvider = 'gemini';
    else if (apiKey.startsWith('gsk_')) {
      realProvider = 'groq';
      baseUrl = 'https://api.groq.com/openai/v1/chat/completions';
    } else {
      realProvider = 'openai';
    }
  }

  if (realProvider === 'groq' && (!baseUrl || baseUrl.includes('api.openai.com'))) {
    baseUrl = 'https://api.groq.com/openai/v1/chat/completions';
  }

  const accessProfile = {
    openAIApiKey: apiKey,
    apiProvider: provider,
    apiBaseUrl: baseUrl
  };
  if (!(await ensureApiAccess(accessProfile, false))) return;
  
  loadingIndicator.classList.remove('hidden');
  
  try {
    const models = await fetchAvailableModels(realProvider, baseUrl, apiKey);
    datalist.innerHTML = '';
    if (models && models.length > 0) {
      models.forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        datalist.appendChild(option);
      });
    }
  } catch (err) {
    console.error('[UJA] Failed to populate models:', err);
  } finally {
    loadingIndicator.classList.add('hidden');
  }
}

function addSkillChip(skill, container, inputEl) {
  const chip = document.createElement('div');
  chip.className = 'skill-tag-chip flex items-center gap-1 px-2 py-1 bg-slate-700 rounded text-xs text-slate-200';
  chip.innerHTML = `
    <span>${escapeHtml(skill)}</span>
    <button type="button" class="hover:text-red-400 focus:outline-none" aria-label="${escapeHtml(t('ui.removeSkill'))}">&times;</button>
  `;
  chip.dataset.skill = skill;
  
  chip.querySelector('button').onclick = () => chip.remove();
  container.insertBefore(chip, inputEl);
}

function initSettingsEvents() {
  const container = document.getElementById('skills-input-container');
  const input = document.getElementById('skill-input');
  
  container.onclick = () => input.focus();
  
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = input.value.trim().replace(/,/g, '');
      if (val) {
        addSkillChip(val, container, input);
        input.value = '';
      }
    } else if (e.key === 'Backspace' && input.value === '') {
      const chips = container.querySelectorAll('.skill-tag-chip');
      if (chips.length > 0) {
        chips[chips.length - 1].remove();
      }
    }
  });
  
  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.onclick = () => {
      setTheme(btn.dataset.theme);
    };
  });
  
  const replayBtn = document.getElementById('replay-tour-btn');
  if (replayBtn) {
    replayBtn.onclick = async () => {
      await StorageHelper.saveSettings({ hasSeenTour: false });
      document.querySelector('[data-tab="panel-settings"]').click();
      initTour();
    };
  }

  const cvBtn = document.getElementById('cv-parse-btn');
  if (cvBtn) {
    cvBtn.onclick = async () => {
      const cvText = document.getElementById('cv-text').value.trim();
      if (!cvText) return alert(t('cv.errorEmpty') || 'Please enter CV text.');
      
      cvBtn.disabled = true;
      const originalText = cvBtn.textContent;
      cvBtn.textContent = t('ui.aiAnalyzing');
      
      try {
        const tempProfile = await StorageHelper.getUserProfile();
        const apiKey = document.getElementById('api-key')?.value;
        const apiBaseUrl = document.getElementById('api-base-url')?.value;
        const apiModel = document.getElementById('api-model')?.value;
        const apiProvider = document.getElementById('api-provider')?.value;
        
        // Use current input values for ad-hoc parse
        const aiProfile = {
          ...tempProfile,
          openAIApiKey: apiKey || tempProfile.openAIApiKey,
          apiBaseUrl: apiBaseUrl || tempProfile.apiBaseUrl,
          apiModel: apiModel || tempProfile.apiModel,
          apiProvider: apiProvider || tempProfile.apiProvider || 'auto'
        };
        await ensureApiAccess(aiProfile, true);
        const extracted = await extractSkillsFromCV(cvText, aiProfile);
        
        // Expected "React, Node.js, HTML..."
        const newSkills = extracted.split(',').map(s => s.trim()).filter(s => s);
        newSkills.forEach(s => {
          // Check if already exists in UI
          const existing = Array.from(container.querySelectorAll('.skill-tag-chip')).map(el => el.dataset.skill);
          if (!existing.includes(s)) {
            addSkillChip(s, container, input);
          }
        });
        document.getElementById('cv-text').value = '';
        
        // Auto-save settings
        const saveBtn = document.getElementById('save-settings');
        if (saveBtn) saveBtn.click();
      } catch (err) {
        alert(t('cv.errorApi', { error: err.message }) || 'Error: ' + err.message);
      } finally {
        cvBtn.disabled = false;
        cvBtn.textContent = originalText;
      }
    };
  }
  
  document.getElementById('save-settings').onclick = async () => {
    const skills = Array.from(document.querySelectorAll('.skill-tag-chip')).map(el => el.dataset.skill);
    const minHourly = Math.max(0, parseFloat(document.getElementById('min-hourly').value) || 0);
    const minFixed = Math.max(0, parseFloat(document.getElementById('min-fixed').value) || 0);
    const openAIApiKey = document.getElementById('api-key')?.value || '';
    const apiBaseUrl = document.getElementById('api-base-url')?.value || 'https://api.openai.com/v1/chat/completions';
    const apiModel = document.getElementById('api-model')?.value || '';
    const apiProvider = document.getElementById('api-provider')?.value || 'auto';
    const aiAnalysisMode = document.getElementById('ai-mode')?.value || 'auto';
    const selectedLang = document.getElementById('lang-select')?.value || getLanguage();
    
    // Apply language change
    setLanguage(selectedLang);
    
    const nextSettings = {
      ...currentSettings,
      skills,
      minimumHourlyRate: minHourly,
      minimumFixedBudget: minFixed,
      theme: currentTheme,
      openAIApiKey,
      apiBaseUrl,
      apiModel,
      apiProvider,
      aiAnalysisMode
    };

    try {
      await ensureApiAccess(nextSettings, true);
    } catch (error) {
      alert(error.message);
      return;
    }

    currentSettings = nextSettings;
    await StorageHelper.saveUserProfile(currentSettings);
    await populateModelsList();
    
    const sysSettings = await StorageHelper.getSettings();
    await StorageHelper.saveSettings({ ...sysSettings, language: selectedLang });
    
    // Update all UI text with new language
    updateStaticUI();
    
    // Show toast
    const toast = document.getElementById('save-toast');
    toast.textContent = t('ui.settingsSaved');
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
    
    // Re-evaluate current analysis if exists
    const lastAnalysis = await StorageHelper.getLastAnalysis();
    if (lastAnalysis) {
      chrome.runtime.sendMessage({ type: 'ANALYZE_JOB', data: lastAnalysis.rawData });
    }
    
    // Notify open Upwork tabs to re-analyze
    chrome.tabs.query({ url: "*://*.upwork.com/*" }, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: 'REANALYZE_PAGE' }).catch(() => {});
      });
    });
  };

  document.getElementById('lang-select').addEventListener('change', async (e) => {
    const lang = e.target.value;
    const currentSettings = await StorageHelper.getSettings();
    await StorageHelper.saveSettings({ ...currentSettings, language: lang });
    
    // Update local setLanguage immediately
    setLanguage(lang);
    
    // Reanalyze history and last analysis in the background
    await chrome.runtime.sendMessage({ type: 'REANALYZE_ALL' }).catch(() => {});
    
    // Notify open Upwork tabs to re-analyze
    chrome.tabs.query({ url: "*://*.upwork.com/*" }, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: 'REANALYZE_PAGE' }).catch(() => {});
      });
    });
    
    // Reload popup to rebuild the entire UI with new language strings
    window.location.reload();
  });
}

function listenForStorageChanges() {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes[STORAGE_KEYS.ANALYSIS_HISTORY]) {
      loadHistory();
      // If history was updated, top item is the latest analysis
      const history = changes[STORAGE_KEYS.ANALYSIS_HISTORY].newValue;
      if (history && history.length > 0) {
        renderAnalysis(history[0]);
      } else {
        // History cleared
        document.getElementById('empty-state').classList.remove('hidden');
        document.getElementById('analysis-content').classList.add('hidden');
      }
    }
  });
}

// Helpers
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function safeUpworkUrl(value) {
  try {
    const url = new URL(value);
    const isUpwork = url.hostname === 'upwork.com' || url.hostname.endsWith('.upwork.com');
    if (url.protocol === 'https:' && isUpwork) return url.href;
  } catch {
    // Fall through to the safe Upwork landing page.
  }
  return 'https://www.upwork.com/freelance-jobs/';
}

function renderPlainDetails(containerId, details = []) {
  const container = document.getElementById(containerId);
  container.replaceChildren();

  details.forEach((detail) => {
    const row = document.createElement('div');
    row.className = 'flex items-start mt-1.5';
    row.textContent = String(detail ?? '')
      .replace(/<svg[\s\S]*?<\/svg>/gi, '')
      .replace(/<[^>]+>/g, '')
      .trim();
    container.appendChild(row);
  });
}

function getScoreLabel(label) {
  const map = { 'high-risk': t('score.highRisk'), 'caution': t('score.caution'), 'decent': t('score.decent'), 'good': t('score.good') };
  return map[label] || label;
}

function getScoreLabelClass(label) {
  const map = {
    'high-risk': 'bg-red-500/20 text-red-400',
    'caution': 'bg-amber-500/20 text-amber-400',
    'decent': 'bg-green-500/20 text-green-400',
    'good': 'bg-emerald-500/20 text-emerald-400'
  };
  return map[label] || 'bg-slate-500/20 text-slate-400';
}

function getScoreColorClass(score) {
  if (score <= 30) return 'text-red-500';
  if (score <= 60) return 'text-amber-500';
  if (score <= 80) return 'text-green-500';
  return 'text-emerald-500';
}

function getScoreLabelInlineStyle(label) {
  const map = {
    'high-risk': 'background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3);',
    'caution': 'background: rgba(245, 158, 11, 0.15); color: #d97706; border: 1px solid rgba(245, 158, 11, 0.3);',
    'decent': 'background: rgba(34, 197, 94, 0.15); color: #16a34a; border: 1px solid rgba(34, 197, 94, 0.3);',
    'good': 'background: rgba(16, 185, 129, 0.15); color: #059669; border: 1px solid rgba(16, 185, 129, 0.3);'
  };
  return map[label] || 'background: rgba(100, 116, 139, 0.15); color: #64748b; border: 1px solid rgba(100, 116, 139, 0.3);';
}

function getSeverityIcon(severity) {
  const map = {
    critical: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" class="inline-block"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    high: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" class="inline-block"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    medium: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" class="inline-block"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    low: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2" class="inline-block"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };
  return map[severity] || '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" class="inline-block"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
}
