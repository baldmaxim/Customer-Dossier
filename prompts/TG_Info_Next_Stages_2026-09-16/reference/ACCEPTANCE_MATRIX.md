# Матрица приёмки нового пакета

Это **задания для будущих тестов**, не результаты выполненного прогона. Все начальные статусы NEW / NOT_RUN. Прежние 421/196 не заменяют эти проверки.

Обозначения: U — офлайн unit/статический тест агентом; DB_USER — интеграция/дампы/HTTP с БД пользователем; UI_USER — настоящий браузер пользователем; MODEL_USER — реальная модель пользователем; LIVE_USER — разрешённая сеть пользователем; USER_REPORT — разбор фактически переданного отчёта.

| ID | Этап | Исполнение | Сценарий | Требуемый результат |
|---|---|---|---|---|
| T10-01 | 10 | U | Содержимое при тех же counts | Замена цитаты/ИНН/решения при неизменном числе строк даёт content mismatch. |
| T10-02 | 10 | U | Разные миграции | Несовместимая обязательная схема не equal; R06 больше не воспроизводится как дефект. |
| T10-03 | 10 | U | Нет пустой таблицы | Отсутствующая required relation отличается от существующей count=0; R07 исправлен. |
| T10-04 | 10 | U+DB_USER | Строгая test-цель | Имя с test без выделенного URL/маркера отвергается до первой записи; правильная цель проходит. |
| T10-05 | 10 | U | HTTP400 benchmark | Шаг failed, не успешная latency; обязательная ошибка даёт ненулевой exit. |
| T10-06 | 10 | U | Каноническая сериализация | Порядок JSON/строк стабилен; NULL, числа и timestamp не теряют различия по контракту. |
| T10-07 | 10 | DB_USER | Содержательный restore | Dump/restore в другую marked цель совпадает по manifest; application read и следующая тестовая запись работают. |
| T10-08 | 10 | U+DB_USER | Пропущенная integrity check | Missing schema/check не PASS; реальные integrity violations дают ненулевой exit. |
| T10-09 | 10 | U | Несовместимый manifest | Схема отчёта иной версии явно incompatible, секретов/исходных текстов в отчёте нет. |
| T11-01 | 11 | U+DB_USER | A enqueue/B worker | До provider call выявлен config mismatch; нет ложной атрибуции A. |
| T11-02 | 11 | U+DB_USER | Resume другой моделью | Chunks A нельзя продолжить как B под прежним run; создаётся новый intent либо блокировка. |
| T11-03 | 11 | U+DB_USER | Отзыв между chunks | После первого вызова AI-допуск отозван: второго нет; R09 исправлен. |
| T11-04 | 11 | U | Истечение и retry | Policy expired/revoked блокирует retry перед новым outbound. |
| T11-05 | 11 | U+DB_USER | Поздний in-flight ответ | После отзыва не публикуется; отмена не обещает вернуть отправленные данные. |
| T11-06 | 11 | U | Effective prompt identity | Изменение renderer/no_think/schema/chunker/проверок отражается в execution identity. |
| T11-07 | 11 | U | Неизвестная модельная мета | Непредоставленная сервером квантизация/настройка остаётся unknown. |
| T11-08 | 11 | DB_USER | Потеря lease | Stale worker не меняет run/canon и прекращает следующие вызовы. |
| T11-09 | 11 | DB_USER | Ошибка позднего chunk | Успешные ранние chunks и ошибка последнего не дают частичной публикации; прежние decisions сохранены. |
| T12-01 | 12 | U | Нет объекта договора | R01: общий contract не documented для выбранного объекта. |
| T12-02 | 12 | U | Отрицание другого корпуса | R02: корпус1 не опровергает корпус2. |
| T12-03 | 12 | U | Rejected negative | R03: история видна, отвергнутое отрицание не решает active status. |
| T12-04 | 12 | U | Корпус неизвестен | R04: факт по проекту без корпуса — контекст, не established в корпусе2. |
| T12-05 | 12 | U | Другие работы/корпус договора | R05: электрический контракт корпуса1 не подтверждает ВК корпуса2. |
| T12-06 | 12 | U | Верное исключение сохраняется | C01: явно другой корпус по-прежнему выделяется отдельно. |
| T12-07 | 12 | U | Последовательные периоды | Смена подрядчика с непересекающимися периодами не конфликт текущей роли. |
| T12-08 | 12 | U | План и факт | План стать подрядчиком не состоявшийся договор; отрицание плана не отрицание старого участия. |
| T12-09 | 12 | U | Явный all_project | Только документированное покрытие всего объекта может включить корпус; null этого не означает. |
| T12-10 | 12 | U | Несовпадающая роль | Отрицание роли генподрядчика не опровергает роль субподрядчика. |
| T12-11 | 12 | U+DB_USER | Действующее противоречие | Применимое по scope неотклонённое отрицание сохраняется рядом с точным решением аналитика. |
| T12-12 | 12 | DB_USER+UI_USER | Одинаковое объяснение | API/live dossier/graph/new snapshot согласованы по scope, direct client и unknown. |
| T13-01 | 13 | U+DB_USER | Key другого case | R08: повтор ключа с другим case/filters — конфликт, не старый чужой snapshot. |
| T13-02 | 13 | DB_USER | Настоящий replay | Тот же intent повторяет тот же snapshot; отдельный новый intent снимает актуальное состояние. |
| T13-03 | 13 | DB_USER | Два одновременных key | Конкурентный одинаковый intent возвращает один результат без непредсказуемого 500. |
| T13-04 | 13 | U+DB_USER | Единый read executor | Все входы payload, включая refresh state, читаются через одну транзакцию. |
| T13-05 | 13 | DB_USER | Barrier snapshot race | Concurrent rename/review/refresh не даёт смешанный payload. |
| T13-06 | 13 | DB_USER | Неизменность истории | Old payload/hash/HTML сохранены после merge/edit/recompute. |
| T13-07 | 13 | U+DB_USER | Evidence vs latest | Revision1 основание сохраняет metadata; revision2 latest отмечена отдельно. |
| T13-08 | 13 | U+DB_USER | 1001 фактов | Нет silent completeness: cursor/hasMore/known total или unknown. |
| T13-09 | 13 | U+DB_USER | 2001 связей | Loader truncation отличается от node limit; фильтры работают до ограничения где возможно. |
| T13-10 | 13 | U | Ограниченный export | Snapshot/JSON/HTML/MD включают coverage, не называются полными при ограничении. |
| T13-11 | 13 | U | Старый snapshot формат | Новые поля не меняют исторический hash; совместимое чтение. |
| T13-12 | 13 | U | History cutoff | Неподдерживаемый исторический срез честно отвергнут, не имитируется по дате публикации. |
| T14A-01 | 14A | U | Current vs legacy | extract@2 output не считается benchmark текущего extract@3. |
| T14A-02 | 14A | U | Ошиблись все cases | planned сохраняется; отчёт не PASS и не 100% из пустого списка. |
| T14A-03 | 14A | U | Пустой selector | Неизвестный/пустой case selection — явная ошибка, ненулевой exit. |
| T14A-04 | 14A | U | Parity pipeline/scorer | Truncated/invalid/partial output одинаково непубликуемый на общем пути. |
| T14A-05 | 14A | U | Score FP/FN | Подсчёт по эталонным facts воспроизводим; checks отдельно от precision/recall. |
| T14A-06 | 14A | U | Нет leakage | Один origin cluster не разделяется по разным URL между dev и holdout. |
| T14A-07 | 14A | U | Сравнение конфигураций | Разные schema/corpus/thresholds отмечены incompatible; полный fingerprint. |
| T14A-08 | 14A | U+MODEL_USER | Воспроизводимый baseline | Мок replay без сети; actual model baseline отдельно только из user JSON. |
| T14B-01 | 14B | U+MODEL_USER | Локализация пропуска | Путь text→chunk→model→verify→resolve→dossier содержит конкретную причину и regression. |
| T14B-02 | 14B | MODEL_USER | Один фактор | Baseline и candidate отличаются явно зарегистрированным фактором при том же scoring. |
| T14B-03 | 14B | U+MODEL_USER | Без новых ложных фактов | Полнота не куплена чужим ИНН/суммой/договором/снятием отрицания. |
| T14B-04 | 14B | U | Второй проход bounded | Число вызовов ограничено, dedup и verification/policy не обходятся. |
| T14B-05 | 14B | MODEL_USER | Safety gate | Непрошедший обязательный safety не скрыт средним score; конфигурация не разрешена автоматически. |
| T14B-06 | 14B | MODEL_USER | Замороженный holdout | Пороги заданы до результата, holdout не был few-shot/dev. |
| T14B-07 | 14B | U+MODEL_USER | История/откат | Selected variant требует решения и full report, исторический run не переименован. |
| T15A-01 | 15A | U+DB_USER | Одно mention | Выбор юрлица одного упоминания не глобальный merge остальных омонимов. |
| T15A-02 | 15A | U+DB_USER | Разные реквизиты | Конфликт известных ИНН/ОГРН/формы не обходится простым approve. |
| T15A-03 | 15A | DB_USER | Version/idempotency | Повтор решения не дублирует, stale version даёт conflict. |
| T15A-04 | 15A | DB_USER | Stale merge preview | Новые evidence/decisions после preview требуют нового preview. |
| T15A-05 | 15A | U+DB_USER | Lineage decisions | Каноническое досье видит историю с прежними actor/time/scope без auto-confirm. |
| T15A-06 | 15A | U | Цепочка слияний | Циклы/дубли lineage не увеличивают вес и не дают бесконечного обхода. |
| T15A-07 | 15A | DB_USER+UI_USER | Access/UI flow | Без полномочий нет writes; пользователь проходит ambiguity→choice→evidence→canonical dossier. |
| T15B-01 | 15B | U+UI_USER | Ошибка видна | Failed chunk/invalid output в run detail, не пустой список и не успех. |
| T15B-02 | 15B | DB_USER | Revoked publish | Policy между preview и publish изменилась: refused. |
| T15B-03 | 15B | DB_USER | Новая revision | Old preview не применён после изменения входа. |
| T15B-04 | 15B | U+DB_USER | Retry/cancel | Повторы идемпотентны, отмена не запускает будущие calls и не обещает удаление прошлого. |
| T15B-05 | 15B | DB_USER | No bypass | Auth/CSRF/Origin/backend flags не обходятся UI. |
| T15B-06 | 15B | U+UI_USER | Ссылка на revision | Кандидат открывает точную цитату/редакцию/run, не только latest article. |
| T15B-07 | 15B | U+DB_USER | Пагинация runs | 101+ runs доступны без потерь и ложного полного count. |
| T16-01 | 16 | U | Пустая vs сломанная | Healthy empty list отличается от parser_degraded/never_run. |
| T16-02 | 16 | U | Полнота текста | Анонс/вложение/обрезка не full article, missing date не today. |
| T16-03 | 16 | U | URL boundary | Forbidden redirect/IP/body budget не обходятся новым preview/profile. |
| T16-04 | 16 | U+DB_USER | Collection vs AI | Разрешение сбора не разрешает AI, unknown/expired отдельно. |
| T16-05 | 16 | U+DB_USER | Поздняя ошибка | Сбой страницы/вставки не теряет диапазон cursor. |
| T16-06 | 16 | U+DB_USER | Edit идемпотентен | Правка — новая revision, повтор неизменного — без дубля. |
| T16-07 | 16 | U+LIVE_USER | Telegram coverage | Фактически просмотренные границы видны, preview не равен полному архиву. |
| T16-08 | 16 | LIVE_USER | Отдельный допуск | Только названный источник с основанием получает user validation; template не approved. |
| T17-01 | 17 | U+UI_USER | Ответ по обращению | Direct client указан с основанием или не установлен; нет выдуманных промежуточных звеньев. |
| T17-02 | 17 | U | Перепечатки | Известный origin один, unknown originality не названа независимостью. |
| T17-03 | 17 | U | Судебные роли | Истец/ответчик/стадия различаются; иск не автоматически долг. |
| T17-04 | 17 | U | Общий фон | Другой объект/корпус/роль не выдан за факт текущего обращения. |
| T17-05 | 17 | U+UI_USER | Проверяемый вывод | Каждый значимый вывод ведёт к evidence/revision/scope. |
| T17-06 | 17 | U | Пробелы видны | Truncation/pending edit/unknown identity отражены в коротком резюме. |
| T17-07 | 17 | U | Parity export | JSON/MD/HTML не расходятся в статусах и данных. |
| T17-08 | 17 | U+UI_USER | Предметные вопросы | Вопросы основаны на явном missing dimension, без обвинений/выдуманных условий договора. |
| T18-01 | 18 | U | Component negative states | Ошибки/API down/unknown/empty/partial/rejected представлены раздельно. |
| T18-02 | 18 | UI_USER | Core browser workflow | Login→case→review→snapshot→logout пройден настоящим браузером. |
| T18-03 | 18 | UI_USER | PDF/390px | Печать и узкое окно проверены отдельно, evidence/ограничения не обрезаны. |
| T18-04 | 18 | U+UI_USER | Session/cache | Logout не оставляет dossier API payload доступным через старый client cache. |
| T18-05 | 18 | U+UI_USER | Untrusted output | XSS/опасные ссылки нейтрализованы, canaries не в bundle/log/export. |
| T18-06 | 18 | DB_USER | Большая synthetic выборка | 1000+/2000+ сценарии валидны, generator guarded и bounded. |
| T18-07 | 18 | DB_USER | Сопоставимый benchmark | Одинаковые данные/параметры, успешные ответы, errors отдельно, warm-up исключён. |
| T18-08 | 18 | U+DB_USER | Оптимизация без смысловой регрессии | Query/index diff не меняет dossier/immutable snapshot на одинаковом входе. |
| T19-01 | 19 | U+LIVE_USER | Пилот без допуска | Нет named manifest/permissions/target — запуск отсутствует, PILOT_NOT_RUN. |
| T19-02 | 19 | LIVE_USER | Точный предел | Источник/даты/число материалов соответствуют утверждённому manifest. |
| T19-03 | 19 | UI_USER+LIVE_USER | Человеческий review | Опорные факты проверены по evidence/scope до рабочего использования. |
| T19-04 | 19 | MODEL_USER | Model gate | Safety fail не превращается в автопубликацию или model validated. |
| T19-05 | 19 | DB_USER | Backup stop condition | Manifest/target mismatch блокирует операцию, не предупреждение для игнорирования. |
| T19-06 | 19 | U+LIVE_USER | Defaults off | Никакого автосбора/слияния/расписания без отдельного решения. |
| T19-07 | 19 | LIVE_USER | Revocation в пилоте | Будущие calls остановлены; история/retention согласно реальным правам. |
| T19-08 | 19 | USER_REPORT | Областная готовность | Отчёт named source+model fingerprint+dataset+date, без общего production-ready. |

Всего: **103 сценария**. Один сценарий может требовать нескольких tests; не фиксировать искусственно число test cases.

В stage report сопоставить каждый ID с реальным файлом/названием теста или командой ручного прогона и логом. Удаление сценария допустимо только с явным обоснованием и решением владельца; оно не является способом получить PASS.
