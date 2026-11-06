// Development-only Chromium regression: use the pinned Playwright path from the
// existing browser runbook. Every network request is fulfilled locally/blocked.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.BABYPARK_PLAYWRIGHT_PATH || '/workspace/.browser-tools/node_modules/playwright');
const assets = new URL('../../web/contact-launcher/', import.meta.url);
const config = {
  websiteToken: 'PUBLICWEBSITETOKEN123',
  channels: {
    chat: { enabled: true }, callback: { enabled: true },
    phone: { enabled: true, url: 'tel:+380000000000' },
    telegram: { enabled: true, url: 'https://t.me/synthetic_test_only' },
    whatsapp: { enabled: true, url: 'https://wa.me/380000000000' },
    viber: { enabled: true, url: 'viber://pa?chatURI=synthetic_test_only' },
  },
};

test('64px launcher preserves Callback in compact and tall viewports: UA/RU and reduced motion', async t => {
  const browser = await chromium.launch({
    executablePath: process.env.BABYPARK_CHROMIUM || '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox'],
  });
  t.after(() => browser.close());

  for (const locale of ['uk', 'ru']) {
    for (const reducedMotion of ['no-preference', 'reduce']) {
      for (const viewport of [
        { width: 320, height: 800 },
        { width: 390, height: 844 },
        { width: 640, height: 900 },
        { width: 641, height: 900 },
        { width: 767, height: 900 },
        { width: 768, height: 900 },
        { width: 1440, height: 900 },
        { width: 600, height: 280 },
        { width: 600, height: 320 },
        { width: 600, height: 360 },
        { width: 600, height: 450 },
        { width: 640, height: 360 },
        { width: 767, height: 360 },
        { width: 768, height: 360 },
        { width: 800, height: 320 },
        { width: 800, height: 360 },
        { width: 800, height: 450 },
        { width: 1024, height: 360 },
        { width: 600, height: 451 },
        { width: 640, height: 451 },
        { width: 767, height: 451 },
        { width: 768, height: 451 },
        { width: 800, height: 451 },
        { width: 1024, height: 451 },
        { width: 320, height: 450 },
        { width: 320, height: 451 },
        { width: 390, height: 630 },
        { width: 450, height: 450 },
        { width: 450, height: 451 },
        { width: 390, height: 631 },
        { width: 600, height: 630 },
        { width: 800, height: 630 },
        { width: 800, height: 631 },
        { width: 320, height: 640 },
        { width: 390, height: 600 },
        { width: 390, height: 639 },
        { width: 390, height: 640 },
        { width: 800, height: 639 },
        { width: 800, height: 640 },
        { width: 1366, height: 600 },
        { width: 1366, height: 900 },
        { width: 1440, height: 451 },
        { width: 1440, height: 639 },
        { width: 1440, height: 640 },
      ]) {
        await t.test(locale + ' ' + reducedMotion + ' ' + viewport.width + 'x' + viewport.height, async () => {
          const context = await browser.newContext({ viewport, reducedMotion });
          const page = await context.newPage();
          const unexpected = [];
          const errors = [];
          page.on('pageerror', error => errors.push(error.message));
          await page.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.origin === 'https://babypark.ua' &&
                (url.pathname === '/test/' || url.pathname === '/ru/test/')) {
              const html = '<!doctype html><html lang="' + locale +
                '" xml:lang="' + locale + '"><head><meta charset="utf-8">' +
                '<link rel="icon" href="data:,"><link rel="stylesheet" href="/assets/babypark-launcher.css"></head><body>' +
                '<script>window.BabyParkLauncherConfig=' + JSON.stringify(config) + '</script>' +
                '<script src="/assets/babypark-launcher.js"></script></body></html>';
              return route.fulfill({ contentType: 'text/html', body: html });
            }
            if (url.origin === 'https://babypark.ua' && url.pathname.startsWith('/assets/')) {
              const relative = url.pathname.slice('/assets/'.length);
              if (!['babypark-launcher.css', 'babypark-launcher.js',
                'icons/bp-emblem-avatar-64.png', 'icons/kyivstar.svg',
                'icons/telegram.svg', 'icons/viber.svg', 'icons/whatsapp.svg'].includes(relative)) {
                unexpected.push(url.pathname);
                return route.abort();
              }
              const kind = relative.endsWith('.js') ? 'text/javascript' :
                relative.endsWith('.css') ? 'text/css' :
                  relative.endsWith('.png') ? 'image/png' : 'image/svg+xml';
              return route.fulfill({ body: readFileSync(new URL(relative, assets)), contentType: kind });
            }
            if (url.origin === 'https://chat.babypark.ua' && url.pathname === '/packs/js/sdk.js') {
              return route.fulfill({
                contentType: 'text/javascript',
                body: 'window.chatwootSDK={run(){window.$chatwoot={toggle(){}};' +
                  'window.dispatchEvent(new Event("chatwoot:ready"));}};',
              });
            }
            unexpected.push(url.href);
            return route.abort();
          });
          try {
            const pagePath = locale === 'ru' ? '/ru/test/' : '/test/';
            await page.goto('https://babypark.ua' + pagePath);
            const trigger = page.locator('.bp-contact__trigger');
            await trigger.waitFor();
            assert.equal(await page.locator('script[src*="sdk.js"]').count(), 0, 'no passive SDK');
            const openIcon = await page.locator('.bp-contact__trigger-symbol svg').boundingBox();
            assert.equal(openIcon.width, 28);
            assert.equal(openIcon.height, 28);
            await trigger.click();
            assert.equal(await page.locator('script[src*="sdk.js"]').count(), 0, 'general menu never initializes SDK');
            assert.equal(await page.locator('.bp-contact__channel:visible').count(), 6, 'all existing channels remain available');
            await page.locator('.bp-contact__channel--callback').click();
            await page.waitForFunction(() => !!window.$chatwoot);
            await page.waitForTimeout(220); // allow 150ms disclosure animation to finish

            const rect = await page.evaluate(() => {
              const trigger = document.querySelector('.bp-contact__trigger').getBoundingClientRect();
              const panel = document.querySelector('.bp-contact__menu--callback').getBoundingClientRect();
              const close = document.querySelector('.bp-contact__menu-close').getBoundingClientRect();
              const root = document.querySelector('.bp-contact');
              return {
                trigger: { top: trigger.top, bottom: trigger.bottom, right: trigger.right, width: trigger.width, height: trigger.height },
                panel: { top: panel.top, bottom: panel.bottom },
                gap: trigger.top - panel.bottom,
                icon: document.querySelector('.bp-contact__trigger-close svg').getBoundingClientRect().width,
                close: { top: close.top, bottom: close.bottom },
                bottom: getComputedStyle(root).bottom,
                scrollWidth: document.documentElement.scrollWidth,
                width: innerWidth,
              };
            });
            assert.equal(rect.trigger.height, 64);
            if (viewport.width <= 640) assert.equal(rect.trigger.width, 64);
            assert.equal(rect.icon, 28);
            assert.equal(rect.width - rect.trigger.right, viewport.width <= 767 ? 22 : 24);
            assert.equal(rect.gap, viewport.width <= 767 ? 9 : 10, 'existing panel-to-trigger gap');
            assert.ok(rect.panel.top >= -0.5, JSON.stringify({ locale, viewport, rect }));
            assert.ok(rect.panel.bottom <= viewport.height, 'Callback panel bottom is visible');
            assert.ok(rect.close.top >= -0.5, JSON.stringify({ locale, viewport, rect }));
            assert.ok(rect.close.bottom <= viewport.height, 'Callback close is entirely visible');
            assert.ok(rect.trigger.bottom <= viewport.height, 'trigger is visible');
            assert.ok(rect.scrollWidth <= rect.width, 'no horizontal overflow');
            const expectedBottom = viewport.height <= 639
              ? 12 : viewport.width <= 767 ? 76 : 24;
            assert.equal(parseFloat(rect.bottom), expectedBottom, 'positioned inset regression');
            const form = page.locator('.bp-contact__callback-form');
            assert.equal(await form.evaluate(el => getComputedStyle(el).overflowY), 'auto', 'internal form scroll retained');
            await page.locator('.bp-contact__callback-submit').scrollIntoViewIfNeeded();
            const submit = await page.locator('.bp-contact__callback-submit').boundingBox();
            const formRect = await form.boundingBox();
            assert.ok(submit.y >= formRect.y && submit.y + submit.height <= formRect.y + formRect.height + 0.5, 'submit reachable through internal scroll');
            await page.keyboard.press('Escape');
            await page.locator('.bp-contact__menu').waitFor({ state: 'hidden' });
            assert.equal(await trigger.evaluate(el => el === document.activeElement), true, 'Escape restores trigger focus');
            await page.keyboard.press('Space');
            await page.locator('.bp-contact__menu').waitFor({ state: 'visible' });
            await page.locator('.bp-contact__menu-close').click();
            await page.locator('.bp-contact__menu').waitFor({ state: 'hidden' });
            assert.deepEqual(errors, [], 'no browser runtime errors');
            assert.deepEqual(unexpected, [], 'no real network requests / unknown fixture assets');
          } finally {
            await context.close();
          }
        });
      }
    }
  }
});
