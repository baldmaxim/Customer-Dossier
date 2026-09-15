-- 016: Telegram — журнал обработанных обновлений бота, транспортные метаданные наблюдения,
-- новые исходы запусков (отзыв допуска во время прохода, смена идентичности канала).
--
-- Только расширение и замена CHECK-ограничений на более широкие.

-- Обработанные обновления Bot API. update_id — транспортный offset, не бизнес-идентификатор
-- сообщения: запись сообщения и отметка обновления фиксируются одной транзакцией, повтор
-- того же обновления (после сбоя или перезапуска long polling) ничего не дублирует.
CREATE TABLE bot_processed_updates (
  update_id     BIGINT PRIMARY KEY,
  source_id     BIGINT NOT NULL REFERENCES sources(id),
  update_kind   TEXT NOT NULL CHECK (update_kind IN ('message', 'edited_message', 'other')),
  chat_id       BIGINT,
  message_id    BIGINT,
  outcome       TEXT NOT NULL CHECK (outcome IN ('inserted', 'duplicate', 'new_revision', 'unchanged', 'stale', 'too_short',
                                                 'edited_skipped', 'rejected_sender', 'rejected_empty', 'ignored')),
  revision_id   BIGINT REFERENCES document_revisions(id),
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX bot_processed_updates_source_idx ON bot_processed_updates (source_id, update_id DESC);

CREATE TRIGGER bot_processed_updates_append_only BEFORE UPDATE OR DELETE ON bot_processed_updates
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();

-- Что сообщил транспорт о наблюдении: канал и номер поста, признак правки, дата правки,
-- группа медиа, происхождение пересылки отдельно от переславшего. Недоступные поля не заполняются.
ALTER TABLE source_observations ADD COLUMN transport_meta JSONB;

ALTER TABLE sources DROP CONSTRAINT sources_health_check;
ALTER TABLE sources ADD CONSTRAINT sources_health_check
  CHECK (health IN ('unknown', 'ok', 'parser_degraded', 'rate_limited', 'blocked', 'error', 'config_invalid',
                    'identity_uncertain'));

ALTER TABLE source_runs DROP CONSTRAINT source_runs_outcome_check;
ALTER TABLE source_runs ADD CONSTRAINT source_runs_outcome_check
  CHECK (outcome IS NULL OR outcome IN ('ok', 'not_modified', 'partial', 'parser_degraded', 'rate_limited', 'blocked',
                                        'http_error', 'network', 'oversize', 'config_invalid', 'error',
                                        'policy_blocked', 'identity_changed', 'not_found', 'private'));
