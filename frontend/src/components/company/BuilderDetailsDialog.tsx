// «Подробнее» о строителе из «Кто строит для компании» — окном: реквизит, как найдена карточка портала,
// и каждый объект с источниками и датами. В строке блока — только имя, роль и число объектов: на телефоне
// подробности по каждому объекту занимали экран.
//
// Карточки строителя в портале нет — завести её по ИНН здесь же (AddCompanyByInn). Прежняя ссылка
// «Найти по ИНН» уводила на поиск, который заведомо ничего не находил, и с главной не было пути назад.

import { FC } from 'react';
import { Link } from 'react-router-dom';

import type { IBuilderObject, ICompanyBuilder } from '../../api/types';
import { formatCount } from '../../lib/format';
import { ASSERTION_ROLE_LABELS, BUILDER_MATCH_LABELS, formatDate } from '../../lib/labels';
import { identifierOfQuery } from '../../lib/taxId';
import { Badge } from '../ui/Badge';
import { ButtonLink } from '../ui/ButtonLink';
import { CopyValue } from '../ui/CopyValue';
import { DescriptionList, type IDescriptionItem } from '../ui/DescriptionList';
import { Dialog } from '../ui/Dialog';
import { Heading } from '../ui/Heading';
import { Stack } from '../ui/Stack';
import { AddCompanyByInn } from './AddCompanyByInn';
import styles from './CompanyBuilders.module.css';

/** Строки источников объекта: «ДОМ.РФ — сведения на 30.09.2026, прочитано 02.10.2026». */
const sourceLines = (o: IBuilderObject): string[] =>
  o.sources.map(source => {
    if (source === 'registry') {
      const parts = ['ДОМ.РФ'];
      if (o.registryAsOf) parts.push(`сведения на ${formatDate(o.registryAsOf)}`);
      if (o.registryFetchedAt) parts.push(`прочитано ${formatDate(o.registryFetchedAt)}`);
      return parts.length > 1 ? `${parts[0]} — ${parts.slice(1).join(', ')}` : parts[0]!;
    }
    const parts = [o.mentions !== null ? `Публикации: ${formatCount(o.mentions)}` : 'Публикации'];
    if (o.lastPublication) parts.push(`последняя ${formatDate(o.lastPublication)}`);
    return parts.join(', ');
  });

/** Объектов у строителя: один объект в двух ролях — один. */
export const builderObjectCount = (b: ICompanyBuilder): number => new Set(b.objects.map(o => o.projectId)).size;

interface IBuilderDetailsDialogProps {
  builder: ICompanyBuilder | null;
  open: boolean;
  onClose: () => void;
}

export const BuilderDetailsDialog: FC<IBuilderDetailsDialogProps> = ({ builder: b, open, onClose }) => {
  if (!b) return null;
  const manyRoles = b.roles.length > 1;
  const identifier = !b.company && b.inn ? identifierOfQuery(b.inn) : null;
  const facts: IDescriptionItem[] = [
    { label: 'ИНН', value: b.inn ? <CopyValue value={b.inn} label="ИНН" /> : 'не указан' },
    { label: 'Роль', value: b.roles.map(role => ASSERTION_ROLE_LABELS[role] ?? role).join(', ') },
  ];
  if (b.company) facts.push({ label: 'В портале', value: b.match ? BUILDER_MATCH_LABELS[b.match] ?? 'названа в публикации' : 'названа в публикации' });
  if (b.registryNames.length > 0 && b.registryNames[0] !== b.company?.name) facts.push({ label: 'В ДОМ.РФ', value: b.registryNames.join(', ') });
  if (b.inGroup) facts.push({ label: 'Группа', value: 'входит в группу заказчика — строит своими силами' });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={b.company?.name ?? b.name}
      footer={
        b.company && (
          <ButtonLink to={`/company/${b.company.id}`} iconEnd="forward">
            Карточка компании
          </ButtonLink>
        )
      }
    >
      <Stack gap={3}>
        <DescriptionList items={facts} layout="inline" dense />
        {identifier && <AddCompanyByInn identifier={identifier} />}
        {!b.company && !b.inn && <p className={styles.source}>Карточки в портале нет, ИНН в ДОМ.РФ не указан.</p>}
      </Stack>
      <Heading className={styles.dialogHeading}>Объекты — {formatCount(builderObjectCount(b))}</Heading>
      <ul className={styles.dialogObjects}>
        {b.objects.map(o => (
          <li key={`${o.projectId}-${o.role}`} className={styles.dialogObject}>
            <div className={styles.head}>
              <Link className={styles.objectLink} to={`/projects/${o.projectId}`} viewTransition>
                «{o.name}»
              </Link>
              {manyRoles && <Badge>{ASSERTION_ROLE_LABELS[o.role] ?? o.role}</Badge>}
              {!o.isCurrent && <span className={styles.past}>в прошлом</span>}
            </div>
            {sourceLines(o).map(line => (
              <p key={line} className={styles.source}>
                {line}
              </p>
            ))}
          </li>
        ))}
      </ul>
      <p className={styles.note}>
        ДОМ.РФ — сведения сайта на дату, не проверенный договор. Роль из публикаций — так написано в тексте.
      </p>
    </Dialog>
  );
};
