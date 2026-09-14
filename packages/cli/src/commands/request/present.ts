import { createSign, sign as signEd25519 } from 'node:crypto';
import type {
  ClaimReference,
  HolderSigner,
  KbJwtAlgorithm,
  PreparedKbJwt,
} from '@stripe/link-sdk';
import {
  assemblePresentation,
  prepareKbJwt,
  selectDisclosures,
  verifyAssembledPresentation,
} from '@stripe/link-sdk';
import { sanitizeDeep } from '../../utils/sanitize-text';
import {
  type HolderKeyType,
  loadHolderKey,
  loadOrCreateHolderKey,
} from '../credentials/holder-key';

export type { ClaimPathComponent, ClaimReference } from '@stripe/link-sdk';
export { claimReferenceKey } from '@stripe/link-sdk';

/** The claims-required challenge a verifier returns for identity disclosure. */
export interface ClaimsChallenge {
  aud: string;
  nonce: string;
  claims: ClaimReference[];
  purpose?: string;
  formats: string[];
  trusted_issuers?: string[];
}

const CLAIMS_REQUIRED_TYPE = 'urn:aap:claims-required';
const SUPPORTED_FORMAT = 'dc+sd-jwt';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseClaimReference(value: unknown): ClaimReference | null {
  if (typeof value === 'string' && value.length === 0) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    typeof value[0] !== 'string' ||
    value[0].length === 0
  ) {
    return null;
  }
  for (const component of value) {
    if (
      component !== null &&
      typeof component !== 'string' &&
      !(
        typeof component === 'number' &&
        Number.isInteger(component) &&
        component >= 0
      )
    ) {
      return null;
    }
  }
  return value as ClaimReference;
}

/**
 * Recognizes a claims-required challenge only when all protocol signals agree.
 * Unrelated 401 responses pass through; malformed identity challenges fail closed.
 */
export function parseClaimsChallenge(
  response: Pick<Response, 'status' | 'headers'>,
  body: string,
): ClaimsChallenge | null {
  if (response.status !== 401) {
    return null;
  }
  const authenticate = collectWwwAuthenticate(response.headers);
  if (!/(?:^|,)\s*Identity-Presentation(?:\s|,|$)/i.test(authenticate)) {
    return null;
  }
  const contentType = (response.headers.get('content-type') ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== 'application/problem+json') {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = sanitizeDeep(JSON.parse(body));
  } catch {
    throw new Error('Invalid claims challenge: body is not JSON');
  }
  if (!isRecord(parsed) || parsed.type !== CLAIMS_REQUIRED_TYPE) {
    return null;
  }
  if (
    typeof parsed.aud !== 'string' ||
    parsed.aud.length === 0 ||
    typeof parsed.nonce !== 'string' ||
    parsed.nonce.length === 0 ||
    !Array.isArray(parsed.claims) ||
    !Array.isArray(parsed.formats)
  ) {
    throw new Error('Invalid claims challenge: required fields are missing');
  }

  const claims = parsed.claims.map(parseClaimReference);
  if (claims.some((claim) => claim === null)) {
    throw new Error('Invalid claims challenge: malformed claim reference');
  }
  if (!parsed.formats.every((format) => typeof format === 'string')) {
    throw new Error('Invalid claims challenge: malformed formats');
  }
  if (
    parsed.trusted_issuers !== undefined &&
    (!Array.isArray(parsed.trusted_issuers) ||
      !parsed.trusted_issuers.every(
        (issuer) => typeof issuer === 'string' && issuer.length > 0,
      ))
  ) {
    throw new Error('Invalid claims challenge: malformed trusted_issuers');
  }

  return {
    aud: parsed.aud,
    nonce: parsed.nonce,
    claims: claims as ClaimReference[],
    formats: parsed.formats as string[],
    ...(typeof parsed.purpose === 'string' ? { purpose: parsed.purpose } : {}),
    ...(parsed.trusted_issuers !== undefined
      ? { trusted_issuers: parsed.trusted_issuers as string[] }
      : {}),
  };
}

function collectWwwAuthenticate(headers: Headers): string {
  const values: string[] = [];
  headers.forEach((value, name) => {
    if (name.toLowerCase() === 'www-authenticate') {
      values.push(value);
    }
  });
  return values.join(', ');
}

