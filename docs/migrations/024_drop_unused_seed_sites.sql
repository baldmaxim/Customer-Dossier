-- 024: убрать сид-сайты, которыми никто не пользовался.
--
-- Миграции 008 и 009 заводили девять сайтов-заготовок: пять казахстанских
-- (рынок РК, от которого отказались в 009) и четыре российских. Это были
-- подсказки «откуда можно читать», а не решение о сборе: допуск у них
-- не подтверждён, профиля нет, ни одного документа по ним не собрано.
-- На новой установке они создают ложное впечатление, что портал уже с чем-то
-- работает, и их приходится удалять руками после каждой миграции.
--
-- Удаляем только нетронутые: нет публикаций, документов, наблюдений и запусков,
-- допуск и ИИ-обработка остались `unknown`, статус — `paused`, курсор пуст,
-- ни одного успешного или неуспешного обращения не было.
-- Если источник хоть раз читали, одобряли или ставили на расписание — он
-- остаётся: удалить источник с документами значит разорвать цепочку
-- «утверждение → доказательство → источник».
--
-- Вернуть любой из них можно без миграции:
--   npm run ingest:once -- --add-site https://stroygaz.ru
-- `bot` и `form` не трогаем: это ручная вставка и форварды, они в сеть не ходят.

DELETE FROM sources s
WHERE s.kind = 'website'
  AND s.key IN (
    'kapital.kz', 'inbusiness.kz', 'zakon.kz', 'forbes.kz', 'kn.kz',
    'erzrf.ru', 'stroygaz.ru', 'realty.rbc.ru', 'interfax.ru'
  )
  AND s.status = 'paused'
  AND s.access_status = 'unknown'
  AND s.ai_processing_status = 'unknown'
  AND s.last_ok_at IS NULL
  AND s.last_attempt_at IS NULL
  AND s.fail_streak = 0
  AND s.cursor = '{}'::jsonb
  AND NOT EXISTS (SELECT 1 FROM raw_documents d WHERE d.source_id = s.id)
  AND NOT EXISTS (SELECT 1 FROM source_items i WHERE i.source_id = s.id)
  AND NOT EXISTS (SELECT 1 FROM source_observations o WHERE o.source_id = s.id)
  AND NOT EXISTS (SELECT 1 FROM source_runs r WHERE r.source_id = s.id);
