import { z } from 'zod';
import type { LinkOptions } from '@/config';
import { LinkApiError, LinkResponseError, LinkTransportError } from '@/errors';
import { BaseResource } from '@/resources/base';
import { parseHolderPublicJwk } from '@/resources/holder-jwk';
import type {
  IIdentityCredentialsResource,
  IssueIdentityCredentialParams,
  IssueIdentityCredentialResponse,
} from '@/resources/interfaces';

const LINK_ISSUER = 'https://api.link.com';
const LINK_ISSUER_METADATA_URL = `${LINK_ISSUER}/.well-known/aap-issuer`;

const identityCredentialIssuerMetadataSchema = z.looseObject({
  issuer: z.literal(LINK_ISSUER),
  credential_endpoint: z.string(),
});

const issueIdentityCredentialResponseSchema = z.looseObject({
  credential: z.string(),
  issuer: z.literal(LINK_ISSUER),
  expires_at: z.string(),
});

/** Accepts a discovered endpoint only when it remains on api.link.com. */
function requireLinkEndpoint(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new TypeError(`${field} is not a valid URL`, { cause: error });
  }
  if (
    url.protocol !== 'https:' ||
    url.origin !== LINK_ISSUER ||
    url.username ||
    url.password
  ) {
    throw new TypeError(`${field} must be an HTTPS URL on ${LINK_ISSUER}`);
  }
  return url.href;
}

export class IdentityCredentialsResource
  extends BaseResource
  implements IIdentityCredentialsResource
{
  constructor(options: LinkOptions) {
    super(options, '');
  }

  private async discoverCredentialEndpoint(): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchImpl(LINK_ISSUER_METADATA_URL, {
        redirect: 'manual',
      });
    } catch (error) {
      throw new LinkTransportError(
        `Request failed: GET ${LINK_ISSUER_METADATA_URL}`,
        { cause: error },
      );
    }

    const rawBody = await response.text();
    if (response.status >= 300 && response.status < 400) {
      throw new LinkApiError(
        `Refused redirect while fetching issuer metadata (${response.status})`,
        { status: response.status, rawBody },
      );
    }

    let data: unknown = null;
    try {
      data = JSON.parse(rawBody);
    } catch (error) {
      if (response.ok) {
        throw new LinkResponseError('fetch issuer metadata', response.status, {
          cause: error,
        });
      }
    }
    if (!response.ok) {
      this.throwApiError(
        'fetch issuer metadata',
        response.status,
        data,
        rawBody,
      );
    }

    const metadata = this.parseResponse(
      'parse issuer metadata',
      response.status,
      () => identityCredentialIssuerMetadataSchema.parse(data),
    );
    return this.parseResponse('validate issuer metadata', response.status, () =>
      requireLinkEndpoint(metadata.credential_endpoint, 'credential_endpoint'),
    );
  }

  async issue(
    params: IssueIdentityCredentialParams,
  ): Promise<IssueIdentityCredentialResponse> {
    const publicJwk = parseHolderPublicJwk(params.cnf.jwk);
    const endpoint = await this.discoverCredentialEndpoint();
    const send = async (forceRefresh = false): Promise<Response> => {
      const token = await this.getAccessToken(
        forceRefresh ? { forceRefresh: true } : undefined,
      );
      try {
        return await this.fetchImpl(endpoint, {
          method: 'POST',
          redirect: 'manual',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ cnf: { jwk: publicJwk } }),
        });
      } catch (error) {
        throw new LinkTransportError(`Request failed: POST ${endpoint}`, {
          cause: error,
        });
      }
    };

    let response = await send();
    if (response.status === 401 && this.canRefreshAccessToken) {
      response = await send(true);
    }

    const rawBody = await response.text();
    if (response.status >= 300 && response.status < 400) {
      throw new LinkApiError(
        `Refused redirect while issuing credential (${response.status})`,
        { status: response.status, rawBody },
      );
    }

    let data: unknown = null;
    try {
      data = JSON.parse(rawBody);
    } catch (error) {
      if (response.ok) {
        throw new LinkResponseError('issue credential', response.status, {
          cause: error,
        });
      }
    }
    if (!response.ok) {
      this.throwApiError('issue credential', response.status, data, rawBody);
    }

    return this.parseResponse('issue credential', response.status, () =>
      issueIdentityCredentialResponseSchema.parse(data),
    );
  }
}
