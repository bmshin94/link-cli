import { z } from 'incur';

const fileOptions = {
  credentialFile: z
    .string()
    .describe(
      'Credential artifact from identity credentials get --output-file.',
    ),
  challengeFile: z
    .string()
    .describe('Saved 401 challenge artifact from the verifier.'),
  origin: z
    .string()
    .describe(
      'Intended HTTPS verifier origin, including scheme and non-default port.',
    ),
  claims: z
    .string()
    .optional()
    .describe(
      'Comma-separated user-info fields to share. Only these are sent. Defaults to what the site asked for.',
    ),
  outputFile: z
    .string()
    .optional()
    .describe(
      'Write the result as JSON to this path (0600). Refuses to overwrite unless --force is set.',
    ),
  force: z
    .boolean()
    .default(false)
    .describe('Overwrite --output-file if it already exists.'),
};

export const prepareOptions = z.object(fileOptions);

export const createOptions = z.object({
  ...fileOptions,
  keyFile: z
    .string()
    .describe(
      'Matching CLI-managed private key for this credential. The file must already exist.',
    ),
});
