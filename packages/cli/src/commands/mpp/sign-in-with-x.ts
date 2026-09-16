import {
  SIGN_IN_WITH_X,
  type SIWxExtensionInfo,
  type SupportedChain,
} from '@x402/extensions/sign-in-with-x';
import { z } from 'incur';
import { buildHeaders, type PayResult, readPayResult } from './pay';
import {
  createMppRequest,
  fetchMppRequest,
  isRedirectResponse,
} from './request';

const siwxInfoSchema = z.object({
  domain: z.string(),
  uri: z.string(),
  statement: z.string().optional(),
  version: z.string(),
  nonce: z.string(),
  issuedAt: z.string(),
  expirationTime: z.string().optional(),
  notBefore: z.string().optional(),
  requestId: z.string().optional(),
  resources: z.array(z.string()).optional(),
});

const supportedChainSchema = z.object({
  chainId: z.string(),
  type: z.enum(['eip191', 'ed25519']),
  signatureScheme: z.enum(['eip191', 'eip1271', 'eip6492', 'siws']).optional(),
});

const paymentRequiredSchema = z.object({
  extensions: z.record(z.string(), z.unknown()).optional(),
});

export interface SignInWithXChallenge {
  info: SIWxExtensionInfo;
  supportedChains: SupportedChain[];
}

export interface ISignInWithXCredentialResource {
  createCredential(
    challenge: SignInWithXChallenge,
    requestUrl: string,
  ): Promise<string>;
}

export interface SignInWithXOptions {
  url: string;
  method?: string;
  data?: string;
  headers?: string[];
  credentialResource: ISignInWithXCredentialResource;
  fetcher?: typeof fetch;
}

export function decodeSignInWithXChallenge(
  paymentRequiredHeader: string,
): SignInWithXChallenge {
  let decoded: unknown;
  try {
    decoded = JSON.parse(
      Buffer.from(paymentRequiredHeader, 'base64url').toString('utf8'),
    );
  } catch (error) {
    throw new Error('PAYMENT-REQUIRED header is not valid base64 JSON', {
      cause: error,
    });
  }

  const paymentRequired = paymentRequiredSchema.parse(decoded);
  const rawExtension = paymentRequired.extensions?.[SIGN_IN_WITH_X];
  if (!rawExtension) {
    throw new Error(
      'PAYMENT-REQUIRED header does not include a sign-in-with-x extension',
    );
  }

  const extension = z
    .object({
      info: siwxInfoSchema,
      supportedChains: z.array(supportedChainSchema).min(1),
    })
    .parse(rawExtension);

  return extension;
}

export async function runSignInWithX({
  url,
  method,
  data,
  headers,
  credentialResource,
  fetcher = fetch,
}: SignInWithXOptions): Promise<PayResult> {
  const httpMethod = method ?? (data !== undefined ? 'POST' : 'GET');
  const request = createMppRequest(
    url,
    httpMethod,
    data,
    buildHeaders(data, headers),
  );
  if (request.headers.has(SIGN_IN_WITH_X)) {
    throw new Error(
      'Do not pass SIGN-IN-WITH-X manually; this command creates it from the server challenge',
    );
  }

  const challengeResponse = await fetchMppRequest(request, fetcher);
  if (isRedirectResponse(challengeResponse)) {
    await challengeResponse.body?.cancel();
    throw new Error(
      `SIWX challenge request returned redirect ${challengeResponse.status}; refusing to move the authentication destination`,
    );
  }
  if (challengeResponse.status !== 402) {
    return readPayResult(challengeResponse);
  }

  const paymentRequired = challengeResponse.headers.get('payment-required');
  if (!paymentRequired) {
    await challengeResponse.body?.cancel();
    throw new Error('URL returned 402 but no PAYMENT-REQUIRED header');
  }
  const challenge = decodeSignInWithXChallenge(paymentRequired);
  await challengeResponse.body?.cancel();

  const credential = await credentialResource.createCredential(
    challenge,
    request.url,
  );
  const authenticatedHeaders = new Headers(request.headers);
  authenticatedHeaders.set(SIGN_IN_WITH_X, credential);

  const response = await fetchMppRequest(
    { ...request, headers: authenticatedHeaders },
    fetcher,
  );
  if (isRedirectResponse(response)) {
    await response.body?.cancel();
    throw new Error(
      `Authenticated SIWX request returned redirect ${response.status}; refusing to forward the credential`,
    );
  }
  return readPayResult(response);
}
