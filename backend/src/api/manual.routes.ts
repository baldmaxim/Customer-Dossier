// Ручная вставка текста: третий канал ингеста рядом со скрейпером и форвард-ботом.
// Нужен для закрытых каналов, PDF-выжимок и просто «увидел на сайте, скопировал».

import { asyncRouter } from '../utils/asyncRouter.js';
import { z } from 'zod';

import { withTransaction } from '../db/pool.js';
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
        publishedAt: input.publishedAt ? new Date(input.publishedAt) : new Date(),
        forwardFrom: input.origin ?? null,
      },
      client,
    ),
  );

  const status = result.outcome === 'inserted' ? 201 : 200;
  res.status(status).json({ outcome: result.outcome, documentId: result.documentId });
});
