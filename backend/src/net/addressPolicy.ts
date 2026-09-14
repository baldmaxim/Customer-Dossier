// Какие IP-адреса запрещены для запросов к внешним источникам.
//
// Ссылка из публикации или ленты не должна уводить сервер во внутреннюю сеть:
// loopback, частные диапазоны, link-local (включая облачный metadata
// 169.254.169.254), служебные и документационные блоки. Проверяется адрес,
// в который реально резолвится имя, а не строка URL.

import net from 'node:net';

const blockList = new net.BlockList();

const IPV4_BLOCKED: Array<[string, number]> = [
  ['0.0.0.0', 8], // «этот» хост
  ['10.0.0.0', 8], // частная сеть
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, metadata облаков
  ['172.16.0.0', 12], // частная сеть
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // частная сеть
  ['198.18.0.0', 15], // бенчмарки
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // зарезервировано, включая broadcast
];

const IPV6_BLOCKED: Array<[string, number]> = [
  ['::', 96], // unspecified, loopback и устаревшие IPv4-compatible (::127.0.0.1)
  ['64:ff9b::', 96], // NAT64: внутри может быть частный IPv4
  ['64:ff9b:1::', 48], // локальный NAT64
  ['100::', 64], // discard
  ['2001::', 23], // IETF protocol assignments
  ['2001:db8::', 32], // документация
  ['2002::', 16], // 6to4: внутри может быть частный IPv4
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
];

for (const [address, prefix] of IPV4_BLOCKED) blockList.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of IPV6_BLOCKED) blockList.addSubnet(address, prefix, 'ipv6');

/** IPv4, спрятанный в IPv6 (::ffff:127.0.0.1 или ::ffff:7f00:1). */
const unwrapMappedIpv4 = (address: string): string | null => {
  const lower = address.toLowerCase();
  const dotted = /^(?:0{0,4}:){0,5}:?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  if (dotted?.[1]) return dotted[1];
  const hex = /^(?:0{0,4}:){0,5}:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex?.[1] && hex[2]) {
    const high = Number.parseInt(hex[1], 16);
    const low = Number.parseInt(hex[2], 16);
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
  }
  return null;
};

export const isBlockedAddress = (address: string): boolean => {
  const clean = address.replace(/^\[|\]$/g, '').split('%')[0] ?? '';
  const family = net.isIP(clean);
  if (family === 0) return true; // не адрес — не пускаем
  if (family === 4) return blockList.check(clean, 'ipv4');
  const mapped = unwrapMappedIpv4(clean);
  if (mapped !== null) return blockList.check(mapped, 'ipv4');
  return blockList.check(clean, 'ipv6');
};
