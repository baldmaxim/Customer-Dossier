// Флаги интерфейса, задаются при сборке. Секретов здесь нет.

/**
 * Рабочее досье (этап 08A): обращения, досье объекта, очередь проверки, резюме компании.
 * VITE_DOSSIER_UI=false — откат к прежнему интерфейсу; обращения в базе не удаляются.
 */
export const DOSSIER_UI_ENABLED = (import.meta.env.VITE_DOSSIER_UI as string | undefined) !== 'false';
