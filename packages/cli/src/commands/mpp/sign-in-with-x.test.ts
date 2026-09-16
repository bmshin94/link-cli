import { parseSIWxHeader } from '@x402/extensions/sign-in-with-x';
import { privateKeyToAccount } from 'viem/accounts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignInWithXCredential } from './local-sign-in-with-x';
import {
  decodeSignInWithXChallenge,
  type ISignInWithXCredentialResource,
  runSignInWithX,
  type SignInWithXChallenge,
} from './sign-in-with-x';

const URL = 'https://merchant.example/api/jobs/job_123';
const issuedAt = new Date();
const expirationTime = new Date(issuedAt.getTime() + 5 * 60 * 1000);
const CHALLENGE: SignInWithXChallenge = {
  info: {
    domain: 'merchant.example',
    uri: URL,
    statement: 'Sign in to retrieve your generation',
    version: '1',
    nonce: 'abcdefgh',
    issuedAt: issuedAt.toISOString(),
    expirationTime: expirationTime.toISOString(),
  },
  supportedChains: [{ chainId: 'eip155:8453', type: 'eip191' }],
};

function paymentRequiredHeader(
  challenge: SignInWithXChallenge = CHALLENGE,
): string {
  return Buffer.from(
    JSON.stringify({
      x402Version: 2,
      accepts: [],
      extensions: { 'sign-in-with-x': challenge },
    }),
  ).toString('base64url');
}

function challengeResponse(): Response {
  return new Response('{"error":"authentication required"}', {
    status: 402,
    headers: { 'payment-required': paymentRequiredHeader() },
  });
}

beforeEach(() => {
  vi.stubGlobal('__CLI_VERSION__', 'test');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('decodeSignInWithXChallenge', () => {
  it('decodes the SIWX extension from an x402 v2 challenge', () => {
    expect(decodeSignInWithXChallenge(paymentRequiredHeader())).toEqual(
      CHALLENGE,
    );
  });

  it('rejects a payment challenge without the SIWX extension', () => {
    const header = Buffer.from(
      JSON.stringify({ x402Version: 2, accepts: [] }),
    ).toString('base64url');

    expect(() => decodeSignInWithXChallenge(header)).toThrow(
      'does not include a sign-in-with-x extension',
    );
  });
});

describe('runSignInWithX', () => {
  it('gets a fresh challenge and retries once with the signed credential', async () => {
    const createCredential = vi.fn(async () => 'signed-credential');
    const credentialResource = {
      createCredential,
    } satisfies ISignInWithXCredentialResource;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(challengeResponse())
      .mockResolvedValueOnce(
        new Response(
          '{"status":"complete","result":{"videoUrl":"https://cdn.example/video.mp4"}}',
        ),
      );

    const result = await runSignInWithX({
      url: URL,
      credentialResource,
      fetcher,
    });

    expect(result.status).toBe(200);
    expect(result.body).toContain('videoUrl');
    expect(createCredential).toHaveBeenCalledWith(CHALLENGE, URL);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1]?.redirect).toBe('manual');
    expect(
      new Headers(fetcher.mock.calls[0][1]?.headers).has('sign-in-with-x'),
    ).toBe(false);
    expect(
      new Headers(fetcher.mock.calls[1][1]?.headers).get('sign-in-with-x'),
    ).toBe('signed-credential');
  });

  it('rejects redirects both before and after signing', async () => {
    const credentialResource = {
      createCredential: vi.fn(async () => 'signed-credential'),
    } satisfies ISignInWithXCredentialResource;
    const redirect = () =>
      new Response(null, {
        status: 307,
        headers: { location: 'https://other.example/jobs' },
      });

    await expect(
      runSignInWithX({
        url: URL,
        credentialResource,
        fetcher: vi.fn<typeof fetch>().mockResolvedValue(redirect()),
      }),
    ).rejects.toThrow('challenge request returned redirect 307');
    expect(credentialResource.createCredential).not.toHaveBeenCalled();

    await expect(
      runSignInWithX({
        url: URL,
        credentialResource,
        fetcher: vi
          .fn<typeof fetch>()
          .mockResolvedValueOnce(challengeResponse())
          .mockResolvedValueOnce(redirect()),
      }),
    ).rejects.toThrow('Authenticated SIWX request returned redirect 307');
  });
});

describe('createSignInWithXCredential', () => {
  it('creates a valid EIP-191 credential bound to the challenged URL', async () => {
    const account = privateKeyToAccount(
      '0x0000000000000000000000000000000000000000000000000000000000000001',
    );

    const header = await createSignInWithXCredential(CHALLENGE, URL, account);
    const payload = parseSIWxHeader(header);

    expect(payload.address).toBe(account.address);
    expect(payload.chainId).toBe('eip155:8453');
    expect(payload.uri).toBe(URL);
    expect(payload.signature).toMatch(/^0x[0-9a-f]+$/);
  });

  it('rejects a challenge bound to a different URL', async () => {
    const account = privateKeyToAccount(
      '0x0000000000000000000000000000000000000000000000000000000000000001',
    );

    await expect(
      createSignInWithXCredential(
        {
          ...CHALLENGE,
          info: { ...CHALLENGE.info, uri: 'https://merchant.example/other' },
        },
        URL,
        account,
      ),
    ).rejects.toThrow('does not match request URL');
  });
});
