import { createHash } from 'node:crypto';

/**
 * Directory listing for a merchant/provider.
 *
 * This is the public `inspect` output and the shape a future Directory API is
 * expected to return. `runInspect` currently builds it locally from site
 * probes rather than calling a backend.
 *
 * Optional fields are omitted when absent — never `null` or empty placeholders.
 */

export interface DirectoryTool {
  command: string;
  description: string;
  url?: string;
}

export interface BrowserCheckoutTool {
  merchant_advice?: string;
  general_advice?: string;
}

export interface AvailableTools {
  machine_payments?: DirectoryTool[];
  mcp?: DirectoryTool[];
  provisioning?: DirectoryTool[];
  browser_checkout?: BrowserCheckoutTool;
}

export interface Directory {
  id: string;
  display_name?: string;
  profile_id?: string;
  username?: string;
  description?: string;
  url: string;
  llms_txt?: string[];
  available_tools?: AvailableTools;
}

/**
 * Local stand-in for a Directory API id. A future backend will assign
 * canonical `directory_...` ids; until then we derive a stable placeholder
 * from the origin so repeated inspects of the same site match.
 */
export function localDirectoryId(origin: string): string {
  const digest = createHash('sha256').update(origin).digest('hex').slice(0, 24);
  return `directory_${digest}`;
}

export function quoteCommandArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function compactDirectory(directory: Directory): Directory {
  return compactRecord(
    directory as unknown as Record<string, unknown>,
  ) as unknown as Directory;
}

export function parseLlmsTxtMeta(body: string): {
  title?: string;
  summary?: string;
} {
  const text = body.replace(/^\uFEFF/, '');
  const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const summary = text.match(/^>\s+(.+)$/m)?.[1]?.trim();
  return {
    ...(title ? { title } : {}),
    ...(summary ? { summary } : {}),
  };
}

export function parseMcpManifest(
  spec: unknown,
): { url: string; name?: string; description?: string }[] {
  if (!spec || typeof spec !== 'object') return [];
  const obj = spec as Record<string, unknown>;
  const name = typeof obj.name === 'string' ? obj.name : undefined;
  const description =
    typeof obj.description === 'string' ? obj.description : undefined;
  const found = new Map<
    string,
    { url: string; name?: string; description?: string }
  >();

  const add = (
    url: unknown,
    extra?: { name?: string; description?: string },
  ) => {
    if (typeof url !== 'string' || !url.trim()) return;
    const trimmed = url.trim();
    if (!found.has(trimmed)) {
      found.set(trimmed, {
        url: trimmed,
        name: extra?.name ?? name,
        description: extra?.description ?? description,
      });
    }
  };

  if (Array.isArray(obj.remotes)) {
    for (const remote of obj.remotes) {
      if (remote && typeof remote === 'object') {
        add((remote as Record<string, unknown>).url);
      }
    }
  }

  add(obj.url);
  add(obj.endpoint);
  add(obj.mcp_url);

  if (obj.endpoints && typeof obj.endpoints === 'object') {
    const endpoints = obj.endpoints as Record<string, unknown>;
    add(endpoints.streamable_http);
    add(endpoints.sse);
    add(endpoints.http);
  }

  if (obj.server && typeof obj.server === 'object') {
    add((obj.server as Record<string, unknown>).url);
  }

  return Array.from(found.values());
}

export function extractProvisionSlugs(text: string): string[] {
  const slugs = new Set<string>();
  const patterns = [
    /\bstripe\s+provision\s+([A-Za-z0-9][A-Za-z0-9._/-]*)/g,
    /\bstripe\s+projects\s+add\s+([A-Za-z0-9][A-Za-z0-9._/-]*)/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const slug = match[1]?.replace(/[.,;:]+$/, '');
      if (slug) slugs.add(slug);
    }
  }
  return Array.from(slugs);
}

export function extractLlmsTxtUrls(text: string, base: string): string[] {
  const urls = new Set<string>();
  const patterns = [
    /(?:href|content)\s*=\s*["']([^"']*llms(?:-full)?\.txt[^"']*)["']/gi,
    /\[[^\]]*\]\(([^)]*llms(?:-full)?\.txt[^)]*)\)/gi,
    /https?:\/\/[^\s)"']+llms(?:-full)?\.txt/gi,
    /(?:^|\s)(\/?[^\s)"']*llms(?:-full)?\.txt)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = (match[1] ?? match[0])?.trim();
      if (!raw) continue;
      try {
        urls.add(new URL(raw, base).toString());
      } catch {
        // ignore unparseable refs
      }
    }
  }
  return Array.from(urls);
}

export function extractMarkdownMcpLinks(
  text: string,
): { name: string; url: string }[] {
  const results: { name: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
    const name = match[1]?.trim();
    const url = match[2]?.trim();
    if (!name || !url) continue;
    if (!/mcp/i.test(name) && !/mcp/i.test(url)) continue;
    try {
      const absolute = new URL(url).toString();
      if (seen.has(absolute)) continue;
      seen.add(absolute);
      results.push({ name, url: absolute });
    } catch {
      // ignore relative/non-URL refs
    }
  }
  return results;
}

function compactRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    const compacted = compactValue(raw);
    if (compacted === undefined) continue;
    result[key] = compacted;
  }
  return result;
}

function compactValue(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  if (Array.isArray(value)) {
    const items = value
      .map((item) => compactValue(item))
      .filter((item) => item !== undefined);
    return items.length === 0 ? undefined : items;
  }
  if (typeof value === 'object') {
    const nested = compactRecord(value as Record<string, unknown>);
    return Object.keys(nested).length === 0 ? undefined : nested;
  }
  return value;
}
