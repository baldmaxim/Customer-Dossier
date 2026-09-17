// Этап 15B без БД: правило полноты запуска для публикации.

import { describe, expect, it } from 'vitest';

import { runComplete } from './publish.js';

describe('полнота запуска для публикации (T15B-07)', () => {
  it('публикуется только completed с полным покрытием', () => {
    expect(runComplete({ status: 'completed', covered_chars: 120, total_chars: 120 })).toBe(true);
    expect(runComplete({ status: 'completed', covered_chars: 119, total_chars: 120 })).toBe(false);
    expect(runComplete({ status: 'completed', covered_chars: null, total_chars: null })).toBe(false);
    for (const status of ['partial', 'failed', 'cancelled', 'queued', 'running']) {
      expect(runComplete({ status, covered_chars: 120, total_chars: 120 }), status).toBe(false);
    }
    expect(runComplete(null)).toBe(false);
  });
});
