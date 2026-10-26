// Development-only driver lives outside application dependencies. See the runbook.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.BABYPARK_PLAYWRIGHT_PATH || '/workspace/.browser-tools/node_modules/playwright');
const assets = new URL('../../web/contact-launcher/', import.meta.url);
const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzb3VyY2VfaWQiOiJzeW50aGV0aWMifQ.SIGNATURE';
const config = { websiteToken: 'PUBLICWEBSITETOKEN123', channels: {
  callback: { enabled: true }, chat: { enabled: true }, phone: { enabled: true, url: 'tel:+380982908838' }
} };

test('V12 R2 B1: native keyboard, caret, Backspace, ranges and full Ukrainian sources', async t => {
  const browser = await chromium.launch({ executablePath: process.env.BABYPARK_CHROMIUM || '/usr/bin/chromium',
    headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  console.log('Browser:', browser.version());
  async function fixture(run) {
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'], viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const posts = [], unexpected = [], errors = [], events = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', async route => {
      const u = new URL(route.request().url());
      if (u.origin === 'https://babypark.ua' && u.pathname === '/test/') {
        return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/assets/babypark-launcher.css"><script>window.BabyParkLauncherConfig=' + JSON.stringify(config) + '</script><script src="/assets/babypark-launcher.js"></script>' });
      }
      if (u.origin === 'https://babypark.ua' && u.pathname.startsWith('/assets/')) {
        const relative = u.pathname.slice('/assets/'.length);
        if (!['babypark-launcher.js', 'babypark-launcher.css', 'icons/bp-emblem-avatar-64.png', 'icons/kyivstar.svg', 'icons/telegram.svg', 'icons/viber.svg', 'icons/whatsapp.svg'].includes(relative)) {
          unexpected.push(u.href); return route.abort();
        }
        return route.fulfill({ body: readFileSync(new URL(relative, assets)), contentType: relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : relative.endsWith('.png') ? 'image/png' : 'image/svg+xml' });
      }
      if (u.origin === 'https://chat.babypark.ua' && u.pathname === '/packs/js/sdk.js') {
        return route.fulfill({ contentType: 'text/javascript', body: 'window.chatwootSDK={run(){window.$chatwoot={toggle(){}};window.dispatchEvent(new Event("chatwoot:ready"));}};' });
      }
      if (u.origin === 'https://chat.babypark.ua' && u.pathname === '/api/v1/widget/messages' && route.request().method() === 'POST') {
        posts.push(route.request().postDataJSON());
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 100, conversation_id: 10 }) });
      }
      unexpected.push(u.href); return route.abort();
    });
    await context.addCookies([{ name: 'cw_conversation', value: jwt, url: 'https://babypark.ua' }]);
    try {
      await page.goto('https://babypark.ua/test/');
      await page.locator('.bp-contact__trigger').click();
      assert.equal(await page.locator('script[src*="sdk.js"]').count(), 0);
      await page.locator('.bp-contact__channel--callback').click();
      await page.waitForFunction(() => !!window.$chatwoot);
      const phone = page.locator('.bp-contact__callback-phone-input');
      await phone.evaluate(el => {
        window.phoneEvents = [];
        for (const type of ['keydown', 'beforeinput', 'input']) el.addEventListener(type, e => window.phoneEvents.push({ type, key: e.key, inputType: e.inputType, trusted: e.isTrusted }));
      });
      await phone.focus();
      await run({ page, phone, posts, submit: page.locator('.bp-contact__callback-submit') });
      events.push(...await page.evaluate(() => window.phoneEvents));
      assert.ok(events.some(e => e.type === 'beforeinput' && e.trusted), 'native trusted edit events actually executed');
      assert.deepEqual(errors, []);
      assert.deepEqual(unexpected, [], 'all requests intercepted, no live service access');
    } finally { await context.close(); }
  }
  async function send(f, number) {
    assert.equal(await f.submit.isDisabled(), false);
    await f.submit.click();
    await f.page.locator('.bp-contact__callback-success').waitFor({ state: 'visible' });
    assert.equal(f.posts.length, 1);
    assert.equal(f.posts[0].custom_attributes.callback_phone, number);
    assert.ok(f.posts[0].message.content.includes('Зворотний дзвінок: ' + number));
  }
  for (const [name, source, caret, keys, expected, recipient] of [
    ['mid Backspace', '381023456', 3, ['Backspace', 'End', '7'], '380234567', '+380380234567'],
    ['mid insertion', '38123456', 2, ['0'], '380123456', '+380380123456'],
    ['range replacement', '391234567', 1, ['Shift+ArrowRight', 'Shift+ArrowRight', '8', '0'], '380234567', '+380380234567'],
    ['source end Backspace guard', '38', 2, ['Backspace', '8', '0', ...'671234567'], '671234567', '+380671234567']
  ]) await t.test(name, () => fixture(async f => {
    await f.page.keyboard.type(source);
    await f.page.keyboard.press('Home');
    for (let i = 0; i < caret; i++) await f.page.keyboard.press('ArrowRight');
    for (const key of keys) await f.page.keyboard.press(key);
    assert.equal(await f.phone.inputValue(), expected);
    await send(f, recipient);
  }));
  for (const source of ['0671234567', '380671234567', '+380671234567', '+38 (067) 123-45-67']) {
    for (const method of ['keyboard', 'clipboard']) await t.test(method + ' full source ' + source, () => fixture(async f => {
      if (method === 'keyboard') await f.page.keyboard.type(source);
      else {
        // Seed a real key transaction, then use the asynchronous clipboard and Ctrl+V.
        await f.page.keyboard.type('9');
        await f.page.keyboard.press('Control+a');
        await f.page.evaluate(text => navigator.clipboard.writeText(text), source);
        await f.page.keyboard.press('Control+v');
      }
      assert.equal(await f.phone.inputValue(), '671234567');
      await f.page.keyboard.press('9');
      assert.equal(await f.phone.inputValue(), '671234567', 'tenth cancelable digit cannot change recipient');
      await send(f, '+380671234567');
    }));
    await t.test('select-all keyboard replacement after national edit ' + source, () => fixture(async f => {
      await f.page.keyboard.type('38123456');
      await f.page.keyboard.press('Home');
      await f.page.keyboard.press('ArrowRight');
      await f.page.keyboard.press('ArrowRight');
      await f.page.keyboard.type('0');
      assert.equal(await f.phone.inputValue(), '380123456');
      await f.page.keyboard.press('Control+a');
      await f.page.keyboard.type(source);
      assert.equal(await f.phone.inputValue(), '671234567');
      await send(f, '+380671234567');
    }));
  }
  for (const source of ['+48671234567', '+3800671234567', '00380671234567', '6712345678']) {
    await t.test('reject full replacement ' + source, () => fixture(async f => {
      await f.page.keyboard.type('671234567');
      await f.page.keyboard.press('Control+a');
      await f.page.evaluate(text => navigator.clipboard.writeText(text), source);
      await f.page.keyboard.press('Control+v');
      assert.equal(await f.submit.isDisabled(), true);
      await f.page.locator('.bp-contact__callback-form').evaluate(el => el.requestSubmit());
      await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(f.posts.length, 0);
    }));
  }
});
