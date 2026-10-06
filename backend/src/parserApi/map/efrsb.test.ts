// Сообщения ЕФРСБ (bankruptcy-map@2) и основания окончания ФССП (fssp-map@2) без сети, 06.10.2026.
// Форма и слова — как в живых ответах parser-api.com (архив counterparty-risk: 15 списков, 415 сообщений, 483
// производства ФССП); имена, номера и суммы — синтетические.

import { describe, expect, it } from 'vitest';

import type { IDatasetPayload, IDatasetResponse } from '../datasets.js';
import { actEffect, efrsbDate, efrsbType, mapBankruptcy, messageKind } from './bankruptcy.js';
import { mapFssp, stopMeaning } from './fssp.js';

const INN = '7736255508';

const payload = (dataset: IDatasetPayload['dataset'], responses: IDatasetResponse[], missing: string[] = []): IDatasetPayload => ({
  format: 'parser-api-dataset@1',
  dataset,
  inn: INN,
  window: null,
  missing,
  responses,
});

const search: IDatasetResponse = {
  method: 'fedresurs_ur',
  params: { orgCode: INN },
  body: { success: 1, total_count: '1', records: [{ id: 'D1', inn: INN, debtor: 'ООО «ДЕМО»', category: 'Обычная организация', region: 'г. Москва' }] },
};

const list = (records: Array<[string, string, string]>, total = records.length): IDatasetResponse => ({
  method: 'fedresurs_messages',
  params: { id: 'D1' },
  body: { success: 1, total_count: String(total), records: records.map(([id, date, type]) => ({ id, date: `${date} 12:00:00`, type, manager_name: 'Петров П. П.' })) },
});

const card = (id: string, date: string, act: string, over: Record<string, unknown> = {}): IDatasetResponse => ({
  method: 'fedresurs_message',
  params: { id },
  body: { success: 1, record: { id, act, act_type: null, date_published: date, type: 'Сообщение о судебном акте', case_num: 'А40-1/2025', is_actual: 1, ...over } },
});

describe('ЕФРСБ: разбор слов (bankruptcy-map@2)', () => {
  it('даты ЕФРСБ — в ISO; пометка «(аннулировано)» снимается с типа и ставит признак', () => {
    expect(efrsbDate('16.10.2025 14:48:09')).toBe('2025-10-16');
    expect(efrsbDate('09.04.2020')).toBe('2020-04-09');
    expect(efrsbDate('нет')).toBeNull();
    expect(efrsbType('Сообщение о собрании кредиторов (аннулировано)')).toEqual({ type: 'Сообщение о собрании кредиторов', annulled: true });
  });

  it('вид сообщения по типу; судебный акт по сделке — про сделки, а не про процедуру', () => {
    expect(messageKind('Сообщение о судебном акте')).toBe('court_act');
    expect(messageKind('Судебный акт по результатам рассмотрения заявления об оспаривании сделки должника')).toBe('transactions');
    expect(messageKind('Судебный акт по результатам рассмотрения заявления о привлечении контролирующих должника лиц к субсидиарной ответственности')).toBe('liability');
    expect(messageKind('Сообщение о результатах проведения собрания кредиторов')).toBe('meeting');
    expect(messageKind('Уведомление о получении требований кредитора')).toBe('claims');
    expect(messageKind('Сообщение о включении заявленных требований в реестр требований кредиторов')).toBe('claims');
    expect(messageKind('Объявление о проведении торгов')).toBe('sale');
    expect(messageKind('Сведения о заключении договора купли-продажи')).toBe('sale');
    expect(messageKind('Отчет оценщика об оценке имущества должника')).toBe('property');
    expect(messageKind('Аннулирование ранее опубликованного сообщения')).toBe('annulment');
    expect(messageKind('Иное сообщение')).toBe('other');
  });

  it('акт: введение, прекращение и завершение — процедура; продление и смена управляющего — нет; незнакомое — null', () => {
    expect(actEffect('о введении наблюдения')).toBe('observation');
    expect(actEffect('о признании должника банкротом и открытии конкурсного производства')).toBe('competition');
    expect(actEffect('о завершении конкурсного производства')).toBe('completed');
    expect(actEffect('о прекращении производства по делу')).toBe('terminated');
    expect(actEffect('о продлении срока процедуры')).toBe('procedural');
    expect(actEffect('об освобождении или отстранении арбитражного управляющего')).toBe('procedural');
    expect(actEffect('о завершении реализации имущества гражданина')).toBe('completed');
    expect(actEffect('о чём-то новом')).toBeNull();
    expect(actEffect(null)).toBeNull();
  });
});

