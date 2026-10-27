/* BabyPark Contact Launcher L1 — no Drupal/Chatwoot core dependency or customer data storage. */
(function () {
  'use strict';
  if (window.__babyParkLauncherL1) return;
  window.__babyParkLauncherL1 = true;

  var config = window.BabyParkLauncherConfig;
  var ownScript = document.currentScript;
  // Explicit same-origin assetBase survives Drupal JS aggregation/Magento bundling.
  function resolveAssetBase() {
    // Never trust a document <base> element to define an icon origin.
    var origin = window.location.href;
    var value = config && config.assetBase;
    var candidate = typeof value === 'string' && value ? value
      : ownScript && ownScript.src ? new URL('.', ownScript.src).href : null;
    if (!candidate) return null;
    try {
      var url = new URL(candidate, origin);
      if (url.origin !== new URL(origin).origin || !/^https?:$/.test(url.protocol) ||
          !url.pathname.endsWith('/') || url.search || url.hash) return null;
      return url.href;
    } catch (_) { return null; }
  }
  var assetBase = resolveAssetBase();
  var names = ['chat', 'telegram', 'whatsapp', 'viber', 'phone'];
  var labels = {
    chat: 'Чат з продавцем',
    telegram: 'Telegram',
    whatsapp: 'WhatsApp',
    viber: 'Viber',
    phone: 'Зателефонувати'
  };
  var iconNames = {
    telegram: 'telegram.svg', whatsapp: 'whatsapp.svg',
    viber: 'viber.svg', phone: 'kyivstar.svg'
  };
  var urlPatterns = {
    telegram: /^https:\/\/t\.me\/[a-zA-Z0-9_]{4,64}\/?$/,
    whatsapp: /^https:\/\/wa\.me\/[1-9][0-9]{7,14}\/?$/,
    viber: /^viber:\/\/pa\?chatURI=[a-zA-Z0-9_-]{1,90}$/,
    phone: /^tel:\+[1-9][0-9]{7,14}$/
  };
  var chatOrigin = 'https://chat.babypark.ua';
  var widgetId = 'bp-contact-launcher-l1';
  var state = { ready: false, expanded: false, openedFromKeyboard: false, pendingChatFocus: false, sdkStarted: false, sdkFailed: false, slow: false };
  var readyTimer = null;
  var root, menu, trigger, chatStatus, chatNote, rows = {};
  // Static Lucide/Feather X; Feather-derived glyph licensed MIT (see runbook).
  var closeSvg = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  function channelConfig(name) {
    var channels = config && config.channels;
    var entry = channels && channels[name];
    return entry && entry.enabled === true ? entry : null;
  }

  function targetFor(name) {
    var entry = channelConfig(name);
    if (!entry || typeof entry.url !== 'string') return null;
    if (!urlPatterns[name] || !urlPatterns[name].test(entry.url)) return null;
    return entry.url;
  }

  function node(tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function iconFor(name) {
    var span = node('span', 'bp-contact__icon bp-contact__icon--' + name);
    if (name === 'chat') {
      // Static icon from approved BabyPark V4 mock; no customer-controlled markup.
      span.innerHTML = '<svg width="24" height="24" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11.4a7.8 7.8 0 0 1-8.2 7.7 9.6 9.6 0 0 1-3.3-.65L4 20l1.38-4.03A7.8 7.8 0 1 1 20 11.4Z"/><path d="M8.1 11.4h.01m3.89 0h.01m3.89 0h.01" stroke-width="2.5"/></svg>';
    } else if (assetBase) {
      var image = node('img');
      image.src = assetBase + 'icons/' + iconNames[name];
      image.alt = '';
      image.setAttribute('aria-hidden', 'true');
      image.decoding = 'async';
      span.appendChild(image);
    }
    return span;
  }

  function closeMenu(restoreFocus) {
    if (!menu) return;
    state.expanded = false;
    state.openedFromKeyboard = false;
    state.pendingChatFocus = false;
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
  }

  function chatConfigured() {
    return !!(channelConfig('chat') && config && typeof config.websiteToken === 'string' &&
      /^[a-zA-Z0-9_-]{8,128}$/.test(config.websiteToken));
  }

  function styled() {
    return !!(window.getComputedStyle && window.getComputedStyle(root).position === 'fixed');
  }

  function syncVisible() {
    if (!root) return;
    var count = 0;
    names.forEach(function (name) {
      var configured = name === 'chat' ? chatConfigured() : !!targetFor(name);
      var available = name === 'chat'
        ? !!(configured && state.ready && !state.sdkFailed && window.$chatwoot &&
             typeof window.$chatwoot.toggle === 'function')
        : configured;
      // A configured Website row ALWAYS occupies its final slot, even while
      // loading, after 12s or after failure. It is never clickable before ready.
      rows[name].hidden = !configured;
      if (name === 'chat') {
        rows.chat.disabled = !available;
        rows.chat.setAttribute('aria-disabled', available ? 'false' : 'true');
        if (chatNote) {
          chatNote.textContent = state.sdkFailed ? 'Чат тимчасово недоступний'
            : state.slow && !available ? 'Підключення триває довше, ніж зазвичай' : '';
          chatNote.hidden = !chatNote.textContent;
        }
      }
      if (available) count += 1;
    });
    if (chatStatus) {
      // The live region exists before updates, but never participates in layout.
      var message = !chatConfigured() ? ''
        : state.sdkFailed ? 'Чат тимчасово недоступний'
        : state.ready && !rows.chat.disabled ? 'Чат з продавцем доступний'
        : state.slow ? 'Підключення триває довше, ніж зазвичай'
        : state.sdkStarted ? 'Чат підключається' : '';
      if (chatStatus.textContent !== message) chatStatus.textContent = message;
    }
    if (!count && !chatConfigured()) closeMenu(false);
    root.hidden = ((!count && !chatConfigured()) || !styled());
    if (root.hidden && state.expanded) closeMenu(false);
  }

  function makeRow(name) {
    var isChat = name === 'chat';
    var item = node(isChat ? 'button' : 'a', 'bp-contact__channel bp-contact__channel--' + name);
    if (isChat) {
      item.type = 'button';
      item.addEventListener('click', function () {
        if (!state.ready || !window.$chatwoot || typeof window.$chatwoot.toggle !== 'function') {
          state.ready = false;
          syncVisible();
          return;
        }
        closeMenu(false);
        window.$chatwoot.toggle('open');
        trigger.focus();
      });
    } else {
      item.href = targetFor(name) || '#';
      if (name === 'phone') {
        item.setAttribute('aria-label', 'Зателефонувати, Київстар');
      } else if (name === 'viber') {
        item.setAttribute('aria-label', 'Відкрити Viber: BabyPark');
      } else {
        item.target = '_blank';
        item.rel = 'noopener noreferrer';
        item.setAttribute('aria-label', labels[name] + ', відкриється у новій вкладці');
      }
      item.addEventListener('click', function (e) {
        var current = targetFor(name);
        if (!current) { e.preventDefault(); syncVisible(); return; }
        item.href = current;
        closeMenu(false);
      });
    }
    item.appendChild(iconFor(name));
    if (isChat) {
      var textWrap = node('span', 'bp-contact__chat-copy');
      textWrap.appendChild(node('span', 'bp-contact__name', labels[name]));
      chatNote = node('span', 'bp-contact__chat-note');
      chatNote.hidden = true;
      textWrap.appendChild(chatNote);
      item.appendChild(textWrap);
      item.disabled = true;
      item.setAttribute('aria-disabled', 'true');
    } else {
      item.appendChild(node('span', 'bp-contact__name', labels[name]));
    }
    item.hidden = true;
    rows[name] = item;
    return item;
  }

  function initializeChatwoot() {
    // Variant B: first explicit menu-open only. No hover/prefetch/retries.
    if (state.sdkStarted || !chatConfigured()) return;
    state.sdkStarted = true;
    var token = config.websiteToken; // Public Website token, never an API secret.
    function clearDeadline() {
      if (readyTimer !== null) {
        window.clearTimeout(readyTimer);
        readyTimer = null;
      }
    }
    function fail() {
      clearDeadline();
      state.ready = false;
      state.slow = false;
      state.sdkFailed = true;
      syncVisible();
    }
    window.addEventListener('chatwoot:ready', function () {
      if (state.sdkFailed) return; // Explicit SDK failure stays fail-closed.
      if (!window.$chatwoot || typeof window.$chatwoot.toggle !== 'function') {
        fail();
        return;
      }
      clearDeadline();
      state.ready = true;
      state.slow = false;
      syncVisible();
      // Only the chat-only keyboard opener is eligible, once, while focus never left trigger.
      if (state.expanded && state.pendingChatFocus && !rows.chat.hidden && !rows.chat.disabled &&
          document.activeElement === trigger) {
        state.pendingChatFocus = false;
        rows.chat.focus();
      }
    });
    window.chatwootSettings = Object.assign({}, window.chatwootSettings || {}, {
      hideMessageBubble: true, locale: 'uk', showUnreadMessagesDialog: false
    });
    // A one-shot informational deadline; it does NOT abort SDK or make
    // a slow but valid later chatwoot:ready irrecoverable.
    readyTimer = window.setTimeout(function () {
      readyTimer = null;
      if (state.ready || state.sdkFailed) return;
      state.slow = true;
      syncVisible();
    }, 12000);
    var sdk = document.createElement('script');
    var sdkRun = false;
    sdk.async = true;
    sdk.src = chatOrigin + '/packs/js/sdk.js';
    sdk.onerror = fail;
    sdk.onload = function () {
      // Script.onload must not call the official SDK.run() more than once.
      if (state.sdkFailed || sdkRun) return;
      sdkRun = true;
      if (!window.chatwootSDK || typeof window.chatwootSDK.run !== 'function') return fail();
      try { window.chatwootSDK.run({ websiteToken: token, baseUrl: chatOrigin }); }
      catch (_) { fail(); }
    };
    try { document.head.appendChild(sdk); } catch (_) { fail(); }
  }

  function init() {
    if (!document.body || !config || document.getElementById(widgetId)) return;
    root = node('aside', 'bp-contact');
    root.id = widgetId;
    root.hidden = true;
    menu = node('div', 'bp-contact__menu');
    menu.id = widgetId + '-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'group');
    menu.setAttribute('aria-label', 'Способи зв’язку');
    var header = node('div', 'bp-contact__heading', 'Як Вам зручніше?');
    var menuClose = node('button', 'bp-contact__menu-close');
    menuClose.innerHTML = closeSvg;
    menuClose.type = 'button';
    menuClose.setAttribute('aria-label', 'Закрити меню');
    menuClose.addEventListener('click', function () { closeMenu(true); });
    header.appendChild(menuClose);
    menu.appendChild(header);
    var options = node('div', 'bp-contact__options');
    names.forEach(function (name) { options.appendChild(makeRow(name)); });
    menu.appendChild(options);
    chatStatus = node('p', 'bp-contact__chat-status');
    chatStatus.setAttribute('role', 'status');
    chatStatus.setAttribute('aria-live', 'polite');
    chatStatus.setAttribute('aria-atomic', 'true');
    menu.appendChild(chatStatus);
    trigger = node('button', 'bp-contact__trigger');
    trigger.type = 'button';
    trigger.setAttribute('aria-label', 'Зв’язатися з BabyPark');
    trigger.setAttribute('aria-controls', menu.id);
    trigger.setAttribute('aria-expanded', 'false');
    var openIcon = node('span', 'bp-contact__trigger-symbol');
    openIcon.innerHTML = '<svg width="24" height="24" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11.4a7.8 7.8 0 0 1-8.2 7.7 9.6 9.6 0 0 1-3.3-.65L4 20l1.38-4.03A7.8 7.8 0 1 1 20 11.4Z"/><path d="M8.1 11.4h.01m3.89 0h.01m3.89 0h.01" stroke-width="2.5"/></svg>';
    var closeIcon = node('span', 'bp-contact__trigger-close');
    closeIcon.innerHTML = closeSvg;
    closeIcon.setAttribute('aria-hidden', 'true');
    trigger.appendChild(openIcon);
    trigger.appendChild(closeIcon);
    trigger.appendChild(node('span', 'bp-contact__trigger-label', 'Зв’язатися'));
    trigger.addEventListener('click', function (event) {
      if (state.expanded) return closeMenu(true);
      syncVisible();
      if (root.hidden) return;
      state.expanded = true;
      // Pointer activation must not steal focus; keyboard/AT click has detail 0.
      state.openedFromKeyboard = event.detail === 0;
      state.pendingChatFocus = false;
      menu.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      initializeChatwoot();
      syncVisible();
      if (state.openedFromKeyboard) {
        var first = Array.prototype.find.call(options.children, function (item) {
          return !item.hidden && !item.disabled;
        });
        if (first) first.focus();
        else {
          // No enabled row: allow one ready-time focus only if keyboard focus stays here.
          state.pendingChatFocus = !rows.chat.hidden && rows.chat.disabled;
          trigger.focus();
        }
      }
    });
    root.appendChild(menu);
    root.appendChild(trigger);
    document.body.appendChild(root);
    // A return to the trigger must not revive stale auto-focus after visiting another control.
    document.addEventListener('focusin', function (e) {
      if (state.pendingChatFocus && e.target !== trigger) state.pendingChatFocus = false;
    });
    document.addEventListener('pointerdown', function (e) {
      if (state.expanded && !root.contains(e.target)) closeMenu(true);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.expanded) return closeMenu(true);
      // Menu precedes the launcher in DOM. Tab must still enter it after pointer opening.
      if (e.key === 'Tab' && !e.shiftKey && state.expanded && document.activeElement === trigger) {
        var first = Array.prototype.find.call(options.children, function (item) {
          return !item.hidden && !item.disabled;
        });
        e.preventDefault();
        (first || menuClose).focus();
      }
    });
    syncVisible();
    // CSS may load late; if missing entirely, remain hidden rather than unstyled.
    window.addEventListener('load', syncVisible);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
}());
