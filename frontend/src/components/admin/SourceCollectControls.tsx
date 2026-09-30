// Сбор источника — две ячейки строки: переключатель и срок сбора (глубина истории).
//
// Переключатель — без слова «включён / выключен» рядом: в плотной таблице его положение и цвет
// дорожки читаются сами, а диктору состояние отдаёт role="switch" + aria-checked.
// У ручного способа срока нет — он ничего не собирает сам, только принимает вставленное.

import { FC } from 'react';

import type { ISourceRow } from '../../api/types';
import { Switch } from '../ui/Switch';
import { HistoryDepthPicker } from './HistoryDepthPicker';
import { isSourceEnabled, sourceName, type ISourceActions } from './useSourceActions';
import styles from './Sources.module.css';

interface ISourceControlProps {
  source: ISourceRow;
  actions: ISourceActions;
}

export const SourceToggle: FC<ISourceControlProps> = ({ source, actions }) => {
  const manual = source.kind === 'manual';
  const on = isSourceEnabled(source);
  const what = manual ? 'Приём текстов' : 'Сбор';
  return (
    // title — подсказка мышью; диктору состояние скажет сам переключатель.
    <span className={styles.toggle} title={`${what} ${on ? 'включён' : 'выключен'}`}>
      <Switch
        checked={on}
        label={`${what}: ${sourceName(source)}`}
        onText=""
        offText=""
        disabled={actions.isToggling(source)}
        onChange={next => actions.toggle(source, next)}
      />
    </span>
  );
};

export const SourceDepth: FC<ISourceControlProps> = ({ source, actions }) =>
  source.kind === 'manual' ? null : (
    <HistoryDepthPicker
      kind={source.kind}
      value={source.historyDays ?? null}
      label={`Срок сбора: ${sourceName(source)}`}
      disabled={actions.isSettingHistory(source)}
      onChange={days => actions.setHistory(source, days)}
    />
  );
