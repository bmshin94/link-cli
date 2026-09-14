import {
  createHash,
  createPublicKey,
  createVerify,
  verify as verifyEd25519,
} from 'node:crypto';
import { LinkConfigurationError } from '@/errors';
import { parseHolderPublicJwk } from '@/resources/holder-jwk';
import type { HolderPublicJwk } from '@/resources/interfaces';

export type ClaimPathComponent = string | number | null;
export type ClaimReference = string | ClaimPathComponent[];
export type KbJwtAlgorithm = 'EdDSA' | 'ES256';
export type SdHashAlgorithm = 'sha-256' | 'sha-384' | 'sha-512';

export interface HolderSigner {
  alg: KbJwtAlgorithm;
  sign(signingInput: string): Uint8Array | Promise<Uint8Array>;
}

export interface DisclosureSelection {
  /** Issuer JWT plus selected disclosures, including the trailing tilde. */
  sdPart: string;
  disclosed: ClaimReference[];
  withheld: string[];
  unavailable: ClaimReference[];
  hashAlgorithm: SdHashAlgorithm;
  holderJwk: HolderPublicJwk;
}

export interface PreparedKbJwt {
  protectedHeader: { typ: 'kb+jwt'; alg: KbJwtAlgorithm };
  payload: {
    aud: string;
    nonce: string;
    iat: number;
    sd_hash: string;
  };
  encodedHeader: string;
  encodedPayload: string;
  /** ASCII `header.payload` bytes a signer must sign. */
  signingInput: string;
}

interface DecodedDisclosure {
  encoded: string;
  digest: string;
  name?: string;
  value: unknown;
}

function base64url(input: Buffer | Uint8Array | string): string {
  return Buffer.from(input as Buffer).toString('base64url');
}

