/** Normalize text for case- and whitespace-insensitive substring searches. */
export function normalizeSearchText(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Match a query as a partial phrase while treating whitespace and case as insignificant. */
export function searchTextIncludes(text: string, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return false;

  const modelVersionQuery = /gpt-?\d+(?:\.\d+)+$/.test(normalizedQuery);
  if (!modelVersionQuery) return normalizeSearchText(text).includes(normalizedQuery);

  // Preserve spaces and punctuation after the version so only an immediately
  // continuing digit or another numeric version segment blocks the match.
  const queryPattern = Array.from(normalizedQuery, escapeRegExp).join('\\s*');
  return new RegExp(`${queryPattern}(?!\\d|\\.\\d)`).test(text.normalize('NFKC').toLowerCase());
}

/** Normalize known product and model spellings in ordinary text without rewriting X syntax. */
export function canonicalizeSearchQuery(query: string): string {
  const trimmed = query.trim();
  const hasXSearchSyntax = (value: string) => /[A-Za-z_][\w-]*:|["“”「」『』@#]|(?:^|\s)-\S/.test(value);

  // Check before NFKC so quoted literals and operator values keep their spelling.
  if (hasXSearchSyntax(trimmed)) return trimmed;
  const normalized = trimmed.normalize('NFKC');
  // Also recognize compatibility forms of syntax, but return the original query.
  if (hasXSearchSyntax(normalized)) return trimmed;

  // Replace only complete known terms; keep all version digits and decimal parts verbatim.
  return normalized
    .replace(/(^|[^A-Za-z0-9_-])(google\s*workspace)(?=$|[^A-Za-z0-9_-])/gi, '$1Google Workspace')
    .replace(/(^|[^A-Za-z0-9_-])gpt(?:-|\s+)?(\d+(?:\.\d+)+)(?=$|[^A-Za-z0-9_-])/gi, '$1GPT-$2');

}
