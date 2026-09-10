import { describe, expect, it } from 'vitest';
import { detectPackageSpecifier } from '../../node_modules/incur/dist/SyncMcp.js';

describe('framework package identity', () => {
  it.each(['1.2.3', '0.0.0', '1.2.3-beta.1', '1.2.3+build.001'])(
    'accepts an exact version: %s',
    (version) => {
      expect(detectPackageSpecifier('@stripe/link-cli', version)).toBe(
        `@stripe/link-cli@${version}`,
      );
    },
  );

  it.each([
    undefined,
    '',
    'latest',
    '^1.2.3',
    '1.2',
    '01.2.3',
    '1.2.3-01',
    '1.2.3 --yes',
    '1.2.3\n',
    '1.2.3;id',
    '1.2.3$(id)',
    'https://attacker.invalid/x.tgz',
    'file:./payload',
  ])('rejects an absent or unsafe version: %s', (version) => {
    expect(() => detectPackageSpecifier('@stripe/link-cli', version)).toThrow(
      /explicit packageName and exact version/,
    );
  });

  it.each([
    undefined,
    '',
    '@stripe/link-cli --yes',
    '@stripe/link-cli\n',
    '@stripe/link-cli;id',
    'https://attacker.invalid/x.tgz',
    'file:./payload',
    'npm:link-cli',
    '../link-cli',
    '--package=link-cli',
    '@stripe/link-cli@1.2.3',
  ])('rejects an absent or unsafe package name: %s', (name) => {
    expect(() => detectPackageSpecifier(name, '1.2.3')).toThrow(
      /explicit packageName and exact version/,
    );
  });
});
