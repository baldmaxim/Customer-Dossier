# Обратный туннель к LM Studio с домашнего ПК на quantor (TG_Info, ADR-013).
#
# Запускается задачей планировщика «При запуске системы» от SYSTEM, с ExecutionTimeLimit = PT0S:
# значение по умолчанию (72 ч) убивает процесс — так уже падал xray на домашней машине.
# LM Studio остаётся на 127.0.0.1:1234 — в локальную сеть его открывать не нужно.
#
# Ключ и known_hosts лежат в C:\ProgramData\tginfo\ (доступ — SYSTEM и администраторы, владелец ключа —
# SYSTEM: иначе ssh от SYSTEM отвергает ключ как слишком открытый).
# Разрыв связи, сон ПК или перезапуск Docker на сервере — туннель переподключается сам;
# пока его нет, портал работает, а разбор ждёт модель (этап 22, probeModel).

$ErrorActionPreference = 'Continue'
$dir = 'C:\ProgramData\tginfo'
$server = 'llmtunnel@<адрес quantor>'

while ($true) {
    & ssh.exe -N `
        -i "$dir\llmtunnel_ed25519" `
        -o "UserKnownHostsFile=$dir\known_hosts" `
        -o StrictHostKeyChecking=yes `
        -o ExitOnForwardFailure=yes `
        -o ServerAliveInterval=30 `
        -o ServerAliveCountMax=3 `
        -R 172.30.0.1:1234:127.0.0.1:1234 `
        $server
    Start-Sleep -Seconds 20
}
