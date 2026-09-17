import { generateKeyPairSync } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HolderPublicJwk, ICredentialsResource } from '@stripe/link-sdk';
import { holderJwkThumbprint } from '@stripe/link-sdk';
import { describe, expect, it, vi } from 'vitest';
import { loadHolderKey, loadOrCreateHolderKey } from '../holder-key';
import { issueCredential } from '../issue';
import { resolveCredentialKeySource } from '../key-source';

function publicJwkFromPrivate(type: 'ed25519' | 'p256'): {
  privateJwk: Record<string, unknown>;
  publicJwk: HolderPublicJwk;
} {
  const privateKey =
    type === 'ed25519'
      ? generateKeyPairSync('ed25519').privateKey
      : generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
  const jwk = privateKey.export({ format: 'jwk' }) as Record<string, string>;
  if (type === 'ed25519') {
    return {
      privateJwk: jwk,
      publicJwk: { kty: 'OKP', crv: 'Ed25519', x: jwk.x },
    };
  }
  return {
    privateJwk: jwk,
    publicJwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y },
  };
}

function encodeSegment(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function compactCredential(
  jwk: HolderPublicJwk,
  claims: Record<string, unknown> = { email: 'user@example.com' },
): string {
  const jwt = `${encodeSegment({ alg: 'EdDSA', typ: 'vc+sd-jwt' })}.${encodeSegment(
    {
      iss: 'https://api.link.com',
      cnf: { jwk },
    },
  )}.sig`;
  const disclosures = Object.entries(claims).map(([name, value]) =>
    encodeSegment(['salt', name, value]),
  );
  return `${[jwt, ...disclosures].join('~')}~`;
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'link-credential-'));
}

describe('resolveCredentialKeySource', () => {
  it('treats an explicit public-key file as external and does not default a private key', () => {
    const dir = tempDir();
    const { publicJwk } = publicJwkFromPrivate('ed25519');
    const publicKeyFile = join(dir, 'public.jwk');
    writeFileSync(publicKeyFile, JSON.stringify(publicJwk));

    expect(resolveCredentialKeySource({ publicKeyFile })).toEqual({
      kind: 'external',
      publicJwk,
    });
  });

  it('rejects public-key and private-key flags together', () => {
    expect(() =>
      resolveCredentialKeySource({
        publicKeyFile: '/tmp/public.jwk',
        keyFile: '/tmp/holder.jwk',
      }),
    ).toThrow('not both');
  });

  it('rejects --key-type with a public-key file', () => {
    expect(() =>
      resolveCredentialKeySource({
        publicKeyFile: '/tmp/public.jwk',
        keyType: 'p256',
      }),
    ).toThrow('--key-type');
  });
});

describe('issueCredential', () => {
  it('issues to a public JWK without creating a private key file', async () => {
    const dir = tempDir();
    const { publicJwk } = publicJwkFromPrivate('ed25519');
    const keyFile = join(dir, 'holder-key.jwk');
    const resource: ICredentialsResource = {
      issue: vi.fn(async ({ cnf }) => ({
        credential: compactCredential(cnf.jwk, { email: 'user@example.com' }),
        issuer: 'https://api.link.com',
        expires_at: '2026-09-15T00:00:00Z',
      })),
    };

    const result = await issueCredential({
      resource,
      source: { kind: 'external', publicJwk },
    });

    expect(existsSync(keyFile)).toBe(false);
    expect(result.version).toBe(1);
    expect(result.holder).toEqual({
      ownership: 'external',
      jwk: publicJwk,
      thumbprint: holderJwkThumbprint(publicJwk),
    });
    expect(result.holder.path).toBeUndefined();
    expect(result.claims).toEqual({ email: 'user@example.com' });
    expect(resource.issue).toHaveBeenCalledWith({ cnf: { jwk: publicJwk } });
  });

  it('issues a managed credential and records the local key path', async () => {
    const dir = tempDir();
    const keyFile = join(dir, 'holder-key.jwk');
    const resource: ICredentialsResource = {
      issue: vi.fn(async ({ cnf }) => ({
        credential: compactCredential(cnf.jwk),
        issuer: 'https://api.link.com',
        expires_at: '2026-09-15T00:00:00Z',
      })),
    };

    const result = await issueCredential({
      resource,
      source: { kind: 'managed', keyFile, keyType: 'ed25519' },
    });

    expect(existsSync(keyFile)).toBe(true);
    expect(result.holder.ownership).toBe('managed');
    expect(result.holder.path).toBe(keyFile);
    expect(result.holder.created).toBe(true);
  });

  it('sanitizes disclosed claims before returning them to the CLI', async () => {
    const { publicJwk } = publicJwkFromPrivate('ed25519');
    const resource: ICredentialsResource = {
      issue: vi.fn(async ({ cnf }) => ({
        credential: compactCredential(cnf.jwk, {
          email: '\u001b[2Juser@example.com\u0007',
        }),
        issuer: 'https://api.link.com',
        expires_at: '2026-09-15T00:00:00Z',
      })),
    };

    const result = await issueCredential({
      resource,
      source: { kind: 'external', publicJwk },
    });

    expect(result.claims).toEqual({ email: 'user@example.com' });
  });

  it('rejects an issued credential whose cnf.jwk does not match', async () => {
    const { publicJwk } = publicJwkFromPrivate('ed25519');
    const other = publicJwkFromPrivate('ed25519').publicJwk;
    const resource: ICredentialsResource = {
      issue: vi.fn(async () => ({
        credential: compactCredential(other),
        issuer: 'https://api.link.com',
        expires_at: '2026-09-15T00:00:00Z',
      })),
    };

    await expect(
      issueCredential({
        resource,
        source: { kind: 'external', publicJwk },
      }),
    ).rejects.toThrow('does not match the requested holder public key');
  });
});

describe('loadHolderKey', () => {
  it('does not generate a replacement key when the file is missing', () => {
    const missing = join(tempDir(), 'missing.jwk');
    expect(() => loadHolderKey(missing)).toThrow('Holder key not found');
    expect(existsSync(missing)).toBe(false);
  });

  it('loads an existing managed key', () => {
    const keyFile = join(tempDir(), 'holder-key.jwk');
    const created = loadOrCreateHolderKey(keyFile, 'ed25519');
    const loaded = loadHolderKey(keyFile);
    expect(statSync(keyFile).mode & 0o777).toBe(0o600);
    expect(loaded.created).toBe(false);
    expect(loaded.publicJwk).toEqual(created.publicJwk);
  });

  it('refuses to read or write a holder key through a symbolic link', () => {
    const dir = tempDir();
    const target = join(dir, 'target.jwk');
    const keyFile = join(dir, 'holder-key.jwk');
    symlinkSync(target, keyFile);

    expect(() => loadOrCreateHolderKey(keyFile, 'ed25519')).toThrow(
      'symbolic link',
    );
    expect(existsSync(target)).toBe(false);
  });
});
