import { z } from 'zod';
import type { LinkOptions } from '@/config';
import { LinkSdkError } from '@/errors';
import { BaseResource } from '@/resources/base';
import type { IWebBotAuthResource } from '@/resources/interfaces';
import type { WebBotAuthBlock } from '@/types/index';

interface CacheEntry {
  block: WebBotAuthBlock;
  expiresAt: number;
}

const EXPIRY_BUFFER_MS = 30_000;

const webBotAuthBlockSchema = z.looseObject({
  signature: z.string().min(1),
  signature_input: z.string().min(1),
  signature_agent: z.string().min(1),
  authority: z.string().min(1),
  expires_at: z.string().min(1),
});
const webBotAuthResponseSchema = z.looseObject({
  web_bot_auth: webBotAuthBlockSchema,
});

export class WebBotAuthResource
  extends BaseResource
  implements IWebBotAuthResource
{
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: LinkOptions) {
    super(options, '/web_bot_auth/sign');
  }

  private parseBlock(
    operation: string,
    status: number,
    data: unknown,
    rawBody: string,
    requiredComponents: string[] = [],
  ): WebBotAuthBlock {
    if (status < 200 || status >= 300) {
      this.throwApiError(operation, status, data, rawBody);
    }

    return this.parseResponse(operation, status, () => {
      const webBotAuth = webBotAuthResponseSchema.parse(data).web_bot_auth;
      if (Number.isNaN(Date.parse(webBotAuth.expires_at))) {
        throw new LinkSdkError(
          `Credentials response has invalid expires_at: ${webBotAuth.expires_at}`,
        );
      }
      const signatureInput = webBotAuth.signature_input.toLowerCase();
      const missing = requiredComponents.filter(
        (component) => !signatureInput.includes(`"${component.toLowerCase()}"`),
      );
      if (missing.length > 0) {
        throw new LinkSdkError(
          `Web Bot Auth signature does not cover required components: ${missing.join(', ')}`,
        );
      }
      if (requiredComponents.length > 0) {
        const created = signatureInput.match(/;created=(\d+)/)?.[1];
        const expires = signatureInput.match(/;expires=(\d+)/)?.[1];
        if (
          !created ||
          !expires ||
          Number(expires) <= Number(created) ||
          !/;keyid="[^"]+"/.test(signatureInput) ||
          !signatureInput.includes(';tag="web-bot-auth"')
        ) {
          throw new LinkSdkError(
            'Web Bot Auth signature is missing required freshness, keyid, or tag parameters',
          );
        }
      }
      return webBotAuth;
    });
  }

  async signUrl(url: string): Promise<WebBotAuthBlock> {
    let authority: string;
    try {
      authority = new URL(url).hostname;
    } catch (error) {
      throw new LinkSdkError(`Invalid URL: ${url}`, { cause: error });
    }

    const cached = this.cache.get(authority);
    if (cached && Date.now() < cached.expiresAt - EXPIRY_BUFFER_MS) {
      return cached.block;
    }

    const { status, data, rawBody } = await this.apiFetch({
      method: 'POST',
      url: this.endpoint,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      redirect: 'manual',
    });

    const webBotAuth = this.parseBlock(
      'get web bot auth headers',
      status,
      data,
      rawBody,
    );
    const expiresAt = Date.parse(webBotAuth.expires_at);

    this.cache.set(authority, { block: webBotAuth, expiresAt });
    return webBotAuth;
  }
}
