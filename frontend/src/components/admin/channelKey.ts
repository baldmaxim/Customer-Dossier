/** «@name», «t.me/name», «https://t.me/s/name» — всё это один канал «name». */
export const channelKey = (raw: string): string =>
  raw
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^t\.me\/(s\/)?/i, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0] ?? '';
