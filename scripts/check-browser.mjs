// Optional real-browser release checks. Requires Playwright and Chromium.
// No personal browser profile, live Upwork account, or paid AI request is used.
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { TRANSLATIONS } from '../utils/i18n.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extension = path.resolve(process.argv[2] || root);
const work = path.join(root, 'Store_Submission', 'Working_v1.0.3');
const captures = path.join(work, 'ui-captures');
await mkdir(captures, { recursive: true });
const fixtureSource = await readFile(path.join(root, 'tests/browser/chrome-mock.js'), 'utf8');
function fixture(scenario = 'empty', theme = 'light', language = 'en', seen = true) {
  const sandbox = { URLSearchParams, Date, location: { search: `?scenario=${scenario}&theme=${theme}&lang=${language}&seen=${seen ? 1 : 0}` } };
  vm.runInNewContext(fixtureSource, sandbox);
  return JSON.parse(JSON.stringify(sandbox.__UPLENS_TEST_STATE__));
}
function contrast(a, b) {
  const luminance = c => c.match(/[\d.]+/g).slice(0, 3).map(Number)
    .map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4)
    .reduce((sum, x, i) => sum + x * [.2126, .7152, .0722][i], 0);
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
const context = await chromium.launchPersistentContext(path.join(work, `profile-${Date.now()}`), {
  headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined,
  viewport: { width: 420, height: 600 }, deviceScaleFactor: 1,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
});
const checks = [], errors = [];
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  page.on('pageerror', error => { errors.push(error.message); console.error('Popup error:', error.message); });
  async function open(state) {
    await page.goto('about:blank');
    await worker.evaluate(async value => { await chrome.storage.local.clear(); await chrome.storage.local.set(value); }, state);
    await page.goto(`chrome-extension://${id}/popup/popup.html`);
    await page.waitForFunction(() => document.documentElement.dataset.resolvedTheme);
    await page.waitForTimeout(650);
  }
  async function colors(selector, backgroundSelector) {
    return page.evaluate(([s, b]) => ({ foreground: getComputedStyle(document.querySelector(s)).color, background: getComputedStyle(document.querySelector(b)).backgroundColor }), [selector, backgroundSelector]);
  }
  for (const theme of ['light', 'dark']) {
    for (const language of Object.keys(TRANSLATIONS)) {
      await open(fixture('empty', theme, language, false));
      assert.equal(await page.locator('#tour-lang-start-label').textContent(), TRANSLATIONS[language].ui.tourStart);
      assert.equal(await page.locator('#tour-lang-skip').textContent(), TRANSLATIONS[language].ui.tourSkipSetup);
      assert.equal(await page.locator('#support-patreon').textContent(), TRANSLATIONS[language].ui.supportPatreon);
      assert.equal(await page.locator('html').getAttribute('dir'), language === 'ar' ? 'rtl' : 'ltr');
      const palette = await colors('#tour-lang-prompt', '#tour-lang-box');
      assert.ok(contrast(palette.foreground, palette.background) >= 4.5, `${theme}/${language} tour contrast`);
      await page.locator('#tour-lang-start').click();
      for (let step = 1; step <= 4; step++) {
        await page.waitForTimeout(220);
        const bounds = await page.locator('.tour-tooltip').boundingBox();
        assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 421 && bounds.y + bounds.height <= 601, `${theme}/${language} step ${step} offscreen`);
        const tip = await colors('#tour-text', '.tour-tooltip');
        assert.ok(contrast(tip.foreground, tip.background) >= 4.5, `${theme}/${language} tip contrast`);
        await page.locator('#tour-next').click();
      }
      assert.equal(await page.locator('.tour-overlay').count(), 0);
      assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings.hasSeenTour), true);
      checks.push(`tour:${theme}:${language}:labels,contrast,bounds,completion`);
      console.log(checks.at(-1));
    }
  }
  await open(fixture('empty', 'light', 'en', false));
  await page.locator('#tour-lang-select').selectOption('de');
  assert.equal(await page.locator('#tour-lang-start-label').textContent(), TRANSLATIONS.de.ui.tourStart);
  await page.locator('#tour-lang-skip').click();
  assert.equal(await page.locator('.tour-overlay').count(), 0);
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings.language), 'de');
  checks.push('onboarding:live-language-change-and-skip');
  await open(fixture('empty', 'light', 'en', false));
  // Trigger the old close-during-pending-step race without waiting for the tip.
  await page.locator('#tour-lang-start').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.tour-overlay').count(), 0);
  checks.push('onboarding:escape-cancels-pending-step');
  await page.emulateMedia({ colorScheme: 'dark' });
  await open(fixture('empty', 'auto'));
  assert.equal(await page.locator('html').getAttribute('data-resolved-theme'), 'dark');
  await page.locator('#theme-toggle').click();
  assert.equal(await page.locator('html').getAttribute('data-resolved-theme'), 'light');
  await page.reload();
  await page.waitForTimeout(650);
  assert.equal(await page.locator('html').getAttribute('data-resolved-theme'), 'light');
  checks.push('theme:auto-dark-toggle-and-persistence');
  await open(fixture('settings', 'auto'));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('html').getAttribute('data-resolved-theme'), 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('html').getAttribute('data-resolved-theme'), 'dark');
  checks.push('theme:auto-follows-system');
  const old = fixture('history');
  old.userProfile.skills = ['Rust', 'TypeScript'];
  old.userProfile.openAIApiKey = 'test-only-not-a-real-key';
  await open(old);
  const retained = await worker.evaluate(() => chrome.storage.local.get(null));
  assert.deepEqual(retained, old);
  assert.equal(await page.locator('#support-patreon').getAttribute('href'), 'https://www.patreon.com/cw/AybarsOnurlu');
  assert.equal(await page.locator('#support-patreon').getAttribute('rel'), 'noopener noreferrer');
  await page.locator('#tab-history').click();
  assert.equal(await page.locator('#history-list > *').count(), 4);
  checks.push('upgrade:legacy-profile-credentials-history-preserved');
  await page.locator('#tab-settings').click();
  await page.locator('#api-key').fill('');
  await page.locator('#min-hourly').fill('48');
  await page.locator('#save-settings').click();
  await page.waitForTimeout(150);
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('userProfile')).userProfile.minimumHourlyRate), 48);
  checks.push('settings:save-without-key');
  await open(fixture());
  const job = fixture('analysis').lastAnalysis.rawData;
  const result = await page.evaluate(data => chrome.runtime.sendMessage({ type: 'ANALYZE_JOB', data }), job);
  assert.equal(result.success, true);
  assert.ok(result.analysis.overallScore >= 0 && result.analysis.overallScore <= 100);
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#analysis-content').isVisible(), true);
  const historyBefore = await worker.evaluate(async () => (await chrome.storage.local.get('analysisHistory')).analysisHistory);
  const tile = await page.evaluate(data => chrome.runtime.sendMessage({ type: 'ANALYZE_JOB', data: { ...data, isSearchTile: true } }), job);
  assert.equal(tile.success, true);
  assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.local.get('analysisHistory')).analysisHistory), historyBefore);
  checks.push('real-service-worker:local-score-storage-popup-and-search-no-history');
  await page.locator('#tab-history').click();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#clear-history').click();
  await page.waitForTimeout(150);
  assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.local.get('analysisHistory')).analysisHistory), []);
  checks.push('history:clear');
  // Offline page fixtures exercise Chrome's real manifest-injected content script.
  // They test our supported selectors, not the current authenticated Upwork DOM.
  await context.route('https://www.upwork.com/**', async route => {
    const detail = route.request().url().includes('/jobs/~');
    const body = detail
      ? '<main><h1 data-test="job-title">Fixture TypeScript Engineer</h1><div data-test="job-description">Build a React and TypeScript dashboard. Deliver tested components and documentation.</div><p>Hourly: $55 - $75</p><h2>About the client</h2><p>Payment method verified</p><p>92% hire rate</p><span data-test="skill">TypeScript</span></main>'
      : '<main><article class="job-tile"><h3><a data-test="job-tile-title-link" href="https://www.upwork.com/jobs/~019876543210">Fixture TypeScript Engineer</a></h3><p data-test="job-type-label">Hourly: $55 - $75</p><p class="job-description-text">Build a React and TypeScript dashboard.</p><p>Payment verified · $25K spent · 92% hire rate</p><span data-test="skill">TypeScript</span></article></main>';
    await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><title>Offline Upwork-shaped fixture</title></head><body>${body}</body></html>` });
  });
  const jobPage = await context.newPage();
  jobPage.on('pageerror', error => errors.push(error.message));
  await jobPage.goto('https://www.upwork.com/jobs/~019876543210');
  await page.waitForFunction(async () => (await chrome.storage.local.get('lastAnalysis')).lastAnalysis?.jobTitle === 'Fixture TypeScript Engineer');
  assert.equal(await page.locator('#analysis-content').isVisible(), false); // History tab is still selected.
  await page.locator('#tab-analysis').click();
  await page.locator('#analysis-content').waitFor({ state: 'visible', timeout: 5000 });
  assert.equal(await page.locator('#job-title').textContent(), 'Fixture TypeScript Engineer');
  await jobPage.goto('https://www.upwork.com/freelance-jobs/');
  await jobPage.locator('.uja-inline-badge').waitFor();
  assert.equal(await jobPage.locator('.uja-inline-badge').count(), 1);
  await jobPage.close();
  await context.unroute('https://www.upwork.com/**');
  checks.push('manifest-injected-content:detail-to-popup-and-search-badge-offline-fixtures');
  for (const [scenario, theme, filename] of [['empty', 'light', '01-ready'], ['analysis', 'dark', '02-analysis'], ['ai', 'dark', '03-ai'], ['settings', 'light', '04-settings'], ['history', 'dark', '05-history']]) {
    await open(fixture(scenario, theme));
    if (scenario === 'settings' || scenario === 'history') await page.locator(`#tab-${scenario}`).click();
    if (scenario === 'ai') await page.locator('#ai-section').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(captures, `${filename}.png`) });
  }
  assert.deepEqual(errors, [], 'browser runtime errors');
  const report = { checkedAt: new Date().toISOString(), extension, browser: context.browser()?.version(), checks, runtimeErrors: errors, limitations: ['Sample job and AI data used for visual captures; marked example data in artwork.', 'Upwork-shaped offline HTML fixtures tested extraction; no live Upwork account or paid AI provider was used.', 'Extension loaded from production folder, not the public Chrome Web Store update.'] };
  await writeFile(path.join(work, 'browser-report.json'), JSON.stringify(report, null, 2));
  console.log(`Browser checks passed: ${checks.length}; runtime errors: ${errors.length}; five real extension captures saved.`);
} finally { await context.close(); }
