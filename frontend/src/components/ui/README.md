# Примитивы интерфейса (`src/components/ui/`)

Каталог для страниц портала. Импорт — из файла примитива: `import { Tabs } from '../components/ui/Tabs'`.
Токены — `src/index.css` (шкалы `--sp-*`, `--fs-*`, `--ctl-*`, `--z-*`, статусы, движение); брейкпоинты —
`src/lib/media.ts` (`MQ.sm` 600 · `MQ.md` 900 · `MQ.lg` 1280 · `MQ.reader`).

## Что когда

| Задача | Берите | Не берите |
|---|---|---|
| Разделы страницы («Сведения · Объекты · Публикации · Подробно», вкладки «Подробно» и «Проверки») | `Tabs` + `TabPanel` | `Segmented` |
| Разделы-адреса (админка: у каждого свой URL) | `TabLinks` | `Tabs` |
| Фильтр или режим внутри экрана («По числу объектов / По названию») | `Segmented` | `Tabs` |
| Раздел с заголовком на карточке | `Section` | `Card` + свой h2 |
| Поверхность без заголовка (элемент списка, плитка, панель) | `Card` | свой `.panel` |
| Ошибка загрузки, предупреждение, пояснение, которое остаётся на экране | `Callout` | тост |
| «Сделано» / «не удалось» после нажатия | `useToast().show` | `Notice`, баннер вверху |
| Подтвердить необратимое (удалить, сменить роль) | `useConfirm()` | `window.confirm` |
| Отдельная задача поверх страницы (новый пароль, форма) | `Dialog` (на телефоне — лист) | `window.prompt` |
| Свернуть второстепенное на месте | `Disclosure` | кнопку-переключатель с `useState` |
| «Откуда известно», контекст и подробности строки списка (решение владельца 06.10.2026) | `EvidenceButton`, `Dialog` | раскрытие под строкой, переход на другую страницу |
| Пары «подпись — значение» | `DescriptionList` | свои `Row`/`Line`/`dl.facts` |
| Широкая таблица | `TableScroll` на ≥ 600, `CardList` на < 600 | таблицу без прокрутки |
| Загрузка | `Loading` (+ `Skeleton`) | «Загрузка…» голым текстом, «пусто», «0» |
| Пусто | `EmptyState` (словами + действие) | команды CLI и имена env |

## Состояния — одна схема везде

```tsx
if (query.isLoading) return <Loading label="Загружаю компании…"><Skeleton lines={6} height="44px" /></Loading>;
if (query.isError)
  return (
    <Callout tone="danger" title="Не удалось загрузить" action={<Button onClick={() => void query.refetch()}>Повторить</Button>}>
      {describeLoadError(query.error)}
    </Callout>
  );
if (rows.length === 0) return <EmptyState title="Ничего не найдено" action={<Button onClick={reset}>Сбросить фильтр</Button>}>Проверьте написание.</EmptyState>;
```

`Callout tone="danger"` по умолчанию `role="alert"` (тесты находят его `findByRole('alert')`); `Loading` — `role="status"`.
404 — это «не найдено», прочее — `describeLoadError` + «Повторить».

## Оболочка, переходы, фокус

- **Заголовок страницы** — `PageHeader` (единственный h1, `tabIndex=-1`). Строковый `title` ставит и заголовок
  вкладки браузера («… — Досье Заказчика»); для составного — `docTitle="…"`. Без PageHeader — `usePageTitle(title)`.
- **Фокус при переходе** делает оболочка (`hooks/useRouteFocus.ts`): после смены pathname фокус — на h1, пока h1 нет
  (данные грузятся) — на `main`, потом переезжает на h1. Диктору объявляется название страницы. Смена query фокус не трогает.
  Ничего делать не нужно — только один h1 через `PageHeader`.
- **View Transitions**: на ссылках к другим экранам ставьте `viewTransition` — `<Link to={`/company/${id}`} viewTransition>`
  (и `.row-link-target` в строках таблиц). Шапка, нижняя панель, BackBar, `TabLinks`, `ButtonLink`, `CardListItem` уже с ним.
  Не ставьте его на смену параметров (`setSearchParams`, поиск, фильтры). Без поддержки браузера — просто смена экрана;
  при `prefers-reduced-motion` — без анимации. Смена вида без маршрута (список ↔ пост на телефоне) —
  `startViewTransition(() => setOpen(k))` из `lib/motion.ts` (+ `view-transition-name: post` у поста).
