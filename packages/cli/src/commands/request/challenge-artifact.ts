import { type ClaimsChallenge, parseClaimsChallenge } from './present';
import {
  type PrivateTokenChallenge,
  parsePrivateTokenChallenges,
} from './private-token';

export const CHALLENGE_ARTIFACT_VERSION = 1 as const;

export interface ChallengeHeader {
  name: string;
  value: string;
}

export interface ChallengeArtifact {
  version: typeof CHALLENGE_ARTIFACT_VERSION;
  url: string;
  status: number;
  headers: ChallengeHeader[];
  body: string;
}

export interface PlaywrightLikeResponse {
  url: () => string;
  status: () => number;
  headersArray?: () => ChallengeHeader[];
  headers?: () => Record<string, string>;
  text: () => Promise<string> | string;
}

function headerValues(headers: ChallengeHeader[], name: string): string[] {
  const needle = name.toLowerCase();
  return headers
    .filter((header) => header.name.toLowerCase() === needle)
    .map((header) => header.value);
}

export function headersFromFetch(headers: Headers): ChallengeHeader[] {
  const collected: ChallengeHeader[] = [];
  headers.forEach((value, name) => {
    collected.push({ name, value });
  });
  return collected;
}

export function challengeArtifactFromFetch(options: {
  url: string;
  response: Pick<Response, 'status' | 'headers'>;
  body: string;
}): ChallengeArtifact {
  return {
    version: CHALLENGE_ARTIFACT_VERSION,
    url: options.url,
    status: options.response.status,
    headers: headersFromFetch(options.response.headers as Headers),
    body: options.body,
  };
}

export async function challengeArtifactFromPlaywright(
  response: PlaywrightLikeResponse,
): Promise<ChallengeArtifact> {
  const headers =
    response.headersArray?.() ??
    Object.entries(response.headers?.() ?? {}).map(([name, value]) => ({
      name,
      value,
    }));
  return {
    version: CHALLENGE_ARTIFACT_VERSION,
    url: response.url(),
    status: response.status(),
    headers,
    body: await response.text(),
  };
}

export function parseChallengeArtifact(value: unknown): ChallengeArtifact {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Challenge artifact must be an object');
  }
  const record = value as Record<string, unknown>;
  if (record.version !== CHALLENGE_ARTIFACT_VERSION) {
    throw new Error(
      `Unsupported challenge artifact version: ${String(record.version)}`,
    );
  }
  if (typeof record.url !== 'string' || record.url.length === 0) {
    throw new Error('Challenge artifact is missing url');
  }
  if (typeof record.status !== 'number') {
    throw new Error('Challenge artifact is missing status');
  }
  if (!Array.isArray(record.headers)) {
    throw new Error('Challenge artifact is missing headers');
  }
  const headers = record.headers.map((header) => {
    if (
      typeof header !== 'object' ||
      header === null ||
      typeof (header as ChallengeHeader).name !== 'string' ||
      typeof (header as ChallengeHeader).value !== 'string'
    ) {
      throw new Error('Challenge artifact has a malformed header');
    }
    return {
      name: (header as ChallengeHeader).name,
      value: (header as ChallengeHeader).value,
    };
  });
  if (typeof record.body !== 'string') {
    throw new Error('Challenge artifact is missing body');
  }
  return {
    version: CHALLENGE_ARTIFACT_VERSION,
    url: record.url,
    status: record.status,
    headers,
    body: record.body,
  };
}

function artifactAsResponse(artifact: ChallengeArtifact): {
  status: number;
  headers: Headers;
} {
  const headers = new Headers();
  for (const header of artifact.headers) {
    headers.append(header.name, header.value);
  }
  return { status: artifact.status, headers };
}

export function parseArtifactPrivateTokenChallenges(
  artifact: ChallengeArtifact,
): PrivateTokenChallenge[] {
  return parsePrivateTokenChallenges(artifactAsResponse(artifact));
}

export function parseArtifactClaimsChallenge(
  artifact: ChallengeArtifact,
): ClaimsChallenge | null {
  return parseClaimsChallenge(artifactAsResponse(artifact), artifact.body);
}

export function requireHttpsOrigin(origin: string): string {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error(`Invalid origin: ${origin}`);
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  const loopback =
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname.startsWith('127.');
  if (
    (parsed.protocol !== 'https:' &&
      !(parsed.protocol === 'http:' && loopback)) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      'Origin must be an HTTPS origin including scheme and non-default port (HTTP is allowed only for loopback development)',
    );
  }
  return parsed.origin;
}

export function assertChallengeAudience(
  challengeAud: string,
  intendedOrigin: string,
): void {
  const origin = requireHttpsOrigin(intendedOrigin);
  if (challengeAud !== origin) {
    throw new Error(
      `Challenge audience ${challengeAud} does not exactly match ${origin}.`,
    );
  }
}

export function wwwAuthenticateValues(artifact: ChallengeArtifact): string[] {
  return headerValues(artifact.headers, 'www-authenticate');
}
