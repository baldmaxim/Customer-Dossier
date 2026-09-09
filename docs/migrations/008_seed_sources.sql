-- 008: стартовый список источников.
--
-- ВАЖНО: все записи заведены со status='paused'. Ни один источник не начнёт
-- опрашиваться, пока вы не проверите его вручную и не переключите в 'active'
-- (экран «Источники» в админке или SQL ниже). Причина: селекторы и сами адреса
-- надо подтвердить глазами, а Telegram-каналы вписать своими — угадывать
-- username каналов бессмысленно.
--
-- Добавить Telegram-канал:
--   INSERT INTO sources (kind, key, title, base_url, status)
--   VALUES ('telegram', 'имя_канала_без_собачки', 'Название', 'https://t.me/s/имя_канала_без_собачки', 'active');
-- Проверить, что канал публичный и читается: откройте https://t.me/s/<key> в браузере.
-- Если страница просит открыть в приложении — канал закрытый, используйте форвард-бота.
--
-- Включить проверенный источник:
--   UPDATE sources SET status = 'active' WHERE kind = 'website' AND key = 'kapital.kz';

INSERT INTO sources (kind, key, title, base_url, status, poll_interval_sec, config) VALUES
  ('website', 'kapital.kz',    'Kapital.kz — деловые новости',      'https://kapital.kz',    'paused', 1800, '{"section": "/business"}'::jsonb),
  ('website', 'inbusiness.kz', 'Inbusiness.kz — экономика',         'https://inbusiness.kz', 'paused', 1800, '{}'::jsonb),
  ('website', 'zakon.kz',      'Zakon.kz — новости и право',        'https://www.zakon.kz',  'paused', 1800, '{}'::jsonb),
  ('website', 'forbes.kz',     'Forbes Kazakhstan',                 'https://forbes.kz',     'paused', 3600, '{}'::jsonb),
  ('website', 'kn.kz',         'KN.kz — недвижимость',              'https://www.kn.kz',     'paused', 3600, '{}'::jsonb)
ON CONFLICT (kind, key) DO NOTHING;

-- Каналы ручного ввода: форвард-бот и форма вставки текста в портале.
-- Опросу не подлежат (poll_interval большой, status='active' безвреден —
-- шедулер пропускает kind='manual').
INSERT INTO sources (kind, key, title, status, poll_interval_sec) VALUES
  ('manual', 'bot',  'Форварды в Telegram-бота', 'active', 86400),
  ('manual', 'form', 'Ручная вставка текста',    'active', 86400)
ON CONFLICT (kind, key) DO NOTHING;
