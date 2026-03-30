import type { TransformFnParams } from 'class-transformer';

interface OptionalClampedIntOptions {
  min?: number;
  max?: number;
}

const normalizeOptionalClampedInt = (
  rawValue: unknown,
  options: OptionalClampedIntOptions = {},
): unknown => {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return undefined;
  }

  const parsed = Number.parseInt(String(rawValue).trim(), 10);
  if (!Number.isFinite(parsed)) {
    return rawValue;
  }

  let normalized = Math.trunc(parsed);
  if (typeof options.min === 'number' && normalized < options.min) {
    normalized = options.min;
  }
  if (typeof options.max === 'number' && normalized > options.max) {
    normalized = options.max;
  }

  return normalized;
};

export const toOptionalClampedInt =
  (options: OptionalClampedIntOptions = {}) =>
  ({ value }: TransformFnParams): unknown =>
    normalizeOptionalClampedInt(value, options);
