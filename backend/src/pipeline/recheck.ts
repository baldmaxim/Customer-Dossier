// Перепроверка уже записанных фактов против исходных текстов.
//
// Зачем это нужно. Пайплайн умеет добавлять факты, но не умеет их отзывать:
// резолвер переиспользует существующий объект и не затирает поля, о которых
// новый документ ничего не сказал. Логика правильная — молчание одного поста
// не опровергает сведения из другого. Но у неё есть цена: значение, записанное
// сломанной версией кода, остаётся навсегда.
//
// Так и вышло с городом. До появления проверки города модель дописывала его
// «по смыслу», и объекты на московской Автозаводской получили город Алматы.
// Переизвлечение это не лечит: новый разбор просто не сообщает города, и
// старое значение остаётся.
//
// Точечный UPDATE закрыл бы конкретный случай и оставил класс проблемы.
// Здесь — общий инструмент: берём сохранённое значение и спрашиваем, есть ли
// хоть один документ, который его подтверждает. Нет — значение снимается.

import { query, execute } from '../db/pool.js';
import { isCityMentionedInBody, isAddressGroundedInBody } from './verify.js';

export interface IRecheckResult {
  checked: number;
  cleared: number;
  details: Array<{ id: number; name: string; field: string; value: string }>;
}

interface IProjectRow {
  id: number;
  name: string;
  city: string | null;
  address: string | null;
  bodies: string[];
}

/**
 * Документы, которыми объект подтверждался. Берём все: город мог быть назван
 * в одном посте, а адрес в другом, и требовать подтверждения из одного текста
 * значило бы снимать верные сведения.
 */
const loadProjects = async (): Promise<IProjectRow[]> =>
  query<IProjectRow>(
    `SELECT p.id, p.name, p.city, p.address,
            coalesce(array_agg(d.body) FILTER (WHERE d.body IS NOT NULL), '{}') AS bodies
     FROM projects p
     LEFT JOIN mentions m      ON m.entity_kind = 'project' AND m.entity_id = p.id
     LEFT JOIN raw_documents d ON d.id = m.document_id
     WHERE p.merged_into_id IS NULL
       AND (p.city IS NOT NULL OR p.address IS NOT NULL)
     GROUP BY p.id, p.name, p.city, p.address`,
  );

export const recheckProjectFields = async (dryRun = false): Promise<IRecheckResult> => {
  const projects = await loadProjects();
  const result: IRecheckResult = { checked: projects.length, cleared: 0, details: [] };

  for (const project of projects) {
    // Объект без единого упоминания проверить нечем. Снимать вслепую нельзя:
    // сведения могли прийти из документа, который позже удалили.
    if (project.bodies.length === 0) continue;

    const cityOk =
      project.city === null || project.bodies.some(b => isCityMentionedInBody(project.city!, b));
    const addressOk =
      project.address === null ||
      project.bodies.some(b => isAddressGroundedInBody(project.address!, b));

    if (cityOk && addressOk) continue;

    if (!cityOk && project.city) {
      result.details.push({ id: project.id, name: project.name, field: 'city', value: project.city });
    }
    if (!addressOk && project.address) {
      result.details.push({
        id: project.id,
        name: project.name,
        field: 'address',
        value: project.address,
      });
    }
    result.cleared += 1;

    if (!dryRun) {
      await execute(
        `UPDATE projects
         SET city    = CASE WHEN $2 THEN city    ELSE NULL END,
             address = CASE WHEN $3 THEN address ELSE NULL END,
             updated_at = now()
         WHERE id = $1`,
        [project.id, cityOk, addressOk],
      );
    }
  }

  return result;
};
