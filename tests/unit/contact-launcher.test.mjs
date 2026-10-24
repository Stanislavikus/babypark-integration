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
  assert.match(body.message.content,/BABYPARK_CALLBACK_V1/);
  assert.match(body.message.content,/\+380661234567/);
  assert.doesNotMatch(body.message.content,/Повідомлення:/);
  assert.equal(Object.hasOwn(body,'contact'),false);
  assert.match(h.get('bp-contact__callback-status').textContent,/надіслано/);
  assert.equal(h.get('bp-contact__callback-submit').disabled,true);
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
  h.get('bp-contact__back').click();
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
  assert.match(h.get('bp-contact__callback-status').textContent, /Заявку надіслано/);
  h.get('bp-contact__back').click();
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
  h.get('bp-contact__back').click();
  assert.equal(h.get('bp-contact__options').hidden, false);
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
