-- Объекты застройщика с ДОМ.РФ (этап 20D): карточки застройщиков и групп компаний в едином реестре
-- застройщиков и найденные на них объекты — кандидаты, которые оператор подтверждает или отклоняет.
--
-- Обход каталога по-прежнему не делается (этап 20C): открываются только страница застройщика и страница
-- группы, на которые ссылается карточка объекта, уже подтверждённая оператором. Найденный объект сам
-- не собирается — он ждёт решения оператора; подтверждённый становится обычной ссылкой в domrf_targets.
--
-- Ссылок на компании и объекты портала здесь нет намеренно: заказчик находится по ИНН со страницы
-- застройщика при чтении, и слияние сущностей эти таблицы не задевает.

CREATE TABLE domrf_cards (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind            TEXT NOT NULL,
  external_ref    TEXT NOT NULL,
  url             TEXT NOT NULL,
  name            TEXT,
  -- Реквизиты — только у застройщика и только прошедшие формат; контрольную сумму проверяет код.
  inn             TEXT,
  ogrn            TEXT,
  -- У застройщика — его группа компаний (ссылка и название со страницы застройщика).
  group_ref       TEXT,
  group_name      TEXT,
  -- Объекты, которые страница перечисляла при последнем чтении.
  object_refs     TEXT[] NOT NULL DEFAULT '{}',
  scanned_at      TIMESTAMPTZ,
  next_scan_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT domrf_cards_kind CHECK (kind IN ('developer', 'group')),
  CONSTRAINT domrf_cards_ref CHECK (external_ref ~ '^[0-9]{1,18}$'),
  CONSTRAINT domrf_cards_group_ref CHECK (group_ref IS NULL OR group_ref ~ '^[0-9]{1,18}$'),
  CONSTRAINT domrf_cards_unique UNIQUE (kind, external_ref)
);

CREATE INDEX domrf_cards_due_idx ON domrf_cards (next_scan_at, id);

CREATE TABLE domrf_candidates (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_ref     TEXT NOT NULL UNIQUE,
  url              TEXT NOT NULL,
  -- Как объект назван в списке застройщика или группы, и статус с адресом оттуда же.
  label            TEXT,
  details          TEXT,
  found_via_kind   TEXT NOT NULL,
  found_via_ref    TEXT NOT NULL,
  state            TEXT NOT NULL DEFAULT 'pending',
  decided_by       TEXT,
  decided_at       TIMESTAMPTZ,
  decision_note    TEXT,
  -- «Заменить»: ссылка на правильную карточку, которую оператор указал вместо найденной.
  replacement_ref  TEXT,
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT domrf_candidates_ref CHECK (external_ref ~ '^[0-9]{1,18}$'),
  CONSTRAINT domrf_candidates_via CHECK (found_via_kind IN ('developer', 'group')),
  CONSTRAINT domrf_candidates_state CHECK (state IN ('pending', 'confirmed', 'rejected', 'replaced')),
  CONSTRAINT domrf_candidates_decided CHECK ((state = 'pending') = (decided_at IS NULL))
);

CREATE INDEX domrf_candidates_pending_idx ON domrf_candidates (found_via_kind, found_via_ref, external_ref)
  WHERE state = 'pending';

-- Ссылки карточки объекта на застройщика и группу — по ним работник открывает их страницы.
ALTER TABLE domrf_targets
  ADD COLUMN developer_ref TEXT,
  ADD COLUMN group_ref TEXT;

-- Уже снятые карточки снимаются ещё раз: ссылок на застройщика у них нет, а без них
-- не найти ни реквизитов застройщика, ни остальных его объектов.
UPDATE domrf_targets SET requested_at = now(), next_attempt_at = NULL, updated_at = now()
WHERE developer_ref IS NULL;
