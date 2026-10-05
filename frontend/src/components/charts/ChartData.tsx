// «Числа графика» — таблица под раскрытием: у каждого графика есть табличный вид (dataviz,
// доступность), и диктор получает все числа, а не только сводку. Таблица монтируется при первом
// раскрытии: скрытый текст не дублирует подписи на странице (и не ломает поиск по тексту в тестах).

import { FC, ReactNode, useState } from 'react';

import { Disclosure } from '../ui/Disclosure';
import styles from './Charts.module.css';

export interface IChartDataRow {
  key: string;
  cells: ReadonlyArray<ReactNode>;
}

export interface IChartDataProps {
  /** Ярлык раскрытия: «Числа по месяцам». */
  summary: string;
  /** Подпись таблицы для диктора. */
  caption: string;
  columns: ReadonlyArray<string>;
  rows: ReadonlyArray<IChartDataRow>;
  className?: string;
}

export const ChartData: FC<IChartDataProps> = ({ summary, caption, columns, rows, className }) => {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  return (
    <Disclosure
      summary={summary}
      className={[styles.data, className ?? ''].filter(Boolean).join(' ')}
      open={open}
      onToggle={next => {
        setOpen(next);
        if (next) setMounted(true);
      }}
    >
      {mounted && (
        <div className={styles.dataScroll}>
          <table className={styles.dataTable}>
            <caption className="visually-hidden">{caption}</caption>
            <thead>
              <tr>
                {columns.map(c => (
                  <th key={c} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.key}>
                  {row.cells.map((cell, i) =>
                    i === 0 ? (
                      <th key={i} scope="row">
                        {cell}
                      </th>
                    ) : (
                      <td key={i}>{cell}</td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Disclosure>
  );
};
