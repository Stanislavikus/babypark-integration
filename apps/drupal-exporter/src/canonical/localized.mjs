import { SUPPORTED_AUTHORITY_LANGUAGES } from '../constants.mjs';
import { BLOCKER_CODES, Blocker } from '../blockers.mjs';

function optionalLocalizedText(value) {
  if (value == null) return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  return value;
}

export function resolveUrl(node, aliases, publicSiteUrl) {
  const matches = aliases.filter(a =>
    (a.language === node.language || a.language === 'und')
  );
  if (matches.length > 1) {
    return {
      error: new Blocker(
        BLOCKER_CODES.URL_ALIAS_MULTIPLE,
        'Multiple URL aliases for node/language',
        { nid: node.nid, language: node.language, aliases: matches }
      ),
    };
  }
  if (matches.length === 1) {
    const alias = matches[0].alias.startsWith('/')
      ? matches[0].alias
      : `/${matches[0].alias}`;
    return { url: `${publicSiteUrl}${alias}` };
  }
  return { url: `${publicSiteUrl}/node/${node.nid}` };
}

export function buildLocalized(translations, bodies, aliases, publicSiteUrl, blockers) {
  const localized = {};
  for (const node of translations) {
    if (!SUPPORTED_AUTHORITY_LANGUAGES.includes(node.language)) continue;
    const body = bodies.get(node.nid) ?? {};
    const urlResult = resolveUrl(node, aliases.get(node.nid) ?? [], publicSiteUrl);
    if (urlResult.error) {
      blockers.add(urlResult.error);
      continue;
    }
    const entry = {
      title: node.title,
      url: urlResult.url,
    };
    const shortDescription = optionalLocalizedText(body.summary);
    const description = optionalLocalizedText(body.value);
    if (shortDescription !== undefined) {
      entry.short_description = shortDescription;
    }
    if (description !== undefined) {
      entry.description = description;
    }
    localized[node.language] = entry;
  }
  return localized;
}
