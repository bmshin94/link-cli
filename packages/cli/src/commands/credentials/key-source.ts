import { readFileSync } from 'node:fs';
import { parseHolderPublicJwk } from '@stripe/link-sdk';
import { DEFAULT_HOLDER_KEY_PATH } from './holder-key';
import type { CredentialKeySource } from './issue';

export class CredentialKeySourceError extends Error {
  readonly code = 'INVALID_INPUT';
}

export interface CredentialKeySourceOptions {
  publicKeyFile?: string;
}

/**
 * Resolve the holder key source before applying managed-key defaults. An
 * explicit public-key file must not open, create, or overwrite a private key.
 */
export function resolveCredentialKeySource(
  options: CredentialKeySourceOptions,
): CredentialKeySource {
  const { publicKeyFile } = options;

  if (publicKeyFile) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(publicKeyFile, 'utf8'));
    } catch (error) {
      throw new CredentialKeySourceError(
        `Failed to read public key at ${publicKeyFile}: ${(error as Error).message}`,
      );
    }
    return {
      kind: 'external',
      publicJwk: parseHolderPublicJwk(parsed),
    };
  }

  return {
    kind: 'managed',
    keyFile: DEFAULT_HOLDER_KEY_PATH,
    keyType: 'ed25519',
  };
}
