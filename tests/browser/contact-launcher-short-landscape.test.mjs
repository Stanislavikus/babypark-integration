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
  channels: { chat: { enabled: true }, callback: { enabled: true } },
};

test('64px launcher preserves Callback close in short landscape: UA/RU, portrait control', async t => {
  const browser = await chromium.launch({
    executablePath: process.env.BABYPARK_CHROMIUM || '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox'],
  });
  t.after(() => browser.close());

  for (const locale of ['uk', 'ru']) {
    for (const viewport of [
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
      { width: 390, height: 844 },
    ]) {
      await t.test(locale + ' ' + viewport.width + 'x' + viewport.height, async () => {
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        const unexpected = [];
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
          await trigger.click();
          await page.locator('.bp-contact__channel--callback').click();
          await page.waitForTimeout(220); // allow 150ms disclosure animation to finish

          const rect = await page.evaluate(() => {
            const trigger = document.querySelector('.bp-contact__trigger').getBoundingClientRect();
            const panel = document.querySelector('.bp-contact__menu--callback').getBoundingClientRect();
            const close = document.querySelector('.bp-contact__menu-close').getBoundingClientRect();
            const root = document.querySelector('.bp-contact');
            return {
              trigger: { top: trigger.top, bottom: trigger.bottom, height: trigger.height },
              panel: { top: panel.top, bottom: panel.bottom },
              close: { top: close.top, bottom: close.bottom },
              bottom: getComputedStyle(root).bottom,
              scrollWidth: document.documentElement.scrollWidth,
              width: innerWidth,
            };
          });
          assert.equal(rect.trigger.height, 64);
          assert.ok(rect.panel.top >= -0.5, JSON.stringify({ locale, viewport, rect }));
          assert.ok(rect.close.top >= -0.5, JSON.stringify({ locale, viewport, rect }));
          assert.ok(rect.close.bottom <= viewport.height, 'Callback close is entirely visible');
          assert.ok(rect.trigger.bottom <= viewport.height, 'trigger is visible');
          assert.ok(rect.scrollWidth <= rect.width, 'no horizontal overflow');
          const expectedBottom = viewport.width > viewport.height && viewport.height <= 450
            ? 12 : viewport.width <= 767 ? 76 : 24;
          assert.equal(parseFloat(rect.bottom), expectedBottom, 'positioned inset regression');
          assert.deepEqual(unexpected, [], 'no real network requests / unknown fixture assets');
        } finally {
          await context.close();
        }
      });
    }
  }
});
