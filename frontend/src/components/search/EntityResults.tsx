// Поиск от двух символов: «Компании» и «Объекты». Каждый результат ведёт в свою карточку;
// с 600px — таблицы, на телефоне — карточки. Фильтры каталога при поиске не сбрасываются:
// они в адресе и вернутся, когда запрос очистят.

import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { ICompanySearchItem, IProjectSearchItem } from '../../api/types';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { formatCount } from '../../lib/format';
import { describeLoadError } from '../../lib/loadError';
import { MQ } from '../../lib/media';
import { LoadingSkeleton } from '../LoadingSkeleton';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { EmptyState } from '../ui/EmptyState';
import { Section } from '../ui/Section';
import { Stack } from '../ui/Stack';
import { AddCompanyByInn, missingIdentifier } from '../company/AddCompanyByInn';
import { CompanyResults } from './CompanyResults';
import { ProjectResults } from './ProjectResults';

interface IEntityResultsProps {
  query: string;
  onClear: () => void;
}

export const EntityResults: FC<IEntityResultsProps> = ({ query, onClear }) => {
  const wide = useMediaQuery(MQ.sm);
  const companies = useQuery({
    queryKey: ['search', 'companies', query],
    queryFn: () => api.get<{ items: ICompanySearchItem[] }>(`/api/companies?q=${encodeURIComponent(query)}&limit=25`),
  });
  const projects = useQuery({
    queryKey: ['search', 'projects', query],
    queryFn: () => api.get<{ items: IProjectSearchItem[] }>(`/api/projects/search?q=${encodeURIComponent(query)}&limit=25`),
  });
  const found = companies.data?.items ?? [];
  const foundProjects = projects.data?.items ?? [];
  // Набран реквизит, а карточки с ним нет — предложить завести компанию (ADR-016).
  const missing = companies.isSuccess ? missingIdentifier(query, found.flatMap(c => c.identifiers ?? [])) : null;

  if (companies.isLoading || projects.isLoading) {
    return <LoadingSkeleton label="Ищу компании и объекты…" lines={6} height="44px" />;
  }
  if (companies.isError || projects.isError) {
    return (
      <Callout
        tone="danger"
        title="Поиск не удался"
        action={
          <Button
            onClick={() => {
              void companies.refetch();
              void projects.refetch();
            }}
          >
            Повторить
          </Button>
        }
      >
        {describeLoadError(companies.error ?? projects.error)}
      </Callout>
    );
  }
  if (found.length === 0 && foundProjects.length === 0) {
    if (missing) return <AddCompanyByInn identifier={missing} />;
    return (
      <EmptyState title="Ничего не найдено" icon="search" action={<Button onClick={onClear}>Очистить поиск</Button>}>
        Компании и объекты не найдены. Проверьте написание или попробуйте часть названия.
      </EmptyState>
    );
  }

  // Карточки на телефоне сами по себе карточки: раздел вокруг них — без рамки.
  const variant = wide ? 'card' : 'plain';
  return (
    <Stack gap={4}>
      {missing && <AddCompanyByInn identifier={missing} />}
      {found.length > 0 && (
        <Section title="Компании" note={`найдено: ${formatCount(found.length)}`} variant={variant}>
          <CompanyResults items={found} wide={wide} />
        </Section>
      )}
      {foundProjects.length > 0 && (
        <Section title="Объекты" note={`найдено: ${formatCount(foundProjects.length)}`} variant={variant}>
          <ProjectResults items={foundProjects} wide={wide} />
        </Section>
      )}
    </Stack>
  );
};
