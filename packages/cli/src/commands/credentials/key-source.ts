import { readFileSync } from 'node:fs';
import { parseHolderPublicJwk } from '@stripe/link-sdk';
import { DEFAULT_HOLDER_KEY_PATH, type HolderKeyType } from './holder-key';
import type { CredentialKeySource } from './issue';

export class CredentialKeySourceError extends Error {
  readonly code = 'INVALID_INPUT';
}

export interface CredentialKeySourceOptions {
  keyFile?: string;
  publicKeyFile?: string;
  keyType?: HolderKeyType;
}

/**
 * Resolve the holder key source before applying managed-key defaults. An
 * explicit public-key file must not open, create, or overwrite a private key.
 */
export function resolveCredentialKeySource(
  options: CredentialKeySourceOptions,
): CredentialKeySource {
  const { keyFile, publicKeyFile, keyType } = options;

  if (publicKeyFile && keyFile) {
    throw new CredentialKeySourceError(
      'Pass either --public-key-file or --key-file, not both.',
    );
  }
  if (publicKeyFile && keyType) {
    throw new CredentialKeySourceError(
      '--key-type applies only when generating a CLI-managed holder key.',
    );
  }

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
    keyFile: keyFile ?? DEFAULT_HOLDER_KEY_PATH,
    keyType: keyType ?? 'ed25519',
  };
}
