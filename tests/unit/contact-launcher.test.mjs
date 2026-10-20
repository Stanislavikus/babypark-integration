import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('../../web/contact-launcher/babypark-launcher.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../web/contact-launcher/babypark-launcher.css', import.meta.url), 'utf8');

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.hidden = false;
    this.className = '';
    this.textContent = '';
    this.href = '';
    this.parent = null;
    this.disabled = false;
  }
  appendChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  click() {
    const event = { target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    if (!this.disabled) (this.listeners.click || []).forEach(fn => fn(event));
    return event;
  }
  focus() { this.focused = true; }
  contains(other) {
    for (let node = other; node; node = node.parent) if (node === this) return true;
    return false;
  }
}

function traverse(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root.children) {
    const found = traverse(child, predicate);
    if (found) return found;
  }
  return null;
}

function harness(config, opts = {}) {
  const body = new Element('body');
  const head = new Element('head');
  const documentListeners = {};
  const windowListeners = {};
  const document = {
    currentScript: opts.inline ? null : { src: opts.scriptSrc || 'https://babypark.ua/themes/babypark2/assets/contact/babypark-launcher.js' },
    baseURI: opts.documentBase || 'https://babypark.ua/product/123',
    readyState: 'complete',
    body, head,
    createElement: tag => {
      const el = new Element(tag);
      el.focus = () => { el.focused = true; document.activeElement = el; };
      return el;
    },
    activeElement: null,
    getElementById: id => traverse(body, node => node.id === id),
    addEventListener(name, fn) { (documentListeners[name] ||= []).push(fn); },
    dispatch(name, extra = {}) {
      const event = { key: extra.key, target: extra.target || body };
      (documentListeners[name] || []).forEach(fn => fn(event));
    }
  };
  let now = 0, nextTimerId = 0;
  const timers = new Map();
  function advance(ms) {
    const until = now + ms;
    while (true) {
      const entries = [...timers.entries()].filter(([, task]) => task.at <= until)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
      if (!entries.length) break;
      const [id, task] = entries[0];
      timers.delete(id);
      now = task.at;
      task.fn();
    }
    now = until;
  }
  const window = {
    setTimeout(fn, ms) {
      const id = ++nextTimerId;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    BabyParkLauncherConfig: config,
    location: { href: 'https://babypark.ua/product/123' },
    getComputedStyle: () => ({ position: opts.cssMissing ? 'static' : 'fixed' }),
    addEventListener(name, fn) { (windowListeners[name] ||= []).push(fn); },
    dispatch(name) { (windowListeners[name] || []).forEach(fn => fn()); }
  };
  const context = { window, document, URL, Object, Array };
  runInNewContext(script, context);
  function get(name) { return traverse(body, n => n.className.split(' ').includes(name)); }
  return { document, body, head, window, get, context, advance, pendingTimers: () => timers.size,
    runAgain: () => runInNewContext(script, context) };
}

test('missing config fails closed without adding a launcher or SDK', () => {
  const h = harness(undefined);
  assert.equal(h.body.children.length, 0);
  assert.equal(h.head.children.length, 0);
});

test('phone only: no unverified channel, no callback, no SDK', () => {
  const h = harness({ channels: { phone: { enabled: true, url: 'tel:+380982908838' } } });
  assert.equal(h.get('bp-contact').hidden, false);
  assert.equal(h.get('bp-contact__channel--phone').hidden, false);
  assert.equal(h.get('bp-contact__channel--viber').hidden, true);
  assert.equal(h.get('bp-contact__channel--telegram').hidden, true);
  assert.equal(h.get('bp-contact__channel--whatsapp').hidden, true);
  assert.equal(h.get('bp-contact__channel--chat').hidden, true);
  assert.equal(h.head.children.length, 0);
  assert.equal(h.get('bp-contact__channel--callback'), null);
  const launcher = h.get('bp-contact__trigger');
  launcher.click();
  assert.equal(launcher.getAttribute('aria-expanded'), 'true');
  assert.equal(h.get('bp-contact__menu').hidden, false);
  h.get('bp-contact__menu-close').click();
  assert.equal(h.get('bp-contact__menu').hidden, true);
  assert.equal(launcher.focused, true);
  h.runAgain();
  assert.equal(h.body.children.length, 1, 'duplicate includes are idempotent');
});

test('explicit channel flags and whitelisted protocols prevent unsafe links', () => {
  const h = harness({ channels: {
    telegram: { enabled: true, url: 'javascript:alert(1)' },
    whatsapp: { enabled: true, url: 'https://wa.me.evil.invalid/380980000000' },
    viber: { enabled: true, url: 'viber://pa?chatURI=babypark' },
    phone: { enabled: 'true', url: 'tel:+380982908838' }
  } });
  assert.equal(h.get('bp-contact__channel--telegram').hidden, true);
  assert.equal(h.get('bp-contact__channel--whatsapp').hidden, true);
  assert.equal(h.get('bp-contact__channel--phone').hidden, true);
  assert.equal(h.get('bp-contact__channel--viber').hidden, false);
  assert.equal(h.get('bp-contact__channel--viber').href, 'viber://pa?chatURI=babypark');
});

test('L1-C stable disabled chat row: official run() creates toggle BEFORE actual ready', () => {
  const h = harness({ websiteToken: 'PUBLICWEBSITETOKEN123', channels: { chat: { enabled: true } } });
  const row = h.get('bp-contact__channel--chat');
  const note = h.get('bp-contact__chat-note');
  assert.equal(h.get('bp-contact').hidden, false);
  assert.equal(row.hidden, false, 'configured chat slot is always reserved');
  assert.equal(row.disabled, true, 'placeholder is non-actionable');
  assert.equal(row.getAttribute('aria-disabled'), 'true');
  assert.equal(note.hidden, true, 'no changing status text in first 12 seconds');
  assert.equal(h.head.children.length, 0, 'passive view MUST NOT inject SDK');
  assert.equal(h.pendingTimers(), 0);
  h.get('bp-contact__trigger').click();
  assert.equal(h.document.activeElement, h.get('bp-contact__trigger'),
    'chat-only pending SDK keeps focus on the launcher');
  assert.equal(h.head.children.length, 1);
  assert.equal(h.pendingTimers(), 1);
  assert.equal(h.head.children[0].src, 'https://chat.babypark.ua/packs/js/sdk.js');
  assert.equal(h.window.chatwootSettings.hideMessageBubble, true);
  assert.equal(h.window.chatwootSettings.showUnreadMessagesDialog, false);
  assert.equal(h.window.chatwootSettings.locale, 'uk');
  assert.equal(row.disabled, true);
  assert.equal(note.hidden, true);
  let runOptions, toggleArg;
  h.window.chatwootSDK = { run: o => {
    runOptions = o;
    h.window.$chatwoot = { toggle: arg => { toggleArg = arg; } };
  } };
  h.head.children[0].onload();
  assert.equal(runOptions.websiteToken, 'PUBLICWEBSITETOKEN123');
  assert.equal(runOptions.baseUrl, 'https://chat.babypark.ua');
  assert.equal(row.disabled, true, 'callable toggle alone must never authorize chat');
  h.advance(11999);
  assert.equal(note.hidden, true);
  h.window.dispatch('chatwoot:ready');
  assert.equal(row.hidden, false, 'chat row is the same element');
  assert.equal(row.disabled, false);
  assert.equal(row.getAttribute('aria-disabled'), 'false');
  assert.equal(h.pendingTimers(), 0, 'ready cancels soft notice');
  assert.equal(note.hidden, true);
  assert.match(h.get('bp-contact__chat-status').textContent, /доступний/);
  assert.equal(h.document.activeElement, row);
  row.click();
  assert.equal(toggleArg, 'open');
  h.get('bp-contact__trigger').click();
  assert.equal(h.head.children.length, 1, 'SDK must never be injected twice');
});

test('L1-C explicit SDK failure retains disabled row and cannot resurrect a fake chat', () => {
  const withoutToken = harness({ websiteToken: '', channels: { chat: { enabled: true } } });
  assert.equal(withoutToken.head.children.length, 0);
  assert.equal(withoutToken.body.children[0].hidden, true);
  const bad = harness(withChat());
  bad.get('bp-contact__trigger').click();
  const sdk = bad.head.children[0];
  sdk.onerror();
  const row = bad.get('bp-contact__channel--chat');
  assert.equal(row.hidden, false);
  assert.equal(row.disabled, true);
  assert.equal(bad.pendingTimers(), 0);
  assert.match(bad.get('bp-contact__chat-note').textContent, /недоступний/);
  assert.equal(bad.get('bp-contact').hidden, false);
  bad.window.$chatwoot = { toggle() {} };
  bad.window.dispatch('chatwoot:ready');
  assert.equal(row.disabled, true, 'late ready must not resurrect EXPLICIT failure');
  const broken = harness(withChat());
  broken.get('bp-contact__trigger').click();
  broken.window.chatwootSDK = { run() { throw new Error('SDK failed'); } };
  broken.head.children[0].onload();
  assert.match(broken.get('bp-contact__chat-note').textContent, /недоступний/);
  assert.equal(broken.get('bp-contact__channel--chat').disabled, true);
  assert.equal(broken.pendingTimers(), 0);
  const missing = harness(withChat());
  missing.get('bp-contact__trigger').click();
  missing.head.children[0].onload();
  assert.match(missing.get('bp-contact__chat-note').textContent, /недоступний/);
  assert.equal(missing.pendingTimers(), 0);
});

test('Escape and outside pointerdown close menu, with keyboard focus restored on Escape', () => {
  const h = harness({ channels: { phone: { enabled: true, url: 'tel:+380982908838' } } });
  const trigger = h.get('bp-contact__trigger');
  trigger.click();
  assert.equal(h.get('bp-contact__menu').hidden, false);
  h.document.dispatch('keydown', { key: 'Escape' });
  assert.equal(h.get('bp-contact__menu').hidden, true);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(trigger.focused, true);
  trigger.click();
  h.document.dispatch('pointerdown', { target: new Element('div') });
  assert.equal(h.get('bp-contact__menu').hidden, true);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(h.document.activeElement, trigger,
    'outside close restores focus from a hidden menu option');
  trigger.click();
  h.document.dispatch('pointerdown', { target: h.get('bp-contact__heading') });
  assert.equal(h.get('bp-contact__menu').hidden, false, 'inside click keeps menu open');
});

test('assetBase stays correct through bundling and inline loading, but external origins are refused', () => {
  const cfg = { assetBase: '/themes/babypark2/assets/contact/', channels: { phone: { enabled: true, url: 'tel:+380982908838' } } };
  const aggregated = harness(cfg, { scriptSrc: 'https://babypark.ua/agg/js/agg_123.js' });
  const icon = traverse(aggregated.body, el => el.tagName === 'IMG' && el.src.endsWith('/kyivstar.svg'));
  assert.equal(icon.src, 'https://babypark.ua/themes/babypark2/assets/contact/icons/kyivstar.svg');
  const hostileBase = harness(cfg, { inline: true, documentBase: 'https://evil.example/' });
  const trustedIcon = traverse(hostileBase.body, el => el.tagName === 'IMG' && el.src.endsWith('/kyivstar.svg'));
  assert.equal(trustedIcon.src, 'https://babypark.ua/themes/babypark2/assets/contact/icons/kyivstar.svg',
    'injected document <base> cannot redirect icon loads');
  const inline = harness(cfg, { inline: true });
  assert.equal(inline.get('bp-contact').hidden, false);
  const missingBase = harness({ channels: cfg.channels }, { inline: true });
  assert.equal(missingBase.get('bp-contact').hidden, false, 'phone still works without icon files');
  const external = harness({ assetBase: 'https://evil.example/icons/', channels: cfg.channels }, { inline: true });
  assert.equal(traverse(external.body, el => el.tagName === 'IMG'), null, 'never load arbitrary cross-origin icons');
});

test('missing stylesheet always hides floating widget, late CSS load can safely reveal it', () => {
  const config = { channels: { phone: { enabled: true, url: 'tel:+380982908838' } } };
  const h = harness(config, { cssMissing: true });
  assert.equal(h.get('bp-contact').hidden, true);
  assert.equal(h.head.children.length, 0);
  h.window.getComputedStyle = () => ({ position: 'fixed' });
  h.window.dispatch('load');
  assert.equal(h.get('bp-contact').hidden, false);
  assert.equal(h.get('bp-contact__menu').getAttribute('role'), 'group');
});

test('CSS provides mobile 22px inset, safe area, hidden/focus/mobile no-text and reduced motion', () => {
  assert.match(css, /--bp-mobile-right:\s*22px/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /\.bp-contact\[hidden\]/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /outline: 3px solid #004b78/);
  assert.match(css, /--bp-compact-bottom:/);
  assert.match(css, /@media \(max-height: 450px\)\s*\{\s*\.bp-contact \{ bottom: var\(--bp-compact-bottom\)/);
  assert.ok(css.includes('max-height: calc(100dvh - var(--bp-compact-bottom) - 75px)'),
    'landscape menu must subtract configured bottom inset plus trigger gap');
  assert.ok(!css.includes('max-height: calc(100vh - 84px)'),
    'unconditional landscape menu height clips when inset increases');
  assert.match(css, /@media print/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /\.bp-contact__trigger-label \{ display: none; \}/);
});


test('brand palette: static orange rim, accessible white-on-teal text and no periodic pulse', () => {
  const bg = css.match(/--bp-accent:\s*(#[0-9a-fA-F]{6})/);
  const hover = css.match(/\.bp-contact__trigger:hover\s*\{\s*background:\s*(#[0-9a-fA-F]{6})/);
  assert.ok(bg);
  assert.ok(hover);
  function luminance(hex) {
    const v = [1, 3, 5].map(pos => parseInt(hex.slice(pos, pos + 2), 16) / 255)
      .map(x => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return v[0] * 0.2126 + v[1] * 0.7152 + v[2] * 0.0722;
  }
  for (const color of [bg[1], hover[1]]) {
    assert.ok((1.05 / (luminance(color) + 0.05)) >= 4.5,
      `White text contrast on ${color} must be >= 4.5:1`);
  }
  assert.match(css, /\.bp-contact__trigger\s*\{[^}]*border:\s*1px solid #f47c20\s*;/s);
  assert.doesNotMatch(css, /\.bp-contact__trigger[^}]*animation\s*:/s);
  assert.doesNotMatch(css, /\b(infinite|pulse|marquee)\b/i);
});


// Sonnet R2 V1′: these six scenarios must kill the nine independent key-invariant
// mutants described in PR #142 review #6275239378. They deliberately drive
// state transitions between SDK.run() and Chatwoot's later ready event.
const token = 'PUBLICWEBSITETOKEN123';
const withChat = () => ({ websiteToken: token, channels: { chat: { enabled: true } } });

test('V1prime T1: a re-sync between SDK run and later ready cannot expose chat', () => {
  const h = harness(withChat());
  const trigger = h.get('bp-contact__trigger');
  const chat = h.get('bp-contact__channel--chat');
  trigger.click();
  h.window.chatwootSDK = {
    run() { h.window.$chatwoot = { toggle() {} }; }
  };
  h.head.children[0].onload(); // SDK.run creates $chatwoot BEFORE ready.
  assert.equal(chat.disabled, true);
  trigger.click(); // closes menu
  trigger.click(); // forces syncVisible in the ready gap
  h.window.dispatch('load'); // late CSS/load refresh must not bypass ready.
  assert.equal(chat.disabled, true, 'ready gate cannot be replaced by SDK availability');
  h.window.dispatch('chatwoot:ready');
  assert.equal(chat.disabled, false);
});

test('V1prime T2: lost/invalid $chatwoot after ready re-hides chat without throwing', () => {
  const h = harness(withChat());
  const trigger = h.get('bp-contact__trigger');
  const chat = h.get('bp-contact__channel--chat');
  trigger.click();
  h.window.chatwootSDK = { run() { h.window.$chatwoot = { toggle() {} }; } };
  h.head.children[0].onload();
  h.window.dispatch('chatwoot:ready');
  assert.equal(chat.disabled, false);
  delete h.window.$chatwoot;
  // A background resize/load/reconciliation may re-render before any click.
  // Test the actual lost-action window while state.ready is still true.
  assert.doesNotThrow(() => h.window.dispatch('load'),
    're-sync with vanished $chatwoot must not dereference it');
  assert.equal(chat.disabled, true, 'missing SDK action is disabled by re-sync');
  assert.doesNotThrow(() => chat.click(), 'vanished toggle must never throw');
  assert.equal(chat.disabled, true, 'missing SDK action removes the actionable chat');
  h.window.$chatwoot = {};
  // Fresh ready cycle restores state.ready, but the action remains non-callable.
  // Emulate an SDK losing its method before a passive re-sync rather than
  // relying on the click guard to set state.ready=false.
  const h2 = harness(withChat());
  h2.get('bp-contact__trigger').click();
  h2.window.chatwootSDK = { run() { h2.window.$chatwoot = { toggle() {} }; } };
  h2.head.children[0].onload();
  h2.window.dispatch('chatwoot:ready');
  const chat2 = h2.get('bp-contact__channel--chat');
  assert.equal(chat2.disabled, false);
  h2.window.$chatwoot = {};
  assert.doesNotThrow(() => h2.window.dispatch('load'),
    're-sync with non-callable toggle must be safe');
  assert.equal(chat2.disabled, true, 'non-callable toggle must not advertise chat');
  assert.doesNotThrow(() => chat2.click());
});

test('V1prime T3: ready event without a callable SDK toggle does not authorize chat', () => {
  const h = harness(withChat());
  h.get('bp-contact__trigger').click();
  h.window.chatwootSDK = { run() {} };
  h.head.children[0].onload();
  h.window.dispatch('chatwoot:ready');
  assert.equal(h.get('bp-contact__channel--chat').disabled, true);
  assert.equal(h.get('bp-contact__channel--chat').hidden, false);
  assert.match(h.get('bp-contact__chat-status').textContent, /недоступний/);
});

test('V1prime T4: disabled/absent/invalid Website chat never requests SDK on menu-open', () => {
  const cases = [
    { channels: { phone: { enabled: true, url: 'tel:+380982908838' } } },
    { websiteToken: token, channels: { chat: { enabled: false },
      phone: { enabled: true, url: 'tel:+380982908838' } } },
    { websiteToken: '', channels: { chat: { enabled: true },
      phone: { enabled: true, url: 'tel:+380982908838' } } },
    { websiteToken: 'NOT A VALID TOKEN!', channels: { chat: { enabled: true },
      phone: { enabled: true, url: 'tel:+380982908838' } } }
  ];
  for (const config of cases) {
    const h = harness(config);
    h.get('bp-contact__trigger').click();
    h.window.dispatch('load');
    assert.equal(h.head.children.length, 0, 'no configured chat, no SDK script');
    assert.equal(h.window.chatwootSettings, undefined, 'no Chatwoot settings for disabled chat');
    assert.equal(h.get('bp-contact__channel--chat').hidden, true);
  }
});

test('V1prime T5: load, hover, keyboard and touch without menu-open never initialize Chatwoot', () => {
  const h = harness(withChat());
  const trigger = h.get('bp-contact__trigger');
  h.window.dispatch('load');
  h.document.dispatch('keydown', { key: 'Enter', target: trigger });
  h.document.dispatch('keydown', { key: 'Escape', target: trigger });
  h.document.dispatch('pointerdown', { target: trigger });
  for (const event of ['pointerenter', 'mouseover', 'focus', 'touchstart']) {
    for (const fn of trigger.listeners[event] || []) fn({ target: trigger });
  }
  h.window.dispatch('load');
  assert.equal(h.head.children.length, 0, 'no SDK from passive or non-open gestures');
  assert.equal(h.window.chatwootSettings, undefined);
  assert.equal(h.get('bp-contact__channel--chat').disabled, true);
  assert.equal(h.get('bp-contact__channel--chat').hidden, false);
  trigger.click();
  assert.equal(h.head.children.length, 1, 'only explicit opening requests SDK once');
});

test('V1prime T6: host Chatwoot defaults cannot override required privacy/UX settings', () => {
  const h = harness(withChat());
  h.window.chatwootSettings = {
    hideMessageBubble: false,
    showUnreadMessagesDialog: true,
    locale: 'en',
    otherHostSetting: 'preserve'
  };
  h.get('bp-contact__trigger').click();
  assert.equal(h.head.children.length, 1);
  assert.equal(h.window.chatwootSettings.hideMessageBubble, true);
  assert.equal(h.window.chatwootSettings.showUnreadMessagesDialog, false);
  assert.equal(h.window.chatwootSettings.locale, 'uk');
  assert.equal(h.window.chatwootSettings.otherHostSetting, 'preserve');
});

test('L1-C 12s notice is informational: 11,999ms quiet, 12,000ms slow, genuine late ready recovers', () => {
  const h = harness(withChat());
  const row = h.get('bp-contact__channel--chat');
  const note = h.get('bp-contact__chat-note');
  const close = h.get('bp-contact__trigger');
  assert.equal(h.pendingTimers(), 0);
  close.click();
  assert.equal(h.pendingTimers(), 1);
  h.window.chatwootSDK = { run() { h.window.$chatwoot = { toggle() {} }; } };
  h.head.children[0].onload();
  h.advance(11999);
  assert.equal(row.disabled, true);
  assert.equal(note.hidden, true);
  h.advance(1);
  assert.equal(h.pendingTimers(), 0, 'one-shot timeout settles');
  assert.equal(row.disabled, true);
  assert.equal(note.hidden, false);
  assert.match(note.textContent, /довше, ніж зазвичай/);
  assert.equal(row.hidden, false, 'reserved slot never disappears at threshold');
  close.click();
  close.click();
  assert.equal(h.head.children.length, 1, 'no reinjection after timeout');
  assert.equal(h.pendingTimers(), 0, 'no repeated timers on menu reopen');
  h.window.dispatch('chatwoot:ready');
  assert.equal(row.disabled, false, 'late valid SDK always recovers');
  assert.equal(note.hidden, true, 'informational message clears on ready');
  assert.equal(h.pendingTimers(), 0);
});

test('L1-C readiness and failure races are settled once without auto-open', () => {
  const h = harness(withChat());
  const row = h.get('bp-contact__channel--chat');
  let opens = 0, runs = 0;
  h.get('bp-contact__trigger').click();
  h.window.chatwootSDK = { run() {
    runs += 1;
    h.window.$chatwoot = { toggle() { opens += 1; } };
  } };
  const sdk = h.head.children[0];
  sdk.onload();
  sdk.onload(); // defensive: duplicated onload may not re-run official SDK.
  h.window.dispatch('chatwoot:ready');
  h.window.dispatch('chatwoot:ready');
  h.advance(24000);
  assert.equal(row.disabled, false);
  assert.equal(h.get('bp-contact__chat-note').hidden, true);
  assert.equal(h.pendingTimers(), 0);
  assert.equal(opens, 0, 'ready never automatically opens the chat');
  assert.equal(runs, 1);
  assert.equal(h.head.children.length, 1);
  // An explicit script failure remains a hard error, even after an earlier
  // spurious late ready event. Never show a fake clickable option.
  const failed = harness(withChat());
  failed.get('bp-contact__trigger').click();
  failed.advance(12000);
  assert.equal(failed.get('bp-contact__channel--chat').disabled, true);
  failed.head.children[0].onerror();
  failed.window.$chatwoot = { toggle() {} };
  failed.window.dispatch('chatwoot:ready');
  assert.equal(failed.get('bp-contact__channel--chat').disabled, true);
  assert.match(failed.get('bp-contact__chat-note').textContent, /недоступний/);
  assert.equal(failed.pendingTimers(), 0);
});

test('L1-C fixed chat slot precedes unchanged Telegram/Viber/phone rows and has no visual footer', () => {
  const h = harness({ ...withChat(), channels: {
    chat: { enabled: true },
    telegram: { enabled: true, url: 'https://t.me/Babyparkua_bot' },
    viber: { enabled: true, url: 'viber://pa?chatURI=babypark' },
    phone: { enabled: true, url: 'tel:+380982908838' }
  } });
  const rows = ['chat', 'telegram', 'viber', 'phone'].map(name => h.get('bp-contact__channel--' + name));
  const options = h.get('bp-contact__options');
  assert.deepEqual(rows.map(r => options.children.indexOf(r)), [0, 1, 3, 4],
    'configured channel order never changes when ready state changes');
  assert.equal(rows[0].disabled, true);
  assert.equal(rows[0].hidden, false);
  h.get('bp-contact__trigger').click();
  assert.equal(h.document.activeElement, rows[1], 'disabled chat never receives initial focus');
  h.advance(12000);
  assert.equal(rows[0].disabled, true);
  assert.deepEqual(rows.map(r => options.children.indexOf(r)), [0, 1, 3, 4]);
  h.window.chatwootSDK = { run() { h.window.$chatwoot = { toggle() {} }; } };
  h.head.children[0].onload();
  h.window.dispatch('chatwoot:ready');
  assert.equal(rows[0].disabled, false);
  assert.equal(h.document.activeElement, rows[1], 'late ready never steals focus from another channel');
  assert.deepEqual(rows.map(r => options.children.indexOf(r)), [0, 1, 3, 4]);
  assert.match(css, /\.bp-contact__channel--chat\s*\{[^}]*height:\s*64px;[^}]*min-height:\s*64px;[^}]*max-height:\s*64px/s);
  assert.match(css, /\.bp-contact__chat-status\s*\{[^}]*position:\s*absolute !important;/s);
  assert.match(css, /\.bp-contact__chat-note\s*\{[^}]*max-height:\s*26px;/s);
});

test('L1-C SVG X geometry and double-contrast focus have no baseline glyph', () => {
  const h = harness({ channels: { phone: { enabled: true, url: 'tel:+380982908838' } } });
  for (const name of ['bp-contact__trigger-close', 'bp-contact__menu-close']) {
    const icon = h.get(name);
    assert.match(icon.innerHTML, /viewBox="0 0 24 24"/);
    assert.match(icon.innerHTML, /M18 6 6 18M6 6l12 12/);
    assert.equal(icon.textContent, '', 'no font baseline affects visual X centre');
  }
  assert.match(css, /\.bp-contact :focus-visible\s*\{[^}]*outline:\s*3px solid #004b78;[^}]*box-shadow:\s*0 0 0 6px #fff;/s);
  assert.match(css, /@media \(forced-colors:\s*active\)/);
  assert.match(css, /\.bp-contact__trigger-close svg\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;/s);
});

test('L1-C S9 accessibility: persistent live region announces loading, slowness and recovery', () => {
  const h = harness(withChat());
  const status = h.get('bp-contact__chat-status');
  assert.ok(status, 'a real aria-live node must exist before any chat transitions');
  assert.equal(status.getAttribute('role'), 'status');
  assert.equal(status.getAttribute('aria-live'), 'polite');
  assert.equal(status.getAttribute('aria-atomic'), 'true');
  assert.equal(status.hidden, false, 'permanent live region must not be conditionally hidden');
  h.get('bp-contact__trigger').click();
  assert.match(status.textContent, /підключається/);
  h.advance(12000);
  assert.match(status.textContent, /довше, ніж зазвичай/);
  h.window.chatwootSDK = { run() { h.window.$chatwoot = { toggle() {} }; } };
  h.head.children[0].onload();
  h.window.dispatch('chatwoot:ready');
  assert.match(status.textContent, /доступний/);
  assert.equal(status.getAttribute('aria-live'), 'polite', 'live region survives state changes');
  assert.equal(status.hidden, false);
  const error = harness(withChat());
  error.get('bp-contact__trigger').click();
  error.head.children[0].onerror();
  assert.match(error.get('bp-contact__chat-status').textContent, /недоступний/);
  assert.equal(error.get('bp-contact__chat-status').getAttribute('role'), 'status');
});

test('L1-C S9: subdued informational note is still legible at small text size', () => {
  const noteStyle = css.match(/\.bp-contact__chat-note\s*\{([^}]*)\}/)?.[1];
  assert.ok(noteStyle);
  const foreground = noteStyle.match(/\bcolor:\s*(#[0-9a-fA-F]{6})\s*;/)?.[1];
  const bgStyle = css.match(/\.bp-contact__channel--chat:disabled,\s*\.bp-contact__channel--chat\[aria-disabled="true"\]\s*\{([^}]*)\}/)?.[1];
  const background = bgStyle?.match(/background:\s*(#[0-9a-fA-F]{6})\s*;/)?.[1];
  assert.ok(foreground && background, 'explicit disabled-note foreground and background required');
  const luminance = hex => {
    const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const fg = luminance(foreground), bg = luminance(background);
  const contrast = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  assert.ok(contrast >= 4.5, `Disabled chat status text contrast ${contrast.toFixed(2)} must be >= 4.5:1`);
  assert.match(noteStyle, /font-size:\s*10px/);
});