- **BackBar** рисуется только на `/company/:id`, `/projects/:id`, `/documents/:id`, `/admin/process/:id`. Спрятать его
  (пост открыт вместо списка и свой «К списку» рядом): `data-hide-backbar` на любом элементе внутри `main`.
- **Читалка «в один экран»**: `data-fill-screen` на корне читалки (и в загрузке/ошибке — чтобы раскладка не прыгала);
  условие — `MQ.reader`, не одна ширина.
- **Состояние экрана — в адресе**: `useUrlState` (`hooks/useUrlState.ts`):
  ```ts
  const [tab, setTab] = useUrlState('tab', enumParam(TABS, 'overview'), { history: 'push' }); // вкладка, открытый пост
  const [q, setQ] = useUrlState('q', stringParam());                                          // поиск, фильтры: replace
  const patch = useUrlPatch(); patch({ view: 'publications', post: null }, { history: 'push' }); // несколько разом
  ```
  Значение по умолчанию в адрес не пишется, мусор в адресе — значение по умолчанию, прокрутка не сбрасывается.
  Если зовёте `setSearchParams` сами — передавайте `{ preventScrollReset: true }`: иначе ScrollRestoration уведёт наверх.
- **Таблица → карточки на телефоне**: `const wide = useMediaQuery(MQ.sm); wide ? <TableScroll…/> : <CardList…/>`.
  Не рендерите оба варианта сразу, пряча один CSS: тексты задвоятся и тесты получат «found multiple elements».

## Примитивы

**Раскладка**
- `Stack` — `{ gap?: 0–7 (шкала --sp), as?, align? }` — вертикальный поток, gap вместо margin детей.
- `Cluster` — `{ gap?: Space | [ряд, колонка], align?, justify?: 'start'|'between'|'end'|'center', wrap? }` — ряд с переносом
  (кнопки, ярлыки, мета-строка без разделителей «·»).
- `Grid` — `{ min?: '240px', gap? }` — `repeat(auto-fit, minmax(min(100%, min), 1fr))`, на телефоне одна колонка.
- `Card` — `{ as?, padding?: 'none'|'sm'|'md'|'lg', tone?: 'default'|'muted'|'accent', elevated?, interactive?, selected? }`.
- `Section` — `{ title?, note?, actions?, footer?, level?, variant?: 'card'|'plain', id? }`. `footer` — концовка под чертой:
  «Все события — 12 →», «Показать все» (длинный блок показывает первые строки и кончается ссылкой на полный список). Уровень заголовка — из контекста
  (h2 на странице, h3 в разделе раздела); содержимое получает уровень глубже. `Heading` — заголовок с уровнем из контекста
  (для переиспользуемых блоков вместо зашитых h3/h4), `HeadingLevelContext` — задать уровень вручную.
- `PageHeader` — `{ title, titleHidden?, eyebrow?, meta?, lead?, actions?, docTitle?, children? (вкладки под шапкой) }`.

**Навигация**
- `Tabs` — `{ label, items: {value,label,count?,hint?,disabled?}[], value, onChange, idBase?, variant?: 'underline'|'pill',
  size?, activation?: 'auto'|'manual' }`; `TabPanel` — `{ idBase, value, focusable? }`. Клавиатура: ←/→ по кругу, Home/End;
  одна остановка Tab. `idBase` — общий `useId()` пары, иначе вкладки не связаны с панелью.
  ```tsx
  const idBase = useId();
  <Tabs label="Разделы компании" idBase={idBase} items={TABS} value={tab} onChange={setTab} />
  <TabPanel idBase={idBase} value={tab}>{tab === 'overview' ? <Overview /> : …}</TabPanel>
  ```
- `TabLinks` — `{ label, items: {to,label,end?,count?,group?}[], variant? }` — `<nav>` со ссылками и `aria-current`;
  разделитель — между разными `group`. Переход не уводит фокус со вкладки.
- `Segmented` — `{ label, items: {value,label,hint?,disabled?}[], value, onChange, size?, fill? }` — `role="group"` +
  `aria-pressed`; не помещается — прокрутка в строку. `fill` — пункты поровну во всю ширину (режимы на телефоне).
- `Pagination` — `{ label, page, pageSize, total, onChange }` — «Назад · 51–100 из 4 700, страница 2 из 94 · Вперёд» для
  списка, который считает сервер (offset): номер страницы — в адресе (`numberParam(1)`), смена фильтра сбрасывает его.
  Лента «новее / старее» по курсору — `useCursorPaging` (admin).
- `ButtonLink` — `Link` в виде кнопки: пропсы `Link` + `variant/size/icon/iconEnd/block`; `viewTransition` по умолчанию.

