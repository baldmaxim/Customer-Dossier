// Содержимое одной вкладки «Источников». Порядок — как идёт работа оператора:
// что сломалось («Не собираются») → список → добавить новый. На «Вручную» наоборот:
// там главное действие — вставить текст, список способов вторичен.

import { FC, ReactNode } from 'react';

import type { ISourceRow } from '../../api/types';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { formatCount } from '../../lib/format';
import { MQ } from '../../lib/media';
import { Callout } from '../ui/Callout';
import { Disclosure } from '../ui/Disclosure';
import { EmptyState } from '../ui/EmptyState';
import { Section } from '../ui/Section';
import { Stack } from '../ui/Stack';
import { AddChannelForm } from './AddChannelForm';
import { AddSiteForm } from './AddSiteForm';
import { DomRfTargets } from './DomRfTargets';
import { ManualPaste } from './ManualPaste';
import { SourceCards } from './SourceCards';
import { SourcesTable } from './SourcesTable';
import { isSourceEnabled, type ISourceActions } from './useSourceActions';
import styles from './Forms.module.css';

type Kind = ISourceRow['kind'];

const LIST_TITLES: Record<Kind, string> = {
  telegram: 'Каналы',
  website: 'Сайты',
  manual: 'Способы ручной передачи',
};

const EMPTY: Record<Kind, string> = {
  telegram: 'Каналов пока нет — добавьте первый ниже.',
  website: 'Сайтов пока нет — добавьте первый ниже.',
  manual: 'Способов ручной передачи нет.',
};

const ADD_TITLES: Record<Exclude<Kind, 'manual'>, string> = {
  telegram: 'Добавить канал',
  website: 'Добавить сайт',
};

const ADD_HINTS: Record<Exclude<Kind, 'manual'>, string> = {
  telegram:
    'Только публичные каналы: страница t.me/s/имя должна открываться без входа. Закрытые каналы читаются пересылкой боту — он во вкладке «Вручную».',
  website: 'Сайт читается через RSS или список статей. У RSS нет архива — только последние записи, срок сбора его не углубит.',
};

interface ISourcesPanelProps {
  kind: Kind;
  sources: ISourceRow[];
  actions: ISourceActions;
  label: string;
}

export const SourcesPanel: FC<ISourcesPanelProps> = ({ kind, sources, actions, label }) => {
  const wide = useMediaQuery(MQ.md);
  const phone = !useMediaQuery(MQ.sm);
  const ofKind = sources.filter(s => s.kind === kind);
  const on = ofKind.filter(isSourceEnabled).length;
  const broken = ofKind.filter(s => s.status === 'broken' && isSourceEnabled(s));

  const addForm = (addKind: Exclude<Kind, 'manual'>): ReactNode => {
    const body = (
      <Stack gap={3}>
        <p className={styles.hint}>{ADD_HINTS[addKind]}</p>
        {addKind === 'telegram' ? <AddChannelForm /> : <AddSiteForm />}
      </Stack>
    );
    // На телефоне форма не занимает экран под списком: раскрывается по нажатию.
    return phone ? (
      <Disclosure variant="card" summary={ADD_TITLES[addKind]}>
        {body}
      </Disclosure>
    ) : (
      <Section title={ADD_TITLES[addKind]}>{body}</Section>
    );
  };

  return (
    <Stack gap={5}>
      {kind === 'manual' && (
        <Section title="Вставить текст вручную">
          <ManualPaste />
        </Section>
      )}

      {broken.length > 0 && (
        <Callout tone="warning" title={`Не собираются: ${formatCount(broken.length)}`}>
          Обычная причина — изменилась вёрстка страницы или канал стал закрытым. Что именно — в строке источника, «Подробнее».
        </Callout>
      )}

      <Section
        title={LIST_TITLES[kind]}
        note={ofKind.length > 0 ? `включено ${formatCount(on)} из ${formatCount(ofKind.length)}` : undefined}
      >
        {ofKind.length === 0 ? (
          <EmptyState size="sm">{EMPTY[kind]}</EmptyState>
        ) : wide ? (
          <SourcesTable kind={kind} sources={ofKind} actions={actions} label={label} />
        ) : (
          <SourceCards kind={kind} sources={ofKind} actions={actions} label={label} />
        )}
      </Section>

      {kind !== 'manual' && addForm(kind)}
      {kind === 'website' && <DomRfTargets />}
    </Stack>
  );
};
