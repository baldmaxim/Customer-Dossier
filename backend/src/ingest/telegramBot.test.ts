// TC-016 для форвард-бота: подпись к медиа не считается полным текстом.

import { describe, it, expect } from 'vitest';

import { describeBotMessage } from './telegramBot.js';

const base = { message_id: 1, chat: { id: 10, type: 'private' }, date: 1_790_000_000 };

describe('describeBotMessage', () => {
  it('текстовое сообщение — full', () => {
    expect(describeBotMessage({ ...base, text: '  Текст новости  ' })).toEqual({
      body: 'Текст новости',
      completeness: 'full',
      completenessReason: 'bot_message_text',
      attachments: [],
    });
  });

  it('документ с подписью — caption_only, файл не прочитан', () => {
    const result = describeBotMessage({ ...base, caption: 'Скан письма подрядчика', document: { file_id: 'x' } });
    expect(result.completeness).toBe('caption_only');
    expect(result.attachments).toEqual([{ kind: 'document', status: 'unsupported' }]);
  });

  it('фото без подписи — пустой текст, полнота не full', () => {
    const result = describeBotMessage({ ...base, photo: [{}] });
    expect(result.body).toBe('');
    expect(result.completeness).toBe('caption_only');
  });
});
