// Ключ Контур.Фокуса: ввод и удаление (Источники → Контур.Фокус, право focus.manage). Форма — общая
// для ключей внешних сервисов (ServiceKeyForm): значение не живёт нигде, кроме поля ввода.

import { FC } from 'react';

import type { IFocusKeySaved, IFocusKeyStatus } from '../../api/types';
import { ServiceKeyForm } from './ServiceKeyForm';

interface IFocusKeyFormProps {
  /** В админке уже есть ключ — его можно удалить. */
  hasAdminKey: boolean;
  onSaved: (result: IFocusKeySaved) => void;
  onCleared: (status: IFocusKeyStatus) => void;
  onError: (text: string) => void;
}

export const FocusKeyForm: FC<IFocusKeyFormProps> = ({ hasAdminKey, onSaved, onCleared, onError }) => (
  <ServiceKeyForm
    endpoint="/api/admin/focus/key"
    serviceName="Контур.Фокуса"
    hint="Ключ API из личного кабинета Контур.Фокуса. Перед сохранением он проверяется в Фокусе. На экран не возвращается — видно только четыре последних символа."
    hasAdminKey={hasAdminKey}
    onSaved={result => onSaved(result as IFocusKeySaved)}
    onCleared={onCleared}
    onError={onError}
  />
);
