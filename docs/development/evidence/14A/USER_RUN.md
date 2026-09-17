# Пользовательский прогон этапа 14A
**Это форма, а не выполненный прогон.** PowerShell, корень `TG_Info`. База данных не нужна. В LM Studio уходят только вымышленные
тексты синтетического корпуса. Рабочие публикации не участвуют. Это baseline текущей конфигурации, а не валидация модели.

| Шаг | Команда (cwd) | Изменяет данные? | Ожидается | Фактически | Exit/log |
|---|---|---|---|---|---|
| 1 | `cd backend; npx vitest run src/reprocess --maxWorkers=2` | нет | все passed | NOT_RUN | — |
| 2 | `npm run pipeline:once -- --compare` | нет | отказ: «LEGACY extract@2… добавьте --legacy», exit 1 | NOT_RUN | — |
| 3 | `npm run benchmark:model -- --case SYN-99` | нет | «неизвестные кейсы: SYN-99», exit 1, модель не вызывается | NOT_RUN | — |
| 4 | LM Studio запущен, загружена рабочая модель; `npm run pipeline:once -- --check` | нет | модель доступна | NOT_RUN | — |
| 5 | `npm run benchmark:model -- --out "$env:USERPROFILE\tg-info-14a\baseline.json"` (папку создать заранее) | файл отчёта | `current-eval@1 · extract@3`, числа safety/recall **из запланированных**, вердикт `REPORT_ONLY` или `FAIL`/`INCOMPLETE` с причинами; exit 0 только без нарушений safety и без неоценённого | NOT_RUN | — |
| 6 | `npm run benchmark:model -- --replay "$env:USERPROFILE\tg-info-14a\baseline.json"` (LM Studio можно выключить) | нет | те же числа без обращения к модели | NOT_RUN | — |
| 7 (если есть) | `npm run benchmark:model -- --import-legacy <путь>\benchmark-06.json` | нет | записанные поля и перечень неизвестного; без файла — разбор 06 остаётся UNKNOWN | NOT_RUN | — |

Зафиксировать и прислать: машина (CPU/GPU/VRAM), версия LM Studio, модель и квантизация **как показывает LM Studio**,
контекст, concurrency, вывод шагов 5–6 и `baseline.json` (в нём только синтетические тексты). Реальные публикации не присылать.
