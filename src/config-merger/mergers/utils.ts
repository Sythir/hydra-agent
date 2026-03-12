export type Obj = Record<string, unknown>;

export function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function mergeDeep(target: Obj, source: Obj): Obj {
  const result: Obj = { ...target };

  for (const key of Object.keys(source)) {
    if (isObject(result[key]) && isObject(source[key])) {
      result[key] = mergeDeep(result[key] as Obj, source[key] as Obj);
    } else {
      result[key] = source[key];
    }
  }

  return result;
}
