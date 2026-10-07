// Строка состояния над разделами админки: идёт ли сбор, разбор, перенос в карточки и
// отвечает ли модель — словами, а не шестью ярлыками с именами переменных окружения.
//
// «Остановлено» — решение владельца в настройках сервера, а не поломка: нейтральный тон.
// Предупреждение — только там, где обработка ждёт, хотя должна идти (модель не отвечает).
// Как это настраивается (имена переменных) — только в пояснении и только администратору.
//
// На телефоне строка короче: только то, что требует внимания или остановлено; всё в порядке —
// один ярлык «Обработка идёт». Четыре ярлыка в три строки отодвигали разделы за первый экран.

import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { IPipelineOverview } from '../../api/types';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Cluster } from '../../components/ui/Cluster';
import { Hint } from '../../components/ui/Hint';
import { Loading } from '../../components/ui/Loading';
import { Skeleton } from '../../components/ui/Skeleton';
import { useAuth } from '../../hooks/useAuth';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { MQ } from '../../lib/media';
import { modelTone, switchTone, type StatusTone } from '../../lib/statusTone';
import styles from './AdminStatus.module.css';

type Worker = IPipelineOverview['worker'];
type Model = IPipelineOverview['model'];

interface IStatusItem {
  key: string;
  label: string;
  tone: StatusTone;
}

const statusItems = (worker: Worker, model: Model): IStatusItem[] => [
  { key: 'ingest', label: worker.ingestEnabled ? 'Сбор идёт' : 'Сбор остановлен', tone: switchTone(worker.ingestEnabled) },
  {
    key: 'pipeline',
    // Разбор включён, но модели нет — он ждёт: собранное не теряется, запуски не падают.
    label: !worker.pipelineEnabled ? 'Разбор остановлен' : model.ok ? 'Разбор идёт' : 'Разбор ждёт модель',
    tone: !worker.pipelineEnabled ? 'neutral' : modelTone(model.ok),
  },
  {
    key: 'publish',
    label: worker.autoPublish ? 'Перенос в карточки идёт' : 'Перенос в карточки выключен',
    tone: switchTone(worker.autoPublish),
  },
  { key: 'model', label: model.ok ? 'Модель отвечает' : 'Модель не отвечает', tone: modelTone(model.ok) },
];

const onOff = (on: boolean): string => (on ? 'включён' : 'выключен');

/** Пояснение: что ещё настроено на сервере. Имена переменных — только тому, кто правит настройки. */
const statusHint = (worker: Worker, model: Model, technical: boolean): string => {
  const env = (name: string, on: boolean): string => (technical ? ` (${name}=${on ? 'true' : 'false'})` : '');
  const parts = [
    `Сбор ${onOff(worker.ingestEnabled)}${env('INGEST_ENABLED', worker.ingestEnabled)}.`,
    `Разбор ${onOff(worker.pipelineEnabled)}${env('PIPELINE_ENABLED', worker.pipelineEnabled)}.`,
    `Перенос в карточки ${onOff(worker.autoPublish)}${env('REPROCESS_AUTO_PUBLISH', worker.autoPublish)}.`,
    `Повтор упавшего разбора ${onOff(worker.retryEnabled)}${worker.retryEnabled ? `, до ${worker.retryMax} попыток` : ''}${env('REPROCESS_RETRY_ENABLED', worker.retryEnabled)}.`,
    model.ok
      ? 'Модель отвечает.'
      : `Модель не отвечает${model.error ? `: ${model.error}` : ''}. Пока её нет, разбор ждёт — собранное не теряется.`,
    technical ? 'Меняется в .env сервера, из портала — нельзя.' : 'Всё это включается в настройках сервера, из портала — нельзя.',
  ];
  return parts.join(' ');
};

/** Телефон: только отклонения от «всё идёт»; если их нет — один общий ярлык. */
const compactItems = (items: IStatusItem[]): IStatusItem[] => {
  const notable = items.filter(item => item.tone !== 'success');
  return notable.length > 0 ? notable : [{ key: 'all', label: 'Обработка идёт', tone: 'success' }];
};

export const AdminStatus: FC = () => {
  const { can } = useAuth();
  const wide = useMediaQuery(MQ.sm);
  const pipeline = useQuery({
    queryKey: ['pipeline'],
    queryFn: () => api.get<IPipelineOverview>('/api/admin/pipeline'),
  });

  if (pipeline.isLoading) {
    return (
      <Loading label="Проверяю, идёт ли обработка…">
        <Skeleton width="20rem" height="22px" radius="full" />
      </Loading>
    );
  }
  const worker = pipeline.data?.worker;
  const model = pipeline.data?.model;
  if (pipeline.isError || !worker || !model) {
    return (
      <Cluster gap={2}>
        <Badge tone="neutral">Состояние обработки не получено</Badge>
        <Button variant="link" size="sm" onClick={() => void pipeline.refetch()}>
          Повторить
        </Button>
      </Cluster>
    );
  }

  const technical = can('users.manage') || can('llm.manage');
  return (
    <Cluster as="ul" gap={[1, 2]} aria-label="Состояние обработки">
      {(wide ? statusItems(worker, model) : compactItems(statusItems(worker, model))).map(item => (
        <li key={item.key}>
          <Badge tone={item.tone}>{item.label}</Badge>
        </li>
      ))}
      <li className={styles.hintItem}>
        <Hint label="состояние обработки" text={statusHint(worker, model, technical)} />
      </li>
    </Cluster>
  );
};