function jsonSegment(value: unknown): string {
  return base64url(JSON.stringify(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeJsonSegment(segment: string, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch (error) {
    throw new LinkConfigurationError(`Invalid ${label}`, { cause: error });
  }
}

function resolveSdHashAlgorithm(payload: Record<string, unknown>): {
  nodeName: 'sha256' | 'sha384' | 'sha512';
  sdName: SdHashAlgorithm;
} {
  const sdName = payload._sd_alg ?? 'sha-256';
  if (sdName === 'sha-256') {
    return { nodeName: 'sha256', sdName };
  }
  if (sdName === 'sha-384') {
    return { nodeName: 'sha384', sdName };
  }
  if (sdName === 'sha-512') {
    return { nodeName: 'sha512', sdName };
  }
  throw new LinkConfigurationError(
    `Unsupported SD-JWT hash algorithm: ${String(sdName)}`,
  );
}

function decodeDisclosures(
  encodedDisclosures: string[],
  hashName: string,
): Map<string, DecodedDisclosure> {
  const disclosures = new Map<string, DecodedDisclosure>();
  for (const encoded of encodedDisclosures) {
    const value = decodeJsonSegment(encoded, 'SD-JWT disclosure');
    if (
      !Array.isArray(value) ||
      (value.length !== 2 && value.length !== 3) ||
      (value.length === 3 && typeof value[1] !== 'string')
    ) {
      throw new LinkConfigurationError('Invalid SD-JWT disclosure');
    }
    const digest = base64url(createHash(hashName).update(encoded).digest());
    disclosures.set(digest, {
      encoded,
      digest,
      ...(value.length === 3 ? { name: value[1] as string } : {}),
      value: value.length === 3 ? value[2] : value[1],
    });
  }
  return disclosures;
}

function revealArrayElement(
  element: unknown,
  remainingPath: ClaimPathComponent[],
  disclosures: Map<string, DecodedDisclosure>,
  selected: Set<string>,
): boolean {
  if (isRecord(element) && typeof element['...'] === 'string') {
    const disclosure = disclosures.get(element['...']);
    if (!disclosure || disclosure.name !== undefined) {
      return false;
    }
    selected.add(disclosure.digest);
    return revealPath(disclosure.value, remainingPath, disclosures, selected);
  }
  return revealPath(element, remainingPath, disclosures, selected);
}

function revealPath(
  node: unknown,
  path: ClaimPathComponent[],
  disclosures: Map<string, DecodedDisclosure>,
  selected: Set<string>,
): boolean {
  if (path.length === 0) {
    return true;
  }
  const [component, ...remaining] = path;

  if (Array.isArray(node)) {
    if (component === null) {
      let matched = false;
      for (const element of node) {
        matched =
          revealArrayElement(element, remaining, disclosures, selected) ||
          matched;
      }
      return matched;
    }
    if (typeof component !== 'number' || component >= node.length) {
      return false;
    }
    return revealArrayElement(
      node[component],
      remaining,
      disclosures,
      selected,
    );
  }

  if (!isRecord(node) || typeof component !== 'string') {
    return false;
  }
  if (Object.hasOwn(node, component)) {
    return revealPath(node[component], remaining, disclosures, selected);
  }
  const digests = Array.isArray(node._sd) ? node._sd : [];
  for (const digest of digests) {
    if (typeof digest !== 'string') {
      continue;
    }
    const disclosure = disclosures.get(digest);
    if (disclosure?.name === component) {
      selected.add(disclosure.digest);
      return revealPath(disclosure.value, remaining, disclosures, selected);
    }
  }
  return false;
}

function claimPath(reference: ClaimReference): ClaimPathComponent[] {
  return typeof reference === 'string' ? [reference] : reference;
}

export function claimReferenceKey(reference: ClaimReference): string {
  return JSON.stringify(claimPath(reference));
}

function credentialHolderJwk(
  payload: Record<string, unknown>,
): HolderPublicJwk {
  if (!isRecord(payload.cnf)) {
    throw new LinkConfigurationError('Issued credential is missing cnf.jwk');
  }
  return parseHolderPublicJwk(payload.cnf.jwk);
}

/**
 * Selects disclosure bytes for the requested claim references without
 * loading a private key or signing.
 */
export function selectDisclosures(options: {
  credential: string;
  disclose: ClaimReference[];
}): DisclosureSelection {
  const { credential, disclose } = options;
  const [issuerJwt, ...rest] = credential.split('~');
  if (!issuerJwt) {
    throw new LinkConfigurationError('Invalid SD-JWT issuer credential');
  }
  const jwtParts = issuerJwt.split('.');
  if (jwtParts.length !== 3 || !jwtParts[1]) {
    throw new LinkConfigurationError('Invalid SD-JWT issuer credential');
  }
  const payload = decodeJsonSegment(jwtParts[1], 'SD-JWT payload');
  if (!isRecord(payload)) {
    throw new LinkConfigurationError('Invalid SD-JWT payload');
  }
  const hashAlgorithm = resolveSdHashAlgorithm(payload);
  const available = rest.filter(Boolean);
  const disclosures = decodeDisclosures(available, hashAlgorithm.nodeName);
  const selected = new Set<string>();
  const disclosed: ClaimReference[] = [];
  const unavailable: ClaimReference[] = [];

  for (const reference of disclose) {
    const candidate = new Set(selected);
    if (revealPath(payload, claimPath(reference), disclosures, candidate)) {
      selected.clear();
      for (const digest of candidate) {
        selected.add(digest);
      }
      disclosed.push(reference);
    } else {
      unavailable.push(reference);
    }
  }

  const kept = available.filter((encoded) => {
    for (const disclosure of disclosures.values()) {
      if (disclosure.encoded === encoded) {
        return selected.has(disclosure.digest);
      }
    }
    return false;
  });
  const withheld = Array.from(disclosures.values())
    .filter((disclosure) => !selected.has(disclosure.digest))
    .map((disclosure) => disclosure.name ?? '[array element]');

  return {
    sdPart: `${[issuerJwt, ...kept].join('~')}~`,
    disclosed,
    withheld,
    unavailable,
    hashAlgorithm: hashAlgorithm.sdName,
    holderJwk: credentialHolderJwk(payload),
  };
}

function nodeHashName(
  algorithm: SdHashAlgorithm,
): 'sha256' | 'sha384' | 'sha512' {
  if (algorithm === 'sha-256') {
    return 'sha256';
  }
  if (algorithm === 'sha-384') {
    return 'sha384';
  }
  return 'sha512';
}

export function prepareKbJwt(options: {
  sdPart: string;
  aud: string;
  nonce: string;
  alg: KbJwtAlgorithm;
  hashAlgorithm: SdHashAlgorithm;
  iat?: number;
}): PreparedKbJwt {
  const iat = options.iat ?? Math.floor(Date.now() / 1000);
  const protectedHeader = { typ: 'kb+jwt' as const, alg: options.alg };
  const payload = {
    aud: options.aud,
    nonce: options.nonce,
    iat,
    sd_hash: base64url(
      createHash(nodeHashName(options.hashAlgorithm))
        .update(options.sdPart)
        .digest(),
    ),
  };
  const encodedHeader = jsonSegment(protectedHeader);
  const encodedPayload = jsonSegment(payload);
  return {
    protectedHeader,
    payload,
    encodedHeader,
    encodedPayload,
    signingInput: `${encodedHeader}.${encodedPayload}`,
  };
}

export function assemblePresentation(options: {
  sdPart: string;
  prepared: PreparedKbJwt;
  signature: Uint8Array;
}): string {
  return `${options.sdPart}${options.prepared.encodedHeader}.${options.prepared.encodedPayload}.${base64url(options.signature)}`;
}

function verifyKbSignature(
  alg: KbJwtAlgorithm,
  signingInput: string,
  signature: Uint8Array,
  jwk: HolderPublicJwk,
): boolean {
  const key = createPublicKey({ key: jwk as never, format: 'jwk' });
  if (alg === 'EdDSA') {
    return verifyEd25519(null, Buffer.from(signingInput), key, signature);
  }
  return createVerify('sha256')
    .update(signingInput)
    .verify({ key, dsaEncoding: 'ieee-p1363' }, signature);
}

/**
 * Confirms a locally assembled SD-JWT+KB presentation matches the prepared
 * audience, nonce, and disclosure hash, and verifies the KB-JWT under the
 * credential holder key. The merchant still performs authoritative verification.
 */
export function verifyAssembledPresentation(options: {
  presentation: string;
  holderJwk: HolderPublicJwk;
  prepared: PreparedKbJwt;
  sdPart: string;
}): void {
  const { presentation, holderJwk, prepared, sdPart } = options;
  if (!presentation.startsWith(sdPart)) {
    throw new LinkConfigurationError(
      'Assembled presentation does not preserve the prepared SD-JWT bytes',
    );
  }
  const kbJwt = presentation.slice(sdPart.length);
  const parts = kbJwt.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new LinkConfigurationError('Assembled KB-JWT is malformed');
  }
  if (
    parts[0] !== prepared.encodedHeader ||
    parts[1] !== prepared.encodedPayload
  ) {
    throw new LinkConfigurationError(
      'Assembled KB-JWT does not match the prepared signing input',
    );
  }
  const signature = Buffer.from(parts[2], 'base64url');
  if (
    !verifyKbSignature(
      prepared.protectedHeader.alg,
      prepared.signingInput,
      signature,
      holderJwk,
    )
  ) {
    throw new LinkConfigurationError(
      'KB-JWT signature does not verify under the credential holder key',
    );
  }
}
