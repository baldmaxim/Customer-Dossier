// Карточка компании: обзор — «что сейчас», публикации — «что пишут», подробно — «откуда известно».
//
// Проверяется то, ради чего карточку пересобрали: обзор короткий и без ленты, публикации —
// отдельной вкладкой со списком и постом рядом, контрагенты подписаны основанием связи,
// совместное участие не выдаётся за договор.

import { fireEvent, screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { fakeApi, renderWithProviders } from '../test/render';
import { CompanyPage } from './CompanyPage';

/** Карточка читает id из адреса: без Route параметр не появится. */
const renderCard = (): void => {
  renderWithProviders(
    <Routes>
      <Route path="/company/:id" element={<CompanyPage />} />
    </Routes>,
    '/company/7',
  );
};

const company = {
  company: { id: 7, name: 'ООО «Мостострой»', city: 'Казань', legalForm: 'ООО', taxId: null, entityType: 'legal_entity' },
  aliases: [{ alias: 'Мостострой' }],
  identifiers: [{ type: 'inn', value: '1655000000' }],
  relations: [],
  registry: null,
  mergedInto: null,
};

const fact = (over: Record<string, unknown> = {}) => ({
  assertionId: 101,
  predicate: 'participates_in_project',
  role: 'general_contractor',
  eventType: null,
  modality: 'reported_fact',
  polarity: 'positive',
  status: 'text_grounded',
  projectId: 55,
  projectName: 'Развязка на М-7',
  otherCompanyId: null,
  otherCompanyName: null,
  amount: null,
  currency: null,
  valueType: null,
  quote: 'генподрядчиком выступает «Мостострой»',
  ...over,
});

const publication = (over: Record<string, unknown> = {}) => ({
  itemId: 11,
  revisionId: 21,
  documentId: 31,
  title: null,
  topic: 'Подряд на развязку передан другой фирме',
  publishedAt: '2026-09-18T07:00:00Z',
  observedAt: '2026-09-18T07:30:00Z',
  sourceTitle: 'Стройканал',
  sourceKind: 'telegram',
  sourceKey: 'stroykanal',
  url: 'https://t.me/stroykanal/11',
  completeness: 'full',
  snippet: 'Начало текста публикации',
  facts: [fact(), fact({ assertionId: 102, predicate: 'company_mentioned', role: null, projectName: null })],
  moreFacts: 0,
  ...over,
});

const partner = {
  companyId: 8,
  name: 'ООО «Дорсервис»',
  city: 'Казань',
  links: [
    {
      kind: 'co_participation',
      role: 'subcontractor',
      ownRole: 'general_contractor',
      projectId: 55,
      projectName: 'Развязка на М-7',
      assertionId: null,
      modality: null,
      status: null,
    },
  ],
};

const revision = (id: number, body: string) => ({
  revision: {
    id,
    sourceItemId: 11,
    revisionNo: 1,
    title: null,
    body,
    representation: 'telegram_web_text@1',
    bodyHash: 'x',
    completeness: 'full',
    completenessReason: null,
    attachments: [],
    publishedAt: '2026-09-18T07:00:00Z',
    sourceModifiedAt: null,
    firstObservedAt: '2026-09-18T07:30:00Z',
    chronology: 'observed_order',
    sameContentAsRevisionId: null,
    legacyDocumentId: 31,
    origin: 'ingest',
  },
});

const routes = () => [
  {
    match: 'GET /api/companies/7/publications',
    respond: () => ({
      status: 200,
      body: {
        items: [
          publication(),
          publication({ itemId: 12, revisionId: 22, topic: 'Мост через Оку сдан', snippet: 'Второй пост', facts: [] }),
        ],
        nextCursor: null,
      },
    }),
  },
  { match: 'GET /api/revisions/21', respond: () => ({ status: 200, body: revision(21, 'Полный текст первого поста.') }) },
  { match: 'GET /api/revisions/22', respond: () => ({ status: 200, body: revision(22, 'Полный текст второго поста.') }) },
  { match: 'GET /api/companies/7/partners', respond: () => ({ status: 200, body: { items: [partner] } }) },
  { match: 'GET /api/companies/7/projects', respond: () => ({ status: 200, body: { items: [] } }) },
  { match: 'GET /api/companies/7/events', respond: () => ({ status: 200, body: { items: [] } }) },
  { match: 'GET /api/companies/7/similar', respond: () => ({ status: 200, body: { items: [] } }) },
  { match: 'GET /api/companies/7/signals', respond: () => ({ status: 200, body: { status: 'not_computed', refresh: { active: null, lastFailure: null, running: false, stale: true, staleReasons: ['сигналы ещё не рассчитывались'] }, signals: null } }) },
  { match: 'GET /api/companies/7/mentions', respond: () => ({ status: 200, body: { items: [], nextCursor: null } }) },
  {
    match: 'GET /api/companies/7/dossier-summary',
    respond: () => ({
      status: 200,
      body: {
        generatedAt: '2026-09-21T10:00:00Z',
        signalsCutoff: null,
        stale: false,
        staleReasons: [],
        summary: [],
        counterparties: { contracts: [], corporate: [], coParticipants: [] },
        contradictions: [],
        limits: [],
      },
    }),
  },
  { match: 'GET /api/companies/7', respond: () => ({ status: 200, body: company }) },
];

describe('Карточка компании', () => {
  it('обзор — сводка и контрагенты, без ленты публикаций', async () => {
    fakeApi(routes());
    renderCard();

    expect(await screen.findByText('ООО «Дорсервис»')).toBeTruthy();
    expect(screen.getByText('Коротко')).toBeTruthy();
    expect(screen.queryByText('Подряд на развязку передан другой фирме')).toBeNull();
  });

  it('совместное участие подписано как «вместе на объекте», а не как договор', async () => {
    fakeApi(routes());
    renderCard();

    const row = (await screen.findByText('ООО «Дорсервис»')).closest('li')!;
    expect(within(row).getByText('вместе на объекте')).toBeTruthy();
    // Договором это называть нельзя: две фирмы на объекте могут не иметь отношений.
    expect(within(row).queryByText('договор')).toBeNull();
    expect(within(row).getByText(/мы — генподрядчик, они — субподрядчик/)).toBeTruthy();
  });

  it('сводка не выдумывает числа, когда снимок сигналов не рассчитан', async () => {
    fakeApi(routes());
    renderCard();

    expect(await screen.findByText(/Сигналы ещё не рассчитывались/)).toBeTruthy();
    expect(screen.getByText(/станет известно после пересчёта сигналов/)).toBeTruthy();
  });

  it('вкладка «Публикации»: список и пост рядом, первый пост открыт сразу', async () => {
    fakeApi(routes());
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Публикации' }));

    expect(await screen.findByText('Подряд на развязку передан другой фирме')).toBeTruthy();
    expect(await screen.findByText('Полный текст первого поста.')).toBeTruthy();
    // Что сказано о компании — одной строкой; пустое «упоминание» не шумит.
    expect(screen.getByText('генподрядчик · Развязка на М-7')).toBeTruthy();
    expect(screen.queryByText(/упоминание/)).toBeNull();
  });

  it('нажатие в любое место карточки публикации открывает её пост', async () => {
    fakeApi(routes());
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Публикации' }));
    await screen.findByText('Полный текст первого поста.');

    // Нажимаем не на заголовок, а на сниппет второй карточки.
    fireEvent.click(screen.getByText('Второй пост'));
    expect(await screen.findByText('Полный текст второго поста.')).toBeTruthy();
  });

  it('старые упоминания — во вкладке «Подробно» и объясняют свою пустоту', async () => {
    fakeApi(routes());
    renderCard();
    await screen.findByText('ООО «Дорсервис»');

    expect(screen.queryByText(/Упоминаний старого разбора нет/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Подробно' }));

    expect(await screen.findByText(/Упоминаний старого разбора нет/)).toBeTruthy();
  });
});
