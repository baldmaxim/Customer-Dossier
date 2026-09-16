# Схема JSON-выгрузки снимка досье — `dossier-snapshot-export@1`

Этап 08B, ADR-011. Файл отдаётся по `GET /api/snapshots/:id/export.json` (после входа оператора).
Выгрузка строится из хранимого снимка, а не из текущей базы. Версия схемы меняется при любом
несовместимом изменении полей; старые файлы не переписываются.

## Верхний уровень

| Поле | Тип | Смысл |
|---|---|---|
| `exportSchema` | string | всегда `dossier-snapshot-export@1` |
| `snapshot` | object | `id`, `caseId`, `payloadHash`, `hashAlgorithm`, `generatedAt` (ISO 8601, UTC) |
| `availability` | object | состояние допуска источников **на момент выгрузки**: `checkedAt`, `withheldSources[]` (`sourceId`, `sourceKey`, `reason`), `withheldEvidence` |
| `payload` | object | замороженное содержание снимка (ниже) |

`payloadHash` считается по `payload` в том виде, в каком он хранится в базе (алгоритм `sha256-canonical-json@1`:
сериализация с сортировкой ключей объектов, массивы в исходном порядке, UTF-8, без пробелов). В выгруженном
файле цитаты недоступных сейчас источников заменены на `null` с `withheldReason`, поэтому пересчёт hash по
файлу совпадёт с `payloadHash` только когда `availability.withheldEvidence = 0`.
Hash подтверждает целостность содержания; это не электронная подпись и не подтверждение истинности сведений.

## `payload`

| Поле | Тип | Смысл |
|---|---|---|
| `schemaVersion` | string | `dossier-snapshot@1` |
| `generatedAt`, `knowledgeCutoff` | string | момент создания; срез знаний всегда равен моменту создания (срез прошлого не поддержан) |
| `effective` | object | `from`, `to` (даты `YYYY-MM-DD` или null), `undatedIncluded`, `excluded`, `note` — фильтр событий и ролей |
| `versions` | object | `template`, `signalsRules`, `graph`, `signalsCutoff`, `signalsStale` |
| `case` | object | обращение на момент снимка: `id`, `version`, `title`, заявленные роль, заказчик и условия, `requestDate`, `provenance = operator_recorded_claim` |
| `company`, `claimedClient`, `project` | object \| null | подписи сущностей, скопированные в снимок (переименование позже их не меняет); `company.identifiers` — строки вида `inn 5001007329` |
| `dossier` | object | досье обращения (`dossier-template@1`): `subject`, `observations`, `role`, `chain`, `terms`, `projectContext`, `companyEvents`, `uncertainties`, `questions`, `disclaimer`. Каждая фраза — `{ code, text, attribution, assertionIds[], evidenceIds[], quotes[] }` |
| `assertions` | array | утверждения выборки: `id`, `version`, `predicate`, `role`, `eventType`, `status`, `needsRevalidation`, `polarity`, `modality`, `supports`, `contradicts` |
| `reviews` | array | решения аналитика: `id`, `assertionId`, `decision`, `scope`, `reason`, `assertionVersion`, `decidedAt` |
| `openQueue` | array | открытые вопросы проверки на момент снимка: `kind`, `assertionId`, `priority` |
| `sources` | array | доказательства: `evidenceId`, `assertionId`, `stance`, `status`, `quote` (или `null`), `withheldReason`, `spanStart`, `spanEnd` (code points), `revisionId`, `revisionNo`, `sourceItemId`, `sourceId`, `sourceKey`, `sourceTitle`, `url` (только `http`/`https`, иначе null), `publishedAt`, `completeness` |
| `graph` | object | `nodes[]` (`key` вида `c:12` / `p:34`, `kind`, `id`, `label`, `subtype`, `details`, `depth`, `seed`), `edges[]` (`type`, `from`, `to`, `assertionId`, `role`, `building`, `workPackage`, `validFrom`, `validTo`, `periodPrecision`, `status`, `polarity`, `modality`, `supports`, `contradicts`, `contextProjectId`, `details`), `truncated`, `notes[]` |
| `selection` | object | `assertionIds[]`, `evidenceIds[]`, `reviewIds[]` — что именно вошло в снимок |
| `limitations` | array | ограничения выборки и оговорки, которые обязаны идти вместе с содержанием |

## Соглашения

- **Даты.** Момент времени — ISO 8601 с зоной (`2026-09-15T12:00:00.000Z`); календарная дата — `YYYY-MM-DD`.
  Точность даты события хранится отдельно (`periodPrecision`: `day`/`month`/`year`/`unknown`) — год не превращается в 1 января.
- **Числа.** Счётчики — целые. Денежные суммы в выгрузку снимка не выносятся отдельным числом: они остаются
  внутри формулировок и цитат, чтобы не возникло впечатления, будто суммы из разных публикаций сложены.
  Если сумма появится отдельным полем, она будет строкой с фиксированной точкой (`"1500000.00"`) и валютой —
  не числом с плавающей точкой.
- **Пропуск ≠ ноль.** `null` означает «не установлено», пустой массив — «в выборке ничего не найдено».
  Ни то, ни другое не означает «этого не было».
- **Цитата** подтверждает, что так написано в источнике, а не истинность утверждения. `spanStart`/`spanEnd` —
  смещения в code points внутри указанной редакции.
- **Экспорт не даёт прав на перепубликацию** текста источника. Скрытая цитата (`quote: null`) означает, что
  текущий допуск источника не позволяет выдачу; вымаранная — решение оператора, `quote` равна
  `[фрагмент вымаран по решению оператора]`.
