-- Индексы реестра под «Новое» (07.10.2026): переносы сроков домов ДОМ.РФ берут снимки окна и по одному последнему
-- снимку до окна на дом (news/feed.ts, SHIFTS_SQL). Без них окно выбиралось полным просмотром registry_records,
-- а «последний до окна» — по каждому дому заново.

CREATE INDEX IF NOT EXISTS registry_records_object_fetched_idx
  ON registry_records (fetched_at) WHERE record_type = 'object';

CREATE INDEX IF NOT EXISTS registry_records_object_ref_idx
  ON registry_records (source_id, external_ref, fetched_at DESC, id DESC) WHERE record_type = 'object';
