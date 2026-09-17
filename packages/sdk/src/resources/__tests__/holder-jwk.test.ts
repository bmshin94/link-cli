import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LinkConfigurationError } from '@/errors';
import {
  holderJwksEqual,
  holderJwkThumbprint,
  parseHolderPublicJwk,
} from '@/resources/holder-jwk';

function ed25519PublicJwk(): { kty: 'OKP'; crv: 'Ed25519'; x: string } {
  const { publicKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
  return { kty: 'OKP', crv: 'Ed25519', x: jwk.x };
}

function p256PublicJwk(): {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
} {
  const { publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
}

describe('parseHolderPublicJwk', () => {
  it('accepts an Ed25519 public JWK and strips extra members', () => {
    const jwk = ed25519PublicJwk();
    expect(
      parseHolderPublicJwk({ ...jwk, alg: 'EdDSA', kid: 'unused' }),
    ).toEqual(jwk);
  });

  it('accepts a P-256 public JWK', () => {
    const jwk = p256PublicJwk();
    expect(parseHolderPublicJwk(jwk)).toEqual(jwk);
  });

  it('rejects a private scalar', () => {
    expect(() =>
      parseHolderPublicJwk({ ...ed25519PublicJwk(), d: 'private' }),
    ).toThrow(LinkConfigurationError);
    expect(() =>
      parseHolderPublicJwk({ ...ed25519PublicJwk(), d: 'private' }),
    ).toThrow('private members');
  });

  it('rejects unsupported key types', () => {
    expect(() =>
      parseHolderPublicJwk({ kty: 'RSA', n: 'n', e: 'AQAB' }),
    ).toThrow('Ed25519 (OKP) or P-256 (EC)');
  });
});

describe('holderJwkThumbprint', () => {
  it('is RFC 7638 SHA-256 base64url and distinguishes keys', () => {
    const left = ed25519PublicJwk();
    const right = ed25519PublicJwk();
    const thumbprint = holderJwkThumbprint(left);
    expect(thumbprint).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(holderJwksEqual(left, left)).toBe(true);
    expect(holderJwksEqual(left, right)).toBe(false);
  });
});