**Действия**
- `Button` — `{ variant?: 'primary'|'secondary'|'ghost'|'danger'|'danger-solid'|'link'|'chip', size?: 'sm'|'md'|'lg', icon?, iconEnd?,
  iconOnly? (+ aria-label), block?, loading?, hint?, ref? }`. `loading` — спиннер, `aria-busy`, нажатия игнорируются, фокус остаётся.
  `buttonClass({variant,size})` — классы кнопки для `<a href>` на внешний адрес или `<summary>`.
- `Switch` — `{ checked, onChange, label, onText?, offText?, disabled? }` — `role="switch"`, состояние словом.

**Поля** — шрифт ≥ 16px, рамка ≥ 3:1, контур фокуса.
- `Field` — `{ label, hint?, error?, required?, labelHidden?, id? }` + функция-ребёнок с атрибутами для контрола:
  `<Field label="Логин" error={err}>{c => <TextInput {...c} value={v} onChange={…} />}</Field>`.
- `TextInput` / `Select` / `Textarea` — нативные пропсы + `size?: 'md'|'lg'`, `block?` (по умолчанию во всю ширину), `invalid?`, `ref?`.
- `Checkbox` — `{ label, hint?, checked, onChange(checked) }` — строка ≥ 44px, подсказка в описании, не в имени.
- `SearchInput` — `{ value, onChange(value), label, labelVisible?, onClear?, size? }` — лупа, «Очистить поиск», Esc очищает.

**Сообщения**
- `Callout` — `{ tone?: StatusTone, title?, action?, onClose?, live?: 'assertive'|'polite'|'off', icon? }`.
- `useToast()` → `{ show({ text, tone?, action?: {label,onClick}, duration?: мс|null, id?, dismissLabel?, onDismiss? }), dismiss(id) }`.
  По умолчанию 6 с, `danger` — висит до закрытия; тот же `id` заменяет тост. Тост во время открытого модального диалога
  окажется под подложкой — показывайте его после закрытия.
- `Dialog` — `{ open, onClose, title, description?, size?: 'sm'|'md'|'lg'|'xl', variant?: 'auto'|'modal'|'sheet', footer?,
  initialFocus?, closeOnBackdrop? }`. `auto` — лист снизу < 600px, окно по центру шире. Esc, крестик, подложка → `onClose`.
- `useConfirm()` → `confirm({ title, body?, confirmLabel, cancelLabel?, tone?: 'danger' })` → `Promise<boolean>`.
  Кнопка — глагол («Удалить»), не «ОК»; у `danger` фокус сначала на «Отмена».
- `Loading` — `{ label?, variant?: 'inline'|'block'|'page', children? (скелет) }`; `Skeleton` — `{ lines?, width?, height?, radius? }`.
- `EmptyState` — `{ title?, children (почему пусто), icon?: IconName|false, action?, size?: 'md'|'sm' }`.

**Показ данных**
- `Badge` — `{ tone?: StatusTone | 'accent', hint? }`. Тон статуса — `toneOf(X_TONE, value)` из `lib/statusTone.ts`, подпись —
  из `labels.ts`. С `hint` ярлык — кнопка (цель 24px: 44px перекрывали бы соседние ссылки). `positive`/`warn` — устаревшие имена.
- `CopyValue` — `{ value, label }` — значение, которое копируют (ИНН, ОГРН): само значение — кнопка со значком, итог —
  тостом «ИНН скопирован». Без Clipboard API — просто текст.
- `Term` — машинное значение → подпись из словаря (+ пояснение). `Hint` — значок «?» (цель 44px) с пояснением.
- `DescriptionList` — `{ items: {label,value,hint?,key?}[], layout?: 'stacked'|'inline'|'auto', dense? }`; пустое — «—».
- `TableScroll` — `{ label?, caption?, captionVisible?, minWidth?, stickyHead? }`. В ячейках: `className="num"` — числа и даты
  вправо, табличные цифры, без переноса; `className="nowrap"` — без переноса. Заголовок колонки действий —
  `<th><VisuallyHidden>Действия</VisuallyHidden></th>`, не пустой `<th />`.
- `CardList` + `CardListItem` — `{ to?, title, meta?, aside?, actions?, selected?, viewTransition? }` — таблица на телефоне.
- `Disclosure` — `{ summary, meta?, defaultOpen?, open?, onToggle?, variant?: 'plain'|'card', level? }` на `<details>`;
  `level` — заголовок раздела в summary (свёрнутые разделы страницы объекта).
