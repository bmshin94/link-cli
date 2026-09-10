import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const cliUrl = new URL('../../dist/cli.js', import.meta.url).href;
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

async function runCli(entrypoint: string, args: string[]) {
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
        await import(process.env.LINK_TEST_CLI_URL);
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
        LINK_AUTH_FILE: join(fixture, 'auth.json'),
        LINK_ACCESS_TOKEN: '',
        LINK_REFRESH_TOKEN: '',
        XDG_DATA_HOME: join(fixture, 'data'),
        XDG_CONFIG_HOME: join(fixture, 'config'),
        npm_config_user_agent: 'npm/10.0.0',
        npm_execpath: '',
        npm_config_registry: 'http://127.0.0.1:1',
        NO_UPDATE_NOTIFIER: '1',
      },
      timeout: 10_000,
    },
  );
}

describe('MCP self command', () => {
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
