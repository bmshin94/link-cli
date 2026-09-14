import { z } from 'incur';
import { DEFAULT_AAT_POOL_PATH } from './pool';

export const requestOptions = z.object({
  count: z.coerce
    .number()
    .int()
    .positive()
    .max(100)
    .describe('Number of tokens to request'),
  issuer: z
    .string()
    .default('https://api.link.com')
    .describe('Link origin that attests to your agent'),
  accessToken: z
    .string()
    .optional()
    .describe(
      'Access token. Defaults to the stored credentials from "link-cli auth login".',
    ),
  export: z
    .boolean()
    .default(false)
    .describe(
      'Return newly issued tokens to the caller without adding them to the CLI pool.',
    ),
  poolFile: z
    .string()
    .default(DEFAULT_AAT_POOL_PATH)
    .describe(
      'Local file that stores unused attestation tokens for identity request. Used unless --export is set.',
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
});

export const takeOptions = z.object({
  challengeFile: z
    .string()
    .describe(
      'Saved challenge artifact whose WWW-Authenticate PrivateToken challenge the pooled token must match.',
    ),
  poolFile: z
    .string()
    .default(DEFAULT_AAT_POOL_PATH)
    .describe('Local file that stores unused attestation tokens.'),
  outputFile: z
    .string()
    .optional()
    .describe(
      'Write the exported token as JSON to this path (0600). Refuses to overwrite unless --force is set.',
    ),
  force: z
    .boolean()
    .default(false)
    .describe('Overwrite --output-file if it already exists.'),
});
