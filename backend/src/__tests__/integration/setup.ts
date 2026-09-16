// Окружение интеграционных тестов в каждом воркере. DATABASE_URL подменяется
// тестовой целью только после повторной проверки guard'ом — общим для тестов, сидов и замеров.

import { prepareTestTargetProcess } from '../../db/testTargetBootstrap.js';

prepareTestTargetProcess();
process.env.DOTENV_CONFIG_PATH = 'integration-tests-do-not-load-dotenv.env';
