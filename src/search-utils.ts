export function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeSelector(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return normalizeText(value);
}

export function compactSelector(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return normalizeText(value).replace(/:/g, '');
}

export function tokenizeSearchText(value: string): string[] {
  const withCamelCaseSplit = value.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  const normalized = withCamelCaseSplit
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  if (!normalized) {
    return [];
  }

  return [...new Set(normalized.split(/\s+/).filter(Boolean))];
}

export function buildFtsQuery(value: string): string | null {
  const tokens = tokenizeSearchText(value);

  if (tokens.length === 0) {
    return null;
  }

  return tokens.map((token) => `${token}*`).join(' OR ');
}

export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

export function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function compareVersionStrings(left: string, right: string): number {
  const leftParts = splitVersion(left);
  const rightParts = splitVersion(right);
  const maxLength = Math.max(leftParts.numbers.length, rightParts.numbers.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftNumber = leftParts.numbers[index] ?? 0;
    const rightNumber = rightParts.numbers[index] ?? 0;

    if (leftNumber !== rightNumber) {
      return leftNumber - rightNumber;
    }
  }

  if (!leftParts.suffix && rightParts.suffix) {
    return 1;
  }

  if (leftParts.suffix && !rightParts.suffix) {
    return -1;
  }

  return leftParts.suffix.localeCompare(rightParts.suffix);
}

export function pickLatestVersion(values: readonly string[]): string | null {
  if (values.length === 0) {
    return null;
  }

  return [...values].sort((left, right) => compareVersionStrings(right, left))[0] ?? null;
}

export function toIsoNow(): string {
  return new Date().toISOString();
}

function splitVersion(value: string): { numbers: number[]; suffix: string } {
  const match = value.match(/(\d+(?:\.\d+)*)(.*)/);

  if (!match) {
    return {
      numbers: [],
      suffix: value.toLowerCase(),
    };
  }

  return {
    numbers: match[1].split('.').map((part) => Number.parseInt(part, 10)),
    suffix: match[2].replace(/^[^a-z0-9]+/i, '').toLowerCase(),
  };
}