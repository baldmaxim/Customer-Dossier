# Пользовательский прогон этапа 14B
**Это форма, а не выполненный прогон.** PowerShell, корень `TG_Info`. База не нужна. В LM Studio уходят только вымышленные тексты
корпуса. Одинаковые условия для baseline и варианта: та же модель, контекст, без параллельной тяжёлой GPU-нагрузки.

Перед шагом 3 заполнить в `docs/development/quality/QUALITY_DECISION.md` цели полноты и допустимое время — до просмотра результатов варианта.

| Шаг | Команда (cwd) | Изменяет данные? | Ожидается | Фактически | Exit/log |
|---|---|---|---|---|---|
| 1 | `cd backend; npx vitest run src/reprocess --maxWorkers=2` | нет | все passed | NOT_RUN | — |
| 2 | `New-Item -ItemType Directory -Force "$env:USERPROFILE\tg-info-14b" | Out-Null; npm run benchmark:model -- --experiment baseline-semantic@1 --out "$env:USERPROFILE\tg-info-14b\baseline.json"` | файл | отчёт с причинами пропусков (`пропуск «…»: стадия`), вердикт по safety | NOT_RUN | — |
| 3 | `npm run benchmark:model -- --experiment prompt-recall-a@1 --out "$env:USERPROFILE\tg-info-14b\recall-a.json"` | файл | другой `исполнение …` (отпечаток), тот же корпус | NOT_RUN | — |
| 4 | `npm run benchmark:model -- --compare "$env:USERPROFILE\tg-info-14b\baseline.json" "$env:USERPROFILE\tg-info-14b\recall-a.json"` | нет | совместимо; дельта recall; «потери safety: N» и перечень | NOT_RUN | — |
| 5 | `npm run benchmark:model -- --experiment second-pass@1` | нет | отказ «зарегистрирован, но не реализован», exit 1 | NOT_RUN | — |

Прислать: оба JSON (только синтетика), вывод шага 4, машину и параметры LM Studio. Решение selected/rejected — по заполненному
QUALITY_DECISION, агент его не принимает. Если safety у варианта хуже — вариант отклоняется независимо от роста recall.
