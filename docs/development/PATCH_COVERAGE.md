# Покрытие исправлений reviewed-патча и рисков R01–R20

Дата: 2026-09-11. Основание: `prompts/Customer_Dossier_Prompts/reference/ORIGINAL_REVIEW_2026-09-11.md`,
`reference/REPOSITORY_MAP.md` и **чтение рабочих файлов** на HEAD `6431a5b`.
Сам reviewed-архив и `.patch` в рабочей папке отсутствуют — сверка по описанию исправлений, не по diff.

## Вывод о происхождении дерева

- 111 отслеживаемых файлов — столько же, сколько в `Customer-Dossier-main.zip` по review. HEAD = `origin/main`
  (`github.com/baldmaxim/Customer-Dossier`), рабочее дерево чистое.
- Признаков reviewed-копии нет: отсутствуют `backend/scripts/offline-regression.mjs`, `static-audit.mjs`,
  `TEST_REPORT.md`, `src/metrics/cli.ts`, `llm/vocabulary.ts`, `resolve/identity.ts`, `pipeline/chunks.ts`;
  схема извлечения `extract@2` (reviewed вводил `extract@3`); `app.listen` без host.
- **Классификация: исходный main (вероятно, тот же снимок) + собственная история коммитов. Reviewed-патч не установлен.**
  Точное совпадение с main.zip по хешу не проверено (архива нет) — статус «вероятно».

Статусы — про **исправление** из reviewed-патча (не про дефект):
`present` — исправление есть; `missing` — нет; `partial` — частично; `superseded` — решено иначе;
`not_applicable` — неприменимо.

## R01–R20

| ID | P | Статус исправления | Фактическое место в рабочем дереве | Этап |
|---|---|---|---|---|
| R01 | P0 | **missing** | `backend/src/resolve/company.ts:267-279` точный alias и `:282-290` name_key возвращают `LIMIT 1` без проверки ИНН/ОГРН и формы; конфликт реквизитов проверяется только в скоринге `:184-187`. Дополнительно: ИНН и ОГРН одной компании в одной колонке `tax_id` дают ложный «конфликт» (`:184`) | 01 адресно; 04 полностью |
| R02 | P0 | **missing** | `backend/src/resolve/project.ts:225-236` alias без проверки города; `:246-249` key-путь принимает неизвестный город как совпадение (`!input.city \|\| !keyRow.city`) | 01 адресно; 04 |
| R03 | P0 | **missing** | `backend/src/llm/schema.ts:112-125` у `links` нет `quote`; `pipeline/verify.ts:350-370` связь проверяется только наличием имён сторон в списках | Рекомендация: 06 (требует смены схемы/промпта и переразбора, который до 03B запрещён); в 01 — только маркировка |
| R04 | P0 | **missing** | `pipeline/verify.ts:297-298` ИНН, `:393-394` сумма, `:319` город, `:330` адрес проверяются по **всему** body; `:378-380` событие не требует сторон внутри своей цитаты; `worker.ts:213` передаёт полный `doc.body` | 01 адресно (цитата-локальность ИНН/суммы); 06 |
| R05 | P0 | **missing** | `pipeline/worker.ts:76-77` молча режет body до `chunkSize*maxChunks`; с перекрытием 400 (`:24,:89`) 6 чанков покрывают меньше лимита; `:203,:211-257` частично успешные чанки применяются со статусом `extracted`; признака partial нет нигде | 01 адресно (отказ от apply неполного); 03B |
| R06 | P0 | **missing** | `pipeline/worker.ts:154` `ON CONFLICT ... DO NOTHING` — новый ответ при повторе теряется; `:232-240` подставляет старую строку `extractions`, т.е. канон ссылается на чужой payload; mentions всех чанков получают id первого чанка (`:184,:245`) | 01 адресно (стоп при несовпадении); 03B |
| R07 | P0 | **missing** (не исправлялось и в reviewed) | `pipeline/apply.ts:66-81` `clearDocumentContribution` удаляет mentions/events/roles документа; вызывается в `:92` и `worker.ts:220-226`. Локальный коммит `6431a5b` сделал это **осознанным правилом** (CLAUDE.md, USAGE.md) — противоречит пакету | 01 блокировка изменяющего pipeline; 03A/03B |
| R08 | P0 | **missing** | `docs/migrations/007_metrics.sql:37,55` `coalesce(occurred_on, current_date)`; `:25-26` задержка к `current_date` | 01 пометка legacy; 07 |
| R09 | P0 | **missing** (UI-смягчение reviewed тоже отсутствует) | `007_metrics.sql:53` `court_case` = hard event; `:34` задержка объекта всем `is_current` участникам без привязки к `e.company_id`; `frontend/src/components/RiskBadge.tsx:20-23` «Без замечаний»/«Высокий риск»; `pages/CompanyPage.tsx:50-51` «Заметных проблем… нет» при отсутствии данных | 01 пометка legacy; 06/07 |
| R10 | P0 | **missing** | `backend/src/index.ts:79` `app.listen(env.PORT)` без host → все интерфейсы; auth нет (`api/admin.routes.ts:3-5`); `app.ts:17-21` только CORS; SSRF-защиты нет (`ingest/website.ts:46-61`, `:71`, `:118`, `:244`; `admin.routes.ts:95-105`) | 01 |
| R11 | P0 | **missing** | `docs/migrations/002_sources.sql` без полей допуска; `ingest/sources.ts:140` и `:219` добавляют источник сразу `active`; README без предупреждения о правах на ИИ-обработку | 01 |
| R12 | P1 | **missing** | `ingest/scheduler.ts:38-41` комментарий обещает «разовую команду backfill», которой нет (grep); `:56,:76` только первая страница и `postId > last_post_id` | 01 исправить описание; 05B |
| R13 | P1 | **missing** | `ingest/store.ts:97-101` `edited_skipped`, правка молча теряется | 02 |
| R14 | P1 | **missing** | `ingest/website.ts:21` `listSelector` объявлен, не используется; `:223-226` текст ошибки предлагает `listSelector` как рабочий путь; `:242` анонс ≥400 символов не дополняется полной статьёй | 05A (01 — только текст ошибки) |
| R15 | P1 | **missing** | `pipeline/apply.ts:161,309-338` стадия объекта без сравнения дат утверждений, `suspended/cancelled` из любой старой статьи; `:192` роль всегда `is_current=true` | 06 |
| R16 | P1 | **missing** | `pipeline/worker.ts:106` компании схлопываются по `name.toLowerCase()`; `:124` события по `type\|company\|project` | 03B/06 |
| R17 | P1 | **missing** | `resolve/merge.ts:37-155`: нет проверки ИНН/ОГРН источника и цели, нет блокировки обеих сущностей и проверки tombstone цели; `:78` UPDATE mentions может нарушить `mentions_uidx` (`005:95`); `:108,:125` DELETE ролей без журнала; `:152` refresh после commit → `admin.routes.ts:153-155` вернёт 409 при уже выполненном слиянии; undo нет | 01 выключить небезопасную запись; 04 |
| R18 | P1 | **missing** | `api/companies.routes.ts:94-96` алиасы только в score, не в WHERE; поиска по `tax_id` нет | 01 адресно; 04 |
| R19 | P1 | **missing** | `api/contractors.routes.ts:17` `z.coerce.boolean()`: строка `"false"` → `true`; фронт всегда шлёт `includeGrey=${bool}` (`frontend/src/pages/ContractorsPage.tsx:47`) → серые показываются всегда | 01 |
| R20 | P2 | **missing** | `backend/package.json:15` `metrics:refresh` → `src/metrics/cli.ts`, файла нет | 01 |

