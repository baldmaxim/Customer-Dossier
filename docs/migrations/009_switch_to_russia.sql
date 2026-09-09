-- 009: переход с рынка Казахстана на рынок России.
--
-- Изначально портал строился под РК: идентификатором компании был БИН
-- (ровно 12 цифр), суммы хранились в тенге. Для России нужны другие
-- идентификаторы — ИНН (10 цифр у юрлица, 12 у ИП), ОГРН (13), ОГРНИП (15).
--
-- Колонку переименовываем, а не заводим рядом новую: колонка с именем bin,
-- хранящая ИНН, — ровно та ложь в схеме, которая через полгода стоит вечера
-- разбирательств.

-- Ограничения снимаем до смены типа: CHECK ссылается на колонку по имени.
ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_bin_fmt;
DROP INDEX IF EXISTS companies_bin_uidx;

ALTER TABLE companies RENAME COLUMN bin TO tax_id;
ALTER TABLE companies ALTER COLUMN tax_id TYPE VARCHAR(15) USING trim(tax_id);

-- ИНН 10 или 12 цифр, ОГРН 13, ОГРНИП 15. Казахстанский БИН (12) под правило
-- тоже подходит — пересланный пост про РК не сломает запись.
ALTER TABLE companies
  ADD CONSTRAINT companies_tax_id_fmt
  CHECK (tax_id IS NULL OR tax_id ~ '^([0-9]{10}|[0-9]{12}|[0-9]{13}|[0-9]{15})$');

CREATE UNIQUE INDEX companies_tax_id_uidx ON companies (tax_id)
  WHERE tax_id IS NOT NULL AND merged_into_id IS NULL;

-- Суммы теперь в рублях. Валюту оставляем в имени колонки: нейтральное
-- amount рано или поздно прочитают как «в чём-то».
ALTER TABLE events RENAME COLUMN amount_kzt TO amount_rub;

-- Ранее собранные суммы были размечены как тенге. Их немного, и достоверно
-- пересчитать нельзя — обнуляем, чтобы в карточке не висели неверные цифры.
-- Сами события остаются: факт «был контракт» ценнее потерянной суммы.
UPDATE events SET amount_rub = NULL WHERE amount_rub IS NOT NULL;

-- Источники. Казахстанские сайты снимаем с опроса: они по-прежнему в базе,
-- но больше не относятся к делу. Российские заводим так же на паузе —
-- включать только после проверки, что парсер видит их вёрстку.
UPDATE sources SET status = 'paused', updated_at = now()
WHERE kind = 'website' AND key IN ('kapital.kz', 'inbusiness.kz', 'zakon.kz', 'forbes.kz', 'kn.kz');

INSERT INTO sources (kind, key, title, base_url, status, poll_interval_sec, config) VALUES
  ('website', 'erzrf.ru',   'ЕРЗ.РФ — единый ресурс застройщиков', 'https://erzrf.ru',       'paused', 1800, '{}'::jsonb),
  ('website', 'stroygaz.ru','Строительная газета',                 'https://stroygaz.ru',    'paused', 1800, '{}'::jsonb),
  ('website', 'realty.rbc.ru','РБК Недвижимость',                  'https://realty.rbc.ru',  'paused', 1800, '{}'::jsonb),
  ('website', 'interfax.ru','Интерфакс',                           'https://www.interfax.ru','paused', 3600, '{}'::jsonb)
ON CONFLICT (kind, key) DO NOTHING;
