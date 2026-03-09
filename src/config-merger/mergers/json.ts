import { mergeDeep } from './utils';

export function jsonMerger(config: string, overrides: string): string {
  return JSON.stringify(mergeDeep(JSON.parse(config || '{}'), JSON.parse(overrides || '{}')), null, 2);
}