- `Icon` — `{ name, size?: 'sm'|'md'|'lg', label? }`. Без `label` — декоративная. Стрелки и крестики — только иконками,
  не глифами ←/→/× в тексте (диктор читает их вслух).
- `VisuallyHidden` — текст только для диктора.

## Графики (`src/components/charts/`)

Свои примитивы на токенах `--chart-*`, без библиотек. Перед новым графиком — скилл `dataviz` (форма, метки, проверка цвета).

- `BarList` — `{ label, items: {key,label,value}[], total?, limit?, restText? }`: подпись · полоса · число. Номинальные
  категории (роли, виды, статусы) — одним цветом; `total` — знаменатель (полоса на дорожке = доля), без него — от максимума.
- `StackedBar` — `{ label, segments (≤ 4, от сильной к слабой), total? }`: часть целого для порядковых категорий;
  ступень цвета — по позиции категории, легенда — текстом с числом и долей.
- `Meter` — `{ label, share: 0..1 | null, caption? }`: доля; `null` — «недостаточно данных».
- `MonthBars` — `{ label, points: {month:'YYYY-MM', value}[], forms, partialLast? }`: столбики по месяцам, сводка — в
  `aria-label`, наведение — строкой над графиком. Два ряда — два графика, не две шкалы.
- `Sparkline` — `{ values, partialLast? }`: мини-столбики в плитке, скрыт от диктора (число — текстом рядом).
- `ChartData` — таблица чисел графика под раскрытием, монтируется при первом раскрытии.

Число — всегда текстом, полоса только подсвечивает. Статусных цветов в графиках нет (ADR-009). Скругление 4px — только у
конца данных, между заливками — 2px поверхности, рамок у меток нет.

## Правила

- Цвета, отступы, размеры шрифта, слои, длительности — только токенами. Статусные тоны — `--success/--warning/--danger/
  --info/--neutral` (+ `-bg`, `-border`); `--risk-*` — временные алиасы, новых использований нет.
- `:hover` — только внутри `@media (hover: hover)`; `:focus-visible` — глобальный контур, свой — только если контур надо
  увести внутрь (`outline-offset: calc(var(--focus-ring-width) * -1)`) в прокручиваемой полосе. `outline: none` без замены — нельзя.
- Брейкпоинты — только `min-width` 600/900/1280 (mobile-first), в JS — `MQ` из `lib/media.ts`.
- Анимации — только `transform`/`opacity`, длительности `--dur-*`, кривые `--ease-*`. Общие кадры (`enter-up`, `fade-in`,
  `fade-out`, `exit-down`, `sheet-in`, `sheet-out`, `pulse`, `spin`) — в CSS-модуле через `global()`:
  `animation: global(enter-up) var(--dur-base) var(--ease-out);` — иначе CSS-модуль сделает имя локальным.
  Догруженные элементы списка — класс `appear` и `style={{ '--i': номерВПорции }}`. Плавная прокрутка —
  `scrollIntoView({ behavior: scrollBehavior() })` из `lib/motion.ts`.
- Тап-цели на телефоне ≥ 44px: `--tap-min`, `--ctl-h` (44 под палец, 36 под мышь — `pointer: fine`).
- Плотность: промежуток между блоками страницы — `--sp-4` (`Stack gap={4}`), поля карточки — `Section` (12/16px);
  `--sp-5` и больше — только с комментарием «почему». Межстрочный — `--lh-ui` у интерфейса, `--lh-text` — блоку прозы явно.
- Ширина: каркас — до `--page-max` по центру; блок, которому нужна вся ширина экрана, ставит `data-bleed` на корень страницы.
- Шрифт — Inter из бандла (`styles/fonts.css`); числа в колонках — `font-variant-numeric: tabular-nums`.
- Ссылка внутри текста без класса подчёркнута глобально; ссылкам-компонентам (меню, строки) — свой класс.
- Числа — `formatCount` (`lib/format.ts`: разделитель тысяч — неразрывный пробел), формы слова — `pluralize`/`formatCountWord`,
  длительность — `formatDuration`; даты и деньги — `labels.ts`.
- Общие помощники: `useDebounced` (`hooks/`), `newKey` (`lib/idempotency.ts`) — вместо копий в страницах.
- Тесты: `renderWithProviders` (MemoryRouter + тосты + подтверждения) и `renderWithRouter(routes, [url])` (data-роутер:
  история, редиректы) из `src/test/render.tsx`. Без провайдера `useToast`/`useConfirm` бросают ошибку — это намеренно.
