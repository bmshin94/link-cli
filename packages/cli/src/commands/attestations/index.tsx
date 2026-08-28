import type { IAttestationsResource } from '@stripe/link-sdk';
import { Cli } from 'incur';
import { exportAttestationTokens } from './export';
import { requestOptions } from './schema';

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
      const { count, issuer, accessToken, poolFile, outputFile, force } =
        c.options;
      const { remainingCount, saveIssuedTokens } = await import('./pool');

      const issued = await createResource(accessToken).request({
        issuer,
        count,
      });
      saveIssuedTokens(poolFile, issued);
      const result = {
        ...exportAttestationTokens(issued),
        pool: {
          path: poolFile,
          remaining: remainingCount(poolFile),
        },
      };
      if (outputFile) {
        const { writeCredentialFile } = await import(
          '../../utils/credential-output'
        );
        await writeCredentialFile(outputFile, result, force);
      }
      return result;
    },
  });

  return cli;
}
