import { FC, ReactNode } from 'react';

import { Disclosure } from '../../components/ui/Disclosure';
import { HeadingLevelContext } from '../../components/ui/headingLevel';
import styles from '../ProjectPage.module.css';

interface ISectionDisclosureProps {
  summary: string;
  meta?: string;
  /** Раскрыт сразу: раздел, где есть что показать. */
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * Раздел страницы под раскрытием: заголовок раздела (h2) остаётся заголовком для навигации
 * диктора, а заголовки внутри — ступенью ниже (h3), как у Section.
 */
export const SectionDisclosure: FC<ISectionDisclosureProps> = ({ summary, meta, defaultOpen, children }) => (
  <Disclosure variant="card" level={2} summary={summary} meta={meta} defaultOpen={defaultOpen}>
    <HeadingLevelContext.Provider value={3}>
      <div className={styles.disclosureBody}>{children}</div>
    </HeadingLevelContext.Provider>
  </Disclosure>
);