## Прочие точечные изменения reviewed-копии (по review/REPOSITORY_MAP)

| Изменение reviewed | Статус | Наблюдение |
|---|---|---|
| Запрет массового переизвлечения в начале CLAUDE.md | missing | в `CLAUDE.md` запрета нет; наоборот, «после смены промпта переразбирать всё (`--reextract` без `--source`)» |
| `extract@3` с цитатой связи | missing | `llm/schema.ts:9` `extract@2` |
| Контроль покрытия чанков, отказ от записи неполного | missing | см. R05 |
| Стоп при несовпадении сохранённого payload | missing | см. R06 |
| Привязка API к 127.0.0.1 | missing | см. R10 |
| `backend/scripts/offline-regression.mjs`, `static-audit.mjs`, scripts `test:offline`, `check:syntax` | missing | каталога `backend/scripts` нет; в package.json таких scripts нет |
| Предупреждения о допуске источников в документации | missing | README «Ограничения» (`README.md:197-205`) о правах на ИИ-обработку молчит |
| Модули `llm/vocabulary.ts`, `resolve/identity.ts`, `pipeline/chunks.ts` | missing | в REPOSITORY_MAP указаны, в дереве отсутствуют; эквиваленты: чанкинг — `pipeline/worker.ts:69-132`, реквизиты — `resolve/normalize.ts` (`isValidTaxId`) |

## Особые точки, запрошенные этапом 00

- **Конфликт реквизитов** — R01 (`company.ts:255-290`) и R17 (`merge.ts`): обход и в резолвере, и в ручном слиянии.
- **Локальность цитаты** — R04: цитата сверяется с полным body, а не с чанком/спаном; ИНН/сумма/город вне цитаты.
- **Неполный chunk** — R05: нет статуса partial, хвост теряется молча.
- **Immutable extraction payload** — R06: повтор не пишет новый ответ, канон может ссылаться на старый payload.
- **`includeGrey=false`** — R19: фильтр не работает.
- **Метрики** — R08/R09 в SQL не тронуты, UI говорит «Без замечаний» при отсутствии сведений.

## Статус после этапа 01 (2026-09-14)

Реализовано адресно, с регрессионными тестами (не наложением старого патча):

