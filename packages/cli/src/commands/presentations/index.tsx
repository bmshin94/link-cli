import { readFileSync } from 'node:fs';
import {
  holderJwkThumbprint,
  prepareKbJwt,
  selectDisclosures,
} from '@stripe/link-sdk';
import { Cli } from 'incur';
import type { CredentialIssueResult } from '../credentials/issue';
import {
  assertChallengeAudience,
  parseArtifactClaimsChallenge,
  parseChallengeArtifact,
  requireHttpsOrigin,
} from '../request/challenge-artifact';
import {
  buildPresentation,
  claimReferenceKey,
  formatClaimReference,
  parseClaimList,
  supportsPreProvisionedPresentation,
} from '../request/present';
import { createOptions, prepareOptions } from './schema';

const PRESENTATION_ARTIFACT_VERSION = 1 as const;

function loadJson(path: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `Failed to read ${label} at ${path}: ${(error as Error).message}`,
    );
  }
}

function loadCredentialArtifact(path: string): CredentialIssueResult {
  const parsed = loadJson(path, 'credential artifact');
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Credential artifact must be an object');
  }
  const record = parsed as Partial<CredentialIssueResult>;
  if (typeof record.credential !== 'string' || record.credential.length === 0) {
    throw new Error('Credential artifact is missing credential');
  }
  if (typeof record.issuer !== 'string') {
    throw new Error('Credential artifact is missing issuer');
  }
  return record as CredentialIssueResult;
}

async function writeOutput(
  outputFile: string | undefined,
  data: unknown,
  force: boolean,
): Promise<void> {
  if (!outputFile) {
    return;
  }
  const { writeCredentialFile } = await import('../../utils/credential-output');
  await writeCredentialFile(outputFile, data, force);
}

function requestedClaims(
  challengeClaims: ReturnType<typeof parseArtifactClaimsChallenge>,
  claimsFlag: string | undefined,
) {
  if (!challengeClaims) {
    throw new Error(
      'Challenge artifact has no Identity-Presentation claims challenge.',
    );
  }
  if (!supportsPreProvisionedPresentation(challengeClaims)) {
    throw new Error(
      'The verifier does not accept the supported dc+sd-jwt presentation format.',
    );
  }
  const claimOverride = parseClaimList(claimsFlag);
  if (claimOverride) {
    const challenged = new Set(
      challengeClaims.claims.map((claim) => claimReferenceKey(claim)),
    );
    const extra = claimOverride.filter(
      (claim) => !challenged.has(claimReferenceKey(claim)),
    );
    if (extra.length > 0) {
      throw new Error(
        `--claims may only narrow the verifier request; not requested: ${extra.map(formatClaimReference).join(', ')}.`,
      );
    }
  }
  return {
    challenge: challengeClaims,
    requested: claimOverride ?? challengeClaims.claims,
  };
}

export function createPresentationsCli() {
  const cli = Cli.create('presentations', {
    description:
      'Prepare or create an SD-JWT+KB identity presentation without contacting the merchant.',
  });

  cli.command('prepare', {
    description:
      'Select disclosures and emit KB-JWT signing input without loading a private key or sending a request.',
    options: prepareOptions,
    mcp: false,
    outputPolicy: 'agent-only' as const,
    async run(c) {
      try {
        const origin = requireHttpsOrigin(c.options.origin);
        const credential = loadCredentialArtifact(c.options.credentialFile);
        const artifact = parseChallengeArtifact(
          loadJson(c.options.challengeFile, 'challenge artifact'),
        );
        const { challenge, requested } = requestedClaims(
          parseArtifactClaimsChallenge(artifact),
          c.options.claims,
        );
        assertChallengeAudience(challenge.aud, origin);
        const selection = selectDisclosures({
          credential: credential.credential,
          disclose: requested,
        });
        if (selection.unavailable.length > 0) {
          return c.error({
            code: 'CLAIMS_UNAVAILABLE',
            message: `The credential cannot disclose: ${selection.unavailable.map(formatClaimReference).join(', ')}.`,
          });
        }
        const alg = selection.holderJwk.kty === 'OKP' ? 'EdDSA' : 'ES256';
        const prepared = prepareKbJwt({
          sdPart: selection.sdPart,
          aud: challenge.aud,
          nonce: challenge.nonce,
          alg,
          hashAlgorithm: selection.hashAlgorithm,
        });
        const result = {
          version: PRESENTATION_ARTIFACT_VERSION,
          sd_part: selection.sdPart,
          holder: {
            jwk: selection.holderJwk,
            thumbprint: holderJwkThumbprint(selection.holderJwk),
          },
          kb_jwt: {
            protected_header: prepared.protectedHeader,
            payload: prepared.payload,
            encoded_header: prepared.encodedHeader,
            encoded_payload: prepared.encodedPayload,
            signing_input: prepared.signingInput,
          },
          origin,
          disclosed: selection.disclosed,
          withheld: selection.withheld,
          credential_expires_at: credential.expires_at,
        };
        await writeOutput(c.options.outputFile, result, c.options.force);
        return result;
      } catch (error) {
        return c.error({
          code: 'INVALID_INPUT',
          message: (error as Error).message,
        });
      }
    },
  });

  cli.command('create', {
    description:
      'Create a complete SD-JWT+KB presentation using a matching CLI-managed private key.',
    options: createOptions,
    mcp: false,
    outputPolicy: 'agent-only' as const,
    async run(c) {
      try {
        const origin = requireHttpsOrigin(c.options.origin);
        const credential = loadCredentialArtifact(c.options.credentialFile);
        if (credential.holder?.ownership === 'external') {
          return c.error({
            code: 'INVALID_INPUT',
            message:
              'This credential was issued to an agent-managed key. Sign with identity presentations prepare and an external signer; do not pass --key-file.',
          });
        }
        const artifact = parseChallengeArtifact(
          loadJson(c.options.challengeFile, 'challenge artifact'),
        );
        const { challenge, requested } = requestedClaims(
          parseArtifactClaimsChallenge(artifact),
          c.options.claims,
        );
        assertChallengeAudience(challenge.aud, origin);
        const presented = await buildPresentation({
          credential: credential.credential,
          keyFile: c.options.keyFile,
          keyType: 'ed25519',
          aud: challenge.aud,
          nonce: challenge.nonce,
          disclose: requested,
          createIfMissing: false,
        });
        if (presented.unavailable.length > 0) {
          return c.error({
            code: 'CLAIMS_UNAVAILABLE',
            message: `The credential cannot disclose: ${presented.unavailable.map(formatClaimReference).join(', ')}.`,
          });
        }
        const result = {
          version: PRESENTATION_ARTIFACT_VERSION,
          presentation: presented.presentation,
          origin,
          disclosed: presented.disclosed,
          withheld: presented.withheld,
          credential_expires_at: credential.expires_at,
        };
        await writeOutput(c.options.outputFile, result, c.options.force);
        return result;
      } catch (error) {
        return c.error({
          code: 'INVALID_INPUT',
          message: (error as Error).message,
        });
      }
    },
  });

  return cli;
}
