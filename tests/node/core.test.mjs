import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { analyzeJob } from '../../analysis/scorer.js';
import { callAI, fetchAvailableModels } from '../../utils/ai.js';
import { LANGUAGES, TRANSLATIONS, getLanguage, setLanguage, t } from '../../utils/i18n.js';
import {
  DEFAULT_SETTINGS,
  DEFAULT_USER_PROFILE,
  STORAGE_KEYS,
  StorageHelper
} from '../../utils/storage.js';

function flattenKeys(value, prefix = '') {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === 'object'
      ? flattenKeys(child, path)
      : [path];
  });
}

function placeholders(value) {
  return [...String(value).matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();
}

function resolve(value, path) {
  return path.split('.').reduce((current, key) => current?.[key], value);
}

function installChromeStorage(initialState = {}) {
  const state = structuredClone(initialState);
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          const list = keys == null
            ? Object.keys(state)
            : Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.filter((key) => key in state).map((key) => [key, state[key]]));
        },
        async set(values) { Object.assign(state, structuredClone(values)); },
        async remove(keys) {
          for (const key of (Array.isArray(keys) ? keys : [keys])) delete state[key];
        }
      }
    }
  };
  return state;
}

function okJson(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { get: () => null },
    async json() { return body; },
    async text() { return JSON.stringify(body); }
  };
}

test('manifest is a minimal, internally consistent Manifest V3 build', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
  const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, packageJson.version);
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.deepEqual(manifest.host_permissions, ['https://*.upwork.com/*']);
  assert.ok(!manifest.optional_host_permissions.includes('https://*/*'));
  assert.equal(manifest.background.type, 'module');
  assert.equal(manifest.action.default_popup, 'popup/popup.html');
});

test('all seven locales have identical keys and interpolation placeholders', () => {
  const englishKeys = flattenKeys(TRANSLATIONS.en).sort();
  assert.ok(englishKeys.length > 100);

  for (const language of Object.keys(LANGUAGES)) {
    const localeKeys = flattenKeys(TRANSLATIONS[language]).sort();
    assert.deepEqual(localeKeys, englishKeys, `${language} keys differ from English`);

    for (const key of englishKeys) {
      assert.deepEqual(
        placeholders(resolve(TRANSLATIONS[language], key)),
        placeholders(resolve(TRANSLATIONS.en, key)),
        `${language}.${key} placeholders differ from English`
      );
    }
  }
});

test('onboarding start and skip labels switch immediately and never fall back to Turkish', () => {
  for (const language of Object.keys(LANGUAGES)) {
    setLanguage(language);
    assert.equal(t('ui.tourStart'), TRANSLATIONS[language].ui.tourStart);
    assert.equal(t('ui.tourSkipSetup'), TRANSLATIONS[language].ui.tourSkipSetup);
    if (language !== 'tr') {
      assert.notEqual(t('ui.tourStart'), TRANSLATIONS.tr.ui.tourStart);
      assert.notEqual(t('ui.tourSkipSetup'), TRANSLATIONS.tr.ui.tourSkipSetup);
    }
  }
  setLanguage('en');
  assert.equal(getLanguage(), 'en');
});

test('translation interpolation and English fallback are stable', () => {
  setLanguage('en');
  assert.equal(t('api.errorGeneric', { status: 404, text: 'Not Found' }), 'API Error: 404 Not Found');
  assert.equal(t('missing.path'), 'missing.path');
  setLanguage('not-a-language');
  assert.equal(getLanguage(), 'en');
});

test('analysis rewards a credible client and exact skill match', () => {
  setLanguage('en');
  const base = {
    id: 'job-1',
    title: 'React Developer',
    description: 'We need a React developer for a documented long-term dashboard project with clear deliverables and milestones.',
    budget: { type: 'fixed', amount: 500 },
    skills: ['React', 'JavaScript']
  };
  const profile = { skills: ['React', 'JavaScript'], minimumFixedBudget: 100 };
  const weak = analyzeJob({ ...base, client: { paymentVerified: false, totalSpentNumeric: 0, rating: 0 } }, profile);
  const strong = analyzeJob({ ...base, client: { paymentVerified: true, totalSpentNumeric: 15000, rating: 4.9, hireRate: 85 } }, profile);

  assert.ok(strong.clientAnalysis.score > weak.clientAnalysis.score);
  assert.equal(strong.skillMatch.matchPercentage, 100);
  assert.ok(strong.overallScore > weak.overallScore);
});

