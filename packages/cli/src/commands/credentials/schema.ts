import { z } from 'incur';

export const getOptions = z.object({
  publicKeyFile: z
    .string()
    .optional()
    .describe(
      'Path to a public JWK file. Issues a credential for this key without reading or creating a private key.',
    ),
});
