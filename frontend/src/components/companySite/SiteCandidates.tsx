// Кандидаты в сайты компании (этап 25A): адрес, признаки проверки и решение оператора. Один список — на карточке
// компании и на странице «Сайты компаний». Признаки — словами и тоном: «ИНН компании на сайте» — сильный довод,
// «на сайте другой ИНН» — повод присмотреться; объяснение модели подписано как её объяснение, а не решение.
// На карточке компании (compact, 06.10.2026, просьба владельца «меньше информации») — только адрес, признаки у
// ждущего решения и действия ярлычками в той же строке; как найден, заголовок страницы, кто и когда решил и
// объяснение модели — в очереди «Сайты компаний».

import { FC, FormEvent, ReactNode, useState } from 'react';

import type { ISiteCandidate, ISiteSearchState, SiteSearchMode } from '../../api/types';
import {
  SITE_CANDIDATE_STATE_LABELS,
  SITE_CHECK_STATUS_LABELS,
  SITE_FOUND_VIA_LABELS,
  SITE_SEARCH_MODE_LABELS,
  SITE_SEARCH_OUTCOME_LABELS,
  actorLabel,
  formatDateTime,
} from '../../lib/labels';
import { DECISION_STATE_TONE, SITE_CHECK_TONE, toneOf } from '../../lib/statusTone';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ButtonLink } from '../ui/ButtonLink';
import { Cluster } from '../ui/Cluster';
import { Field } from '../ui/Field';
import { Stack } from '../ui/Stack';
import { TextInput } from '../ui/TextInput';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import styles from './Site.module.css';

/** Признаки проверки сайта: что найдено на главной и страницах «Контакты / О компании». */
export const SiteSignals: FC<{ candidate: ISiteCandidate }> = ({ candidate: c }) => {
  const badges: ReactNode[] = [];
  if (c.checkStatus !== 'ok') {
    badges.push(
      <Badge key="status" tone={toneOf(SITE_CHECK_TONE, c.checkStatus)} hint={c.checkError ?? undefined}>
        {SITE_CHECK_STATUS_LABELS[c.checkStatus]}
      </Badge>,
    );
  }
  if (c.innOnPage) badges.push(<Badge key="inn" tone="success">ИНН компании на сайте</Badge>);
  else if (c.ogrnOnPage) badges.push(<Badge key="ogrn" tone="success">ОГРН компании на сайте</Badge>);
  if (c.otherInns.length > 0) {
    badges.push(
      <Badge key="other" tone="warning" hint={`ИНН на страницах сайта: ${c.otherInns.join(', ')}`}>
        на сайте другой ИНН{c.otherInns.length > 1 ? ` (${c.otherInns.length})` : ''}
      </Badge>,
    );
  }
  if (c.checkStatus === 'ok' && c.innOnPage === false && !c.ogrnOnPage && c.otherInns.length === 0) {
    badges.push(<Badge key="none">реквизитов на сайте не нашлось</Badge>);
  }
  if (c.checkStatus === 'ok' && !c.innOnPage && c.nameOnPage) badges.push(<Badge key="name">название на сайте</Badge>);
  return badges.length > 0 ? <>{badges}</> : null;
};

const SiteLink: FC<{ candidate: ISiteCandidate }> = ({ candidate }) => (
  <a href={candidate.url} target="_blank" rel="noreferrer noopener" className={styles.host}>
    {candidate.host}
    <VisuallyHidden> (откроется в новой вкладке)</VisuallyHidden>
  </a>
);

interface ISiteCandidatesProps {
  candidates: ISiteCandidate[];
  canDecide: boolean;
  busy: boolean;
  onConfirm: (candidate: ISiteCandidate) => void;
  onReject: (candidate: ISiteCandidate) => void;
  /** Карточка компании: адрес, признаки ждущего решения и ярлычки действий — без строк подробностей. */
  compact?: boolean;
}

/** «Это сайт компании» / «Не он» / «Отвязать» — ярлычками. */
const Decision: FC<{ candidate: ISiteCandidate; busy: boolean; onConfirm: () => void; onReject: () => void }> = ({ candidate: c, busy, onConfirm, onReject }) => (
  <>
    {c.state !== 'confirmed' && (
      <Button variant="chip" disabled={busy} onClick={onConfirm}>
        Это сайт компании<VisuallyHidden> — {c.host}</VisuallyHidden>
      </Button>
    )}
    {c.state !== 'rejected' && (
      <Button variant="chip" disabled={busy} onClick={onReject}>
        {c.state === 'confirmed' ? 'Отвязать' : 'Не он'}
        <VisuallyHidden> — {c.host}</VisuallyHidden>
      </Button>
    )}
  </>
);

