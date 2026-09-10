import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const cliUrl =
  process.env.LINK_TEST_PACKED_CLI_URL ??
  new URL('../../dist/cli.js', import.meta.url).href;
const pkg = JSON.parse(
  await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
);

let fixture: string;

beforeEach(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'link-cli-self-command-'));
});

afterEach(async () => {
  await rm(fixture, { recursive: true, force: true });
});

async function runCli(
  entrypoint: string,
  args: string[],
  { framework = false, userAgent = 'npm/10.0.0' } = {},
) {
  // Override homedir only in the child, so registration cannot touch real
  // agent settings. Import the built CLI with a simulated installation path.
  return execFileAsync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
        import os from 'node:os';
        import cp from 'node:child_process';
        import { syncBuiltinESMExports } from 'node:module';
        os.homedir = () => process.env.LINK_TEST_HOME;
        cp.execFile = cp.spawn = () => { throw new Error('Unexpected subprocess'); };
        syncBuiltinESMExports();
        globalThis.fetch = async () => { throw new Error('Unexpected network request'); };
        process.argv = [process.execPath, process.env.LINK_TEST_ENTRYPOINT, ...process.argv.slice(1)];
        if (process.env.LINK_TEST_FRAMEWORK === '1') {
          const { Cli } = await import(process.env.LINK_TEST_FRAMEWORK_URL);
          await Cli.create('link-cli', {
            packageName: process.env.LINK_TEST_PACKAGE_NAME,
            version: process.env.LINK_TEST_PACKAGE_VERSION,
            update: false,
          }).serve();
        } else {
          await import(process.env.LINK_TEST_CLI_URL);
        }
      `,
      '--',
      ...args,
    ],
    {
      cwd: fixture,
      env: {
        ...process.env,
        LINK_TEST_HOME: fixture,
        LINK_TEST_ENTRYPOINT: join(fixture, entrypoint),
        LINK_TEST_CLI_URL: cliUrl,
        LINK_TEST_FRAMEWORK: framework ? '1' : '',
        LINK_TEST_FRAMEWORK_URL: new URL(
          '../../node_modules/incur/dist/index.js',
          import.meta.url,
        ).href,
        LINK_TEST_PACKAGE_NAME: pkg.name,
        LINK_TEST_PACKAGE_VERSION: pkg.version,
        LINK_AUTH_FILE: join(fixture, 'auth.json'),
        LINK_ACCESS_TOKEN: '',
        LINK_REFRESH_TOKEN: '',
        XDG_DATA_HOME: join(fixture, 'data'),
        XDG_CONFIG_HOME: join(fixture, 'config'),
        XDG_CACHE_HOME: join(fixture, 'cache'),
        npm_config_user_agent: userAgent,
        npm_execpath: '',
        npm_config_registry: 'http://127.0.0.1:1',
        NO_UPDATE_NOTIFIER: '1',
      },
      timeout: 10_000,
    },
  );
}

describe('MCP self command', () => {
  it('keeps bundled YAML output working', async () => {
    const { stdout } = await runCli('dist/cli.js', [
      'mcp',
      'doctor',
      '--format',
      'yaml',
    ]);
    expect(stdout).toContain('ok: true');
    expect(stdout).toMatch(/toolCount: [1-9]\d*/);
  });

  it('keeps the bundled MCP transport working', async () => {
    const { stdout } = await runCli('dist/cli.js', [
      'mcp',
      'doctor',
      '--format',
      'json',
    ]);
    const result = JSON.parse(stdout);
    expect(result.ok).toBe(true);
    expect(result.toolCount).toBeGreaterThan(0);
  });

  it.each([
    'dist/cli.js',
    'node_modules/.bin/link-cli',
    'node_modules/.pnpm/@stripe+link-cli/node_modules/@stripe/link-cli/dist/cli.js',
    'bin/link-cli',
  ])('registers the scoped, exact version from %s', async (entrypoint) => {
    await writeFile(
      join(fixture, 'package.json'),
      JSON.stringify({
        dependencies: { '@stripe/link-cli': `^${pkg.version}` },
      }),
    );
    const configPath = join(fixture, '.config/amp/settings.json');
    await mkdir(dirname(configPath), { recursive: true });
    const unrelated = { command: 'another-server', args: [] };
    await writeFile(
      configPath,
      JSON.stringify({ 'amp.mcpServers': { unrelated } }),
    );

    await runCli(entrypoint, ['mcp', 'add', '--agent', 'amp']);

    const config = JSON.parse(await readFile(configPath, 'utf8'));
    expect(config['amp.mcpServers']).toEqual({
      unrelated,
      'link-cli': {
        command: 'npx',
        args: [`${pkg.name}@${pkg.version}`, '--mcp'],
      },
    });
  });
});

describe('untrusted project dependencies', () => {
  const challenge = `Payment id="ch_test", realm="merchant.example", method="stripe", intent="charge", request="${Buffer.from(
    JSON.stringify({
      amount: '1000',
      currency: 'usd',
      methodDetails: { networkId: 'net_test', paymentMethodTypes: ['card'] },
    }),
  ).toString('base64')}"`;

  async function markSkillsStale() {
    const skillPath = join(fixture, 'skills/link-cli-test');
    await mkdir(skillPath, { recursive: true });
    await writeFile(join(skillPath, 'SKILL.md'), 'Test skill');
    await mkdir(join(fixture, 'data/incur'), { recursive: true });
    await writeFile(
      join(fixture, 'data/incur/link-cli.json'),
      JSON.stringify({
        hash: 'stale',
        skills: ['link-cli-test'],
        paths: [skillPath],
      }),
    );
  }

  it.each([
    ['', 'npx'],
    ['pnpm/10.0.0', 'pnpx'],
    ['bun/1.0.0', 'bunx'],
  ])(
    'pins skill suggestions with package manager %s',
    async (userAgent, runner) => {
      await markSkillsStale();
      const { stdout } = await runCli(
        'dist/cli.js',
        [
          'mpp',
          'decode',
          '--challenge',
          challenge,
          '--full-output',
          '--format',
          'json',
        ],
        { userAgent },
      );
      expect(JSON.parse(stdout).meta.cta.commands[0].command).toBe(
        `${runner} ${pkg.name}@${pkg.version} skills add`,
      );
    },
  );

  it.each([
    ['.', 'link-cli', 'https://attacker.invalid/x.tgz'],
    ['.', '@stripe/link-cli', 'https://attacker.invalid/x.tgz'],
    ['.', 'link-cli', 'file:./payload'],
    ['.', 'link-cli', '1.0.0 --yes'],
    ['.', 'link-cli', 'https://attacker.invalid/x.tgz --yes'],
    ['packages/member', 'link-cli', 'https://attacker.invalid/x.tgz'],
    ['node_modules/parent', 'link-cli', 'https://attacker.invalid/x.tgz'],
  ])(
    'ignores %s dependency %s = %s in both sinks',
    async (project, name, spec) => {
      const projectPath = join(fixture, project);
      await mkdir(projectPath, { recursive: true });
      await writeFile(
        join(projectPath, 'package.json'),
        JSON.stringify({
          dependencies: { [name]: spec },
          devDependencies: { '@stripe/link-cli': `^${pkg.version}` },
        }),
      );
      const entrypoint = join(project, 'node_modules/.bin/link-cli');

      // Exercise the framework default without the CLI's explicit MCP override.
      await runCli(entrypoint, ['mcp', 'add', '--agent', 'amp'], {
        framework: true,
      });
      const config = JSON.parse(
        await readFile(join(fixture, '.config/amp/settings.json'), 'utf8'),
      );
      expect(config['amp.mcpServers']['link-cli']).toEqual({
        command: 'npx',
        args: [`${pkg.name}@${pkg.version}`, '--mcp'],
      });

      await markSkillsStale();

      const { stdout } = await runCli(entrypoint, [
        'mpp',
        'decode',
        '--challenge',
        challenge,
        '--full-output',
        '--format',
        'json',
      ]);
      const result = JSON.parse(stdout);
      expect(result.meta.cta.commands).toEqual([
        {
          command: `npx ${pkg.name}@${pkg.version} skills add`,
          description: 'sync outdated skills',
        },
      ]);
    },
  );
});
