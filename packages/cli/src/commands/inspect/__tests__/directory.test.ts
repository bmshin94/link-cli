import { describe, expect, it } from 'vitest';
import {
  type Directory,
  compactDirectory,
  extractLlmsTxtUrls,
  extractMarkdownMcpLinks,
  extractProvisionSlugs,
  localDirectoryId,
  parseLlmsTxtMeta,
  parseMcpManifest,
  quoteCommandArg,
} from '../directory';

describe('directory helpers', () => {
  it('derives a stable local directory_ id from the origin', () => {
    const a = localDirectoryId('https://shop.example.com');
    const b = localDirectoryId('https://shop.example.com');
    const c = localDirectoryId('https://other.example.com');
    expect(a).toMatch(/^directory_[0-9a-f]{24}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('omits null, empty, and blank optional Directory fields', () => {
    const compacted = compactDirectory({
      id: 'directory_abc',
      display_name: '',
      profile_id: undefined,
      username: '  ',
      description: 'A shop',
      url: 'https://shop.example.com',
      llms_txt: [],
      available_tools: {
        machine_payments: [],
        mcp: undefined,
        browser_checkout: {
          merchant_advice: '',
          general_advice: 'Pay in browser',
        },
      },
    } as Directory);

    expect(compacted).toEqual({
      id: 'directory_abc',
      description: 'A shop',
      url: 'https://shop.example.com',
      available_tools: {
        browser_checkout: { general_advice: 'Pay in browser' },
      },
    });
    expect(JSON.stringify(compacted)).not.toContain('null');
    expect(compacted).not.toHaveProperty('display_name');
    expect(compacted).not.toHaveProperty('profile_id');
    expect(compacted).not.toHaveProperty('username');
    expect(compacted).not.toHaveProperty('llms_txt');
  });

  it('parses llms.txt title and summary', () => {
    expect(
      parseLlmsTxtMeta('# Shop\n\n> Sells widgets\n\nDetails here.\n'),
    ).toEqual({ title: 'Shop', summary: 'Sells widgets' });
  });

  it('parses MCP manifests from remotes, endpoints, and url fields', () => {
    expect(
      parseMcpManifest({
        name: 'shop',
        description: 'Shop MCP',
        remotes: [{ url: 'https://shop.example.com/mcp' }],
      }),
    ).toEqual([
      {
        url: 'https://shop.example.com/mcp',
        name: 'shop',
        description: 'Shop MCP',
      },
    ]);
    expect(
      parseMcpManifest({
        endpoints: { streamable_http: 'https://shop.example.com/sse' },
      }),
    ).toEqual([{ url: 'https://shop.example.com/sse' }]);
  });

  it('extracts stripe provision slugs from text', () => {
    expect(
      extractProvisionSlugs(
        'Run stripe provision neon --yes or stripe projects add supabase/project.',
      ),
    ).toEqual(['neon', 'supabase/project']);
  });

  it('extracts llms.txt URLs relative to the origin', () => {
    expect(
      extractLlmsTxtUrls(
        '<link rel="describedby" href="/docs/llms.txt">',
        'https://shop.example.com',
      ),
    ).toContain('https://shop.example.com/docs/llms.txt');
  });

  it('extracts markdown MCP links', () => {
    expect(
      extractMarkdownMcpLinks(
        '- [Shop MCP](https://shop.example.com/api/mcp)\n- [Docs](https://shop.example.com/docs)',
      ),
    ).toEqual([{ name: 'Shop MCP', url: 'https://shop.example.com/api/mcp' }]);
  });

  it('shell-quotes command arguments', () => {
    expect(quoteCommandArg("https://shop.example.com/a'b")).toBe(
      "'https://shop.example.com/a'\\''b'",
    );
  });
});
