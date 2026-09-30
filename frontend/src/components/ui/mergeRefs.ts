import type { Ref, RefCallback } from 'react';

/** Один узел — несколько получателей: ref снаружи и ref подсказки (useHint) у Button. */
export const mergeRefs =
  <T,>(...refs: ReadonlyArray<Ref<T> | undefined>): RefCallback<T> =>
  (node: T | null): void => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as { current: T | null }).current = node;
    }
  };
