// «Откуда известно»: сведение, его цитаты и источники. На экранах чтения — цитата, источник
// (ссылкой на публикацию) и дата; решение оператора и история решений — в раскрытии «Решение
// оператора», и только у тех, кому можно решать. В очереди «Проверки» (mode="review") оно
// раскрыто сразу.
//
// Уровни заголовков — из контекста (Section, Heading): блок стоит то на карточке компании,
// то в «Проверке», и зашитые h3/h4 ломали порядок заголовков.

import { FC, useState } from 'react';

import type { IEvidenceRow } from '../api/types';
import { useCan } from '../hooks/useAuth';
import { describeLoadError } from '../lib/loadError';
import { AssertionSummary } from './assertion/AssertionSummary';
import { useAssertionDetail } from './assertion/assertionApi';
import { EvidenceList } from './assertion/EvidenceList';
import { OperatorDecision } from './assertion/OperatorDecision';
import { WithdrawDialog } from './assertion/WithdrawDialog';
import { Button } from './ui/Button';
import { Callout } from './ui/Callout';
import { EmptyState } from './ui/EmptyState';
import { HeadingLevelContext, deeper, useHeadingLevel } from './ui/headingLevel';
import { Loading } from './ui/Loading';
import styles from './AssertionDetail.module.css';

export interface IAssertionDetailProps {
  assertionId: number;
  /** read (по умолчанию) — экраны чтения; review — очередь «Проверки»: «Решение оператора» раскрыто сразу. */
  mode?: 'read' | 'review';
  /** false — без строки-описания сведения: фраза уже стоит выше (список сведений, панель связи на схеме). */
  showSummary?: boolean;
}

export const AssertionDetail: FC<IAssertionDetailProps> = ({ assertionId, mode = 'read', showSummary = true }) => {
  // Читатель видит цитаты, но не решает: сервер ответил бы 403.
  const canDecide = useCan('review.decide');
  const canAdmin = useCan('admin.view');
  const level = useHeadingLevel();
  const query = useAssertionDetail(assertionId);
  const [operatorOpen, setOperatorOpen] = useState(mode === 'review');
  const [withdrawing, setWithdrawing] = useState<IEvidenceRow | null>(null);

  if (query.isLoading) return <Loading label="Загружаю цитаты…" />;
  if (query.isError) {
    return (
      <Callout
        tone="danger"
        title="Цитаты не загрузились"
        action={
          <Button size="sm" onClick={() => void query.refetch()}>
            Повторить
          </Button>
        }
      >
        {describeLoadError(query.error)}
      </Callout>
    );
  }
  if (!query.data) {
    return (
      <EmptyState size="sm" icon={false}>
        Сведение не найдено.
      </EmptyState>
    );
  }

  const { assertion, evidence, reviews } = query.data;
  const tools = canDecide && operatorOpen;

  return (
    <div className={styles.detail}>
      <div className={styles.body}>
        {showSummary && <AssertionSummary assertion={assertion} />}
        <HeadingLevelContext.Provider value={showSummary ? deeper(level) : level}>
          <EvidenceList evidence={evidence} tools={tools} showRun={tools && canAdmin} onWithdraw={setWithdrawing} />
          {canDecide && <OperatorDecision assertion={assertion} reviews={reviews} open={operatorOpen} onToggle={setOperatorOpen} />}
        </HeadingLevelContext.Provider>
      </div>
      {canDecide && <WithdrawDialog evidence={withdrawing} assertion={assertion} onClose={() => setWithdrawing(null)} />}
    </div>
  );
};
