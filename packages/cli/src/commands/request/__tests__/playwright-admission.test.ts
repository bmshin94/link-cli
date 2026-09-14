import {
  createHash,
  generateKeyPairSync,
  sign as signEd25519,
} from 'node:crypto';
import {
  assemblePresentation,
  prepareKbJwt,
  selectDisclosures,
  verifyAssembledPresentation,
} from '@stripe/link-sdk';
import { describe, expect, it } from 'vitest';
import {
  challengeArtifactFromPlaywright,
  parseArtifactClaimsChallenge,
} from '../challenge-artifact';

function encoded(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('Playwright admission example', () => {
  it('prepares from a Playwright 401 and lets the agent sign the KB-JWT', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
    const holderJwk = {
      kty: 'OKP' as const,
      crv: 'Ed25519' as const,
      x: jwk.x,
    };
    const disclosure = encoded(['salt', 'email', 'user@example.com']);
    const digest = createHash('sha256').update(disclosure).digest('base64url');
    const credential = `${encoded({ alg: 'EdDSA' })}.${encoded({
      iss: 'https://issuer.example',
      cnf: { jwk: holderJwk },
      _sd: [digest],
    })}.sig~${disclosure}~`;

    const artifact = await challengeArtifactFromPlaywright({
      url: () => 'https://merchant.example/admit',
      status: () => 401,
      headersArray: () => [
        {
          name: 'WWW-Authenticate',
          value: 'Identity-Presentation',
        },
        { name: 'Content-Type', value: 'application/problem+json' },
        { name: 'Set-Cookie', value: 'admission_pending=1; Path=/; HttpOnly' },
      ],
      text: () =>
        JSON.stringify({
          type: 'urn:aap:claims-required',
          aud: 'https://merchant.example',
          nonce: 'playwright-nonce',
          claims: ['email'],
          formats: ['dc+sd-jwt'],
        }),
    });

    const challenge = parseArtifactClaimsChallenge(artifact);
    expect(challenge?.aud).toBe('https://merchant.example');
    const selection = selectDisclosures({
      credential,
      disclose: challenge?.claims ?? [],
    });
    const prepared = prepareKbJwt({
      sdPart: selection.sdPart,
      aud: challenge?.aud ?? '',
      nonce: challenge?.nonce ?? '',
      alg: 'EdDSA',
      hashAlgorithm: selection.hashAlgorithm,
    });
    const presentation = assemblePresentation({
      sdPart: selection.sdPart,
      prepared,
      signature: signEd25519(
        null,
        Buffer.from(prepared.signingInput),
        privateKey,
      ),
    });
    verifyAssembledPresentation({
      presentation,
      holderJwk,
      prepared,
      sdPart: selection.sdPart,
    });

    expect({
      Authorization: 'PrivateToken token=<aat>',
      'Identity-Presentation': presentation,
    }).toMatchObject({
      'Identity-Presentation': expect.stringContaining(selection.sdPart),
    });
  });
});
