// Экраны админки одним модулем: маршруты грузят его лениво (routes.tsx), и весь код админки
// уходит в отдельный чанк. Читатель портала админку не открывает — и не скачивает.

export { AccountPage } from '../AccountPage';
export { AdminLayout } from './AdminLayout';
export { DomRfPage } from './DomRfPage';
export { ModelPage } from './ModelPage';
export { ReviewQueuePage } from './ReviewQueuePage';
export { RunPage } from './RunPage';
export { RunsPage } from './RunsPage';
export { SourcesPage } from './SourcesPage';
export { UserPage } from './UserPage';
export { UsersPage } from './UsersPage';