export const SiteCandidates: FC<ISiteCandidatesProps> = ({ candidates, canDecide, busy, onConfirm, onReject, compact = false }) => (
  <ul className={compact ? `${styles.list} ${styles.compact}` : styles.list}>
    {candidates.map(c => (
      <li key={c.id} className={styles.item}>
        <Cluster gap={2} align="center">
          <SiteLink candidate={c} />
          {/* Под заголовком «Сайт компании» ярлык «сайт компании» у подтверждённого — повтор. */}
          {c.state !== 'pending' && !compact && (
            <Badge tone={toneOf(DECISION_STATE_TONE, c.state)}>{SITE_CANDIDATE_STATE_LABELS[c.state]}</Badge>
          )}
          {(!compact || c.state === 'pending') && <SiteSignals candidate={c} />}
          {compact && canDecide && <Decision candidate={c} busy={busy} onConfirm={() => onConfirm(c)} onReject={() => onReject(c)} />}
        </Cluster>
        {!compact && (
          <p className={styles.muted}>
            {SITE_FOUND_VIA_LABELS[c.foundVia]}
            {c.pageTitle || c.title ? ` · «${c.pageTitle ?? c.title}»` : ''}
            {c.decidedBy && c.state !== 'pending' ? ` · решение: ${actorLabel(c.decidedBy)}, ${formatDateTime(c.decidedAt)}` : ''}
            {c.decisionNote ? ` · ${c.decisionNote}` : ''}
          </p>
        )}
        {!compact && c.modelReason && c.state === 'pending' && <p className={styles.muted}>Модель: {c.modelReason}</p>}
        {c.sharedWith.length > 0 && (
          <p className={styles.muted}>
            Уже сайт компании:{' '}
            {c.sharedWith.map((o, i) => (
              <span key={o.companyId}>
                {i > 0 && ', '}
                <ButtonLink to={`/company/${o.companyId}`} variant="link" size="sm">
                  {o.name}
                </ButtonLink>
              </span>
            ))}
          </p>
        )}
        {!compact && canDecide && (
          <Cluster gap={2}>
            <Decision candidate={c} busy={busy} onConfirm={() => onConfirm(c)} onReject={() => onReject(c)} />
          </Cluster>
        )}
      </li>
    ))}
  </ul>
);

/** Состояние поиска одной строкой: искали ли, что нашли, когда снова; ошибку — словами сервера. */
export const searchLine = (search: ISiteSearchState | null, mode: SiteSearchMode): string => {
  if (!search) return mode === 'on' ? 'Сайт ещё не искали — компания в очереди.' : `Сайт не искали: ${SITE_SEARCH_MODE_LABELS[mode]}.`;
  if (search.lastError && !search.searchedAt) return `Поиск не удался: ${search.lastError}`;
  if (!search.searchedAt) return mode === 'on' ? 'Поиск поставлен в очередь.' : `Поиск поставлен в очередь, но ${SITE_SEARCH_MODE_LABELS[mode]}.`;
  const outcome = search.outcome ? SITE_SEARCH_OUTCOME_LABELS[search.outcome] : 'искали';
  return `Поиск ${formatDateTime(search.searchedAt)}: ${outcome}${search.lastError ? ` (${search.lastError})` : ''}.`;
};

interface ISiteControlsProps {
  companyName: string;
  searched: boolean;
  busy: boolean;
  onManual: (url: string) => void;
  onSearch: () => void;
}

/** «Искать снова» и «Указать вручную» — ярлычками: адрес оператора сразу становится сайтом компании. */
export const SiteControls: FC<ISiteControlsProps> = ({ companyName, searched, busy, onManual, onSearch }) => {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (url.trim() === '') return;
    onManual(url.trim());
    setUrl('');
    setOpen(false);
  };
  return (
    <Stack gap={2}>
      <Cluster gap={2}>
        <Button variant="chip" onClick={() => setOpen(!open)} aria-expanded={open}>
          Указать вручную…<VisuallyHidden> — {companyName}</VisuallyHidden>
        </Button>
        <Button variant="chip" disabled={busy} onClick={onSearch}>
          {searched ? 'Искать снова' : 'Искать сейчас'}
          <VisuallyHidden> — {companyName}</VisuallyHidden>
        </Button>
      </Cluster>
      {open && (
        <form onSubmit={submit}>
          <Cluster gap={2} align="end">
            <Field label={`Сайт «${companyName}»`}>
              {control => <TextInput {...control} type="url" required placeholder="https://example.ru" value={url} onChange={e => setUrl(e.target.value)} />}
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
