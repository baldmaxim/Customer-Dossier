import { FC, FormEvent, useState } from 'react';

import type { ICaseInput, ICaseRow } from '../api/types';
import { CLAIMED_ROLE_OPTIONS } from '../lib/labels';
import styles from '../pages/Dossier.module.css';
import { CompanyPicker, ProjectPicker } from './EntityPickers';

interface ICaseFormProps {
  initial?: ICaseRow | null;
  preset?: { companyId: number; companyName: string } | null;
  pending: boolean;
  error: string | null;
  submitLabel: string;
  onSubmit: (input: ICaseInput) => void;
}

const today = (): string => new Date().toISOString().slice(0, 10);
const orNull = (v: string): string | null => (v.trim() ? v.trim() : null);

/**
 * Обращение со слов обратившегося. Юрлицо — выбранное из кандидатов или явно «не установлено» с названием;
 * всё введённое хранится как запись оператора и не становится подтверждённым фактом.
 */
export const CaseForm: FC<ICaseFormProps> = ({ initial, preset, pending, error, submitLabel, onSubmit }) => {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [mode, setMode] = useState<'identified' | 'unidentified'>(initial?.companyStatus ?? 'identified');
  const [company, setCompany] = useState<{ id: number; name: string } | null>(
    initial?.companyId ? { id: initial.companyId, name: initial.companyName ?? `#${initial.companyId}` } : preset ? { id: preset.companyId, name: preset.companyName } : null,
  );
  const [companyNameClaimed, setCompanyNameClaimed] = useState(initial?.companyNameClaimed ?? '');
  const [project, setProject] = useState<{ id: number; name: string } | null>(
    initial?.projectId ? { id: initial.projectId, name: initial.projectName ?? `#${initial.projectId}` } : null,
  );
  const [projectNameClaimed, setProjectNameClaimed] = useState(initial?.projectNameClaimed ?? '');
  const [scopeBuilding, setScopeBuilding] = useState(initial?.scopeBuilding ?? '');
  const [workPackageLabel, setWorkPackageLabel] = useState(initial?.workPackageLabel ?? '');
  const [claimedRole, setClaimedRole] = useState(initial?.claimedRole ?? '');
  const [client, setClient] = useState<{ id: number; name: string } | null>(
    initial?.claimedClientCompanyId ? { id: initial.claimedClientCompanyId, name: initial.claimedClientCompanyName ?? `#${initial.claimedClientCompanyId}` } : null,
  );
  const [claimedClientName, setClaimedClientName] = useState(initial?.claimedClientName ?? '');
  const [claimedTerms, setClaimedTerms] = useState(initial?.claimedTerms ?? '');
  const [requestDate, setRequestDate] = useState(initial?.requestDate ?? today());
  const [operatorNote, setOperatorNote] = useState(initial?.operatorNote ?? '');
  const [status, setStatus] = useState<'open' | 'closed'>(initial?.status ?? 'open');

  const companyReady = mode === 'identified' ? company !== null : companyNameClaimed.trim().length > 0;

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (!companyReady || !title.trim()) return;
    onSubmit({
      title: title.trim(),
      companyId: mode === 'identified' ? (company?.id ?? null) : null,
      companyNameClaimed: mode === 'unidentified' ? orNull(companyNameClaimed) : null,
      projectId: project?.id ?? null,
      projectNameClaimed: project ? null : orNull(projectNameClaimed),
      scopeBuilding: orNull(scopeBuilding),
      workPackageLabel: orNull(workPackageLabel),
      claimedRole: claimedRole || null,
      claimedClientCompanyId: client?.id ?? null,
      claimedClientName: client ? null : orNull(claimedClientName),
      claimedTerms: orNull(claimedTerms),
      requestDate,
      operatorNote: orNull(operatorNote),
      status,
    });
  };

  return (
    <form className={styles.form} onSubmit={submit}>
      <label className={`${styles.field} ${styles.full}`}>
        <span>Название обращения</span>
        <input value={title} onChange={e => setTitle(e.target.value)} required maxLength={300} placeholder="Например: инженерные системы корпуса 2" />
      </label>

      <fieldset className={`${styles.field} ${styles.full}`}>
        <legend>Юрлицо</legend>
        <div className={styles.row} role="radiogroup">
          <label>
            <input type="radio" name="companyMode" checked={mode === 'identified'} onChange={() => setMode('identified')} /> выбрать из базы
          </label>
          <label>
            <input type="radio" name="companyMode" checked={mode === 'unidentified'} onChange={() => setMode('unidentified')} /> юрлицо не установлено
          </label>
        </div>
        {mode === 'identified' ? (
          <CompanyPicker label="Компания" selected={company} onSelect={setCompany} />
        ) : (
          <label className={styles.field}>
            <span>Название со слов обратившегося</span>
            <input value={companyNameClaimed} onChange={e => setCompanyNameClaimed(e.target.value)} maxLength={300} />
            <span className={styles.hint}>Сведения об одноимённых компаниях в досье не подставляются.</span>
          </label>
        )}
      </fieldset>

      <div className={styles.full}>
        <ProjectPicker selected={project} onSelect={setProject} />
        {!project && (
          <label className={styles.field}>
            <span>Объект со слов (если в базе не найден)</span>
            <input value={projectNameClaimed} onChange={e => setProjectNameClaimed(e.target.value)} maxLength={300} />
          </label>
        )}
      </div>

      <label className={styles.field}>
        <span>Корпус или очередь</span>
        <input value={scopeBuilding} onChange={e => setScopeBuilding(e.target.value)} maxLength={120} placeholder="корпус 2" />
      </label>
      <label className={styles.field}>
        <span>Вид работ</span>
        <input value={workPackageLabel} onChange={e => setWorkPackageLabel(e.target.value)} maxLength={200} placeholder="монтаж систем водоснабжения и канализации" />
      </label>
      <label className={styles.field}>
        <span>Заявленная роль</span>
        <select value={claimedRole} onChange={e => setClaimedRole(e.target.value)}>
          <option value="">не указана</option>
          {CLAIMED_ROLE_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span>Дата обращения</span>
        <input type="date" value={requestDate} onChange={e => setRequestDate(e.target.value)} required />
      </label>

      <div className={styles.full}>
        <CompanyPicker label="Кто, со слов, заказывает работы" selected={client} onSelect={setClient} />
        {!client && (
          <label className={styles.field}>
            <span>Заказчик со слов (если в базе не найден)</span>
            <input value={claimedClientName} onChange={e => setClaimedClientName(e.target.value)} maxLength={300} />
          </label>
        )}
      </div>

      <label className={`${styles.field} ${styles.full}`}>
        <span>Условия со слов (цена, аванс)</span>
        <textarea rows={2} value={claimedTerms} onChange={e => setClaimedTerms(e.target.value)} maxLength={2000} />
        <span className={styles.hint}>Хранится как запись оператора; ничего не рассчитывается.</span>
      </label>
      <label className={`${styles.field} ${styles.full}`}>
        <span>Примечание оператора</span>
        <textarea rows={3} value={operatorNote} onChange={e => setOperatorNote(e.target.value)} maxLength={4000} />
      </label>
      {initial && (
        <label className={styles.field}>
          <span>Статус</span>
          <select value={status} onChange={e => setStatus(e.target.value as 'open' | 'closed')}>
            <option value="open">открыто</option>
            <option value="closed">закрыто</option>
          </select>
        </label>
      )}

      {error && (
        <p className={`${styles.error} ${styles.full}`} role="alert">
          {error}
        </p>
      )}
      <div className={`${styles.row} ${styles.full}`}>
        <button type="submit" className={styles.buttonPrimary} disabled={pending || !companyReady || !title.trim()}>
          {pending ? 'Сохраняю…' : submitLabel}
        </button>
        {!companyReady && <span className={styles.hint}>Выберите юрлицо или отметьте «юрлицо не установлено» с названием.</span>}
      </div>
    </form>
  );
};
