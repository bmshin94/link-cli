import { describe, expect, it } from 'vitest';
import {
  challengeArtifactFromFetch,
  challengeArtifactFromPlaywright,
  parseArtifactClaimsChallenge,
  parseArtifactPrivateTokenChallenges,
  requireHttpsOrigin,
} from '../challenge-artifact';
import { base64urlPad } from '../private-token';

function blindRsaChallenge(): string {
  const challenge = Buffer.alloc(8);
  challenge.writeUInt16BE(0x0002, 0);
  return base64urlPad(challenge);
}

describe('challenge artifacts', () => {
  it('preserves repeated WWW-Authenticate values from a Playwright-shaped response', async () => {
    const artifact = await challengeArtifactFromPlaywright({
      url: () => 'https://merchant.example/admit',
      status: () => 401,
      headersArray: () => [
        {
          name: 'WWW-Authenticate',
          value: `PrivateToken challenge="${blindRsaChallenge()}", token-key="${blindRsaChallenge()}"`,
        },
        { name: 'WWW-Authenticate', value: 'Identity-Presentation' },
        { name: 'Content-Type', value: 'application/problem+json' },
      ],
      text: () =>
        JSON.stringify({
          type: 'urn:aap:claims-required',
          aud: 'https://merchant.example',
          nonce: 'n',
          claims: ['email'],
          formats: ['dc+sd-jwt'],
        }),
    });

    expect(
      artifact.headers.filter((h) => h.name === 'WWW-Authenticate'),
    ).toHaveLength(2);
    expect(parseArtifactPrivateTokenChallenges(artifact)).toHaveLength(1);
    expect(parseArtifactClaimsChallenge(artifact)?.claims).toEqual(['email']);
  });

  it('captures a Fetch 401 as a challenge artifact', () => {
    const response = new Response('attestation required', {
      status: 401,
      headers: {
        'WWW-Authenticate': `PrivateToken challenge="${blindRsaChallenge()}", token-key="${blindRsaChallenge()}"`,
      },
    });
    const artifact = challengeArtifactFromFetch({
      url: 'https://merchant.example/admit',
      response,
      body: 'attestation required',
    });
    expect(artifact.version).toBe(1);
    expect(parseArtifactPrivateTokenChallenges(artifact)).toHaveLength(1);
  });

  it('rejects a non-HTTPS origin that is not loopback', () => {
    expect(() => requireHttpsOrigin('http://merchant.example')).toThrow(
      'HTTPS origin',
    );
    expect(requireHttpsOrigin('https://merchant.example:8443')).toBe(
      'https://merchant.example:8443',
    );
  });
});
