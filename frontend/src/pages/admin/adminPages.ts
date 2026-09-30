// Экраны админки одним модулем: маршруты грузят его лениво (routes.tsx), и весь код админки
// уходит в отдельный чанк. Читатель портала админку не открывает — и не скачивает.

export { AccountPage } from '../AccountPage';
export { AdminLayout } from './AdminLayout';
export { ModelPage } from './ModelPage';
export { ReviewQueuePage } from './ReviewQueuePage';
export { RunPage } from './RunPage';
export { RunsPage } from './RunsPage';
export { SourcesPage } from './SourcesPage';
export { UsersPage } from './UsersPage';
