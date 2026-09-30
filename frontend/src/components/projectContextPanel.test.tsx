// Контекст объекта для участия компании: слова без «выборки» и «действительной даты», период с его
// точностью, ошибка загрузки — не «контекст недоступен», а причина и «Повторить».
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { IProjectContext } from '../api/types';
import { fakeApi, renderWithProviders } from '../test/render';
import { ProjectContextPanel } from './ProjectContextPanel';

const context: IProjectContext = {
  cutoff: '2026-09-30T06:00:00Z',
  participations: [
    { assertionId: 101, role: 'customer', building: 'корпус 12', workPackage: null, validFrom: '2024-03-01', validTo: null, periodPrecision: 'month', modality: 'reported_fact', polarity: 'positive', review: 'text_grounded', counted: true },
  ],
  projectEvents: [],
  currentState: [{ building: 'корпус 12', state: 'construction', validFrom: '2026-08-01', periodPrecision: 'day' }],
  note: 'Событие объекта — контекст участия, а не вина компании.',
};

describe('ProjectContextPanel', () => {
  it('состояние по дате события, роль с периодом нужной точности, без «выборки»', async () => {
    fakeApi([{ match: 'GET /api/companies/7/context', respond: () => ({ status: 200, body: context }) }]);
    const { container } = renderWithProviders(<ProjectContextPanel companyId={7} projectId={55} projectName="ЖК «Северная долина»" />);

    expect(await screen.findByText(/Состояние \(по дате события\): корпус 12: строится с 01\.08\.2026/)).toBeTruthy();
    expect(screen.getByText(/заказчик, корпус 12 — с 03\.2024/)).toBeTruthy();
    expect(screen.getByText('Событий объекта в собранных публикациях не найдено.')).toBeTruthy();
    expect(container.textContent).not.toMatch(/выборк|действительной дате/);
  });

  it('ошибка загрузки — причиной и кнопкой «Повторить»', async () => {
    fakeApi([{ match: 'GET /api/companies/7/context', respond: () => ({ status: 500, body: { error: 'db down' } }) }]);
    renderWithProviders(<ProjectContextPanel companyId={7} projectId={55} projectName="ЖК Демо" />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Сбой сервера \(500\)/);
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
  });
});
