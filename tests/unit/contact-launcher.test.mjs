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
    // Native input and textarea controls start with an empty string value.
    this.value = '';
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
    cookie: opts.cookie || '',
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
    fetch: opts.fetchMock,
    location: { href: opts.locationHref || 'https://babypark.ua/product/123' },
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
  assert.equal(h.get('bp-contact__channel--callback').hidden, true);
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


const callbackConfig = () => ({
  websiteToken: 'PUBLICWEBSITETOKEN123',
  channels: { chat: { enabled: true }, callback: { enabled: true },
    phone: { enabled: true, url: 'tel:+380982908838' } }
});
const dummyJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzb3VyY2VfaWQiOiJzeW50aGV0aWMifQ.SIGNATURE';
function visitCallback(h) {
  h.get('bp-contact__trigger').click();
  assert.equal(h.head.children.length, 0, 'general menu must not load Chatwoot SDK');
  h.get('bp-contact__channel--callback').click();
  assert.equal(h.head.children.length, 1, 'explicit callback selection loads Chatwoot once');
  h.window.chatwootSDK = { run() { h.window.$chatwoot = { toggle() {} }; } };
  h.head.children[0].onload();
  h.window.dispatch('chatwoot:ready');
}
function input(h, val) {
  const field = h.get('bp-contact__callback-input');
  field.value = val;
  for (const handler of field.listeners.input || []) handler();
}
function submit(h) {
  for (const handler of h.get('bp-contact__callback-form').listeners.submit || [])
    handler({ preventDefault() {} });
}
async function flushAsync() {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

test('L2: menu and messenger links never load SDK; explicit Chat click starts once and opens after ready', () => {
  const h = harness(callbackConfig());
  const launcher = h.get('bp-contact__trigger');
  launcher.click();
  h.window.dispatch('load');
  assert.equal(h.head.children.length, 0);
  assert.equal(h.get('bp-contact__channel--chat').disabled, false);
  h.get('bp-contact__channel--chat').click();
  assert.equal(h.head.children.length, 1);
  let opens = 0, runs = 0;
  h.window.chatwootSDK = { run() {
    runs++;
    h.window.$chatwoot = { toggle(state) { if (state === 'open') opens++; } };
  } };
  h.head.children[0].onload();
  assert.equal(opens, 0, 'before ready, do not open fake chat');
  h.window.dispatch('chatwoot:ready');
  assert.equal(runs, 1);
  assert.equal(opens, 1);
  assert.equal(h.head.children.length, 1);
});

test('L2: closing menu before late ready cancels deferred chat open', () => {
  const h = harness(callbackConfig());
  h.get('bp-contact__trigger').click();
  h.get('bp-contact__channel--chat').click();
  h.get('bp-contact__trigger').click();
  let opens=0;
  h.window.chatwootSDK = { run() { h.window.$chatwoot={toggle(){opens++;}}; } };
  h.head.children[0].onload();
  h.window.dispatch('chatwoot:ready');
  assert.equal(opens, 0);
});

test('L2: SDK failure remains disabled, no fake chat even if late ready arrives', () => {
  const h = harness(callbackConfig());
  h.get('bp-contact__trigger').click();
  h.get('bp-contact__channel--chat').click();
  h.head.children[0].onerror();
  h.window.$chatwoot = { toggle() {} };
  h.window.dispatch('chatwoot:ready');
  assert.equal(h.get('bp-contact__channel--chat').disabled, true);
  assert.match(h.get('bp-contact__chat-status').textContent, /недоступний/);
});

test('L2: 12-second notice is informational; late ready remains actionable', () => {
  const h = harness(callbackConfig());
  h.get('bp-contact__trigger').click();
  h.get('bp-contact__channel--chat').click();
  assert.equal(h.head.children.length, 1);
  h.advance(12000);
  assert.match(h.get('bp-contact__chat-note').textContent, /довше/);
  h.window.chatwootSDK={run(){h.window.$chatwoot={toggle(){}};}};
  h.head.children[0].onload();
  h.window.dispatch('chatwoot:ready');
  assert.equal(h.get('bp-contact__chat-note').hidden, true);
  assert.equal(h.get('bp-contact__channel--chat').disabled, false);
});

test('L2: all launcher channels share one 24px icon grid inside unchanged 35px badges', () => {
  const h = harness({ assetBase: '/themes/babypark2/assets/contact/',
    websiteToken: 'PUBLICWEBSITETOKEN123',
    channels: {
      chat: { enabled: true },
      callback: { enabled: true },
      telegram: { enabled: true, url: 'https://t.me/Babyparkua_bot' },
      whatsapp: { enabled: true, url: 'https://wa.me/380982908838' },
      viber: { enabled: true, url: 'viber://pa?chatURI=babypark' },
      phone: { enabled: true, url: 'tel:+380982908838' }
    }
  });
  for (const name of ['chat', 'callback', 'telegram', 'whatsapp', 'viber', 'phone']) {
    assert.ok(h.get('bp-contact__icon--' + name), 'icon for ' + name);
  }
  assert.match(css, /\.bp-contact__icon\s*\{[^}]*flex:\s*0\s+0\s+35px;[^}]*width:\s*35px;[^}]*height:\s*35px;/s);
  assert.match(css, /\.bp-contact__icon img,\s*\.bp-contact__icon svg\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;/s);
  assert.doesNotMatch(css, /\.bp-contact__icon--(?:chat|callback|telegram|whatsapp|viber|phone)\s+(?:img|svg)\s*\{[^}]*\b(?:width|height)\s*:/s,
    'no per-channel icon size override');
  assert.match(css, /\.bp-contact__channel\s*\{[^}]*min-height:\s*49px;/s,
    'no change to existing clickable row height');

  const handset = h.get('bp-contact__icon--callback');
  assert.match(handset.innerHTML, /viewBox="0 0 24 24"/);
  assert.match(handset.innerHTML, /stroke-width="2"/);
  assert.match(handset.innerHTML, /M22 16\.92v3/);
  assert.match(handset.innerHTML, /transform="translate\(12 12\) scale\(0\.95\) translate\(-12 -12\)"/,
    'handset optical 5% inset, without CSS geometry overrides');
  assert.doesNotMatch(handset.innerHTML, /M21 11\.5a8\.5|<circle\b/,
    'phone handset has no surrounding ring');

  const chatIcon = h.get('bp-contact__icon--chat');
  assert.match(chatIcon.innerHTML, /viewBox="0 0 24 24"/);
  assert.match(chatIcon.innerHTML, /<g transform="translate\(12 12\) scale\(1\.12\) translate\(-12 -12\)">/,
    'chat bubble optical 12% enlargement inside the identical 24px viewport');
  assert.match(chatIcon.innerHTML, /stroke-width="2\.5"\/><\/g><\/svg>/,
    'bubble and ellipsis are scaled together');

  const callbackRow = h.get('bp-contact__channel--callback');
  const label = traverse(callbackRow, node => node.className.split(' ').includes('bp-contact__name'));
  assert.equal(label?.textContent, 'Замовити дзвінок',
    'clear callback action label matches form submit CTA');
});

