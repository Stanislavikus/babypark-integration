/* L1 runtime configuration — copy into the CMS after verified channel tests.
 * A websiteToken is publicly embedded by Chatwoot itself, NOT an API access token.
 * Never put Chatwoot/Viber admin secrets, callback endpoints, or customer data here.
 * Keep each messenger disabled until a fresh visitor ↔ Chatwoot seller roundtrip.
 * Copy versioned icons into the same configured theme asset directory; set
 * assetBase to the absolute same-origin directory URL ending in '/'. It must
 * be set when Drupal aggregates/repackages JS or Magento bundles scripts.
 * Chatwoot SDK is lazy: opening the menu can create a Chatwoot Contact and
 * cw_conversation cookie even when the buyer then chooses another channel.
 */
window.BabyParkLauncherConfig = {
  assetBase: '', // e.g. '/sites/all/themes/babypark2/assets/contact/' — CMS-specific
  websiteToken: '', // Chatwoot → Inbox "BabyPark" → Configuration → Messenger script
  channels: {
    chat:     { enabled: false },
    telegram: { enabled: false, url: 'https://t.me/Babyparkua_bot' },
    whatsapp: { enabled: false, url: '' },
    viber:    { enabled: false, url: 'viber://pa?chatURI=babypark' },
    phone:    { enabled: true, url: 'tel:+380982908838' }
  }
};
