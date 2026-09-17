import { type ICredentialsResource, LinkSdkError } from '@stripe/link-sdk';
import { Cli } from 'incur';
import { issueCredential } from './issue';
import {
  CredentialKeySourceError,
  resolveCredentialKeySource,
} from './key-source';
import { getOptions } from './schema';

export function createCredentialsCli(
  createResource: (accessToken?: string) => ICredentialsResource,
) {
  const cli = Cli.create('credentials', {
    description: 'User info that has been signed, proving it comes from Link.',
  });

  cli.command('get', {
    description:
      'Get signed user info proving it comes from Link. Includes a wallet of claims such as name, email, and phone that you can present later.',
    options: getOptions,
    mcp: false,
    outputPolicy: 'agent-only' as const,
    async run(c) {
      const { outputFile, force, accessToken, ...keyOptions } = c.options;

      let source: ReturnType<typeof resolveCredentialKeySource>;
      try {
        source = resolveCredentialKeySource(keyOptions);
      } catch (error) {
        return c.error({
          code:
            error instanceof CredentialKeySourceError
              ? error.code
              : 'INVALID_INPUT',
          message: (error as Error).message,
        });
      }

      let result: Awaited<ReturnType<typeof issueCredential>>;
      try {
        result = await issueCredential({
          resource: createResource(accessToken),
          source,
        });
      } catch (error) {
        if (error instanceof LinkSdkError) {
          throw error;
        }
        return c.error({
          code: 'INVALID_INPUT',
          message: (error as Error).message,
        });
      }

      if (outputFile) {
        const { writeCredentialFile } = await import(
          '../../utils/credential-output'
        );
        try {
          await writeCredentialFile(outputFile, result, force);
        } catch (error) {
          const message = (error as Error).message;
          const code = message.startsWith('OUTPUT_FILE_EXISTS')
            ? 'OUTPUT_FILE_EXISTS'
            : message.startsWith('OUTPUT_FILE_SYMLINK')
              ? 'OUTPUT_FILE_SYMLINK'
              : 'OUTPUT_FILE_WRITE_ERROR';
          return c.error({ code, message });
        }
      }
      return result;
    },
  });

  return cli;
}
