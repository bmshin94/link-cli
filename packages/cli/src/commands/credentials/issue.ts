import {
  type HolderPublicJwk,
  type ICredentialsResource,
  holderJwkThumbprint,
  holderJwksEqual,
  parseHolderPublicJwk,
} from '@stripe/link-sdk';
import { type HolderKeyType, loadOrCreateHolderKey } from './holder-key';

export const CREDENTIAL_ARTIFACT_VERSION = 1 as const;

export type HolderOwnership = 'managed' | 'external';

export interface CredentialHolder {
  ownership: HolderOwnership;
  jwk: HolderPublicJwk;
  thumbprint: string;
  path?: string;
  created?: boolean;
}

export interface CredentialIssueResult {
  version: typeof CREDENTIAL_ARTIFACT_VERSION;
  credential: string;
  issuer: string;
  expires_at: string;
  holder: CredentialHolder;
  /** Claim names and values recovered from disclosures. Inspection only. */
  claims?: Record<string, unknown>;
}

export type CredentialKeySource =
  | { kind: 'managed'; keyFile: string; keyType: HolderKeyType }
  | { kind: 'external'; publicJwk: HolderPublicJwk };

function decodeJsonSegment(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeDisclosedClaims(credential: string): Record<string, unknown> {
  const [, ...disclosures] = credential.split('~');
  const claims: Record<string, unknown> = {};

  for (const disclosure of disclosures) {
    if (!disclosure) {
      continue;
    }
    const parsed = decodeJsonSegment(disclosure);
    if (Array.isArray(parsed) && parsed.length === 3) {
      claims[String(parsed[1])] = parsed[2];
    }
  }

  return claims;
}

function credentialHolderJwk(credential: string): HolderPublicJwk {
  const [issuerJwt] = credential.split('~');
  const payloadSegment = issuerJwt?.split('.')[1];
  if (!payloadSegment) {
    throw new Error('Issued credential is not a compact SD-JWT');
  }
  const payload = decodeJsonSegment(payloadSegment);
  if (!isRecord(payload) || !isRecord(payload.cnf)) {
    throw new Error('Issued credential is missing cnf.jwk');
  }
  return parseHolderPublicJwk(payload.cnf.jwk);
}

export async function issueCredential(options: {
  resource: ICredentialsResource;
  source: CredentialKeySource;
  includeClaims?: boolean;
}): Promise<CredentialIssueResult> {
  const { resource, source, includeClaims = true } = options;
  let publicJwk: HolderPublicJwk;
  let managedCreated: boolean | undefined;
  if (source.kind === 'managed') {
    const managed = loadOrCreateHolderKey(source.keyFile, source.keyType);
    publicJwk = managed.publicJwk;
    managedCreated = managed.created;
  } else {
    publicJwk = source.publicJwk;
  }

  const response = await resource.issue({
    cnf: { jwk: publicJwk },
  });
  const issuedJwk = credentialHolderJwk(response.credential);
  if (!holderJwksEqual(issuedJwk, publicJwk)) {
    throw new Error(
      'Issued credential cnf.jwk does not match the requested holder public key',
    );
  }

  return {
    version: CREDENTIAL_ARTIFACT_VERSION,
    credential: response.credential,
    issuer: response.issuer,
    expires_at: response.expires_at,
    holder:
      source.kind === 'managed'
        ? {
            ownership: 'managed',
            jwk: publicJwk,
            thumbprint: holderJwkThumbprint(publicJwk),
            path: source.keyFile,
            created: managedCreated === true,
          }
        : {
            ownership: 'external',
            jwk: publicJwk,
            thumbprint: holderJwkThumbprint(publicJwk),
          },
    ...(includeClaims
      ? { claims: decodeDisclosedClaims(response.credential) }
      : {}),
  };
}
