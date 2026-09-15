// Этап 05B без БД и сети: признаки web-preview, происхождение пересылки бота, возможности транспортов.

import { describe, it, expect } from 'vitest';

import { describeBotMessage, describeForwardOrigin } from '../telegramBot.js';
import { parseChannelPage } from '../telegramWeb.js';
import { BOT_CAPABILITIES, WEB_PREVIEW_CAPABILITIES } from './capabilities.js';

const wrap = (post: string, inner: string): string =>
  `<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="${post}"><div class="tgme_widget_message_bubble">${inner}</div></div></div>`;

describe('parseChannelPage — признаки этапа 05B', () => {
  it('правка, скрытый источник пересылки, альбом с подписью, канал из data-post', () => {
    const html = [
      wrap(
        'demo_chan/10',
        `<div class="tgme_widget_message_text">Срок сдачи перенесён на весну</div>
         <div class="tgme_widget_message_footer"><span class="tgme_widget_message_meta">edited <time datetime="2026-09-12T10:00:00+00:00"></time></span></div>`,
      ),
      wrap(
        'demo_chan/11',
        `<div class="tgme_widget_message_forwarded_from">Forwarded from <span class="tgme_widget_message_forwarded_from_name">Скрытый автор</span></div>
         <div class="tgme_widget_message_text">Пересланный текст без ссылки на источник</div>`,
      ),
      wrap(
        'demo_chan/12',
        `<div class="tgme_widget_message_grouped_wrap"><a class="tgme_widget_message_photo_wrap"></a><a class="tgme_widget_message_photo_wrap"></a></div>
         <div class="tgme_widget_message_text">Подпись к альбому</div>`,
      ),
      wrap(
        'demo_chan/13',
        `<div class="tgme_widget_message_forwarded_from">Forwarded from <a class="tgme_widget_message_forwarded_from_name" href="https://t.me/origin_chan/77">Origin</a></div>
         <div class="tgme_widget_message_text">Пересылка из канала со ссылкой</div>`,
      ),
    ].join('');
    const byId = new Map(parseChannelPage(html, 'demo_chan').posts.map(p => [p.postId, p]));

    expect(byId.get(10)).toMatchObject({ edited: true, channel: 'demo_chan', forward: null, completeness: 'full' });
    expect(byId.get(11)).toMatchObject({ edited: false, forwardFrom: null, forward: { name: 'Скрытый автор', username: null, messageId: null } });
    expect(byId.get(12)).toMatchObject({ completeness: 'caption_only', mediaGroupSize: 2 });
    expect(byId.get(13)).toMatchObject({ forwardFrom: 'origin_chan', forward: { name: 'Origin', username: 'origin_chan', messageId: 77 } });
  });
});

describe('форвард-бот — происхождение и полнота', () => {
  const base = { message_id: 5, chat: { id: 42, type: 'private' }, date: 1_790_000_000, from: { id: 7 } };

  it('скрытый автор — только имя и дата, без канала; не пересылка — null', () => {
    expect(describeForwardOrigin({ ...base, text: 'x', forward_origin: { type: 'hidden_user', sender_user_name: 'Иван', date: 1_789_000_000 } })).toEqual({
      type: 'hidden_user',
      chatId: null,
      username: null,
      title: null,
      senderName: 'Иван',
      messageId: null,
      date: 1_789_000_000,
    });
    expect(describeForwardOrigin({ ...base, text: 'x' })).toBeNull();
    expect(
      describeForwardOrigin({ ...base, text: 'x', forward_origin: { type: 'channel', chat: { id: -100, type: 'channel', username: 'src', title: 'Src' }, message_id: 9, date: 1 } }),
    ).toMatchObject({ type: 'channel', username: 'src', messageId: 9 });
  });

  it('подпись без вложения — полнота неизвестна, не full', () => {
    expect(describeBotMessage({ ...base, caption: 'Подпись без файла' })).toMatchObject({ completeness: 'unknown', attachments: [] });
  });
});

describe('возможности транспортов', () => {
  it('ни один транспорт не обещает историю и наблюдение удалений', () => {
    for (const cap of [WEB_PREVIEW_CAPABILITIES, BOT_CAPABILITIES]) {
      expect(cap.deletes.state).toBe('not_observable');
      expect(cap.history.state).not.toBe('supported');
      expect(cap.documentedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(WEB_PREVIEW_CAPABILITIES.editTimestamp.state).toBe('not_supported');
  });
});
