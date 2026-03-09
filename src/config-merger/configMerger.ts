import { dotenvMerger } from './mergers/dotenv';
import { jsonMerger } from './mergers/json';
import { xmlMerger } from './mergers/xml';

const mergers: Record<string, (config: string, overrides: string) => string> = {
  xml: xmlMerger,
  json: jsonMerger,
  dotenv: dotenvMerger,
  env: dotenvMerger,
  properties: dotenvMerger,
  text: (_config, overrides) => overrides,
};

export function configMerger(config: string = '', overrides: string = '', type: string): string {
  const merger = mergers[type.toLowerCase()];
  return merger ? merger(config, overrides) : overrides;
}