export function supportsPreProvisionedPresentation(
  challenge: ClaimsChallenge,
): boolean {
  return challenge.formats.includes(SUPPORTED_FORMAT);
}

export interface Presentation {
  presentation: string;
  disclosed: ClaimReference[];
  withheld: string[];
  unavailable: ClaimReference[];
}

export function algorithmForHolderKeyType(type: HolderKeyType): KbJwtAlgorithm {
  return type === 'ed25519' ? 'EdDSA' : 'ES256';
}

export function createManagedHolderSigner(
  path: string,
  options?: { createIfMissing?: boolean; keyType?: HolderKeyType },
): HolderSigner {
  const holderKey = options?.createIfMissing
    ? loadOrCreateHolderKey(path, options.keyType ?? 'ed25519')
    : loadHolderKey(path);
  const alg = algorithmForHolderKeyType(holderKey.type);
  return {
    alg,
    sign(signingInput: string) {
      const bytes = Buffer.from(signingInput);
      if (alg === 'EdDSA') {
        return signEd25519(null, bytes, holderKey.privateKey);
      }
      return createSign('sha256')
        .update(bytes)
        .sign({ key: holderKey.privateKey, dsaEncoding: 'ieee-p1363' });
    },
  };
}

export async function signPreparedPresentation(options: {
  sdPart: string;
  prepared: PreparedKbJwt;
  signer: HolderSigner;
  holderJwk: Parameters<typeof verifyAssembledPresentation>[0]['holderJwk'];
}): Promise<string> {
  const signature = await options.signer.sign(options.prepared.signingInput);
  const presentation = assemblePresentation({
    sdPart: options.sdPart,
    prepared: options.prepared,
    signature,
  });
  verifyAssembledPresentation({
    presentation,
    holderJwk: options.holderJwk,
    prepared: options.prepared,
    sdPart: options.sdPart,
  });
  return presentation;
}

/**
 * Builds an SD-JWT-VC presentation with only the disclosures needed to resolve
 * the requested claim references, including nested claims path pointers.
 */
export async function buildPresentation(options: {
  credential: string;
  keyFile: string;
  keyType: HolderKeyType;
  aud: string;
  nonce: string;
  disclose: ClaimReference[];
  createIfMissing?: boolean;
  iat?: number;
}): Promise<Presentation> {
  const selection = selectDisclosures({
    credential: options.credential,
    disclose: options.disclose,
  });
  const signer = createManagedHolderSigner(options.keyFile, {
    createIfMissing: options.createIfMissing ?? true,
    keyType: options.keyType,
  });
  const prepared = prepareKbJwt({
    sdPart: selection.sdPart,
    aud: options.aud,
    nonce: options.nonce,
    alg: signer.alg,
    hashAlgorithm: selection.hashAlgorithm,
    iat: options.iat,
  });
  const presentation = await signPreparedPresentation({
    sdPart: selection.sdPart,
    prepared,
    signer,
    holderJwk: selection.holderJwk,
  });
  return {
    presentation,
    disclosed: selection.disclosed,
    withheld: selection.withheld,
    unavailable: selection.unavailable,
  };
}

export function parseClaimList(
  claims: string | undefined,
): ClaimReference[] | null {
  if (claims === undefined) {
    return null;
  }
  const parsed = claims
    .split(',')
    .map((claim) => claim.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : null;
}

export function buildRequestHeaders(
  data: string | undefined,
  headers: string[],
): Record<string, string> {
  const result: Record<string, string> = {};
  if (data !== undefined) {
    result['Content-Type'] = 'application/json';
  }
  for (const header of headers) {
    const index = header.indexOf(':');
    if (index === -1) {
      throw new Error(`Invalid header "${header}". Use "Name: Value" format.`);
    }
    result[header.slice(0, index).trim()] = header.slice(index + 1).trim();
  }
  return result;
}

export function setRequestHeader(
  headers: Record<string, string>,
  name: string,
  value: string,
): void {
  for (const existing of Object.keys(headers)) {
    if (existing.toLowerCase() === name.toLowerCase()) {
      delete headers[existing];
    }
  }
  headers[name] = value;
}

export function formatClaimReference(reference: ClaimReference): string {
  return typeof reference === 'string' ? reference : JSON.stringify(reference);
}
