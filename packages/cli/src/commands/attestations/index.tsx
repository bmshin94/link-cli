import { readFileSync } from 'node:fs';
import type { IAttestationsResource } from '@stripe/link-sdk';
import { Cli } from 'incur';
import {
  parseArtifactPrivateTokenChallenges,
  parseChallengeArtifact,
} from '../request/challenge-artifact';
import { authorizationHeader, exportAttestationTokens } from './export';
import { remainingCount } from './pool';
import { requestOptions, takeOptions } from './schema';

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

export function createAttestationsCli(
  createResource: (accessToken?: string) => IAttestationsResource,
) {
  const cli = Cli.create('attestations', {
    description:
      'A privacy-preserving token that shows Link attests to your agent.',
  });

  cli.command('request', {
    description:
      'Get privacy-preserving tokens that show Link attests to your agent.',
    options: requestOptions,
    mcp: false,
    outputPolicy: 'agent-only' as const,
    async run(c) {
      const {
        count,
        issuer,
        accessToken,
        poolFile,
        export: exportTokens,
        outputFile,
        force,
      } = c.options;
      const { remainingCount: remaining, saveIssuedTokens } = await import(
        './pool'
      );

      const issued = await createResource(accessToken).request({
        issuer,
        count,
      });

      if (exportTokens) {
        const exported = exportAttestationTokens(issued);
        await writeOutput(outputFile, exported, force);
        return exported;
      }

      saveIssuedTokens(poolFile, issued);
      const pooled = {
        issuer: issued.issuer,
        token_key_id: issued.token_key_id,
        count: issued.count,
        pool: {
          path: poolFile,
          remaining: remaining(poolFile),
        },
      };
      await writeOutput(outputFile, pooled, force);
      return pooled;
    },
  });

  cli.command('take', {
    description:
      'Atomically export one matching pooled attestation token and remove it from the CLI pool.',
    options: takeOptions,
    mcp: false,
    outputPolicy: 'agent-only' as const,
    async run(c) {
      const { challengeFile, poolFile, outputFile, force } = c.options;
      const { takeMatchingToken } = await import('./pool');

      let artifact: ReturnType<typeof parseChallengeArtifact>;
      try {
        artifact = parseChallengeArtifact(
          JSON.parse(readFileSync(challengeFile, 'utf8')),
        );
      } catch (error) {
        return c.error({
          code: 'INVALID_INPUT',
          message: (error as Error).message,
        });
      }

      let challenges: ReturnType<typeof parseArtifactPrivateTokenChallenges>;
      try {
        challenges = parseArtifactPrivateTokenChallenges(artifact);
      } catch (error) {
        return c.error({
          code: 'INVALID_CHALLENGE',
          message: (error as Error).message,
        });
      }
      if (challenges.length === 0) {
        return c.error({
          code: 'INVALID_CHALLENGE',
          message:
            'Challenge artifact has no PrivateToken challenge to match against the pool.',
        });
      }

      const spent =
        challenges
          .map((challenge) =>
            takeMatchingToken(poolFile, {
              challengeDigest: challenge.challengeDigest,
              ...(challenge.tokenKeyId
                ? { tokenKeyId: challenge.tokenKeyId }
                : {}),
            }),
          )
          .find((match) => match !== null) ?? null;
      if (!spent) {
        const empty = remainingCount(poolFile) === 0;
        return c.error({
          code: empty ? 'AAT_POOL_EMPTY' : 'AAT_NO_MATCH',
          message: empty
            ? 'No attestation tokens in the local pool. Run "link-cli identity attestations request --count 10" first.'
            : "The verifier's PrivateToken challenge does not match any token in the local pool.",
        });
      }

      const exported = {
        version: 1 as const,
        token: spent.token,
        issuer: spent.issuer,
        token_key_id: spent.token_key_id,
        authorization: authorizationHeader(spent.token),
        remaining: spent.remaining,
      };
      await writeOutput(outputFile, exported, force);
      return exported;
    },
  });

  return cli;
}
