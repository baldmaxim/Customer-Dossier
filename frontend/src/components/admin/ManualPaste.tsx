// Ручная вставка текста: для закрытых каналов и статей, которые портал не может собрать сам.
//
// Оператор только сохраняет текст. Разбор портал ставит сам по новым версиям текстов
// включённых источников: кнопки «поставить на разбор» здесь нет и не должно быть.
//
// Компактно: пояснение — значком «?» у заголовка раздела (MANUAL_HINT), сведения о тексте —
// в одну строку на широком экране, про дату — подсказкой под её полем.

import { FC, FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiError, api } from '../../api/client';
import type { IManualPasteResult } from '../../api/types';
import { MANUAL_OUTCOME_LABELS } from '../../lib/labels';
import { Button } from '../ui/Button';
import { ButtonLink } from '../ui/ButtonLink';
import { Callout } from '../ui/Callout';
import { Field } from '../ui/Field';
import { Stack } from '../ui/Stack';
import { TextInput } from '../ui/TextInput';
import { Textarea } from '../ui/Textarea';
import { useToast } from '../ui/toast';
import { actionError } from '../../lib/actionError';
import sources from './Sources.module.css';

/** Короче этого сервер текст не сохранит — кнопка не зовёт его зря. */
const MIN_CHARS = 40;

export const MANUAL_HINT =
  'Текст идёт тем же путём, что и собранный: сохраняется публикация, разбирает её портал сам. Вставка не обходит ограничения Telegram или первоисточника — «Ручная вставка текста» должна быть включена, как любой источник. Пустые поля уходят как «неизвестно», а не как догадка.';

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

const orNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());

export const ManualPaste: FC = () => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [origin, setOrigin] = useState('');
  const [at, setAt] = useState('');
  const [result, setResult] = useState<IManualPasteResult | null>(null);

  // /api/manual только сохраняет публикацию: модель в этот момент не вызывается.
  const paste = useMutation({
    mutationFn: (input: IManualInput) => api.post<IManualPasteResult>('/api/manual', input),
    onSuccess: saved => {
      setResult(saved);
      // Поля очищаем только когда текст действительно сохранён: иначе оператор потеряет введённое.
      if (saved.documentId !== null) {
        setText('');
        setTitle('');
        setUrl('');
        setOrigin('');
        setAt('');
      }
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
      void queryClient.invalidateQueries({ queryKey: ['summary'] });
    },
    onError: (err: Error) => {
      setResult(null);
      toast.show({
        tone: 'danger',
        text:
          err instanceof ApiError && err.code === 'source_policy'
            ? `${err.message}. Включите «Ручную вставку текста» переключателем в списке ниже: вставка вручную новых прав на материал не даёт.`
            : actionError(err),
      });
    },
  });

  const publishedAt = toPublishedAt(at);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (text.trim().length < MIN_CHARS) return;
    paste.mutate({ body: text.trim(), title: orNull(title), url: orNull(url), origin: orNull(origin), publishedAt });
  };

  return (
    <Stack as="form" gap={3} onSubmit={submit}>
      <Field label="Текст" hint={`Сообщение или статья целиком, не короче ${MIN_CHARS} знаков.`}>
        {control => (
          <Textarea
            {...control}
            rows={4}
            placeholder="Вставьте текст сообщения или статьи"
            value={text}
            onChange={e => setText(e.target.value)}
          />
        )}
      </Field>

      <div className={sources.pasteGrid}>
        <Field label="Заголовок">{control => <TextInput {...control} value={title} onChange={e => setTitle(e.target.value)} />}</Field>
        <Field label="Ссылка на первоисточник">
          {control => (
            <TextInput {...control} type="url" placeholder="https://example.ru/news/1" value={url} onChange={e => setUrl(e.target.value)} />
          )}
        </Field>
        <Field label="Откуда взято">
          {control => (
            <TextInput {...control} placeholder="канал, издание, ФИО коллеги" value={origin} onChange={e => setOrigin(e.target.value)} />
          )}
        </Field>
        <Field
          label="Дата и время публикации"
          hint={
            publishedAt === null
              ? 'Пусто — дата неизвестна: момент вставки её не заменяет.'
              : `Уйдёт как ${publishedAt} (введено как ${offsetLabel(new Date(at))}).`
          }
        >
          {control => <TextInput {...control} type="datetime-local" value={at} onChange={e => setAt(e.target.value)} />}
        </Field>
      </div>

      <div>
        <Button type="submit" variant="primary" loading={paste.isPending} disabled={text.trim().length < MIN_CHARS}>
          Сохранить текст
        </Button>
      </div>

      {result && (
        <Callout
          tone={result.documentId === null ? 'warning' : 'success'}
          live="polite"
          title={`${MANUAL_OUTCOME_LABELS[result.outcome] ?? result.outcome}.`}
          action={
            result.documentId !== null ? (
              <ButtonLink to={`/documents/${result.documentId}`} variant="link" size="sm">
                Открыть публикацию
              </ButtonLink>
            ) : undefined
          }
        >
          {result.revisionId === null ? 'Текст не сохранён.' : 'Портал разберёт текст сам; сведения появятся в карточках после разбора.'}
        </Callout>
      )}
    </Stack>
  );
};
