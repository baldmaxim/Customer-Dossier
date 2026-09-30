// Период участия — компактно: раскрытие «Период» с выбранным значением в строке заголовка.
// Даты — в адресе (?from=&to=&only=1): ссылка на объект за период открывается тем же.

import { FC } from 'react';

import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { Disclosure } from '../../components/ui/Disclosure';
import { Field } from '../../components/ui/Field';
import { TextInput } from '../../components/ui/TextInput';
import { formatPeriod } from '../../lib/period';
import styles from '../ProjectPage.module.css';

export interface IPeriod {
  from: string;
  to: string;
  only: boolean;
}

interface IPeriodFilterProps {
  period: IPeriod;
  onChange: (patch: Partial<IPeriod>) => void;
}

export const PeriodFilter: FC<IPeriodFilterProps> = ({ period, onChange }) => {
  const selected = Boolean(period.from || period.to);
  const summary = selected ? formatPeriod(period.from, period.to) : 'все даты';
  return (
    <Disclosure summary="Период" meta={summary} defaultOpen={selected}>
      <div className={styles.period}>
        <div className={styles.periodFields}>
          <Field label="Начало периода">
            {control => (
              <TextInput {...control} type="date" value={period.from} max={period.to || undefined} onChange={e => onChange({ from: e.target.value })} />
            )}
          </Field>
          <Field label="Конец периода">
            {control => (
              <TextInput {...control} type="date" value={period.to} min={period.from || undefined} onChange={e => onChange({ to: e.target.value })} />
            )}
          </Field>
        </div>
        <Checkbox
          label="только работавшие в этот период"
          hint={selected ? undefined : 'Сначала выберите даты.'}
          checked={period.only}
          disabled={!selected}
          onChange={only => onChange({ only })}
        />
        {selected && (
          <div>
            <Button variant="ghost" size="sm" onClick={() => onChange({ from: '', to: '', only: false })}>
              Сбросить период
            </Button>
          </div>
        )}
      </div>
    </Disclosure>
  );
};
