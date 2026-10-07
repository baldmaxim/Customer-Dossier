// Запись застройщика в реестре ДОМ.РФ на вкладке «Сведения»: одной строкой, полная карточка — под раскрытием (её
// реквизиты и адрес уже в шапке). Якорь #company-registry.
//
// Прежний «Объекты по данным ДОМ.РФ» снят 07.10.2026: он считал квартиры, цену, распроданность и сроки на клиенте по
// одному снимку на объект, а «Сроки и продажи» рядом — на сервере по домам, и числа расходились. Разбивки статусов и
// сроков по годам теперь в «Сроках и продажах» (registry/delivery.ts) — один расчёт.

import { FC } from 'react';

import type { ICompanyResponse } from '../../api/types';
import { RegistryPanel } from '../RegistryPanel';
import { registryDateText } from '../RegistryChanges';
import { Disclosure } from '../ui/Disclosure';
import { Section } from '../ui/Section';
import styles from './Company.module.css';

export interface ICompanyDeveloperRecordProps {
  data: ICompanyResponse;
  /** Строки карточки застройщика, уже показанные в шапке (CompanyInfo). */
  registryOmit: ReadonlySet<string>;
}

export const CompanyDeveloperRecord: FC<ICompanyDeveloperRecordProps> = ({ data, registryOmit }) => {
  const registry = data.registry;
  if (!registry) return null;
  return (
    <Section id="company-registry" title="Застройщик в реестре ДОМ.РФ">
      <div className={styles.portfolioDeveloper}>
        <p className={styles.portfolioDeveloperLine}>
          Запись застройщика: {registry.source.title}, № {registry.externalRef}
          {registry.groupName ? ` · группа «${registry.groupName}»` : ''} · {registryDateText(registry.asOf, registry.fetchedAt)}
        </p>
        <Disclosure summary="Сведения реестра о застройщике">
          <RegistryPanel registry={registry} bare omit={registryOmit} attribution={false} />
        </Disclosure>
      </div>
    </Section>
  );
};
