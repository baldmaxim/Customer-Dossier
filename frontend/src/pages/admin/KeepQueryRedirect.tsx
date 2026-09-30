import { FC } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

/**
 * Старый адрес раздела: путь новый, параметры адреса прежние — закладка на
 * «/admin/collect?tab=website» открывает ту же вкладку в «Источниках».
 */
export const KeepQueryRedirect: FC<{ to: string }> = ({ to }) => {
  const { search } = useLocation();
  return <Navigate to={`${to}${search}`} replace />;
};