describe('ЕФРСБ: сообщения и процедура (bankruptcy-map@2)', () => {
  it('процедура — последний неаннулированный акт, меняющий её; продление после — отдельной строкой', () => {
    const view = mapBankruptcy(
      payload('bankruptcy', [
        search,
        list([
          ['M5', '01.05.2026', 'Сообщение о судебном акте (аннулировано)'],
          ['M4', '01.04.2026', 'Сообщение о судебном акте'],
          ['M3', '01.03.2026', 'Сообщение о собрании кредиторов'],
          ['M2', '01.02.2026', 'Сообщение о судебном акте'],
          ['M1', '01.01.2026', 'Сообщение о судебном акте'],
          ['M0', '15.12.2025', 'Сообщение о собрании кредиторов (аннулировано)'],
        ]),
        card('M4', '01.04.2026', 'о продлении срока процедуры'),
        card('M2', '01.02.2026', 'о признании должника банкротом и открытии конкурсного производства'),
        card('M1', '01.01.2026', 'о введении наблюдения'),
      ]),
    );
    expect(view).toMatchObject({ recognized: true, found: true, record: { name: 'ООО «ДЕМО»', region: 'г. Москва' } });
    expect(view.procedureAct).toMatchObject({ messageId: 'M2', date: '2026-02-01', effect: 'competition', caseNumber: 'А40-1/2025' });
    expect(view.laterAct).toMatchObject({ messageId: 'M4', effect: 'procedural' });
    expect(view.courtActs!.map(a => a.messageId)).toEqual(['M4', 'M2', 'M1']);
    expect(view.courtActsCoverage).toEqual({ listed: 3, fetched: 3 });
    expect(view.messages).toMatchObject({ total: 6, loaded: 6, complete: true, first: '2025-12-15', last: '2026-05-01', annulled: 2 });
    expect(view.messages!.byKind).toEqual([{ kind: 'court_act', count: 3 }, { kind: 'meeting', count: 1 }]);
    expect(view.caseNumbers).toEqual(['А40-1/2025']);
  });

  it('аннулированный акт (is_actual = 0) процедурой не считается; прекращение после введения — последнее слово', () => {
    const view = mapBankruptcy(
      payload('bankruptcy', [
        search,
        list([
          ['M3', '01.03.2026', 'Сообщение о судебном акте'],
          ['M2', '01.02.2026', 'Сообщение о судебном акте'],
          ['M1', '01.01.2026', 'Сообщение о судебном акте'],
        ]),
        card('M3', '01.03.2026', 'о признании должника банкротом и открытии конкурсного производства', { is_actual: 0 }),
        card('M2', '01.02.2026', 'о прекращении производства по делу'),
        card('M1', '01.01.2026', 'о введении наблюдения'),
      ]),
    );
    expect(view.procedureAct).toMatchObject({ messageId: 'M2', effect: 'terminated' });
    expect(view.laterAct).toBeNull();
    expect(view.courtActs!.find(a => a.messageId === 'M3')).toMatchObject({ annulled: true });
  });

  it('карточки получены не все — покрытие словами; незнакомый тип сообщения не прячется', () => {
    const view = mapBankruptcy(
      payload(
        'bankruptcy',
        [search, list([['M2', '01.02.2026', 'Сообщение о судебном акте'], ['M1', '01.01.2026', 'Новый вид сообщения']], 5), card('M2', '01.02.2026', 'о введении наблюдения')],
        ['сообщения 3–5: предел страниц списка'],
      ),
    );
    expect(view.messages).toMatchObject({ total: 5, loaded: 2, complete: false, otherTypes: ['Новый вид сообщения'] });
    expect(view.courtActsCoverage).toEqual({ listed: 1, fetched: 1 });
    expect(view.missing).toEqual(['сообщения 3–5: предел страниц списка']);
  });

  it('снимок до bankruptcy-map@2 (карточка get_org без сообщений) — найден, сообщения не запрашивались', () => {
    const view = mapBankruptcy(payload('bankruptcy', [search, { method: 'fedresurs_org', params: { id: 'D1' }, body: { success: 1, record: { full_name: 'ОБЩЕСТВО «ДЕМО»' } } }]));
    expect(view).toMatchObject({ found: true, record: { name: 'ОБЩЕСТВО «ДЕМО»' }, messages: null, courtActs: null, procedureAct: null });
  });
});

