// Пользователи из консоли (ADR-014): первый администратор и восстановление доступа, когда войти
// некому. Всё остальное — экран «Пользователи» в админке.
//
//   npm run users -- --create-admin <логин> [--name "Имя Фамилия"]
//   npm run users -- --reset-password <логин>
//   npm run users -- --list
//
// На сервере: ./compose.sh exec api node dist/auth/cli.js --create-admin <логин>
//
// Пароль генерируется и печатается ОДИН раз в этот терминал; при первом входе его обязательно
// сменить. Он не пишется в журнал и не хранится нигде, кроме хеша в базе. Команда пишет в ту базу,
// что указана в DATABASE_URL, — автоматически не запускается.

import { closeDb } from '../db/pool.js';
import { env } from '../config/env.js';
import { generatePassword, passwordProblem } from './password.js';
import { pgAuthStore } from './pgStore.js';
import { AuthService, normalizeLogin, type IActor } from './service.js';

const CLI_ACTOR: IActor = { id: null, login: 'cli' };
const META = { ip: null, userAgent: null };

const argValue = (args: string[], flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
};

const temporaryPassword = (login: string): string => {
  for (;;) {
    const candidate = generatePassword();
    if (passwordProblem(candidate, login) === null) return candidate;
  }
};

const printPassword = (login: string, password: string): void => {
  console.log(`\nЛогин:            ${login}`);
  console.log(`Временный пароль: ${password}`);
  console.log('\nПароль показан один раз. При первом входе портал потребует сменить его.\n');
};

const service = new AuthService(pgAuthStore, {
  idleMs: env.SESSION_IDLE_MINUTES * 60_000,
  maxMs: env.SESSION_MAX_HOURS * 3_600_000,
});

const main = async (): Promise<number> => {
  const args = process.argv.slice(2);

  const adminLogin = argValue(args, '--create-admin');
  if (adminLogin !== undefined) {
    const login = normalizeLogin(adminLogin);
    const password = temporaryPassword(login);
    const result = await service.createUser(
      CLI_ACTOR,
      { login, displayName: argValue(args, '--name') ?? login, role: 'admin', password },
      META,
    );
    if (!result.ok) {
      console.error(`Не создан: ${result.error}`);
      return 1;
    }
    console.log(`Администратор создан (id ${result.user.id}).`);
    printPassword(login, password);
    return 0;
  }

  const resetLogin = argValue(args, '--reset-password');
  if (resetLogin !== undefined) {
    const login = normalizeLogin(resetLogin);
    const user = await pgAuthStore.findUserByLogin(login);
    if (!user) {
      console.error('Пользователь с таким логином не найден');
      return 1;
    }
    const password = temporaryPassword(login);
    const result = await service.resetPassword(CLI_ACTOR, user.id, password, META);
    if (!result.ok) {
      console.error(`Не сброшен: ${result.error}`);
      return 1;
    }
    console.log('Пароль сброшен, блокировка снята, все сессии пользователя закрыты.');
    if (!result.user.isActive) console.log('Внимание: пользователь выключен — включите его в админке.');
    printPassword(login, password);
    return 0;
  }

  if (args.includes('--list')) {
    const users = await service.listUsers();
    if (users.length === 0) {
      console.log('Пользователей нет. Первый администратор: npm run users -- --create-admin <логин>');
      return 0;
    }
    for (const u of users) {
      const state = u.isActive ? (u.lockedUntil ? 'заблокирован' : 'активен') : 'выключен';
      console.log(`${String(u.id).padStart(4)}  ${u.login.padEnd(24)} ${u.role.padEnd(9)} ${state.padEnd(13)} вход: ${u.lastLoginAt ?? '—'}`);
    }
    return 0;
  }

  console.log('Команды: --create-admin <логин> [--name "Имя"] | --reset-password <логин> | --list');
  return 1;
};

main()
  .then(async code => {
    await closeDb();
    process.exit(code);
  })
  .catch(async err => {
    console.error(`Ошибка: ${err instanceof Error ? err.message : String(err)}`);
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
