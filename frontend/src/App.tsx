import { FC } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { Layout } from './components/Layout';
import { UpdatePrompt } from './components/UpdatePrompt';
import { AdminPage } from './pages/AdminPage';
import { CompanyPage } from './pages/CompanyPage';
import { ContractorsPage } from './pages/ContractorsPage';
import { DocumentPage } from './pages/DocumentPage';
import { ProjectPage } from './pages/ProjectPage';
import { RunPage } from './pages/RunPage';
import { RunsPage } from './pages/RunsPage';
import { ReviewQueuePage } from './pages/ReviewQueuePage';
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

/** Вход снят на время разработки: портал открывается сразу. */
const Portal: FC = () => (
  <Layout>
    <Routes>
      <Route path="/" element={<SearchPage />} />
      <Route path="/company/:id" element={<CompanyPage />} />
      <Route path="/contractors" element={<ContractorsPage />} />
      <Route path="/documents/:id" element={<DocumentPage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/runs" element={<RunsPage />} />
      <Route path="/runs/:id" element={<RunPage />} />
      <Route path="/projects/:id" element={<ProjectPage />} />
      <Route path="/review" element={<ReviewQueuePage />} />
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
