// Снимок ДОМ.РФ без лишнего (07.10.2026). Карточка компании брала payload целиком — «Сроки и продажи» всю историю
// снимков всех домов группы, — а читала из него имя, адрес и десяток подписей: JSON со всеми полями карточки
// реестра ехал из базы и разбирался в процессе API (лимит памяти 320 МБ). Отбор теперь в SQL: identity и только
// названные подписи, в прежнем порядке (field() берёт первую непустую). Подписи — из той же таблицы, по которой
// читатель разбирает поля: новая подпись в таблице сразу попадает и в выборку.

/** payload с identity и только перечисленными подписями. labelsParam — параметр с массивом text[]. */
export const slimRegistryPayloadSql = (payload: string, labelsParam: string): string => `jsonb_build_object(
    'identity', ${payload}->'identity',
    'fields', CASE WHEN jsonb_typeof(${payload}->'fields') = 'array' THEN coalesce(
      (SELECT jsonb_agg(e.f ORDER BY e.n) FROM jsonb_array_elements(${payload}->'fields') WITH ORDINALITY AS e(f, n)
       WHERE e.f->>'label' = ANY(${labelsParam}::text[])),
      '[]'::jsonb) ELSE '[]'::jsonb END)`;

/** Все подписи таблицы «поле → подписи по приоритету» — параметр для slimRegistryPayloadSql. */
export const labelsOf = (fields: Readonly<Record<string, readonly string[]>>): string[] => [...new Set(Object.values(fields).flat())];
