// Снимок видимой карточки наш.дом.рф, снятый агентом из браузера без API.
// Вход содержит только текст самой карточки. Навигация, соседние дома и
// сгенерированное сайтом описание не становятся фактами объекта.

import { z } from 'zod';

import { payloadHash } from '../../snapshot/canonical.js';
import { toPayload, type IRegistryField, type IRegistryRecord } from './map.js';

const text = z.string().trim().min(1).max(1000);
const optionalText = z.string().trim().max(1000).nullable().optional();
const captureSchema = z.object({
  format: z.literal('domrf-browser@1'),
  url: z.string().url(),
  title: text,
  address: optionalText,
  status: optionalText,
  pricePerSqm: optionalText,
  declaration: optionalText,
  projectDate: optionalText,
  contractor: optionalText,
  developer: z.object({ name: text, group: optionalText }).strict().nullable().optional(),
  characteristics: z.array(z.object({ label: text, value: text }).strict()).max(100),
  apartmentGroups: z.array(text).max(20).default([]),
  sales: z.array(z.object({ label: text, value: text }).strict()).max(20).default([]),
  informationUpdated: optionalText,
}).strict();

export type IDomRfBrowserCapture = z.infer<typeof captureSchema>;

export const isDomRfBrowserCapture = (body: unknown): boolean =>
  typeof body === 'object' && body !== null && (body as Record<string, unknown>).format === 'domrf-browser@1';

export const mapDomRfBrowserCapture = (body: unknown): IRegistryRecord => {
  const parsed = captureSchema.parse(body);
  const url = new URL(parsed.url);
  if (url.hostname !== 'xn--80az8a.xn--d1aqf.xn--p1ai') throw new Error('адрес не принадлежит наш.дом.рф');
  const match = /\/объект\/(\d{1,18})\/?$/.exec(decodeURIComponent(url.pathname));
  if (!match) throw new Error('адрес не является карточкой объекта');

  const fields: IRegistryField[] = [];
  const seen = new Set<string>();
  const add = (label: string, value: string | null | undefined): void => {
    if (!value) return;
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized) return;
    const key = `${label}\0${normalized}`;
    if (seen.has(key)) return;
    seen.add(key);
    fields.push({ label, value: normalized, raw: normalized });
  };
  add('Статус строительства', parsed.status);
  const names = /^"([^"]+)"(?:,\s*"([^"]+)")?$/.exec(parsed.title);
  if (names?.[2]) add('Другое название', names[2]);
  add('Средняя цена за 1 м²', parsed.pricePerSqm);
  add('Проектная декларация', parsed.declaration?.replace(/^Проектная декларация\s*/i, ''));
  add('Дата публикации проекта', parsed.projectDate);
  for (const field of parsed.characteristics) add(field.label, field.value);
  add('Генподрядчики', parsed.contractor);
  parsed.apartmentGroups.forEach((value, index) => add(`Квартиры и помещения ${index + 1}`, value));
  for (const field of parsed.sales) add(field.label, field.value);
  add('Информация на странице обновлена', parsed.informationUpdated);

  const developer = parsed.developer;
  add('Застройщик', developer?.name);
  add('Группа компаний', developer?.group);
  const identity = {
    externalRef: match[1]!,
    name: names?.[1] ?? parsed.title,
    city: parsed.address?.match(/^(.+?) город(?:,|$)/)?.[1] ?? null,
    address: parsed.address ?? null,
    asOf: null,
    // Страница объекта не показывает реквизиты застройщика. Для утверждения о
    // компании нужен отдельный снимок её карточки, с собственным URL.
    developer: null,
    groupName: null,
  };
  const payload = toPayload(identity, fields);
  payload.captureMethod = 'browser_page';
  return { type: 'object', projectKind: 'residential', identity, fields, payload, payloadHash: payloadHash(payload) };
};
