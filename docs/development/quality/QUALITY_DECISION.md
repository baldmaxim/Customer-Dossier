# Решение по конфигурации модели
Status: **PENDING** (baseline не измерен; критерии не утверждены владельцем)

Config fingerprint: заполняется из отчёта `benchmark:model` (`identity.executionFingerprint`)
Provider/model reported identity: из `meta.modelReported`; квантизация/контекст — как показывает LM Studio, иначе unknown
Effective prompt/schema/chunker/validator versions: semantic@1 (+ вариант), extract@3, chunker@2-codepoints, candidates@1+semantic-verify@1
Corpus hash/split/guideline: `identity.corpusHash`; сплит — regression (17, видены при настройке); 24 предложенных кейса не оцениваются
Ground-truth unresolved cases: 24 (`PROPOSED_REQUIRES_SCHEMA_MAPPING`)
Machine/runtime/concurrency: заполняет пользователь

## До выполнения
Цель изменения: реже пропускать компании, роли, договоры и события без новых ложных фактов
Один изменяемый фактор: промт — `prompt-recall-a@1` против `baseline-semantic@1`
Planned cases/checks: 17 кейсов регрессионного корпуса, все их safety и recall проверки
Обязательные safety gates: все safety пройдены, ни одной `not_evaluated`; потеря любой safety у варианта — отказ
Цели полноты по company/role/relation/event/scope: **задаёт владелец до просмотра результатов варианта** — ____
Допустимые ошибки/latency/бюджет: **задаёт владелец** — ____
Кто утвердил эти критерии и когда: ____

## После выполнения
Все planned случаи учтены: NOT_RUN
Safety failed IDs: NOT_RUN
Provider errors / invalid / truncated / skipped: NOT_RUN
TP/FP/FN (только при определённом matching): не применяется — эталонного набора фактов нет
Paired deltas по каждому классу: NOT_RUN (`benchmark:model -- --compare`)
Новые регрессии: NOT_RUN
Наблюдаемые время/нагрузка: NOT_RUN

## Решение
PENDING. Рабочая конфигурация не меняется. LOCAL_MODEL_VALIDATED = нет. Автопубликация и массовый переразбор не разрешаются
никаким результатом этой оценки.
