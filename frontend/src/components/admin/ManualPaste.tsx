// Ручная вставка текста: для закрытых каналов и статей, до которых парсер не добирается.
// Вырезано из AdminPage дословно — на текстах, подписях полей и плейсхолдере держатся тесты.
//
// Оператор только сохраняет текст. Разбор портал ставит сам по новым редакциям
// допущенных источников: кнопки «поставить на разбор» здесь нет и не должно быть.

import { FC, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiError, api } from '../../api/client';
import type { IManualPasteResult } from '../../api/types';
import { Button } from '../ui/Button';
import { MANUAL_OUTCOME_LABELS } from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import styles from '../../pages/AdminPage.module.css';

interface IManualInput {
  body: string;
  title: string | null;
  url: string | null;
  origin: string | null;
  publishedAt: string | null;
}

/**
 * Введённое местное время — в ISO со смещением, как требует контракт `/api/manual`.
 * Пустое поле остаётся null: момент вставки датой публикации не притворяется.
 */
const toPublishedAt = (local: string): string | null => {
  if (local.trim() === '') return null;
  const parsed = new Date(local);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

/** Пояс, в котором браузер прочитал введённое время: смещение видно, а не подразумевается. */
const offsetLabel = (at: Date): string => {
  const minutes = -at.getTimezoneOffset();
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `UTC${sign}${String(Math.trunc(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
};

export interface IManualPasteProps {
  onNotice: (text: string | null) => void;
}

export const ManualPaste: FC<IManualPasteProps> = ({ onNotice }) => {
  const queryClient = useQueryClient();
  const [pasteText, setPasteText] = useState('');
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteUrl, setPasteUrl] = useState('');
  const [pasteOrigin, setPasteOrigin] = useState('');
  const [pasteAt, setPasteAt] = useState('');
  const [pasteResult, setPasteResult] = useState<IManualPasteResult | null>(null);

  // /api/manual только сохраняет публикацию: модель в этот момент не вызывается.
  const paste = useMutation({
    mutationFn: (input: IManualInput) => api.post<IManualPasteResult>('/api/manual', input),
    onSuccess: result => {
      onNotice(null);
      setPasteResult(result);
      // Поля очищаем только когда текст действительно сохранён: иначе оператор потеряет введённое.
      if (result.documentId !== null) {
        setPasteText('');
        setPasteTitle('');
        setPasteUrl('');
        setPasteOrigin('');
        setPasteAt('');
      }
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
      void queryClient.invalidateQueries({ queryKey: ['summary'] });
    },
    onError: (err: Error) => {
      setPasteResult(null);
      onNotice(
        err instanceof ApiError && err.code === 'source_policy'
          ? `${err.message}. Допуск источнику «Ручная вставка текста» выдаёт оператор в разделе «Источники»: вставка вручную новых прав на материал не даёт.`
          : describeLoadError(err),
      );
    },
  });

  return (
    <>
      <p className={styles.hint}>
        Для закрытых каналов и статей, до которых парсер не добирается. Текст идёт тем же путём, что и всё
        остальное: сохраняется публикация, а разбор портал выполняет сам. Вставка вручную не обходит
        ограничения Telegram или первоисточника — источнику нужен тот же допуск.
      </p>
      <textarea
        className={styles.textarea}
        rows={6}
        placeholder="Вставьте текст сообщения или статьи"
        value={pasteText}
        onChange={e => setPasteText(e.target.value)}
      />

      <div className={styles.fields}>
        <label className={styles.field}>
          <span className={styles.label}>Заголовок</span>
          <input className={styles.input} value={pasteTitle} onChange={e => setPasteTitle(e.target.value)} />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Ссылка на первоисточник</span>
          <input
            className={styles.input}
            type="url"
            placeholder="https://example.ru/news/1"
            value={pasteUrl}
            onChange={e => setPasteUrl(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Откуда взято</span>
          <input
            className={styles.input}
            placeholder="канал, издание, ФИО коллеги"
            value={pasteOrigin}
            onChange={e => setPasteOrigin(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Дата и время публикации</span>
          <input
            className={styles.input}
            type="datetime-local"
            value={pasteAt}
            onChange={e => setPasteAt(e.target.value)}
          />
        </label>
      </div>
      <p className={styles.hint}>
        {toPublishedAt(pasteAt) === null
          ? 'Дата публикации неизвестна — так и запишем (пусто). Момент вставки датой публикации не считается.'
          : `Будет отправлено: ${toPublishedAt(pasteAt)} (введено как ${offsetLabel(new Date(pasteAt))}).`}{' '}
        Пустые поля уходят как «неизвестно», а не как догадка.
      </p>

      <Button
        variant="primary"
        disabled={paste.isPending || pasteText.trim().length < 40}
        hint="сохранить публикацию; разбор портал выполнит сам, если у источника есть ИИ-допуск"
        onClick={() =>
          paste.mutate({
            body: pasteText.trim(),
            title: pasteTitle.trim() === '' ? null : pasteTitle.trim(),
            url: pasteUrl.trim() === '' ? null : pasteUrl.trim(),
            origin: pasteOrigin.trim() === '' ? null : pasteOrigin.trim(),
            publishedAt: toPublishedAt(pasteAt),
          })
        }
      >
        {paste.isPending ? 'Сохраняю…' : 'Сохранить текст'}
      </Button>

      {pasteResult && (
        <div className={styles.result} role="status">
          <p className={styles.resultTitle}>{MANUAL_OUTCOME_LABELS[pasteResult.outcome] ?? pasteResult.outcome}.</p>
          {pasteResult.documentId !== null && (
            <p>
              <Link to={`/documents/${pasteResult.documentId}`}>Документ #{pasteResult.documentId}</Link>
              {pasteResult.revisionNo !== null && ` · редакция №${pasteResult.revisionNo}`}
            </p>
          )}
          {pasteResult.revisionId === null ? (
            <p className={styles.hint}>Сохранённой редакции нет — разбирать нечего.</p>
          ) : (
            <p className={styles.hint}>
              Сохранение — ещё не разбор. Портал разберёт эту редакцию сам, если у источника есть
              ИИ-допуск; в карточках сведения появятся после полного разбора.
            </p>
          )}
        </div>
      )}
    </>
  );
};
