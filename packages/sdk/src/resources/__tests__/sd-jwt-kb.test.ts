import {
  createHash,
  createSign,
  generateKeyPairSync,
  sign as signEd25519,
} from 'node:crypto';
import type { HolderPublicJwk } from '@/resources/interfaces';
import type { HolderSigner } from '@/resources/sd-jwt-kb';
import {
  assemblePresentation,
  prepareKbJwt,
  selectDisclosures,
  verifyAssembledPresentation,
} from '@/resources/sd-jwt-kb';
import { describe, expect, it } from 'vitest';

function encoded(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function publicJwk(type: 'ed25519' | 'p256'): {
  signer: HolderSigner;
  jwk: HolderPublicJwk;
} {
  if (type === 'ed25519') {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
    return {
      jwk: { kty: 'OKP', crv: 'Ed25519', x: jwk.x },
      signer: {
        alg: 'EdDSA',
        sign(signingInput) {
          return signEd25519(null, Buffer.from(signingInput), privateKey);
        },
      },
    };
  }
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  return {
    jwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y },
    signer: {
      alg: 'ES256',
      sign(signingInput) {
        return createSign('sha256')
          .update(signingInput)
          .sign({ key: privateKey, dsaEncoding: 'ieee-p1363' });
      },
    },
  };
}

function issueLikeCredential(jwk: HolderPublicJwk, email: string): string {
  const disclosure = encoded(['salt', 'email', email]);
  const digest = createHash('sha256').update(disclosure).digest('base64url');
  const jwt = `${encoded({ alg: 'EdDSA', typ: 'vc+sd-jwt' })}.${encoded({
    iss: 'https://issuer.example',
    cnf: { jwk },
    _sd: [digest],
  })}.sig`;
  return `${jwt}~${disclosure}~`;
}

describe('sd-jwt-kb external signer', () => {
  it.each(['ed25519', 'p256'] as const)(
    'prepares, signs, and verifies a %s presentation',
    async (type) => {
      const { signer, jwk } = publicJwk(type);
      const credential = issueLikeCredential(jwk, 'user@example.com');
      const selection = selectDisclosures({
        credential,
        disclose: ['email'],
      });
      expect(selection.unavailable).toEqual([]);
      const prepared = prepareKbJwt({
        sdPart: selection.sdPart,
        aud: 'https://merchant.example',
        nonce: 'once',
        alg: signer.alg,
        hashAlgorithm: selection.hashAlgorithm,
        iat: 1_800_000_000,
      });
      expect(prepared.signingInput).toBe(
        `${prepared.encodedHeader}.${prepared.encodedPayload}`,
      );
      expect(prepared.protectedHeader).toEqual({
        typ: 'kb+jwt',
        alg: signer.alg,
      });
      const signature = await signer.sign(prepared.signingInput);
      const presentation = assemblePresentation({
        sdPart: selection.sdPart,
        prepared,
        signature,
      });
      expect(presentation.startsWith(selection.sdPart)).toBe(true);
      verifyAssembledPresentation({
        presentation,
        holderJwk: jwk,
        prepared,
        sdPart: selection.sdPart,
      });
    },
  );

  it('rejects a KB-JWT signed by a different holder key', async () => {
    const holder = publicJwk('ed25519');
    const other = publicJwk('ed25519');
    const credential = issueLikeCredential(holder.jwk, 'user@example.com');
    const selection = selectDisclosures({
      credential,
      disclose: ['email'],
    });
    const prepared = prepareKbJwt({
      sdPart: selection.sdPart,
      aud: 'https://merchant.example',
      nonce: 'once',
      alg: 'EdDSA',
      hashAlgorithm: selection.hashAlgorithm,
    });
    const presentation = assemblePresentation({
      sdPart: selection.sdPart,
      prepared,
      signature: await other.signer.sign(prepared.signingInput),
    });
    expect(() =>
      verifyAssembledPresentation({
        presentation,
        holderJwk: holder.jwk,
        prepared,
        sdPart: selection.sdPart,
      }),
    ).toThrow('does not verify');
  });
});
