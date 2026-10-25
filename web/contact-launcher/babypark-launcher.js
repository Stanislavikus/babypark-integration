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
  var names = ['chat', 'telegram', 'whatsapp', 'viber', 'phone', 'callback'];
  var labels = {
    chat: 'Чат з продавцем',
    telegram: 'Telegram',
    whatsapp: 'WhatsApp',
    viber: 'Viber',
    phone: 'Зателефонувати',
    callback: 'Замовити дзвінок'
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
  var state = {
    ready: false, expanded: false, sdkStarted: false, sdkFailed: false, slow: false,
    requestedChat: false, callbackView: false, callbackPending: false, callbackSent: false, callbackUncertain: false, callbackRejected: false
  };
  var readyTimer = null;
  var root, menu, trigger, chatStatus, chatNote, rows = {};
  var options, formPanel, phoneField, phoneHint, nameField, messageField, callbackSubmit, callbackInfo;
  var callbackSuccess, menuTitle, brandHeader, menuClose;
  var successTimer = null;
  var previousLocalPhone = '';
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
    if (name === 'callback') {
      // Ring-free Lucide handset, 0.95 optical scale inside the shared 24px grid.
      span.innerHTML = '<svg width="24" height="24" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path transform="translate(12 12) scale(0.95) translate(-12 -12)" d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.96.35 1.9.68 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.25a2 2 0 0 1 2.11-.45c.91.33 1.85.56 2.81.68A2 2 0 0 1 22 16.92z"/></svg>';
    } else if (name === 'chat') {
      // Approved BabyPark V4 chat bubble, optically balanced inside the 24px grid.
      span.innerHTML = '<svg width="24" height="24" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><g transform="translate(12 12) scale(1.12) translate(-12 -12)"><path d="M20 11.4a7.8 7.8 0 0 1-8.2 7.7 9.6 9.6 0 0 1-3.3-.65L4 20l1.38-4.03A7.8 7.8 0 1 1 20 11.4Z"/><path d="M8.1 11.4h.01m3.89 0h.01m3.89 0h.01" stroke-width="2.5"/></g></svg>';
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

  function cancelSuccessTimer() {
    if (successTimer !== null) window.clearTimeout(successTimer);
    successTimer = null;
  }

  function setCallbackAppearance(active) {
    if (!menu) return;
    menu.className = active ? 'bp-contact__menu bp-contact__menu--callback' : 'bp-contact__menu';
    if (menuTitle) menuTitle.hidden = !!active;
    if (brandHeader) brandHeader.hidden = !active;
    if (menuClose) menuClose.setAttribute('aria-label', active ? 'Закрити вікно' : 'Закрити меню');
  }

  function closeMenu(restoreFocus) {
    if (!menu) return;
    if (state.callbackPending) return; // Never hide an in-flight request.
    cancelSuccessTimer();
    state.callbackView = false;
    state.requestedChat = false;
    if (formPanel) formPanel.hidden = true;
    if (options) options.hidden = false;
    setCallbackAppearance(false);
    state.expanded = false;
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
  }

  function chatConfigured() {
    return !!(channelConfig('chat') && config && typeof config.websiteToken === 'string' &&
      /^[a-zA-Z0-9_-]{8,128}$/.test(config.websiteToken));
  }

  function callbackConfigured() {
    return !!(channelConfig('callback') && chatConfigured() && window.location &&
      /^https:\/\/(?:www\.)?babypark\.ua$/.test(new URL(window.location.href).origin));
  }

  function localPhoneDigits(raw) {
    // +380 is already fixed on screen. Strip a visitor's repeated country
    // code (or national trunk 0) AS SOON AS THEY TYPE IT, rather than only
    // when all 12/10 digits are present. Otherwise the input freezes on
    // "380xxxxxx" at nine digits and silently sends the wrong recipient.
    var digits = String(raw || '').replace(/[^0-9]/g, '');
    if (digits.slice(0, 3) === '380') digits = digits.slice(3);
    else if (digits.charAt(0) === '0') digits = digits.slice(1);
    // Never truncate an ambiguous foreign/overlong number into another one.
    return digits.length <= 9 ? digits : '';
  }

  function normalizePhone(raw) {
    if (typeof raw !== 'string' || raw.length > 30) return null;
    var digits = localPhoneDigits(raw);
    // A valid Ukrainian NSN cannot begin with the trunk prefix 0, nor
    // 1/2; this validates number shape, not carrier allocation/ownership.
    return /^[3-9][0-9]{8}$/.test(digits) ? '+380' + digits : null;
  }

  function optionalCallbackName(raw) {
    // A name is plain single-line text, not a verified identity. Preserve
    // international letters, apostrophes, hyphens, and preferred spelling.
    // Normalize line/control characters so input cannot forge message rows.
    if (typeof raw !== 'string') return '';
    return raw.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
      .replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  function getWidgetJwt() {
    // The official Website SDK sets cw_conversation on the first-party site.
    // The JWT is a visitor identity, NOT a server-side credential.
    var parts = document.cookie ? document.cookie.split(';') : [];
    var value = null;
    parts.forEach(function (part) {
      var kv = part.trim();
      if (kv.indexOf('cw_conversation=') === 0) {
        try { value = decodeURIComponent(kv.slice('cw_conversation='.length)); }
        catch (_) { value = null; }
      }
    });
    return value && value.length < 4096 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
      ? value : null;
  }

  function syncCallback() {
    if (!formPanel) return;
    var digits = phoneField ? localPhoneDigits(phoneField.value) : '';
    var valid = digits.length === 9 && !!normalizePhone(phoneField.value);
    callbackSubmit.disabled = !valid || !state.ready || state.sdkFailed ||
      state.callbackPending || state.callbackSent || state.callbackUncertain || !getWidgetJwt();
    if (phoneHint) {
      var remaining = 9 - digits.length;
      phoneHint.textContent = remaining === 0 ? 'Номер заповнено'
        : remaining === 9 ? 'Введіть 9 цифр номера'
        : 'Залишилося ввести ' + remaining + ' ' +
          (remaining === 1 ? 'цифру' : remaining <= 4 ? 'цифри' : 'цифр');
    }
    if (!state.callbackPending && !state.callbackSent && !state.callbackUncertain && !state.callbackRejected && callbackInfo) {
      if (state.sdkFailed) callbackInfo.textContent = 'Зараз не вдається підключитися. Спробуйте зателефонувати.';
      else if (!state.ready || !getWidgetJwt()) callbackInfo.textContent = 'Підключення до чату…';
      else callbackInfo.textContent = '';
    }
  }

  function showCallbackSuccess() {
    cancelSuccessTimer();
    formPanel.className = 'bp-contact__callback-form bp-contact__callback-form--success';
    callbackSuccess.hidden = false;
    callbackSuccess.focus();
    // Display a confirmed result long enough to read. A missing/uncertain
    // acknowledgement NEVER starts this timer and NEVER permits a retry.
    successTimer = window.setTimeout(function () {
      successTimer = null;
      if (state.callbackSent && state.callbackView && state.expanded && !state.callbackPending)
        closeMenu(true);
    }, 3500);
  }

  function openCallback() {
    if (!callbackConfigured()) return;
    state.callbackView = true;
    setCallbackAppearance(true);
    formPanel.hidden = false;
    options.hidden = true;
    formPanel.className = 'bp-contact__callback-form';
    callbackSuccess.hidden = true;
    // A successful or uncertain send is terminal for this browser page,
    // even after Close/reopen. Never silently submit a duplicate.
    if (state.callbackSent || state.callbackUncertain) {
      phoneField.disabled = true;
      nameField.disabled = true;
      messageField.disabled = true;
      callbackInfo.textContent = state.callbackSent
        ? 'Заявку успішно надіслано. Ми зателефонуємо Вам.'
        : 'Не вдалося підтвердити надсилання. Щоб уникнути дублювання, зателефонуйте нам.';
      syncCallback();
      if (state.callbackSent) showCallbackSuccess();
      else menuClose.focus();
      return;
    }
    state.callbackRejected = false;
    callbackInfo.textContent = '';
    phoneField.disabled = false;
    nameField.disabled = false;
    messageField.disabled = false;
    phoneField.value = '';
    previousLocalPhone = '';
    nameField.value = '';
    messageField.value = '';
    initializeChatwoot();
    syncCallback();
    phoneField.focus();
  }

  async function submitCallback() {
    if (state.callbackPending || state.callbackSent || state.callbackUncertain || !callbackConfigured()) return;
    var phone = normalizePhone(phoneField.value);
    var preferredName = optionalCallbackName(nameField.value);
    var comment = messageField.value.trim();
    var jwt = getWidgetJwt();
    if (!phone || comment.length > 500 || !state.ready || !jwt || typeof window.fetch !== 'function') {
      callbackInfo.textContent = 'Перевірте номер телефону та з’єднання.';
      return;
    }
    state.callbackRejected = false;
    state.callbackPending = true;
    syncCallback();
    callbackInfo.textContent = 'Надсилаємо заявку…';
    var marker = 'BABYPARK_CALLBACK_V1';
    var content = marker + '\nЗворотний дзвінок: ' + phone +
      (preferredName ? '\nІм’я: ' + preferredName : '') +
      (comment ? '\nПовідомлення: ' + comment : '');
    var url = chatOrigin + '/api/v1/widget/messages?website_token=' +
      encodeURIComponent(config.websiteToken);
    var deadline = null;
    var abortController = null;
    try {
      if (typeof window.AbortController === 'function') abortController = new window.AbortController();
    } catch (_) { abortController = null; } // Timer still bounds failure when abort is unsupported.
    try {
      // Include the response body in the bounded 15s ACK deadline.
      // Timeout and abort DO NOT prove server rollback: never retry automatically.
      var timeLimit = new Promise(function (_resolve, reject) {
        deadline = window.setTimeout(function () {
          if (abortController) {
            try { abortController.abort(); } catch (_) { /* Still reject as unknown commit. */ }
          }
          reject(new Error('callback-ack-timeout'));
        }, 15000);
      });
      var attempt = (async function () {
        var options = {
          method: 'POST', mode: 'cors', credentials: 'omit', redirect: 'error',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Auth-Token': jwt },
          body: JSON.stringify({
            message: { content: content },
            custom_attributes: { callback_phone: phone }, labels: ['callback']
          })
        };
        if (abortController) options.signal = abortController.signal;
        var response = await window.fetch(url, options);
        if (!response || response.status !== 200) {
          // The v4.18.0 Widget route rejects these requests before message save.
          // Do not retry automatically; allow an explicit new attempt only on proven 4xx rejects.
          if (response && [403, 422, 429].indexOf(response.status) !== -1) {
            var rejection = new Error('widget-rejected');
            rejection.definiteReject = true;
            rejection.status = response.status;
            throw rejection;
          }
          throw new Error('not-accepted');
        }
        return response.json();
      }());
      var data = await Promise.race([attempt, timeLimit]);
      if (!data || !Number.isSafeInteger(data.id) || data.id <= 0 ||
          !Number.isSafeInteger(data.conversation_id) || data.conversation_id <= 0) {
        throw new Error('ambiguous-ack');
      }
      state.callbackSent = true;
      phoneField.disabled = true;
      nameField.disabled = true;
      messageField.disabled = true;
      callbackInfo.textContent = 'Заявку успішно надіслано. Ми зателефонуємо Вам.';
      showCallbackSuccess();
    } catch (err) {
      if (err && err.definiteReject === true) {
        // No message was accepted; a deliberate later retry is allowed.
        state.callbackRejected = true;
        callbackInfo.textContent = err.status === 429
          ? 'Забагато спроб. Спробуйте пізніше або зателефонуйте нам.'
          : 'Заявку не прийнято. Спробуйте ще раз або зателефонуйте нам.';
      } else {
        // Network / timeout / server error / invalid ACK may mean committed send.
        // Never retry automatically or enable another submit in this page session.
        state.callbackUncertain = true;
        callbackInfo.textContent = 'Не вдалося підтвердити надсилання. Щоб уникнути дублювання, зателефонуйте нам.';
      }
    } finally {
      if (deadline !== null) window.clearTimeout(deadline);
      state.callbackPending = false;
      syncCallback();
    }
  }

  function styled() {
    return !!(window.getComputedStyle && window.getComputedStyle(root).position === 'fixed');
  }

  function syncVisible() {
    if (!root) return;
    var count = 0;
    names.forEach(function (name) {
      var configured = name === 'chat' ? chatConfigured()
        : name === 'callback' ? callbackConfigured() : !!targetFor(name);
      var available = name === 'chat'
        ? !!(configured && !state.sdkFailed && (!state.ready ||
            (window.$chatwoot && typeof window.$chatwoot.toggle === 'function')))
        : configured;
      // A configured Website row ALWAYS occupies its final slot, even while
      // loading, after 12s or after failure. It is never clickable before ready.
      rows[name].hidden = !configured;
      if (name === 'chat') {
        rows.chat.disabled = !available;
        rows.chat.setAttribute('aria-disabled', available ? 'false' : 'true');
        if (chatNote) {
          chatNote.textContent = state.sdkFailed ? 'Чат тимчасово недоступний'
            : state.slow && !state.ready ? 'Підключення триває довше, ніж зазвичай' : '';
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
    syncCallback();
  }

  function makeRow(name) {
    var isChat = name === 'chat';
    var isCallback = name === 'callback';
    var item = node(isChat || isCallback ? 'button' : 'a', 'bp-contact__channel bp-contact__channel--' + name);
    if (isChat || isCallback) {
      item.type = 'button';
      item.addEventListener('click', function () {
        if (isCallback) { openCallback(); return; }
        if (!chatConfigured() || state.sdkFailed) return;
        if (!state.ready || !window.$chatwoot || typeof window.$chatwoot.toggle !== 'function') {
          state.requestedChat = true;
          initializeChatwoot();
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
    // L2: initialize ONLY after a deliberate chat or callback selection.
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
      if (state.requestedChat) {
        state.requestedChat = false;
        if (window.$chatwoot && typeof window.$chatwoot.toggle === 'function') {
          closeMenu(false);
          window.$chatwoot.toggle('open');
          trigger.focus();
        }
      }
      syncCallback();
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
    var header = node('div', 'bp-contact__heading');
    menuTitle = node('span', 'bp-contact__heading-title', 'Як Вам зручніше?');
    header.appendChild(menuTitle);
    brandHeader = node('div', 'bp-contact__brand');
    brandHeader.hidden = true;
    var brandAvatar = node('span', 'bp-contact__brand-avatar', 'babypark');
    brandAvatar.setAttribute('aria-hidden', 'true');
    var brandCopy = node('span', 'bp-contact__brand-copy');
    brandCopy.appendChild(node('span', 'bp-contact__brand-name', 'BabyPark'));
    brandCopy.appendChild(node('span', 'bp-contact__brand-status', labels.callback));
    brandHeader.appendChild(brandAvatar);
    brandHeader.appendChild(brandCopy);
    header.appendChild(brandHeader);
    menuClose = node('button', 'bp-contact__menu-close');
    menuClose.innerHTML = closeSvg;
    menuClose.type = 'button';
    menuClose.setAttribute('aria-label', 'Закрити меню');
    menuClose.addEventListener('click', function () { closeMenu(true); });
    header.appendChild(menuClose);
    menu.appendChild(header);
    options = node('div', 'bp-contact__options');
    names.forEach(function (name) { options.appendChild(makeRow(name)); });
    menu.appendChild(options);
    formPanel = node('form', 'bp-contact__callback-form');
    formPanel.hidden = true;
    formPanel.setAttribute('aria-label', labels.callback);
    formPanel.appendChild(node('p', 'bp-contact__callback-caption', 'Залиште номер для зв’язку'));
    var phoneLabel = node('label', 'bp-contact__callback-label', 'Номер телефону *');
    var phoneWrap = node('span', 'bp-contact__callback-phone-wrap');
    var countryPrefix = node('span', 'bp-contact__callback-prefix', '+380');
    countryPrefix.setAttribute('aria-hidden', 'true');
    phoneWrap.appendChild(countryPrefix);
    phoneField = node('input', 'bp-contact__callback-input bp-contact__callback-phone-input');
    phoneField.type = 'tel';
    phoneField.inputMode = 'numeric';
    phoneField.autocomplete = 'tel-national';
    // Allow full international/local numbers to be pasted before normalizing
    // them to nine visible digits. A 9-char HTML maxlength would truncate
    // +380.../0... before the input handler sees the original country prefix.
    phoneField.maxLength = 30;
    phoneField.pattern = '[0-9]{9}';
    phoneField.placeholder = 'XX XXX XX XX';
    phoneField.required = true;
    phoneField.setAttribute('aria-label', '9 цифр номера телефону після +380');
    phoneHint = node('span', 'bp-contact__callback-phone-hint', 'Введіть 9 цифр номера');
    phoneHint.id = widgetId + '-phone-hint';
    phoneHint.setAttribute('aria-live', 'polite');
    phoneField.setAttribute('aria-describedby', phoneHint.id);
    phoneWrap.appendChild(phoneField);
    phoneLabel.appendChild(phoneWrap);
    phoneLabel.appendChild(phoneHint);
    formPanel.appendChild(phoneLabel);
    var nameLabel = node('label', 'bp-contact__callback-label', 'Ім’я (необов’язково)');
    nameField = node('input', 'bp-contact__callback-input bp-contact__callback-name');
    nameField.type = 'text';
    nameField.maxLength = 80;
    nameField.autocomplete = 'given-name';
    nameField.spellcheck = false;
    nameLabel.appendChild(nameField);
    formPanel.appendChild(nameLabel);
    var commentLabel = node('label', 'bp-contact__callback-label', 'Повідомлення (необов’язково)');
    messageField = node('textarea', 'bp-contact__callback-input bp-contact__callback-textarea');
    messageField.maxLength = 500;
    messageField.rows = 3;
    messageField.placeholder = 'За бажанням, напишіть причину звернення';
    commentLabel.appendChild(messageField);
    formPanel.appendChild(commentLabel);
    callbackSubmit = node('button', 'bp-contact__callback-submit', 'Замовити дзвінок');
    callbackSubmit.type = 'submit';
    callbackSubmit.disabled = true;
    formPanel.appendChild(callbackSubmit);
    callbackInfo = node('p', 'bp-contact__callback-status');
    callbackInfo.setAttribute('role', 'status');
    callbackInfo.setAttribute('aria-live', 'polite');
    formPanel.appendChild(callbackInfo);
    callbackSuccess = node('div', 'bp-contact__callback-success');
    callbackSuccess.hidden = true;
    callbackSuccess.setAttribute('role', 'status');
    callbackSuccess.setAttribute('aria-live', 'polite');
    callbackSuccess.setAttribute('tabindex', '-1');
    callbackSuccess.appendChild(node('span', 'bp-contact__callback-success-icon', '✓'));
    callbackSuccess.appendChild(node('p', 'bp-contact__callback-success-title',
      'Заявку успішно надіслано. Ми зателефонуємо Вам.'));
    callbackSuccess.appendChild(node('p', 'bp-contact__callback-success-caption',
      'Вікно закриється автоматично'));
    formPanel.appendChild(callbackSuccess);
    phoneField.addEventListener('input', function () {
      var raw = phoneField.value;
      var normalized = localPhoneDigits(raw);
      // Reject an ambiguous overlong paste; do not clear a correctly typed
      // nine-digit value when one extra digit is pressed.
      if (!normalized && raw.replace(/[^0-9]/g, '').length > 9)
        normalized = previousLocalPhone;
      phoneField.value = normalized;
      previousLocalPhone = normalized;
      syncCallback();
    });
    messageField.addEventListener('input', syncCallback);
    formPanel.addEventListener('submit', function (event) {
      if (event && event.preventDefault) event.preventDefault();
      submitCallback();
    });
    menu.appendChild(formPanel);
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
    trigger.addEventListener('click', function () {
      if (state.expanded) return closeMenu(true);
      syncVisible();
      if (root.hidden) return;
      state.expanded = true;
      menu.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      // Opening the general menu never creates a Chatwoot contact/cookie.
      syncVisible();
      var first = Array.prototype.find.call(options.children, function (item) {
        return !item.hidden && !item.disabled;
      });
      if (first) first.focus();
      else trigger.focus(); // chat-only pending SDK: retain an accessible anchor
    });
    root.appendChild(menu);
    root.appendChild(trigger);
    document.body.appendChild(root);
    document.addEventListener('pointerdown', function (e) {
      if (state.expanded && !root.contains(e.target)) closeMenu(true);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.expanded) closeMenu(true);
    });
    syncVisible();
    // CSS may load late; if missing entirely, remain hidden rather than unstyled.
    window.addEventListener('load', syncVisible);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
}());
