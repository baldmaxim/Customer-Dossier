-- Секреты, заданные в админке. Сейчас один — ключ OpenRouter (вкладка «Модель»).
--
-- Значение хранится только шифротекстом AES-256-GCM (settings/secretBox.ts). Ключ шифрования
-- выводится из пароля подключения к базе, а pg_dump роли и пароли не выгружает: дамп сам по себе
-- ключ OpenRouter не раскрывает. База, поднятая под другим паролем, ключ не расшифрует — его вводят
-- в админке заново. Открытым текстом — только последние четыре символа, чтобы было видно, какой
-- ключ задан, и кто и когда его задал.
--
-- Строка — настройка, а не история: новый ключ заменяет прежний, удаление в админке удаляет строку.

CREATE TABLE app_secrets (
  name        TEXT PRIMARY KEY,
  ciphertext  TEXT NOT NULL,
  hint        TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT NOT NULL,
  CONSTRAINT app_secrets_name_known CHECK (name IN ('openrouter_api_key')),
  CONSTRAINT app_secrets_hint_len CHECK (char_length(hint) <= 4)
);
