// Карточка компании: обзор — досье с ключевыми основаниями, публикации — исходные тексты.
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
  basis: 'participation',
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
      kind: 'contract',
      role: 'subcontractor',
      ownRole: 'general_contractor',
      projectId: 55,
      projectName: 'Развязка на М-7',
      assertionId: 101,
      modality: null,
      status: null,
    },
  ],
};

const projectRow = (over: Record<string, unknown> = {}) => ({
  id: 55,
  name: 'Развязка на М-7',
  kind: 'infrastructure',
  stage: 'construction',
  city: 'Казань',
  plannedCompletion: null,
  actualCompletion: null,
  role: 'general_contractor',
  confidence: 0.9,
  isCurrent: true,
  counterparties: [{ id: 9, name: 'АО «Мостотрест»', role: 'designer' }],
  ...over,
});

const projects = [projectRow(), projectRow({ role: 'customer', counterparties: null })];

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
  { match: 'GET /api/revisions/44', respond: () => ({ status: 200, body: revision(44, 'Сохранённый текст сообщения об объекте.') }) },
  { match: 'GET /api/companies/7/partners', respond: () => ({ status: 200, body: { items: [partner] } }) },
  { match: 'GET /api/companies/7/projects', respond: () => ({ status: 200, body: { items: projects } }) },
  { match: 'GET /api/projects/55/dossier', respond: () => ({ status: 200, body: {
    project: { id: 55, name: 'Развязка на М-7', kind: 'infrastructure', city: 'Казань', level: 'complex', levelLabel: null,
      parent: null, children: [], mergedIntoId: null },
    period: { from: null, to: null },
    state: { current: [{ building: null, state: 'construction', validFrom: '2026-08-01', periodPrecision: 'day' }], history: [] },
    participants: [{ companyId: 7, companyName: 'ООО «Мостострой»', role: 'general_contractor', building: null,
      workPackage: 'дорожные работы', validFrom: null, validTo: null, periodPrecision: 'unknown', inPeriod: 'no_period_selected',
      statement: { code: 'participation', text: 'Мостострой строит развязку', attribution: 'source_reported', assertionIds: [101], evidenceIds: [], quotes: [] } }],
    notCounted: [], contracts: [{ code: 'contract', text: 'Договор на строительство', attribution: 'source_reported', assertionIds: [], evidenceIds: [], quotes: [] }],
    coParticipationNote: 'Совместное участие не означает договор.',
    events: [{ code: 'event', text: 'Начало работ', attribution: 'source_reported', assertionIds: [], evidenceIds: [77], quotes: [{
      evidenceId: 77, quote: 'Начало работ', sourceTitle: 'Стройканал', sourceKey: 'stroykanal',
      sourceKind: 'telegram', url: 'https://t.me/stroykanal/44', observedAt: '2026-09-18T07:30:00Z',
      title: null, revisionId: 44, publishedAt: '2026-09-18T07:00:00Z', stance: 'supports',
    }] }],
    cases: [], registry: null,
  } }) },
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
  it('досье — сводка и контрагенты, без ленты публикаций', async () => {
    fakeApi(routes());
    renderCard();

    expect(await screen.findByText('ООО «Дорсервис»')).toBeTruthy();
    expect(screen.getByText('Портрет компании')).toBeTruthy();
    expect(screen.queryByText('Подряд на развязку передан другой фирме')).toBeNull();
  });

  it('досье показывает найденные объекты: объект один раз, роли ярлыками', async () => {
    fakeApi(routes());
    renderCard();

    const section = (await screen.findByRole('heading', { name: 'Объекты' })).closest('section')!;
    expect(await within(section).findAllByRole('button', { name: /Развязка на М-7/ })).toHaveLength(1);
    expect(within(section).getByText('генподрядчик')).toBeTruthy();
    expect(within(section).getByText('заказчик')).toBeTruthy();
    expect(within(section).getByText('Строится')).toBeTruthy();
    expect(screen.getByText(/Выберите объект слева/)).toBeTruthy();
    fireEvent.click(within(section).getByRole('button', { name: /Развязка на М-7/ }));
    expect((await screen.findAllByText('Договор на строительство')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Начало работ').length).toBeGreaterThan(0);
    const projectDetail = document.getElementById('company-project-detail')!;
    expect(within(projectDetail).queryByText('ООО «Мостострой»')).toBeNull();
    expect(within(projectDetail).queryByRole('heading', { name: /Участники/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Открыть объект ↗' }).getAttribute('href')).toBe('/projects/55');
    const sources = screen.getByText('Источники и дополнительные сведения').closest('details') as HTMLDetailsElement;
    expect(sources.open).toBe(false);
    fireEvent.click(screen.getByText('Источники и дополнительные сведения'));
    expect(sources.open).toBe(true);
    expect(within(projectDetail).queryByText('ООО «Мостострой»')).toBeNull();
  });

  it('объект у контрагента подписан словом, а не выглядит ещё одной компанией', async () => {
    fakeApi(routes());
    renderCard();

    const row = (await screen.findByText('ООО «Дорсервис»')).closest('li')!;
    const objectLink = within(row).getByRole('link', { name: '«Развязка на М-7»' });
    expect(objectLink.parentElement!.textContent).toBe('объект «Развязка на М-7»');
  });

  it('прямая связь имеет основание и не смешивается с участниками объекта', async () => {
    fakeApi(routes());
    renderCard();

    const row = (await screen.findByText('ООО «Дорсервис»')).closest('li')!;
    expect(within(row).getByText('договор')).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Проверить основание' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Объекты' })).toBeTruthy();
  });

  it('сводка не выдумывает числа, когда снимок сигналов не рассчитан', async () => {
    fakeApi(routes());
    renderCard();

    expect(await screen.findByText(/Сигналы ещё не рассчитывались/)).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
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

  it('основные сведения реестра видны в блоке объекта без раскрытия источников', async () => {
    fakeApi(routes().map(route => route.match === 'GET /api/projects/55/dossier'
      ? { ...route, respond: () => {
        const response = route.respond();
        return { status: 200, body: { ...response.body, registry: {
          source: { key: 'domrf', title: 'наш.дом.рф' }, externalRef: '62087', asOf: null,
          fetchedAt: '2026-09-28T09:00:00Z', address: 'Москва город, Район Замоскворечье',
          developer: null, groupName: null,
          fields: [
            { label: 'Статус строительства', value: 'Строится' },
            { label: 'Сдача дома', value: 'I кв. 2028' },
            { label: 'Количество квартир', value: '472' },
            { label: 'Генподрядчики', value: 'ООО СУ-10 (ИНН: 7736255508)' },
          ],
          changes: [], coverage: { loaded: 1, truncated: false },
          attribution: 'Текст видимой карточки наш.дом.рф на дату получения.',
        } } };
      } }
      : route));
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /Развязка на М-7/ }));
    const detail = document.getElementById('company-project-detail')!;
    const main = await within(detail).findByRole('region', { name: 'Основные сведения реестра' });
    expect(within(main).getByText('472', { selector: 'strong' })).toBeTruthy();
    expect(within(main).getByText('I кв. 2028', { selector: 'strong' })).toBeTruthy();
    expect(within(main).getByText('ООО СУ-10 (ИНН: 7736255508)', { selector: 'strong' })).toBeTruthy();
    expect((within(main).getByText('Все сведения и изменения').closest('details') as HTMLDetailsElement).open).toBe(false);
    expect(within(detail).queryByText('Источники и дополнительные сведения')).not.toBeNull();
  });

  it('объект из события виден без выдуманной роли участия', async () => {
    fakeApi(routes().map(route => route.match === 'GET /api/companies/7/projects'
      ? { ...route, respond: () => ({ status: 200, body: { items: [...projects, projectRow({
        id: 56, name: 'ЖК Бадаевский', role: null, basis: 'event', confidence: null,
        isCurrent: null, counterparties: null,
      })] } }) }
      : route));
    renderCard();

    const section = (await screen.findByRole('heading', { name: 'Объекты' })).closest('section')!;
    const row = within(section).getByRole('button', { name: /ЖК Бадаевский/ });
    expect(within(row).getByText('из событий · роль не установлена')).toBeTruthy();
    fireEvent.click(row);
    expect(await screen.findByText(/Связь с компанией: событие/)).toBeTruthy();
  });

  it('источник события открывает сохранённую публикацию в модальном окне', async () => {
    fakeApi(routes());
    renderCard();
    const section = (await screen.findByRole('heading', { name: 'Объекты' })).closest('section')!;
    fireEvent.click(within(section).getByRole('button', { name: /Развязка на М-7/ }));

    fireEvent.click((await screen.findAllByRole('button', { name: 'Стройканал — открыть публикацию' }))[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Публикация: Стройканал' });
    expect(await within(dialog).findByText('Сохранённый текст сообщения об объекте.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть публикацию' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByText('Источники и дополнительные сведения'));
    expect(screen.getAllByText('Источник:').length).toBeGreaterThan(0);
  });

  it('событие показывает имя источника вместо безымянной ссылки', async () => {
    fakeApi(routes().map(route => route.match === 'GET /api/companies/7/events'
      ? { ...route, respond: () => ({ status: 200, body: { items: [{
        id: 501, type: 'construction_start', occurredOn: '2026-01-01', severity: 0,
        amountRub: null, quote: 'Начали строительство', confidence: 0.9,
        status: 'text_grounded', projectId: 55, projectName: 'Развязка на М-7',
        counterpartyId: null, counterpartyName: null,
        url: 'https://t.me/stroi_news/501', sourceTitle: 'Стройки — и точка',
        sourceKey: 'stroi_news', sourceKind: 'telegram',
      }] } }) }
      : route));
    renderCard();

    const source = await screen.findByRole('link', { name: 'Стройки — и точка — открыть публикацию' });
    expect(source.textContent).toBe('Стройки — и точка');
    expect(source.getAttribute('href')).toBe('https://t.me/stroi_news/501');
  });

  it('предупреждение о похожих названиях остаётся на обзоре и не занимает место читалки', async () => {
    fakeApi(routes().map(route => route.match === 'GET /api/companies/7/similar'
      ? { ...route, respond: () => ({ status: 200, body: { items: [{ id: 8, name: 'Мостострой-2', city: null }] } }) }
      : route));
    renderCard();
    expect(await screen.findByText(/Похожие названия/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Публикации' }));
    expect(screen.queryByText(/Похожие названия/)).toBeNull();
    expect(await screen.findByText('Полный текст первого поста.')).toBeTruthy();
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

  it('из бывшего «Подробно» статус данных и схема доступны на обзоре, полные основания раскрываются', async () => {
    fakeApi(routes());
    renderCard();
    await screen.findByText('ООО «Дорсервис»');

    expect(screen.queryByRole('button', { name: 'Подробно' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Обзор' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Качество сведений' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Схема связей' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Открыть основания' }));
    expect(await screen.findByRole('heading', { name: 'Резюме' })).toBeTruthy();
  });

  it('на обзоре видны открытые вопросы и краткие сведения реестра', async () => {
    fakeApi(routes().map(route => {
      if (route.match === 'GET /api/companies/7/dossier-summary') return {
        ...route,
        respond: () => ({ status: 200, body: {
          generatedAt: '2026-09-21T10:00:00Z', signalsCutoff: null, stale: false, staleReasons: [],
          summary: [], counterparties: { contracts: [], corporate: [], coParticipants: [] },
          contradictions: [{ kind: 'polarity_conflict', assertionId: 101, priority: 1 }], limits: [], cases: [],
        } }),
      };
      if (route.match === 'GET /api/companies/7') return {
        ...route,
        respond: () => ({ status: 200, body: { ...company, registry: {
          source: { key: 'registry', title: 'Единый реестр' }, externalRef: '123', asOf: '2026-09-20',
          fetchedAt: '2026-09-21', fields: [], developer: { name: 'Мостострой', legalForm: 'ООО', inn: '1655000000', ogrn: null },
          groupName: null, address: null, changes: [], coverage: { loaded: 1, truncated: false },
          attribution: 'По сведениям проектной декларации',
        } } }),
      };
      return route;
    }));
    renderCard();
    expect(await screen.findByText(/противоречий 1/)).toBeTruthy();
    const registry = screen.getByRole('heading', { name: 'Сведения реестра' }).closest('section')!;
    expect(within(registry).getByText('ИНН 1655000000')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Очередь проверки' })).toBeTruthy();
  });
});