describe('ФССП: основание окончания по 229-ФЗ (fssp-map@2)', () => {
  it('ссылка на закон → значение; написание без пробелов тоже', () => {
    expect(stopMeaning('ст. 46 ч. 1 п. 3')).toBe('not_found');
    expect(stopMeaning('ст. 46 ч. 1 п. 4')).toBe('no_property');
    expect(stopMeaning('ст.46 ч.1 п.4')).toBe('no_property');
    expect(stopMeaning('ст. 46 ч. 1 п. 1')).toBe('returned');
    expect(stopMeaning('ст. 47 ч. 1 п. 1')).toBe('executed');
    expect(stopMeaning('ст. 47 ч. 1 п. 6')).toBe('periodic');
    expect(stopMeaning('ст. 47 ч. 1 п. 7')).toBe('bankruptcy');
    expect(stopMeaning('ст. 47 ч. 1 п. 8')).toBe('liquidation');
    expect(stopMeaning('ст. 43 ч. 2 п. 1')).toBe('terminated');
    expect(stopMeaning('ст. 47 ч. 1 п. 3')).toBe('other');
    expect(stopMeaning('по решению суда')).toBe('other');
    expect(stopMeaning(null)).toBe('other');
  });

  it('окончено без взыскания (не найдены, нет имущества) — отдельно, с суммой долга «у K из N»', () => {
    const row = (n: number, reason: string, debt: number | null) => ({
      process_title: `${n}/25/77007-ИП`,
      process_date: '2025-03-01',
      stop_date: '2025-09-01',
      stop_reason: reason,
      subjects: [{ title: 'Штраф как вид наказания' }, ...(debt !== null ? [{ title: 'Сумма долга', sum: String(debt) }] : [])],
    });
    const view = mapFssp(
      payload('fssp', [
        {
          method: 'fssp_ur',
          params: { inn: INN },
          body: {
            done: 1,
            total_rows_count: '5',
            total_pages_count: 1,
            result: [row(1, 'ст. 46 ч. 1 п. 4', 1000), row(2, 'ст. 46 ч. 1 п. 3', null), row(3, 'ст. 47 ч. 1 п. 7', 500), row(4, 'ст. 47 ч. 1 п. 7', 250), row(5, 'ст. 46 ч. 1 п. 4', 200)],
          },
        },
      ]),
      '2026-10-06T08:00:00Z',
      true,
    );
    expect(view.ended.count).toBe(5);
    expect(view.ended.uncollected).toEqual({ count: 3, debt: 1200, debtCovered: 2 });
    expect(view.ended.byMeaning).toEqual([
      { meaning: 'no_property', count: 2, debt: 1200, debtCovered: 2 },
      { meaning: 'bankruptcy', count: 2, debt: 750, debtCovered: 2 },
      { meaning: 'not_found', count: 1, debt: 0, debtCovered: 0 },
    ]);
    expect(view.ended.byReason[0]).toEqual({ reason: 'ст. 46 ч. 1 п. 4', meaning: 'no_property', count: 2, debt: 1200, debtCovered: 2 });
  });
});
