export function renderViberMessage(message = {}) {
  if (message.type === 'text') return message.text || '';
  if (message.type === 'picture') {
    return [message.text, message.media && `Фото: ${message.media}`]
      .filter(Boolean).join('\n');
  }
  if (message.type === 'video' || message.type === 'file') {
    return [message.file_name || 'Файл', message.media]
      .filter(Boolean).join(': ');
  }
  if (message.type === 'location') {
    return `Геолокація: ${message.location?.lat}, ${message.location?.lon}`;
  }
  if (message.type === 'contact') {
    return `Контакт: ${message.contact?.name || ''} ${message.contact?.phone_number || ''}`.trim();
  }
  if (message.type === 'sticker') {
    return `Стикер Viber #${message.sticker_id || ''}`;
  }
  return `[Viber message: ${message.type || 'unknown'}]`;
}