test('L2: callback option is in stable final row after direct call, panel has only phone required', () => {
  const h = harness(callbackConfig(),{cookie:'cw_conversation='+dummyJwt});
  const phone = h.get('bp-contact__channel--phone');
  const callback = h.get('bp-contact__channel--callback');
  assert.equal(callback.hidden, false);
  const options = h.get('bp-contact__options');
  assert.equal(options.children.indexOf(callback), options.children.indexOf(phone)+1);
  visitCallback(h);
  assert.equal(h.get('bp-contact__options').hidden,true);
  assert.equal(h.get('bp-contact__callback-form').hidden,false);
  assert.equal(h.get('bp-contact__callback-submit').disabled,true);
  assert.equal(h.get('bp-contact__callback-input').required,true);
  assert.notEqual(h.get('bp-contact__callback-textarea').required,true);
  assert.equal(h.get('bp-contact__callback-input').inputMode,'numeric');
  const name = h.get('bp-contact__callback-name');
  assert.ok(name, 'optional name field between phone and message');
  assert.equal(name.type, 'text');
  assert.notEqual(name.required, true);
  assert.equal(name.maxLength, 80);
  assert.equal(name.autocomplete, 'given-name');
  assert.equal(name.spellcheck, false);
  const form = h.get('bp-contact__callback-form');
  const fields = form.children;
  const phoneWrapper = fields.findIndex(n => n.children?.some?.(e => e.className?.includes?.('bp-contact__callback-phone-wrap')));
  const nameWrapper = fields.findIndex(n => n.children?.includes?.(name));
  const messageWrapper = fields.findIndex(n => n.children?.some?.(e =>
    e.children?.includes?.(h.get('bp-contact__callback-textarea'))));
  assert.ok(phoneWrapper >= 0 && nameWrapper === phoneWrapper + 1 && messageWrapper === nameWrapper + 1,
    'name comes directly after phone and before message');
});

