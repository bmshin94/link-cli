import type {
  IAttestationsResource,
  ICredentialsResource,
} from '@stripe/link-sdk';
import { Cli } from 'incur';
import type { CliAuthStorage } from '../../auth/storage';
import { createAttestationsCli } from '../attestations';
import { createCredentialsCli } from '../credentials';
import { createPresentationsCli } from '../presentations';
import { createRequestCli } from '../request';

export function createIdentityCli(options: {
  createAttestationsResource: (accessToken?: string) => IAttestationsResource;
  createCredentialsResource: (accessToken?: string) => ICredentialsResource;
  authStorage?: CliAuthStorage;
  envAccessToken?: string;
}) {
  const cli = Cli.create('identity', {
    description: 'Prove your agent and user identity with Link.',
  });

  cli.command(createAttestationsCli(options.createAttestationsResource));
  cli.command(createCredentialsCli(options.createCredentialsResource));
  cli.command(createPresentationsCli());
  cli.command(
    createRequestCli(
      () => options.createCredentialsResource(),
      options.authStorage,
      options.envAccessToken,
    ),
  );
  return cli;
}
