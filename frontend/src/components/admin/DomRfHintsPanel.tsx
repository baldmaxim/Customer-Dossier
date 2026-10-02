// Подсказки модели к найденному в реестре ДОМ.РФ: включены ли, сколько составлено, и кнопка допуска.
// Допуск — ИИ-обработка источника наш.дом.рф: решение оператора, пишется в журнал допуска. Без него модель
// записей реестра не видит. Подсказка — не решение: «Это он / Не он» по-прежнему ставит инженер.

import { FC } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { IDomRfSummary } from '../../api/types';
import { useCan } from '../../hooks/useAuth';
import { formatCount } from '../../lib/format';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { useConfirm } from '../ui/confirm';
import { useToast } from '../ui/toast';
import { actionError } from './actionError';
import { DOMRF_SUMMARY_KEY } from './domRfSummary';

const SENT = 'названия компаний портала, их объекты и найденные записи реестра';

export const DomRfHintsPanel: FC<{ hints: IDomRfSummary['hints'] }> = ({ hints }) => {
  const client = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const canManage = useCan('sources.manage');
  const cloud = hints.provider === 'openrouter';

  const toggle = useMutation({
    mutationFn: (allowed: boolean) => api.post('/api/admin/domrf-hints/permission', { allowed }),
    onSuccess: (_data, allowed) => {
      toast.show({ tone: 'success', text: allowed ? 'Подсказки включены — появятся в течение нескольких минут.' : 'Подсказки выключены: новых не будет.' });
      void client.invalidateQueries({ queryKey: DOMRF_SUMMARY_KEY });
    },
    onError: (err: Error) => toast.show({ tone: 'danger', text: actionError(err) }),
  });

  const ask = async (allowed: boolean): Promise<void> => {
    const ok = await confirm(
      allowed
        ? {
            title: 'Разрешить подсказки модели?',
            body: `Модели уйдут ${SENT}${cloud ? ' — во внешний сервис OpenRouter' : ''}. Это разрешение на ИИ-обработку источника наш.дом.рф; оно записывается в журнал допуска. Решения «Это он / Не он» остаются за вами.`,
            confirmLabel: 'Разрешить',
          }
        : { title: 'Выключить подсказки модели?', body: 'Новых подсказок не будет, уже составленные останутся на экране.', confirmLabel: 'Выключить' },
    );
    if (ok) toggle.mutate(allowed);
  };

  if (!hints.allowed) {
    return (
      <Callout
        tone="info"
        title="Подсказки модели выключены"
        action={
          canManage ? (
            <Button variant="primary" disabled={toggle.isPending} onClick={() => void ask(true)}>
              Разрешить подсказки
            </Button>
          ) : undefined
        }
      >
        Модель может подсказывать к каждому найденному застройщику «скорее он», «скорее не он» или «не уверена» с объяснением. Для этого ей
        уходят {SENT}{cloud ? ' (внешний сервис OpenRouter)' : ''}: нужно разрешение на ИИ-обработку источника наш.дом.рф.
        {!canManage && ' Разрешает оператор источников.'}
      </Callout>
    );
  }

  return (
    <Callout
      tone={hints.running ? 'neutral' : 'warning'}
      title={hints.running ? 'Подсказки модели включены' : 'Подсказки разрешены, но не составляются'}
      action={
        canManage ? (
          <Button variant="ghost" disabled={toggle.isPending} onClick={() => void ask(false)}>
            Выключить
          </Button>
        ) : undefined
      }
    >
      {hints.running
        ? `С подсказкой — ${formatCount(hints.hinted)}, ждут подсказки — ${formatCount(hints.waiting)}. Подсказка — не решение: она стоит под найденным, решаете вы.`
        : 'Задание разбора на сервере выключено (PIPELINE_ENABLED или DOMRF_HINT_ENABLED) — без него модель не зовётся.'}
    </Callout>
  );
};
