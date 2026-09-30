// Уровень заголовка из контекста: Section поднимает его для своего содержимого, и
// переиспользуемые блоки (AssertionDetail, CompanySignals) перестают зашивать h3/h4 —
// в карточке компании и в «Проверке» один и тот же блок стоит на разной глубине.

import { createContext, useContext } from 'react';

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/** На странице h1 один — в PageHeader; разделы начинаются со второго уровня. */
export const HeadingLevelContext = createContext<HeadingLevel>(2);

export const useHeadingLevel = (): HeadingLevel => useContext(HeadingLevelContext);

export const deeper = (level: HeadingLevel): HeadingLevel => (level >= 6 ? 6 : ((level + 1) as HeadingLevel));