test('L2: Callback reuses menu close and has Chatwoot-like responsive header/window', () => {
  const h=harness(callbackConfig(), {cookie:'cw_conversation='+dummyJwt});
  visitCallback(h);
  assert.equal(h.get('bp-contact__brand').hidden,false);
  assert.equal(h.get('bp-contact__heading-title').hidden,true);
  assert.match(h.get('bp-contact__menu').className,/bp-contact__menu--callback/);
  assert.equal(h.get('bp-contact__menu-close').getAttribute('aria-label'),'Закрити вікно');
  assert.equal(h.get('bp-contact__back'),null);
  assert.equal(h.get('bp-contact__brand-name').textContent,'BabyPark');
  assert.equal(h.get('bp-contact__brand-status').textContent,'Замовити дзвінок');
  assert.equal(h.get('bp-contact__callback-form').getAttribute('aria-label'),'Замовити дзвінок');
  assert.equal(h.get('bp-contact__callback-heading'),null,'no duplicated category heading');
  assert.equal(h.get('bp-contact__callback-caption').textContent,'Залиште номер для зв’язку');
  assert.equal(h.get('bp-contact__callback-submit').textContent,'Замовити дзвінок');
  assert.doesNotMatch(css,/\.bp-contact__callback-heading\s*\{/,'obsolete duplicate title styling removed');
  assert.match(css,/\.bp-contact__menu--callback\s*\{[^}]*width:\s*min\(400px,/s);
  assert.match(css,/height:\s*min\(600px,\s*calc\(100dvh/s);
  assert.match(css,/@media \(max-width: 767px\)/);
  assert.match(css,/\.bp-contact__callback-phone-input\s*\{[^}]*font-size:\s*20px/s);
  assert.doesNotMatch(h.get('bp-contact__brand-status').textContent,/онлайн|завтра/,
    'do not invent live agent availability');
  h.get('bp-contact__menu-close').click();
  assert.equal(h.get('bp-contact__menu').hidden,true);
  assert.equal(h.get('bp-contact__brand').hidden,true);
  assert.equal(h.get('bp-contact__heading-title').hidden,false);
  assert.equal(h.get('bp-contact__trigger').getAttribute('aria-expanded'),'false');
});

test('L2: native textarea maxlength=500 is visible as a neutral accessible remaining counter', () => {
  const h=harness(callbackConfig(), {cookie:'cw_conversation='+dummyJwt});
  visitCallback(h);
  const note=h.get('bp-contact__callback-textarea');
  const counter=h.get('bp-contact__callback-message-hint');
  assert.equal(note.maxLength,500,'existing native browser input cap is unchanged');
  assert.equal(note.getAttribute('aria-describedby'),counter.id);
  assert.equal(counter.parent, h.get('bp-contact__callback-message-group'));
  assert.notEqual(note.parent, counter.parent,
    'counter must be description, not duplicate accessible label text');
  assert.equal(counter.textContent,'Залишилося 500 символів');
  assert.match(css,/\.bp-contact__callback-message-hint\s*\{[^}]*color:\s*#60646c/s,
    'use stock Chatwoot light-mode slate-11 for explanatory text');
  assert.equal(counter.getAttribute('aria-live'),undefined,
    'per-keystroke counter must not interrupt screen-reader speech');
  const update = value => {
    note.value=value;
    for(const fn of note.listeners.input || []) fn();
    return counter.textContent;
  };
  assert.equal(update('a'.repeat(498)),'Залишилося 2 символи');
  assert.equal(update('a'.repeat(499)),'Залишилося 1 символ');
  assert.equal(update('a'.repeat(500)),'Залишилося 0 символів');
  assert.equal(update('a'.repeat(489)),'Залишилося 11 символів');
  assert.equal(update('a'.repeat(488)),'Залишилося 12 символів');
  assert.equal(update('a'.repeat(496)),'Залишилося 4 символи');
  assert.equal(update('Рядок 1\nРядок 2'),'Залишилося 485 символів');
  input(h,'671234567');
  assert.equal(h.get('bp-contact__callback-submit').disabled,false,
    'comment at exactly 500 units remains valid with a valid phone');
  note.value='a'.repeat(501);for(const fn of note.listeners.input || []) fn();
  assert.equal(counter.textContent,'Залишилося 0 символів');
  assert.equal(h.get('bp-contact__callback-submit').disabled,true,
    'programmatic bypass of native browser maxlength fails closed');
  h.get('bp-contact__menu-close').click();
  h.get('bp-contact__trigger').click();
  h.get('bp-contact__channel--callback').click();
  assert.equal(note.value,'a'.repeat(501),'closing must not silently discard even scripted draft');
  assert.equal(counter.textContent,'Залишилося 0 символів');
  assert.equal(h.get('bp-contact__callback-submit').disabled,true,
    'scripted over-limit draft cannot be submitted after reopen');
});


test('L2 S1: unsent phone/name/multiline note survive X, Escape, outside tap and reopen', () => {
  for (const close of ['x', 'escape', 'outside', 'trigger']) {
    const h = harness(callbackConfig(), { cookie: 'cw_conversation=' + dummyJwt });
    visitCallback(h);
    input(h, '661234567');
    const name = h.get('bp-contact__callback-name');
    const note = h.get('bp-contact__callback-textarea');
    name.value = 'Тест 123';
    note.value = 'Довгий текст\nДругий рядок';
    (note.listeners.input || []).forEach(fn => fn());
    if (close === 'x') h.get('bp-contact__menu-close').click();
    if (close === 'escape') h.document.dispatch('keydown', { key: 'Escape' });
    if (close === 'outside') h.document.dispatch('pointerdown', { target: h.body });
    if (close === 'trigger') h.get('bp-contact__trigger').click();
    assert.equal(h.get('bp-contact__menu').hidden, true, close + ' really closes');
    h.get('bp-contact__trigger').click();
    h.get('bp-contact__channel--callback').click();
    assert.equal(h.get('bp-contact__callback-input').value, '661234567');
    assert.equal(name.value, 'Тест 123');
    assert.equal(note.value, 'Довгий текст\nДругий рядок');
    assert.equal(h.get('bp-contact__callback-submit').disabled, false);
    assert.equal(h.get('bp-contact__callback-message-hint').textContent,
      'Залишилося 475 символів');
  }
  const fresh = harness(callbackConfig(), { cookie: 'cw_conversation=' + dummyJwt });
  visitCallback(fresh);
  assert.equal(fresh.get('bp-contact__callback-input').value || '', '',
    'no durable draft storage across page recreation');
});

test('L2 S4: callback origin allowlist is exactly HTTPS BabyPark apex or www', () => {
  for (const locationHref of [
    'https://attacker.example/product', 'https://babypark.ua.attacker.example/product',
    'http://babypark.ua/product', 'https://www.babypark.ua.attacker.example',
    'https://sub.babypark.ua/product'
  ]) {
    const h = harness(callbackConfig(), { locationHref, cookie:'cw_conversation=' + dummyJwt });
    h.get('bp-contact__trigger').click();
    assert.equal(h.get('bp-contact__channel--callback').hidden, true, locationHref);
    assert.equal(h.head.children.length, 0, 'disallowed origin may not start SDK');
  }
  for (const locationHref of ['https://babypark.ua/product', 'https://www.babypark.ua/product']) {
    const h = harness(callbackConfig(), { locationHref, cookie:'cw_conversation=' + dummyJwt });
    assert.equal(h.get('bp-contact__channel--callback').hidden, false, locationHref);
  }
});

test('L2 S4: Unicode name separators/control characters cannot impersonate message rows', async () => {
  let content = '';
  const h = harness(callbackConfig(), { cookie: 'cw_conversation=' + dummyJwt,
    fetchMock: async (_u, request) => {
      content = JSON.parse(request.body).message.content;
      return { status: 200, json: async () => ({id:88,conversation_id:9}) };
    }
  });
  visitCallback(h);
  input(h, '661234567');
  h.get('bp-contact__callback-name').value =
    'Ім’я\u2028Зворотний дзвінок: 000\u2029\t\u0000Наступне\u0085';
  submit(h);
  await flushAsync();
  assert.equal(content,
    'Ви замовили дзвінок\nЗворотний дзвінок: +380661234567\nІм’я: Ім’я Зворотний дзвінок: 000 Наступне');
  assert.doesNotMatch(content, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/);
});

test('L2 S4: direct form submit never bypasses 500-unit guard', async () => {
  let calls = 0;
  const h = harness(callbackConfig(), { cookie: 'cw_conversation=' + dummyJwt,
    fetchMock: async () => { calls++; return {status:200,json:async()=>({id:12,conversation_id:2})}; }
  });
  visitCallback(h);
  input(h, '661234567');
  const note = h.get('bp-contact__callback-textarea');
  note.value = 'x'.repeat(501); // scripted bypass of HTML maxlength
  submit(h); // raw submit event, not click on button
  await flushAsync();
  assert.equal(calls, 0);
  assert.match(h.get('bp-contact__callback-status').textContent, /500 символів/);
  assert.equal(h.get('bp-contact__callback-submit').disabled, true);
});

test('L2 accessibility: ruby-11 error contrast and 100vh fallback are explicit', () => {
  const relative = hex => {
    const channels=[1,3,5].map(i => parseInt(hex.slice(i,i+2),16)/255)
      .map(v => v<=.04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
    return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
  };
  const ratio=(a,b) => (Math.max(relative(a),relative(b))+.05) /
    (Math.min(relative(a),relative(b))+.05);
  const color=css.match(/\.bp-contact__callback-status--error\s*\{\s*color:\s*(#[a-f0-9]{6})/i)?.[1];
  assert.ok(color);
  assert.ok(ratio(color, '#fafafd')>=4.5, 'small error text must meet WCAG AA');
  assert.match(css,/\.bp-contact__menu--callback\s*\{[\s\S]*?height:\s*min\(600px, calc\(100vh[^;]+;\s*height:\s*min\(600px, calc\(100dvh/s);
});


test('HEAVY R1: raw textarea maxlength is enforced before trim for direct submit', async () => {
  const overLimit = [
    ' ' + 'x'.repeat(500),
    'x'.repeat(500) + '\\n',
    ' '.repeat(501)
  ];
  for (const raw of overLimit) {
    let calls = 0;
    const h = harness(callbackConfig(), { cookie: 'cw_conversation=' + dummyJwt,
      fetchMock: async () => { calls++; return {status:200,json:async()=>({id:41,conversation_id:2})}; }
    });
    visitCallback(h);
    input(h, '661234567');
    const note = h.get('bp-contact__callback-textarea');
    note.value = raw;
    for (const listener of note.listeners.input || []) listener();
    assert.equal(h.get('bp-contact__callback-submit').disabled, true,
      'raw length 501 disables button even if trim would reduce it');
    submit(h); // programmatic direct event bypasses disabled button
    await flushAsync();
    assert.equal(calls, 0, 'never POST beyond raw 500 UTF-16 units');
    assert.match(h.get('bp-contact__callback-status').textContent, /500 символів/);
    assert.equal(h.get('bp-contact__callback-submit').disabled, true);
  }
  for (const raw of ['x'.repeat(500), ' ' + 'x'.repeat(499)]) {
    let calls = 0;
    const h = harness(callbackConfig(), { cookie: 'cw_conversation=' + dummyJwt,
      fetchMock: async () => { calls++; return {status:200,json:async()=>({id:42,conversation_id:3})}; }
    });
    visitCallback(h);
    input(h, '661234567');
    const note = h.get('bp-contact__callback-textarea');
    note.value = raw;
    for (const listener of note.listeners.input || []) listener();
    assert.equal(h.get('bp-contact__callback-submit').disabled, false,
      'exactly 500 raw units are allowed');
    submit(h);
    await flushAsync();
    assert.equal(calls, 1, 'one confirmed Widget POST within raw 500 limit');
    assert.equal(h.get('bp-contact__callback-submit').disabled, true);
  }
});

test('HEAVY R1: stale pending Chat cannot replace selected Callback on late ready', () => {
  const h = harness(callbackConfig(), { cookie:'cw_conversation='+dummyJwt });
  let opens = 0;
  h.get('bp-contact__trigger').click();
  // Seed the late-chat intent through the existing click handler as a stale
  // action from the pre-ready phase; current disabled visual row is unaffected.
  for (const fn of h.get('bp-contact__channel--chat').listeners.click || []) fn();
  assert.equal(h.head.children.length, 1, 'same lazy SDK requested once');
  h.get('bp-contact__channel--callback').click();
  input(h, '661234567');
  const note = h.get('bp-contact__callback-textarea');
  note.value = 'Перетелефонуйте пізніше';
  h.window.chatwootSDK = { run() {
    h.window.$chatwoot = { toggle() { opens++; } };
  }};
  h.head.children[0].onload();
  h.window.dispatch('chatwoot:ready');
  assert.equal(opens, 0, 'stale chat intent never opens Widget');
  assert.equal(h.get('bp-contact__menu').hidden, false);
  assert.equal(h.get('bp-contact__callback-form').hidden, false);
  assert.equal(h.get('bp-contact__callback-input').value, '661234567');
  assert.equal(note.value, 'Перетелефонуйте пізніше');
});

test('HEAVY R1: success auto-close does not steal focus from outside page input', async () => {
  for (const moveOutside of [false,true]) {
    const h = harness(callbackConfig(), { cookie:'cw_conversation='+dummyJwt,
      fetchMock: async () => ({status:200,json:async()=>({id:43,conversation_id:3})})
    });
    visitCallback(h);
    input(h, '661234567');
    submit(h);
    await flushAsync();
    assert.equal(h.document.activeElement, h.get('bp-contact__callback-success'));
    const external = h.document.createElement('input');
    h.body.appendChild(external);
    if (moveOutside) external.focus();
    h.advance(3500);
    assert.equal(h.get('bp-contact__menu').hidden, true);
    assert.equal(h.document.activeElement,
      moveOutside ? external : h.get('bp-contact__trigger'),
      moveOutside ? 'external focus must not be stolen' : 'inside-panel focus safely returns to trigger');
  }
});

test('L2: fixed +380 prefix, nine visible digits and accessible missing-digit hints', () => {
  const h=harness(callbackConfig(),{cookie:'cw_conversation='+dummyJwt});
  visitCallback(h);
  const prefix=h.get('bp-contact__callback-prefix');
  const field=h.get('bp-contact__callback-phone-input');
  assert.equal(prefix.textContent,'+380');
  assert.equal(field.inputMode,'numeric');
  assert.equal(field.pattern,'[3-9][0-9]{8}');
  assert.equal(field.maxLength,30,'allow whole clipboard number before normalization');
  assert.equal(field.getAttribute('aria-describedby'),h.get('bp-contact__callback-phone-hint').id);
  assert.match(h.get('bp-contact__callback-phone-hint').textContent,/Введіть 9 цифр/);
  input(h,'066 123 45 67');
  assert.equal(field.value,'661234567');
  assert.match(h.get('bp-contact__callback-phone-hint').textContent,/Номер заповнено/);
  assert.equal(h.get('bp-contact__callback-submit').disabled,false);
  input(h,'+380 50 123 45 67');
  assert.equal(field.value,'501234567');
  input(h,'1234');
  assert.equal(field.value,'1234');
  assert.match(h.get('bp-contact__callback-phone-hint').textContent,/5 цифр/);
  assert.equal(h.get('bp-contact__callback-submit').disabled,true);
  input(h,'123456789');
  input(h,'1234567895');
  assert.equal(field.value,'123456789','an extra typed digit is ignored');
  input(h,'+420 777 123 456');
  assert.equal(field.value,'+420777123456','preserve explicit foreign code visibly without reinterpreting it');
  assert.equal(h.get('bp-contact__callback-submit').disabled,true,'foreign country is never submittable');
});

test('L2: accessible Radix ruby-11 is reserved for genuine errors, not countdown guidance', () => {
  const h=harness(callbackConfig(), {cookie:'cw_conversation='+dummyJwt});
  visitCallback(h);
  const hint=h.get('bp-contact__callback-phone-hint');
  assert.match(css,/\.bp-contact__callback-phone-hint--error\s*\{[^}]*color:\s*#ca244d/s,
    'Radix ruby-11 AA text contrast for invalid widget values');
  assert.match(css,/\.bp-contact__callback-status--error\s*\{[^}]*color:\s*#ca244d/s);
  input(h,'67123456');
  assert.equal(hint.textContent,'Залишилося ввести 1 цифру');
  assert.doesNotMatch(hint.className,/--error/,'partial number helper is neutral');
  input(h,'+3');
  assert.equal(hint.textContent,'Введіть +380 та 9 цифр номера');
  assert.doesNotMatch(hint.className,/--error/,'partial valid international prefix is not an error');
  input(h,'+48');
  assert.match(hint.textContent,/лише номери України/);
  assert.match(hint.className,/bp-contact__callback-phone-hint--error/);
  input(h,'111111111');
  assert.equal(hint.textContent,'Перевірте перші цифри номера');
  assert.match(hint.className,/bp-contact__callback-phone-hint--error/);
  input(h,'671234567');
  assert.equal(hint.textContent,'Номер заповнено');
  assert.doesNotMatch(hint.className,/--error/);
});

test('L2: stock Chatwoot ruby semantic on rejected/uncertain Widget responses, neutral on success', async () => {
  for(const status of [429,500,200]) {
    const h=harness(callbackConfig(),{
      cookie:'cw_conversation='+dummyJwt,
      fetchMock:async()=>({status,json:async()=>({id:20,conversation_id:2})})
    });
    visitCallback(h);
    input(h,'671234567');
    submit(h);
    await flushAsync();
    const info=h.get('bp-contact__callback-status');
    if(status===200) {
      assert.doesNotMatch(info.className,/--error/,'successful callback not visually erroneous');
    } else {
      assert.match(info.className,/bp-contact__callback-status--error/,
        'a rejected/uncertain request must have an accessible message and standard error color');
      assert.ok(info.textContent.length>0,'not color-only feedback');
    }
  }
});

test('HEAVY B-2: incremental Ukrainian full-country/trunk dialing cannot silently change recipient', () => {
  // Model actual keyboard events: the browser emits input after every key,
  // while our listener sanitizes the displayed value after every event.
  const good = [
    '0671234567',
    '380671234567',
    '+380671234567',
    '38 067 123 45 67',
    '671234567'
  ];
  for (const typed of good) {
    const h = harness(callbackConfig(), { cookie: 'cw_conversation=' + dummyJwt });
    visitCallback(h);
    const field = h.get('bp-contact__callback-phone-input');
    const submitButton = h.get('bp-contact__callback-submit');
    for (const char of typed) {
      input(h, field.value + char);
      // Never show a false complete state for unstripped "380"/trunk "0".
      if (!submitButton.disabled)
        assert.equal(field.value, '671234567',
          'the only accepted visible number is the intended nine NSN digits: ' + typed);
      assert.ok(!/^380[0-9]{6}$/.test(field.value),
        'country prefix must not masquerade as a complete local number');
    }
    assert.equal(field.value, '671234567', 'normalized key-by-key: ' + typed);
    assert.equal(submitButton.disabled, false, 'valid full number enables submit: ' + typed);
    assert.equal(h.get('bp-contact__callback-phone-hint').textContent, 'Номер заповнено');
  }
});

test('HEAVY B-2: incomplete, reserved-prefix and all-zero numbers fail closed across key events', () => {
  const badInputs = [
    '067123456',   // trunk zero + only eight NSN digits
    '380671234',   // country code + only six NSN digits
    '0000000000',  // never a real NSN
    '100000000', '200000000', '012345678',
    '111111111', '222222222'
  ];
  for (const typed of badInputs) {
    const h = harness(callbackConfig(), { cookie: 'cw_conversation=' + dummyJwt });
    visitCallback(h);
    const field = h.get('bp-contact__callback-phone-input');
    const button = h.get('bp-contact__callback-submit');
    for (const char of typed) {
      input(h, field.value + char);
      assert.equal(button.disabled, true, 'never enable invalid phone: ' + typed);
    }
    assert.notEqual(h.get('bp-contact__callback-phone-hint').textContent, 'Номер заповнено',
      'hint must not say complete for incomplete or invalid prefix: ' + typed);
    if (field.value.length === 9) {
      assert.equal(h.get('bp-contact__callback-phone-hint').textContent,
        'Перевірте перші цифри номера', 'bad 9-digit prefix has an actionable hint');
    }
  }
});

test('HEAVY B-2: explicitly typed foreign +country can never masquerade as a Ukrainian NSN', () => {
  for (const foreign of ['+420777123456', '+4917612345678', '+447700900123']) {
    const h = harness(callbackConfig(), { cookie: 'cw_conversation=' + dummyJwt });
    visitCallback(h);
    const field = h.get('bp-contact__callback-phone-input');
    const button = h.get('bp-contact__callback-submit');
    for (const char of foreign) {
      input(h, field.value + char);
      assert.equal(button.disabled, true, 'foreign international entry disabled at every key: ' + foreign);
    }
    assert.match(field.value, /^\+/);
    assert.match(h.get('bp-contact__callback-phone-hint').textContent,
      /лише номери України/, 'show helpful invalid-country hint');
    input(h, '0671234567');
    assert.equal(field.value, '671234567', 'manual replacement with Ukrainian phone recovers');
    assert.equal(button.disabled, false);
  }
});

test('HEAVY B-2: paste, extra keys, edit-after-prefix and request payload retain exactly intended phone', async () => {
  const calls = [];
  const h = harness(callbackConfig(), {
    cookie: 'cw_conversation=' + dummyJwt,
    fetchMock: async (_url, opts) => {
      calls.push(JSON.parse(opts.body));
      return {status: 200, json: async () => ({id: 735, conversation_id: 103})};
    }
  });
  visitCallback(h);
  const field = h.get('bp-contact__callback-phone-input');
  const button = h.get('bp-contact__callback-submit');

  input(h, '+380 (67) 123-45-67');
  assert.equal(field.value, '671234567');
  assert.equal(button.disabled, false);

  input(h, field.value + '1');
  assert.equal(field.value, '671234567', 'extra key cannot overwrite recipient');
  input(h, field.value.slice(0, -1));
  assert.equal(field.value, '67123456');
  assert.equal(button.disabled, true, 'backspace must re-disable until complete');
  input(h, field.value + '7');
  assert.equal(field.value, '671234567');
  assert.equal(button.disabled, false);

  input(h, '+420 777 123 456');
  assert.equal(field.value, '+420777123456', 'foreign code stays visible and fails closed');
  assert.equal(button.disabled, true, 'cannot send to a foreign country as Ukrainian recipient');
  input(h, '671234567');
  assert.equal(button.disabled, false, 'manual correction recovers valid Ukrainian phone');
  submit(h);
  await flushAsync();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].custom_attributes.callback_phone, '+380671234567');
  assert.match(calls[0].message.content, /Зворотний дзвінок: \+380671234567/);
  assert.doesNotMatch(calls[0].message.content, /\+380380|\+380067/);
});

test('L2: invalid phones and injected letters cannot enable submit', () => {
  const h = harness(callbackConfig(),{cookie:'cw_conversation='+dummyJwt});
  visitCallback(h);
  for(const bad of ['123', '+380111', '+38066123456<script>', '+38O661234567', '+380 66123456😺']) {
    input(h,bad);
    assert.equal(h.get('bp-contact__callback-submit').disabled,true,bad);
  }
  input(h,'+380 66 123 45 67');
  assert.equal(h.get('bp-contact__callback-submit').disabled,false);
});

test('L2: no visitor note sends exactly one stock Website Widget POST with conversation phone attribute', async () => {
  const calls=[];
  const h=harness(callbackConfig(),{
    cookie:'cw_conversation='+dummyJwt,
    fetchMock:async (url,init) => {
      calls.push({url,init});
      return {status:200,json:async()=>({id:35,conversation_id:2})};
    }
  });
  visitCallback(h);
  input(h,'0661234567');
  submit(h);submit(h);
  await flushAsync();
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://chat.babypark.ua/api/v1/widget/messages?website_token=PUBLICWEBSITETOKEN123');
  assert.equal(calls[0].init.headers['X-Auth-Token'],dummyJwt);
  assert.equal(calls[0].init.credentials,'omit');
  assert.equal(calls[0].init.redirect,'error');
  const body=JSON.parse(calls[0].init.body);
  assert.equal(body.custom_attributes.callback_phone,'+380661234567');
  assert.equal(body.labels[0],'callback');
  assert.match(body.message.content,/^Ви замовили дзвінок\nЗворотний дзвінок: \+380661234567/);
  assert.doesNotMatch(body.message.content,/BABYPARK_CALLBACK_V1/,
    'no technical marker should leak into buyer-visible Chatwoot message');
  assert.match(body.message.content,/\+380661234567/);
  assert.doesNotMatch(body.message.content,/Повідомлення:|Ім’я:/);
  assert.equal(Object.hasOwn(body,'contact'),false);
  assert.deepEqual(Object.keys(body.custom_attributes), ['callback_phone'],
    'no persistent Contact.name or extra conversation attribute');
  assert.match(h.get('bp-contact__callback-success-title').textContent,/Заявку успішно надіслано/);
  assert.match(h.get('bp-contact__callback-success-title').textContent,/Вам/);
  assert.equal(h.get('bp-contact__callback-success').hidden,false);
  assert.equal(h.get('bp-contact__callback-submit').disabled,true);
});

test('L2: only confirmed success shows full-form confirmation then auto-closes', async () => {
  let calls=0;
  const h=harness(callbackConfig(),{
    cookie:'cw_conversation='+dummyJwt,
    fetchMock:async()=>{calls++;return {status:200,json:async()=>({id:123,conversation_id:42})};}
  });
  visitCallback(h);
  input(h,'661234567');
  submit(h);
  await flushAsync();
  assert.equal(calls,1);
  assert.equal(h.get('bp-contact__menu').hidden,false);
  assert.match(h.get('bp-contact__callback-form').className,/callback-form--success/);
  h.advance(3499);
  assert.equal(h.get('bp-contact__menu').hidden,false,'visible for 3.5s to read');
  h.advance(1);
  assert.equal(h.get('bp-contact__menu').hidden,true);
  assert.equal(h.pendingTimers(),0);
  h.get('bp-contact__trigger').click();
  h.get('bp-contact__channel--callback').click();
  assert.equal(h.get('bp-contact__callback-submit').disabled,true);
  submit(h);
  await flushAsync();
  assert.equal(calls,1,'terminal success cannot be submitted twice');
  h.get('bp-contact__menu-close').click();
  assert.equal(h.pendingTimers(),0,'manual close cancels re-armed timer');
});

test('L2: optional name is transmitted only inside Chatwoot message with safe single-line Unicode text', async () => {
  let payload;
  const h = harness(callbackConfig(),{
    cookie:'cw_conversation='+dummyJwt,
    fetchMock:async (_url,request) => {
      payload=JSON.parse(request.body);
      return {status:200,json:async()=>({id:55,conversation_id:8})};
    }
  });
  visitCallback(h);
  input(h,'661234567');
  assert.equal(h.get('bp-contact__callback-submit').disabled,false,
    'required phone only: name stays optional');
  const name = h.get('bp-contact__callback-name');
  name.value = "  Марія-Анна  О’Браєн\nДруга строка\t";
  h.get('bp-contact__callback-textarea').value='Уточнити розміри';
  submit(h);
  await flushAsync();
  assert.match(payload.message.content,/^Ви замовили дзвінок\nЗворотний дзвінок: \+380661234567/);
  assert.match(payload.message.content,/Ім’я: Марія-Анна О’Браєн Друга строка/);
  assert.match(payload.message.content,/Повідомлення: Уточнити розміри/);
  assert.equal(payload.message.content.split('Ім’я: ').length,2,
    'a visitor cannot add a second message row from the name field');
  assert.deepEqual(Object.keys(payload.custom_attributes),['callback_phone']);
  assert.equal(Object.hasOwn(payload,'contact'),false);
  assert.equal(name.disabled,true,'terminal success freezes optional PII field');
});

test('L2: blank optional name omitted, unusual Unicode spelling kept, no identity mutation', async () => {
  const sent=[];
  const h=harness(callbackConfig(),{
    cookie:'cw_conversation='+dummyJwt,
    fetchMock:async (_url,rq) => {
      sent.push(JSON.parse(rq.body));
      return {status:200,json:async()=>({id:85,conversation_id:11})};
    }
  });
  visitCallback(h);
  input(h,'661234567');
  h.get('bp-contact__callback-name').value='   ';
  submit(h);
  await flushAsync();
  assert.equal(sent.length,1);
  assert.doesNotMatch(sent[0].message.content,/Ім’я:/,'whitespace-only optional name omitted');
  assert.equal(Object.hasOwn(sent[0],'contact'),false);
});

test('L2: optional note preserved as text, never a Contact phone', async () => {
  let payload;
  const h=harness(callbackConfig(),{
    cookie:'cw_conversation='+dummyJwt,
    fetchMock:async (_u,request) => {
      payload=JSON.parse(request.body);
      return {status:200,json:async()=>({id:39,conversation_id:3})};
    }
  });
  visitCallback(h);
  input(h,'+380501234567');
  h.get('bp-contact__callback-textarea').value='Потрібна консультація щодо коляски';
  submit(h);
  await flushAsync();
  assert.match(payload.message.content,/Потрібна консультація щодо коляски/);
  assert.equal(payload.custom_attributes.callback_phone,'+380501234567');
  assert.equal(Object.hasOwn(payload,'contact'),false);
});

test('L2: proven Widget 403/422/429 rejects allow explicit manual retry, never automatic retry', async () => {
  for (const status of [403, 422, 429]) {
    let calls = 0;
    const h = harness(callbackConfig(), {
      cookie: 'cw_conversation=' + dummyJwt,
      fetchMock: async () => { calls++; return {status, json: async () => ({})}; }
    });
    visitCallback(h);
    input(h, '0982908838');
    submit(h);
    await flushAsync();
    assert.equal(calls, 1, 'no automatic retry for status ' + status);
    assert.doesNotMatch(h.get('bp-contact__callback-status').textContent, /Заявку надіслано|Щоб уникнути дублювання/);
    assert.equal(h.get('bp-contact__callback-submit').disabled, false, 'manual retry enabled after ' + status);
    submit(h);
    await flushAsync();
    assert.equal(calls, 2, 'exactly one POST per deliberate attempt on ' + status);
  }
});

test('L2: network failure, 500 and invalid-200 ACK remain uncertain and never resubmit', async () => {
  for (const fetchMock of [
    async () => { throw new Error('network timeout'); },
    async () => ({status:500, json:async()=>({})}),
    async () => ({status:200, json:async()=>({id:'unknown'})})
  ]) {
    let calls = 0;
    const h = harness(callbackConfig(), {
      cookie:'cw_conversation='+dummyJwt,
      fetchMock:async (...args)=>{calls++;return fetchMock(...args);}
    });
    visitCallback(h);
    input(h,'0982908838');
    submit(h);
    await flushAsync();
    assert.equal(calls,1);
    assert.doesNotMatch(h.get('bp-contact__callback-status').textContent,/Заявку надіслано/);
    assert.match(h.get('bp-contact__callback-status').textContent,/Щоб уникнути дублювання/);
    assert.equal(h.get('bp-contact__callback-submit').disabled,true);
    submit(h);
    await flushAsync();
    assert.equal(calls,1,'cannot resubmit uncertain ACK');
  }
});

test('L2: missing visitor cookie keeps submit disabled even after Chatwoot ready', () => {
  const h=harness(callbackConfig());
  visitCallback(h);
  input(h,'+380982908838');
  assert.equal(h.get('bp-contact__callback-submit').disabled,true);
});

test('L2: disabled callback never appears or sends; chat-only still lazily loads', () => {
  const h=harness({websiteToken:'PUBLICWEBSITETOKEN123',channels:{chat:{enabled:true},callback:{enabled:false}}});
  assert.equal(h.get('bp-contact__channel--callback').hidden,true);
  h.get('bp-contact__trigger').click();
  assert.equal(h.head.children.length,0);
});

test('HEAVY B1: uncertain ACK stays terminal across Back/reopen and direct submit bypass', async () => {
  let calls = 0;
  const h = harness(callbackConfig(), {
    cookie: 'cw_conversation=' + dummyJwt,
    fetchMock: async () => { calls++; throw new Error('response lost after request'); },
  });
  visitCallback(h);
  input(h, '0982908838');
  submit(h);
  await flushAsync();
  assert.equal(calls, 1);
  assert.match(h.get('bp-contact__callback-status').textContent, /Щоб уникнути дублювання/);
  assert.equal(h.get('bp-contact__callback-submit').disabled, true);
  h.get('bp-contact__menu-close').click();
  h.get('bp-contact__trigger').click();
  h.get('bp-contact__channel--callback').click();
  assert.match(h.get('bp-contact__callback-status').textContent, /Щоб уникнути дублювання/);
  assert.equal(h.get('bp-contact__callback-input').disabled, true);
  input(h, '0501234567');
  submit(h); // A raw form-submit event must be denied even with button disabled.
  await flushAsync();
  assert.equal(calls, 1);
});

test('HEAVY B1: server-accepted callback stays terminal across reopening same launcher', async () => {
  let calls = 0;
  const h = harness(callbackConfig(), {
    cookie: 'cw_conversation=' + dummyJwt,
    fetchMock: async () => { calls++; return { status: 200, json: async () => ({ id: 35, conversation_id: 2 }) }; },
  });
  visitCallback(h);
  input(h, '0982908838');
  submit(h);
  await flushAsync();
  assert.match(h.get('bp-contact__callback-success-title').textContent, /Заявку успішно надіслано/);
  h.get('bp-contact__menu-close').click();
  h.get('bp-contact__trigger').click();
  h.get('bp-contact__channel--callback').click();
  assert.equal(h.get('bp-contact__callback-submit').disabled, true);
  submit(h);
  await flushAsync();
  assert.equal(calls, 1);
});

test('HEAVY B2: hung fetch becomes bounded unknown ACK; caller may return to telephone options', async () => {
  let calls = 0;
  const h = harness(callbackConfig(), {
    cookie: 'cw_conversation=' + dummyJwt,
    fetchMock: () => { calls++; return new Promise(() => {}); },
  });
  visitCallback(h);
  input(h, '0982908838');
  submit(h);
  await flushAsync();
  assert.match(h.get('bp-contact__callback-status').textContent, /Надсилаємо/);
  h.advance(14999);
  await flushAsync();
  assert.match(h.get('bp-contact__callback-status').textContent, /Надсилаємо/);
  h.advance(1);
  await flushAsync();
  assert.match(h.get('bp-contact__callback-status').textContent, /Щоб уникнути дублювання/);
  assert.equal(h.get('bp-contact__callback-submit').disabled, true);
  h.get('bp-contact__menu-close').click();
  assert.equal(h.get('bp-contact__options').hidden, false);
  assert.equal(h.get('bp-contact__menu').hidden, true);
  assert.equal(h.get('bp-contact__channel--phone').hidden, false);
  assert.equal(h.pendingTimers(), 0);
  submit(h);
  await flushAsync();
  assert.equal(calls, 1);
});

test('HEAVY B2: hung JSON decode shares same bounded deadline and disables resend', async () => {
  let calls = 0;
  const h = harness(callbackConfig(), {
    cookie: 'cw_conversation=' + dummyJwt,
    fetchMock: async () => {
      calls++;
      return { status: 200, json: () => new Promise(() => {}) };
    },
  });
  visitCallback(h);
  input(h, '0982908838');
  submit(h);
  await flushAsync();
  h.advance(15000);
  await flushAsync();
  assert.match(h.get('bp-contact__callback-status').textContent, /Щоб уникнути дублювання/);
  submit(h);
  assert.equal(calls, 1);
  assert.equal(h.pendingTimers(), 0);
});

test('HEAVY B3: premature SDK toggle and broken ready event never simulate working Chat', () => {
  const h = harness(callbackConfig());
  h.get('bp-contact__trigger').click();
  h.get('bp-contact__channel--chat').click();
  let opens = 0;
  h.window.chatwootSDK = { run() { h.window.$chatwoot = { toggle() { opens++; } }; } };
  h.head.children[0].onload();
  h.window.dispatch('load');
  assert.equal(opens, 0, 'SDK.run may install toggle but not establish readiness');
  h.window.$chatwoot = {};
  h.window.dispatch('chatwoot:ready');
  assert.equal(opens, 0);
  assert.equal(h.get('bp-contact__channel--chat').disabled, true);
  assert.match(h.get('bp-contact__chat-status').textContent, /недоступний/);
  h.window.$chatwoot = { toggle() { opens++; } };
  h.window.dispatch('chatwoot:ready');
  assert.equal(opens, 0, 'late ready must never resurrect a failed initialization');
});

test('HEAVY B3: host settings cannot override mandatory privacy and Ukrainian chat UX', () => {
  const h = harness(callbackConfig());
  h.window.chatwootSettings = {
    hideMessageBubble: false, locale: 'en', showUnreadMessagesDialog: true,
    position: 'left',
  };
  h.get('bp-contact__trigger').click();
  assert.equal(h.window.chatwootSettings.locale, 'en');
  assert.equal(h.head.children.length, 0, 'ordinary menu still cannot start Website SDK');
  h.get('bp-contact__channel--callback').click();
  assert.equal(h.window.chatwootSettings.hideMessageBubble, true);
  assert.equal(h.window.chatwootSettings.locale, 'uk');
  assert.equal(h.window.chatwootSettings.showUnreadMessagesDialog, false);
  assert.equal(h.window.chatwootSettings.position, 'left', 'unrelated supported host options preserved');
});

test('HEAVY B2: AbortController is attempted on request timeout, without a second POST', async () => {
  let calls = 0;
  let aborts = 0;
  const h = harness(callbackConfig(), {
    cookie: 'cw_conversation=' + dummyJwt,
    fetchMock: async (_url, req) => {
      calls++;
      assert.ok(req.signal, 'supported native abort signal is attached');
      return new Promise(() => {});
    },
  });
  h.window.AbortController = class {
    signal = {};
    abort() { aborts++; }
  };
  visitCallback(h);
  input(h, '+380982908838');
  submit(h);
  await flushAsync();
  h.advance(15000);
  await flushAsync();
  assert.equal(calls, 1);
  assert.equal(aborts, 1);
  assert.equal(h.get('bp-contact__callback-submit').disabled, true);
  assert.equal(h.pendingTimers(), 0);
});