test('analysis detects risky contact/payment language and low budgets', () => {
  setLanguage('en');
  const result = analyzeJob({
    id: 'job-risky',
    title: 'Quick task',
    description: 'Contact me on Telegram. You must pay an upfront registration fee before starting.',
    budget: { type: 'fixed', amount: 10 },
    client: { paymentVerified: false, totalSpentNumeric: 0, rating: 0 },
    skills: []
  }, { skills: ['JavaScript'], minimumFixedBudget: 100 });

  assert.ok(result.redFlags.some((flag) => flag.severity === 'critical'));
  assert.ok(result.budgetAnalysis.score <= 30);
  assert.ok(result.overallScore <= 30);
});

test('search-card missing-budget message follows the selected locale', () => {
  setLanguage('en');
  const result = analyzeJob({
    id: 'search-job',
    title: 'Search result',
    description: 'A sufficiently detailed search result description for a software project.',
    budget: null,
    client: {},
    skills: ['JavaScript'],
    isSearchTile: true
  }, { skills: ['JavaScript'] });

  assert.match(result.budgetAnalysis.details.join(' '), /search card/i);
  assert.doesNotMatch(result.budgetAnalysis.details.join(' '), /Bütçe/);
});

test('stored profiles and settings are migrated with current defaults', async () => {
  installChromeStorage({
    [STORAGE_KEYS.USER_PROFILE]: { skills: ['TypeScript'] },
    [STORAGE_KEYS.SETTINGS]: { language: 'de' }
  });

  const profile = await StorageHelper.getUserProfile();
  const settings = await StorageHelper.getSettings();
  assert.equal(profile.theme, DEFAULT_USER_PROFILE.theme);
  assert.deepEqual(profile.skills, ['TypeScript']);
  assert.equal(settings.maxHistoryItems, DEFAULT_SETTINGS.maxHistoryItems);
  assert.equal(settings.language, 'de');
});

test('history is deduplicated, bounded, and keeps lastAnalysis in sync', async () => {
  const state = installChromeStorage({
    [STORAGE_KEYS.SETTINGS]: { maxHistoryItems: 3 }
  });

  for (let index = 0; index < 5; index++) {
    await StorageHelper.saveAnalysis({ jobId: `job-${index}`, overallScore: index });
  }
  assert.deepEqual((await StorageHelper.getHistory()).map((item) => item.jobId), ['job-4', 'job-3', 'job-2']);

  await StorageHelper.saveAnalysis({ jobId: 'job-3', overallScore: 99 });
  assert.equal((await StorageHelper.getHistory()).length, 3);
  assert.equal((await StorageHelper.getAnalysisById('job-3')).overallScore, 99);

  await StorageHelper.deleteAnalysisById('job-3');
  assert.equal(await StorageHelper.getAnalysisById('job-3'), null);
  assert.equal(state[STORAGE_KEYS.LAST_ANALYSIS].jobId, 'job-4');
});

test('rebranding keeps legacy storage keys and existing user data intact', async () => {
  assert.deepEqual(STORAGE_KEYS, { ANALYSIS_HISTORY: 'analysisHistory', USER_PROFILE: 'userProfile', SETTINGS: 'settings', LAST_ANALYSIS: 'lastAnalysis' });
  const legacy = { userProfile: { ...DEFAULT_USER_PROFILE, skills: ['Rust'], openAIApiKey: 'test-only', theme: 'light' }, settings: { ...DEFAULT_SETTINGS, language: 'de', hasSeenTour: true }, analysisHistory: [{ jobId: 'legacy-job', overallScore: 70 }], lastAnalysis: { jobId: 'legacy-job', overallScore: 70 } };
  const state = installChromeStorage(legacy);
  assert.deepEqual(await StorageHelper.getUserProfile(), legacy.userProfile);
  assert.deepEqual(await StorageHelper.getSettings(), legacy.settings);
  assert.deepEqual(await StorageHelper.getHistory(), legacy.analysisHistory);
  assert.deepEqual(await StorageHelper.getLastAnalysis(), legacy.lastAnalysis);
  assert.deepEqual(state, legacy);
});

