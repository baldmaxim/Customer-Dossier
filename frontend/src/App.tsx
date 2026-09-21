import { FC } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';

import { Layout } from './components/Layout';
import { UpdatePrompt } from './components/UpdatePrompt';
import { AdminLayout } from './pages/admin/AdminLayout';
import { CollectPage } from './pages/admin/CollectPage';
import { PipelinePage } from './pages/admin/PipelinePage';
import { ResultPage } from './pages/admin/ResultPage';
import { CompanyPage } from './pages/CompanyPage';
import { ContractorsPage } from './pages/ContractorsPage';
import { DocumentPage } from './pages/DocumentPage';
import { LinksPage } from './pages/LinksPage';
import { ProjectPage } from './pages/ProjectPage';
import { RunPage } from './pages/admin/RunPage';
import { RunsPage } from './pages/admin/RunsPage';
import { ReviewQueuePage } from './pages/admin/ReviewQueuePage';
import { SearchPage } from './pages/SearchPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Данные обновляются раз в 10 минут пересчётом метрик — рефетч на каждый
      // фокус окна только дёргает БД без пользы.
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

/** Старая ссылка на запуск: номер сохраняется. */
const RunsRedirect: FC = () => {
  const { id } = useParams();
  return <Navigate to={`/admin/process/${id ?? ''}`} replace />;
};

/** Вход снят на время разработки: портал открывается сразу. */
const Portal: FC = () => (
  <Layout>
    <Routes>
      <Route path="/" element={<SearchPage />} />
      <Route path="/company/:id" element={<CompanyPage />} />
      <Route path="/links" element={<LinksPage />} />
      <Route path="/contractors" element={<ContractorsPage />} />
      <Route path="/documents/:id" element={<DocumentPage />} />
      <Route path="/projects/:id" element={<ProjectPage />} />

      {/* Админка — конвейер: сбор → обработка → результат. Вложенный роут один,
          и только здесь: подшапка ступеней рисуется один раз. */}
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<PipelinePage />} />
        <Route path="collect" element={<CollectPage />} />
        <Route path="process" element={<RunsPage />} />
        <Route path="process/:id" element={<RunPage />} />
        <Route path="result" element={<ResultPage />} />
        <Route path="review" element={<ReviewQueuePage />} />
      </Route>

      {/* Постоянные редиректы: по старым ссылкам из закладок и отчётов. */}
      <Route path="/runs" element={<Navigate to="/admin/process" replace />} />
      <Route path="/runs/:id" element={<RunsRedirect />} />
      <Route path="/review" element={<Navigate to="/admin/review" replace />} />
      {/* Обращения и снимки сняты с портала: данные в базе целы, экранов нет.
          Редиректы постоянные — по старым ссылкам из закладок и отчётов. */}
      <Route path="/cases/*" element={<Navigate to="/" replace />} />
      <Route path="/snapshots/*" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </Layout>
);

export const App: FC = () => (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <Portal />
      <UpdatePrompt />
    </BrowserRouter>
  </QueryClientProvider>
);
