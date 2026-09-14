import { z } from 'incur';

export const getOptions = z.object({
  keyFile: z
    .string()
    .optional()
    .describe(
      'Path to a local private key file. Created if missing. Defaults to ~/.link/holder-key.jwk when --public-key-file is not set.',
    ),
  publicKeyFile: z
    .string()
    .optional()
    .describe(
      'Path to a public JWK file. Issues a credential for this key without reading or creating a private key.',
    ),
  keyType: z
    .enum(['ed25519', 'p256'])
    .optional()
    .describe(
      'Key type to generate when a managed --key-file does not exist yet. Rejected with --public-key-file.',
    ),
  outputFile: z
    .string()
    .optional()
    .describe(
      'Write the credential artifact as JSON to this path (0600). Refuses to overwrite unless --force is set.',
    ),
  force: z
    .boolean()
    .default(false)
    .describe('Overwrite --output-file if it already exists.'),
  accessToken: z
    .string()
    .optional()
    .describe(
      'Access token. Defaults to the stored credentials from "link-cli auth login".',
    ),
});
