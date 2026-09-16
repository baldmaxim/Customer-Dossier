# Первичные технические источники
Проверены 16.09.2026. Документация по текущим публичным версиям помогает объяснить принцип; **команды и API сверять с lock-файлами и установленной версией проекта**. Пакет не требует обновления зависимостей до «current».

1. PostgreSQL, Transaction Isolation — https://www.postgresql.org/docs/current/transaction-iso.html
   Основание: согласованное чтение зависит от транзакции; запросы через другой pool/client не становятся частью её снимка автоматически. Этапы 10/13. Воспроизведение конкретной гонки проекта требует DB integration.
2. PostgreSQL, pg_dump — https://www.postgresql.org/docs/current/app-pgdump.html
   Основание: согласованный дамп одной базы; объекты окружения/кластера требуют отдельного учёта. Для baseline/dump нужен один согласованный момент либо остановленные писатели. Этапы 10/19.
3. LM Studio, Structured Output — https://lmstudio.ai/docs/developer/openai-compat/structured-output
   Основание: JSON schema output доступен через chat completions. Соответствие форме не является доказательством правильной компании, роли, цитаты и полноты: это отдельные проверки проекта. Этапы 11/14.
4. Vitest, File Parallelism — https://vitest.dev/config/fileparallelism
   Vitest, Max Workers — https://vitest.dev/config/maxworkers
   Основание: контролируемый параллелизм прогона. Применимые CLI flags сверять с локальной версией. Не отключать тестовую изоляцию, чтобы скрыть OOM/гонки.
5. OWASP, LLM Prompt Injection Prevention — https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html
   Основание: модельный ввод от источника недоверенный; проверять последствия и ограничения приложения. Тест безопасного HTML не заменяет тест поведения модели.
6. Telegram, Terms of Service for Content Licensing — https://telegram.org/tos/content-licensing
   Основание: перед подключением источников отдельно установить допустимость сбора/использования в AI и требуемое согласие. Публичность/локальность модели не заменяют правовое основание. Это не юридическое заключение о конкретном канале; фактическое разрешение фиксирует владелец.

Выводы F01–F20 основаны прежде всего на локальном архиве, его отчётах и изолированных проверках. Публичная документация не подтверждает конкретные результаты тестов этого проекта.
