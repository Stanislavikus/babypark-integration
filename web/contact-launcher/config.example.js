/* L1 runtime configuration — copy into the CMS after verified channel tests.
 * A websiteToken is publicly embedded by Chatwoot itself, NOT an API access token.
 * Never put Chatwoot/Viber admin secrets, callback endpoints, or customer data here.
 * Keep each messenger disabled until a fresh visitor ↔ Chatwoot seller roundtrip.
 */
window.BabyParkLauncherConfig = {
  websiteToken: '', // Chatwoot → Inbox "BabyPark" → Configuration → Messenger script
  channels: {
    chat:     { enabled: false },
    telegram: { enabled: false, url: 'https://t.me/Babyparkua_bot' },
    whatsapp: { enabled: false, url: '' },
    viber:    { enabled: false, url: 'viber://pa?chatURI=babypark' },
    phone:    { enabled: true, url: 'tel:+380982908838' }
  }
};
