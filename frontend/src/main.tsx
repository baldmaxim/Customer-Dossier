import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { purgeSensitiveCaches } from './lib/cachePurge';
import './index.css';

// Прежние сборки кэшировали ответы API и шрифты. Удаляем при каждом старте:
// досье не должно читаться из кэша после выхода или смены сборки.
void purgeSensitiveCaches();

const root = document.getElementById('root');
if (!root) throw new Error('Не найден #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
