import { type ICredentialsResource, LinkSdkError } from '@stripe/link-sdk';
import { Cli } from 'incur';
import { issueCredential } from './issue';

export function createCredentialsCli(
  createResource: () => ICredentialsResource,
) {
  const cli = Cli.create('credentials', {
    description: 'User info that has been signed, proving it comes from Link.',
  });

  cli.command('get', {
    description:
      'Get signed user info proving it comes from Link. Includes a wallet of claims such as name, email, and phone that you can present later.',
    mcp: false,
    outputPolicy: 'agent-only' as const,
    async run(c) {
      let result: Awaited<ReturnType<typeof issueCredential>>;
      try {
        result = await issueCredential({
          resource: createResource(),
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

      return result;
    },
  });

  return cli;
}