test('Patreon remains an optional safe external link in every locale', async () => {
  const html = await readFile(new URL('../../popup/popup.html', import.meta.url), 'utf8');
  assert.match(html, /id="support-patreon"[^>]+href="https:\/\/www\.patreon\.com\/cw\/AybarsOnurlu"[^>]+rel="noopener noreferrer"/);
  for (const locale of Object.values(TRANSLATIONS)) {
    assert.ok(locale.ui.supportPatreon.includes('Patreon'));
    assert.equal(locale.ui.appName, 'BidLume');
    assert.equal(locale.ui.version, 'v1.0.3');
  }
  assert.notEqual(TRANSLATIONS.en.ui.supportPatreon, TRANSLATIONS.tr.ui.supportPatreon);
});

test('localhost custom AI works without a key and sends no authorization header', async () => {
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return okJson({ choices: [{ message: { content: 'Local response' } }] });
  };

  const result = await callAI([{ role: 'user', content: 'test' }], {
    openAIApiKey: '',
    apiProvider: 'custom',
    apiBaseUrl: 'http://localhost:1234/v1/chat/completions',
    apiModel: 'local-model'
  });

  assert.equal(result, 'Local response');
  assert.equal(captured.url, 'http://localhost:1234/v1/chat/completions');
  assert.equal(captured.options.headers.Authorization, undefined);
});

test('remote AI endpoints require a key', async () => {
  setLanguage('en');
  await assert.rejects(
    () => callAI([{ role: 'user', content: 'test' }], {
      openAIApiKey: '',
      apiProvider: 'custom',
      apiBaseUrl: 'https://api.openai.com/v1/chat/completions',
      apiModel: 'gpt-4o-mini'
    }),
    /API Key/
  );
});

test('auto provider routing supports Gemini and Groq key formats', async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (String(url).includes('generativelanguage.googleapis.com')) {
      return okJson({ candidates: [{ content: { parts: [{ text: 'Gemini response' }] } }] });
    }
    return okJson({ choices: [{ message: { content: 'Groq response' } }] });
  };

  const gemini = await callAI([{ role: 'user', content: 'test' }], {
    openAIApiKey: 'AQ.test-key',
    apiProvider: 'auto',
    apiModel: 'gemini-test'
  });
  const groq = await callAI([{ role: 'user', content: 'test' }], {
    openAIApiKey: 'gsk_test-key',
    apiProvider: 'auto',
    apiModel: 'llama-test'
  });

  assert.equal(gemini, 'Gemini response');
  assert.equal(groq, 'Groq response');
  assert.match(String(calls[0].url), /generativelanguage\.googleapis\.com/);
  assert.match(String(calls[1].url), /api\.groq\.com/);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer gsk_test-key');
});

test('AI requests retry once after a 429 response', async () => {
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    if (attempts === 1) {
      return {
        ...okJson({ error: { message: 'Rate limited' } }, 429),
        headers: { get: () => '0' }
      };
    }
    return okJson({ choices: [{ message: { content: 'Recovered' } }] });
  };

  const result = await callAI([{ role: 'user', content: 'test' }], {
    openAIApiKey: 'sk-test',
    apiProvider: 'openai',
    apiBaseUrl: 'https://api.openai.com/v1/chat/completions',
    apiModel: 'gpt-test'
  });
  assert.equal(result, 'Recovered');
  assert.equal(attempts, 2);
});

test('model discovery filters non-chat OpenAI-compatible models', async () => {
  globalThis.fetch = async () => okJson({
    data: [
      { id: 'gpt-chat' },
      { id: 'text-embedding-3-small' },
      { id: 'whisper-1' }
    ]
  });
  const models = await fetchAvailableModels('openai', 'https://api.openai.com/v1/chat/completions', 'sk-test');
  assert.deepEqual(models, ['gpt-chat']);
});
