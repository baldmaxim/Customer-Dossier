// Старые ссылки на экран «Связи» (/links?company=N, /links?project=N): экран снят 06.10.2026, схема —
// окном на карточке. Ссылка из закладки или отчёта ведёт на карточку центра, без центра — на главную.

import { FC } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';

const parseId = (raw: string | null): number | null => {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

export const LinksRedirect: FC = () => {
  const [params] = useSearchParams();
  const company = parseId(params.get('company'));
  const project = parseId(params.get('project'));
  const to = company ? `/company/${company}` : project ? `/projects/${project}` : '/';
  return <Navigate to={to} replace />;
};
