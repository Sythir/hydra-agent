import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { isObject, mergeDeep, type Obj } from './utils';

const ATTR = '@_';
const IDENTITY_ATTRS = [`${ATTR}key`, `${ATTR}name`, `${ATTR}id`];

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ATTR,
  allowBooleanAttributes: true,
  parseAttributeValue: false,
});

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: ATTR,
  format: true,
  indentBy: '  ',
  suppressEmptyNode: true,
  suppressBooleanAttributes: false,
});

function ensureArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function getIdentityAttr(items: Obj[]): string | undefined {
  return IDENTITY_ATTRS.find((attr) => items.every((item) => attr in item));
}

function isKeyedElement(value: unknown): boolean {
  return isObject(value) && IDENTITY_ATTRS.some((attr) => attr in value);
}

function mergeByKey(target: unknown[], source: unknown[], keyAttr: string): unknown[] {
  const result = target.map((item) => (isObject(item) ? { ...item } : item));

  for (const incoming of source) {
    if (!isObject(incoming)) continue;

    const idx = result.findIndex((item) => isObject(item) && item[keyAttr] === incoming[keyAttr]);
    if (idx >= 0) {
      result[idx] = mergeDeep(result[idx] as Obj, incoming);
    } else {
      result.push(incoming);
    }
  }

  return result;
}

/**
 * XML-aware deep merge. Three cases per property:
 * 1. Keyed elements  → merge by identity attribute (key/name/id)
 * 2. Container nodes → recurse (e.g. <appSettings>, <system.web>)
 * 3. Everything else → override
 */
function mergeXml(target: Obj, source: Obj): Obj {
  const result: Obj = { ...target };

  for (const key of Object.keys(source)) {
    const targetVal = result[key];
    const sourceVal = source[key];

    if (key.startsWith(ATTR)) {
      result[key] = sourceVal;
      continue;
    }
    console.log(target)
    console.log(source)

    if (Array.isArray(targetVal) || Array.isArray(sourceVal) || isKeyedElement(targetVal) || isKeyedElement(sourceVal)) {
      const targetArr = ensureArray(targetVal).filter(isObject) as Obj[];
      const sourceArr = ensureArray(sourceVal).filter(isObject) as Obj[];
      const identityAttr = getIdentityAttr([...targetArr, ...sourceArr]);

      if (identityAttr) {
        result[key] = mergeByKey(targetArr, sourceArr, identityAttr);
      } else {
        // Incompatible identity attributes (e.g. one has @_key, the other @_name)
        // — treat as a plain override rather than deep-merging into a hybrid element
        result[key] = sourceVal;
      }
      continue;
    }

    if (isObject(targetVal) && isObject(sourceVal)) {
      result[key] = mergeXml(targetVal, sourceVal);
      continue;
    }

    result[key] = sourceVal;
  }

  return result;
}

export function xmlMerger(config: string, overrides: string): string {
  const xmlDeclaration = (overrides.match(/<\?xml[^>]*\?>/) || config.match(/<\?xml[^>]*\?>/))?.[0];

  const parsedConfig = xmlParser.parse(config);
  const parsedOverrides = xmlParser.parse(overrides);
  delete parsedConfig['?xml'];
  delete parsedOverrides['?xml'];

  const merged = xmlBuilder.build(mergeXml(parsedConfig, parsedOverrides));
  return xmlDeclaration ? `${xmlDeclaration}\n${merged}` : merged;
}
