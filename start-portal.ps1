# Обычный запуск портала: два окна с уже проверенными командами и адреса. Больше ничего.
#
# Скрипт намеренно не делает: установку зависимостей, миграции, правку .env, включение фоновых
# задач, запуск модели и остановку чужих процессов Node.

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

foreach ($part in @('backend', 'frontend')) {
    $modules = Join-Path $root "$part\node_modules"
    if (-not (Test-Path $modules)) {
        Write-Host "[$part] нет node_modules: выполните 'npm ci' в $root\$part — зависимости скрипт не ставит."
        exit 1
    }
}

$envFile = Join-Path $root 'backend\.env'
if (-not (Test-Path $envFile)) {
    Write-Host '[backend] нет backend/.env: адрес базы вписывает пользователь вручную (образец — backend/.env.example).'
    exit 1
}

Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location '$root\backend'; npm run dev"
Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location '$root\frontend'; npm run dev"

Write-Host 'API:        http://127.0.0.1:4100  (только loopback)'
Write-Host 'Интерфейс:  http://127.0.0.1:5173'
Write-Host 'Вход не требуется: портал открывается сразу (API — только loopback).'
Write-Host 'Сбор, разбор и бот не запускаются: фоновые флаги по умолчанию выключены.'
Write-Host 'Остановка: Ctrl+C в каждом окне.'
