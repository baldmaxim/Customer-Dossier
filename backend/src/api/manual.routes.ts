// Ручная вставка текста: третий канал ингеста рядом со скрейпером и форвард-ботом.
// Нужен для закрытых каналов, PDF-выжимок и просто «увидел на сайте, скопировал».

import { asyncRouter } from '../utils/asyncRouter.js';
import { z } from 'zod';

import { withTransaction } from '../db/pool.js';
import { evaluateSourcePolicy } from '../ingest/policy.js';
import { getSourceByKey } from '../ingest/sources.js';
import { storeDocument } from '../ingest/store.js';

const manualDocumentSchema = z.object({
  body: z.string().min(1, 'Текст не может быть пустым').max(100_000),
  title: z.string().max(500).nullish(),
  url: z.string().url().max(2000).nullish(),
  /** Дата исходной публикации, если известна. Не дата вставки. */
  publishedAt: z.string().datetime({ offset: true }).nullish(),
  /** Откуда взято: имя канала, издание, ФИО коллеги. */
  origin: z.string().max(200).nullish(),
});

export const manualRouter = asyncRouter();

manualRouter.post('/', async (req, res) => {
  const parsed = manualDocumentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Некорректные данные',
      details: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }

  const source = await getSourceByKey('manual', 'form');
  if (!source) {
    res.status(500).json({ error: 'Источник manual:form отсутствует — накатите миграции' });
    return;
  }

  // Ручная вставка — такой же вход сбора, как шедулер и бот: тот же допуск.
  const decision = evaluateSourcePolicy(source, 'collect');
  if (!decision.allowed) {
    res.status(403).json({ error: decision.reason, code: 'source_policy' });
    return;
  }

  const input = parsed.data;
  const result = await withTransaction(client =>
    storeDocument(
      {
        sourceId: source.id,
        sourceRunId: null,
        // Ручные вставки не имеют устойчивого внешнего id: дедупликацию целиком
        // отдаём хэшу содержимого.
        externalId: null,
        url: input.url ?? null,
        title: input.title ?? null,
        body: input.body,
        // Дата публикации неизвестна — NULL, а не момент вставки: иначе старый
        // текст выглядит свежим.
        publishedAt: input.publishedAt ? new Date(input.publishedAt) : null,
        forwardFrom: input.origin ?? null,
        representation: 'manual_text@1',
        // Оператор мог вставить как всю статью, так и её кусок.
        completeness: 'unknown',
        completenessReason: 'manual_paste',
        attachments: [],
        sourceModifiedAt: null,
        fetchedAt: new Date(),
      },
      client,
    ),
  );

  const status = result.outcome === 'inserted' ? 201 : 200;
  // Сохранение — не разбор: идентификаторы возвращаются, чтобы оператор открыл публикацию
  // и отдельным действием поставил запуск по конкретной редакции.
  res.status(status).json({
    outcome: result.outcome,
    documentId: result.documentId,
    sourceItemId: result.sourceItemId,
    revisionId: result.revisionId,
    revisionNo: result.revisionNo,
  });
});