| ID | Статус | Что сделано | Тесты |
|---|---|---|---|
| R01 | **present** (01 адресно, 04 полностью) | реестр реквизитов по типу; точное имя не обходит реквизиты; бренд без реквизитов не прикрепляется к юрлицу; неоднозначность — очередь уточнения без выбора первой строки | `company.test.ts`, `identity04.test.ts`, `resolve.int.test.ts`, `identity.int.test.ts` |
| R02 | **present** (01 адресно, 04 полностью) | известный и равный город; стабильная запись без города; иерархия комплекс → очередь → корпус; общий участник не в балле | `identity04.test.ts`, `resolve.int.test.ts`, `identity.int.test.ts` |
| R03 | **present** (06) | extract@3: у каждой связи своя цитата, обе стороны в одном предложении, признак договора/участия/корпоративной связи по виду; транзитивный договор не выводится; старые ответы extract@2 не переписываются | `semantic.test.ts`, `semantic.int.test.ts` |
| R04 | **present** (01 адресно; 06) | ИНН/сумма/город/адрес из собственной подтверждённой цитаты; стороны события в цитате; 06: сумма — во фрагменте, где названа сторона, с денежной единицей; дата — с точностью, подтверждённой цитатой; номер дела и корпус — только из цитаты | `verify.test.ts`, `semantic.test.ts` |
| R05 | **present** (01 адресно, 03B полностью) | диапазоны чанков в code points, покрытие по объединению диапазонов; `completed` только при всех ok и полном покрытии; хвост сверх лимита — `failed`; `truncated_input` не ok | `reprocess.test.ts`, `reprocess.int.test.ts` |
| R06 | **present** (01 адресно, 03B полностью) | ответы чанков append-only с попыткой, fencing-токеном и хэшем; повтор — новый запуск; evidence ссылается на свой чанк | `reprocess.int.test.ts`, `api.int.test.ts` |
| R07 | **present** (03A + 03B) | публикация набора одной транзакцией снимает только вклад своей публикации (`superseded`), решения и чужие доказательства остаются; старый apply заблокирован; проекции карточек | `assertions.int.test.ts`, `reprocess.int.test.ts` |
| R08, R09 | **present** (06–07) | 06: неизвестная дата — NULL, суд — стадии и роли сторон, план/слух/отрицание не события. 07: снимок `signals@1` на срез без шкалы и светофора; событие без даты не в окне; задержка объекта — контекст с пересечением периодов, не событие участника; суд по роли в деле; нулевой знаменатель — insufficient_data; `company_risk` только за deprecated-эндпоинтом | `signals.test.ts`, `signals.int.test.ts` |
| R10 | **present** | loopback-only, авторизация оператора, Host/Origin/CSRF, SSRF-клиент | `auth.test.ts`, `safeFetch.test.ts`, smoke |
| R11 | **present** | допуск сбора/ИИ, журнал, единый gate | `policy.test.ts`, `policy.int.test.ts`, `cli-gates.log` |
| R12 | **present** (05B) | курсор web-preview с записанным разрывом и ограниченной догрузкой `?before=`, граница истории первого запуска, курсор и посты одной транзакцией; бот — журнал обновлений вместо offset в курсоре | `telegram.test.ts`, `telegram.int.test.ts` — у пользователя |
| R13 | **present** (этап 02; 05B) | правка поста — новая неизменяемая редакция; legacy-текст не переписывается; 05B: правки `edited_message` бота и перепроверка web-preview, короткое опровержение не отбрасывается фильтром длины | `revisions.test.ts`; интеграция `revisions.int.test.ts` — у пользователя |
| R14 | **present** (05A) | профиль сайта: RSS или HTML-список с пагинацией; анонс догружается статьёй по селектору, недоступная — честный excerpt; listSelector без профиля отвергается | `sites.test.ts`, `sites.int.test.ts` |
| R15 | **present** (06) | история состояния объекта в действительном времени (`project_state_history_v`, `project_current_state_v`): поздняя старая статья не меняет текущее состояние, приостановка и возобновление; период роли — valid_from/valid_to с точностью; legacy apply по-прежнему заблокирован | `semantic.int.test.ts` |
| R16 | **present** (03B) | сущности чанков объединяются по ключу имени и ИНН/городу; события — только при той же позиции цитаты; mention-id в пространстве чанка | `reprocess.test.ts`, `reprocess.int.test.ts` |
| R17 | **present** (04) | предпросмотр, версии, идемпотентность, стабильные блокировки, коллизии до записи, журнал ходов, tombstone, отмена при неизменных зависимостях; применение за флагом MERGE_APPLY_ENABLED | `identity.int.test.ts`, `guard.test.ts`, `api.int.test.ts` |
| R18 | **present** | алиасы и ИНН в отборе поиска | `api.int.test.ts` |
| R19 | **present** | строгий разбор `includeGrey` | `contractors.test.ts` |
| R20 | **present** | `src/metrics/cli.ts` | backend build |

## Что это значит для этапа 01

Ничего из reviewed не «доустанавливать» целиком. Адресно восстанавливать с регрессионными тестами:
R01, R02, R04 (ИНН/сумма в цитате), R05, R06, R10, R12 (описание), R14 (текст ошибки), R17 (выключить),
R18, R19, R20. R03/R07/R08/R09/R13/R15/R16 — маркировка и блокировки в 01, реализация в своих этапах.
