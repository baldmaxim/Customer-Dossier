import { FC } from 'react';
import { Navigate, useParams } from 'react-router-dom';

/** Старая ссылка на запуск (/runs/:id): номер сохраняется. */
export const RunsRedirect: FC = () => {
  const { id } = useParams();
  return <Navigate to={`/admin/process/${id ?? ''}`} replace />;
};
