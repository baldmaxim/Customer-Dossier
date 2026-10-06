// Содержимое одной вкладки «Источников». Шапка списка — одна строка: «Каналы · включено 4 из 6»,
// фильтр «Не собираются: N» и форма добавления справа; под ней — сам список. Прежде «Не собираются»
// было большой плашкой над списком, а форма добавления — отдельной карточкой под ним.
//
// На «Вручную» сначала вставка текста — там это главное действие, список способов вторичен;
// на «Сайтах» под списком — вход на страницу наш.дом.рф (компании, объекты и карточки — там, вкладками).

import { FC } from 'react';

import type { ISourceRow } from '../../api/types';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { flagParam, useUrlState } from '../../hooks/useUrlState';
import { formatCount } from '../../lib/format';
import { MQ } from '../../lib/media';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Hint } from '../ui/Hint';
import { Section } from '../ui/Section';
import { Stack } from '../ui/Stack';
import { DomRfEntry } from './DomRfEntry';
import { FocusEntry } from './FocusEntry';
import { ParserApiEntry } from './ParserApiEntry';
import { CompanySitesEntry } from './CompanySitesEntry';
import { MANUAL_HINT, ManualPaste } from './ManualPaste';
import { SourceAdd } from './SourceAdd';
import { SourceCards } from './SourceCards';
import { SourcesTable } from './SourcesTable';
import { isSourceBroken, isSourceEnabled, type ISourceActions } from './useSourceActions';
import styles from './Sources.module.css';

type Kind = ISourceRow['kind'];

const LIST_TITLES: Record<Kind, string> = {
  telegram: 'Каналы',
  website: 'Сайты',
  manual: 'Способы ручной передачи',
};

const EMPTY: Record<Kind, string> = {
  telegram: 'Каналов пока нет — добавьте первый.',
  website: 'Сайтов пока нет — добавьте первый.',
  manual: 'Способов ручной передачи нет.',
};

interface ISourcesPanelProps {
  kind: Kind;
  sources: ISourceRow[];
  actions: ISourceActions;
  label: string;
}

export const SourcesPanel: FC<ISourcesPanelProps> = ({ kind, sources, actions, label }) => {
  const wide = useMediaQuery(MQ.md);
  // Фильтр в адресе (?problems=1): ссылкой можно поделиться, «Назад» его не перебирает.
  const [problems, setProblems] = useUrlState('problems', flagParam());
  const ofKind = sources.filter(s => s.kind === kind);
  const on = ofKind.filter(isSourceEnabled).length;
  const broken = ofKind.filter(isSourceBroken);
  // Фильтр действует, пока есть кого показать: иначе список пуст, а снять фильтр нечем.
  const onlyBroken = problems && broken.length > 0;
  const shown = onlyBroken ? broken : ofKind;

  const note = ofKind.length > 0 && (
    <span className={styles.headNote}>
      <span>
        включено {formatCount(on)} из {formatCount(ofKind.length)}
      </span>
      {broken.length > 0 && (
        <Button
          size="sm"
          icon="warning"
          iconEnd={onlyBroken ? 'close' : undefined}
          aria-pressed={onlyBroken}
          className={styles.problems}
          hint={onlyBroken ? 'Показать все' : 'Показать только их'}
          onClick={() => setProblems(!onlyBroken)}
        >
          Не собираются: {formatCount(broken.length)}
        </Button>
      )}
    </span>
  );

  return (
    <Stack gap={4}>
      {kind === 'manual' && (
        <Section
          title="Вставить текст вручную"
          note={
            // Строкой, а не рядом блоков: на телефоне «?» остаётся в конце текста, а не уходит вниз.
            <>
              закрытые каналы и статьи, которые портал не собирает сам{' '}
              <span className={styles.hintSlot}>
                <Hint label="Вставить текст вручную" text={MANUAL_HINT} />
              </span>
            </>
          }
        >
          <ManualPaste />
        </Section>
      )}

      {/* Таблице нужна поверхность; карточки — сами поверхности, рамка вокруг них — лишняя. */}
      <Section
        title={LIST_TITLES[kind]}
        note={note}
        actions={kind === 'manual' ? undefined : <SourceAdd kind={kind} />}
        variant={wide ? 'card' : 'plain'}
      >
        {ofKind.length === 0 ? (
          <EmptyState size="sm">{EMPTY[kind]}</EmptyState>
        ) : wide ? (
          <SourcesTable kind={kind} sources={shown} actions={actions} label={label} />
        ) : (
          <SourceCards kind={kind} sources={shown} actions={actions} label={label} />
        )}
      </Section>

      {kind === 'website' && <DomRfEntry />}
      {kind === 'website' && <FocusEntry />}
      {kind === 'website' && <ParserApiEntry />}
      {kind === 'website' && <CompanySitesEntry />}
    </Stack>
  );
};
