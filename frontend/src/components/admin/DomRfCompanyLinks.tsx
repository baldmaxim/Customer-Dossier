// Одна компания на ДОМ.РФ: что нашёл поиск в реестре застройщиков и решения оператора — «Это он»,
// «Не он», «Указать вручную», «Искать снова» (ещё не искали — «Искать сейчас»). Подтверждённый
// застройщик или группа уходит в очередь чтения, и их объекты появляются во вкладке «Объекты».
// Под строкой — что ещё выдача показала рядом с названием и подсказка модели: подсказка, а не решение.

import { FC, FormEvent, ReactNode, useState } from 'react';

import type { DomRfHintVerdict, IDomRfCompanyLink, IDomRfCompanyRow, IDomRfLinkHint } from '../../api/types';
import { DOMRF_CARD_KIND_LABELS, DOMRF_COMPANY_LINK_STATE_LABELS, DOMRF_HINT_VERDICT_LABELS } from '../../lib/labels';
import { Badge } from '../ui/Badge';
import { Button, buttonClass } from '../ui/Button';
import { Cluster } from '../ui/Cluster';
import { Field } from '../ui/Field';
import { Stack } from '../ui/Stack';
import { TextInput } from '../ui/TextInput';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import styles from './Found.module.css';

interface IDomRfCompanyLinksProps {
  company: IDomRfCompanyRow;
  canDecide: boolean;
  busy: boolean;
  onConfirm: (link: IDomRfCompanyLink) => void;
  onReject: (link: IDomRfCompanyLink) => void;
  onManual: (url: string) => void;
  onSearchAgain: () => void;
}

const STATE_TONE = { pending: 'neutral', confirmed: 'success', rejected: 'neutral' } as const;

// «Скорее он» выделен, остальное — спокойным: подсказка не статус и не поломка.
const HINT_TONE: Record<DomRfHintVerdict, 'info' | 'neutral'> = { match: 'info', no_match: 'neutral', unsure: 'neutral' };

const LinkHint: FC<{ hint: IDomRfLinkHint | null }> = ({ hint }) => {
  if (!hint) return null;
  if (!hint.verdict) return <p className={styles.muted}>Подсказки модели нет: ответ пришёл не по форме.</p>;
  return (
    <p className={styles.muted}>
      <Badge tone={HINT_TONE[hint.verdict]}>Модель: {DOMRF_HINT_VERDICT_LABELS[hint.verdict]}</Badge> {hint.reason}
    </p>
  );
};

export const DomRfCompanyLinks: FC<IDomRfCompanyLinksProps> = ({ company, canDecide, busy, onConfirm, onReject, onManual, onSearchAgain }) => {
  const [manual, setManual] = useState(false);
  const [url, setUrl] = useState('');

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (url.trim()) onManual(url.trim());
  };

  const linkRow = (link: IDomRfCompanyLink): ReactNode => (
    <li key={link.id}>
      <Stack gap={1}>
        <Cluster gap={2} align="center">
          <span>
            {DOMRF_CARD_KIND_LABELS[link.kind]} {link.name ?? `№${link.externalRef}`}
          </span>
          <a href={link.url} target="_blank" rel="noreferrer noopener" className={buttonClass({ variant: 'link', size: 'sm' })}>
            №{link.externalRef}
            <VisuallyHidden> на ДОМ.РФ (откроется в новой вкладке)</VisuallyHidden>
          </a>
          {link.state === 'pending' && canDecide ? (
            <>
              <Button size="sm" variant="primary" disabled={busy} onClick={() => onConfirm(link)}>
                Это он<VisuallyHidden> — {link.name ?? link.externalRef}</VisuallyHidden>
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onReject(link)}>
                Не он<VisuallyHidden> — {link.name ?? link.externalRef}</VisuallyHidden>
              </Button>
            </>
          ) : (
            <Badge tone={STATE_TONE[link.state]}>{DOMRF_COMPANY_LINK_STATE_LABELS[link.state]}</Badge>
          )}
        </Cluster>
        {link.details && <p className={styles.muted}>{link.details}</p>}
        {link.state === 'pending' && <LinkHint hint={link.hint} />}
      </Stack>
    </li>
  );

  return (
    <Stack gap={2}>
      {company.links.length > 0 && <ul>{company.links.map(linkRow)}</ul>}
      {canDecide && (
        <Cluster gap={2}>
          <Button size="sm" variant="ghost" onClick={() => setManual(!manual)}>
            Указать вручную…<VisuallyHidden> — {company.name}</VisuallyHidden>
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onSearchAgain}>
            {company.searchedAt ? 'Искать снова' : 'Искать сейчас'}
            <VisuallyHidden> — {company.name}</VisuallyHidden>
          </Button>
        </Cluster>
      )}
      {manual && (
        <form onSubmit={submit}>
          <Cluster gap={2} align="end">
            <Field label={`Страница застройщика или группы для «${company.name}»`}>
              {control => (
                <TextInput
                  {...control}
                  type="url"
                  required
                  placeholder="https://наш.дом.рф/сервисы/единый-реестр-застройщиков/застройщик/14929"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                />
              )}
            </Field>
            <Button type="submit" size="sm" variant="primary" disabled={busy || url.trim() === ''}>
              Сохранить
            </Button>
          </Cluster>
        </form>
      )}
    </Stack>
  );
};
