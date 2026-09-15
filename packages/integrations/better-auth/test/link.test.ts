import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { betterAuth } from 'better-auth';
import { createAuthClient } from 'better-auth/client';
import { getMigrations } from 'better-auth/db/migration';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { link } from '../src/index';

const credentials = {
  clientId: 'link-client',
  clientSecret: 'link-secret',
  publishableKey: 'pk_test_link',
};
const linkProfile = {
  id: 'link_user_AbC123',
  email: 'wallet@example.com',
  first_name: 'Link',
  last_name: 'User',
};
const databases: DatabaseSync[] = [];

class Cookies {
  values = new Map<string, string>();
  absorb(response: Response) {
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0] ?? '';
      const separator = pair.indexOf('=');
      this.values.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }
  toString() {
    return [...this.values].map(([key, value]) => `${key}=${value}`).join('; ');
  }
}

async function fixture(
  strategy: 'database' | 'cookie' = 'database',
  basePath = '/api/auth',
  linkOptions: { redirectURI?: string } = {},
) {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  const options = {
    database,
    baseURL: 'http://localhost:3000',
    basePath,
    secret: 'a-test-secret-long-enough-for-better-auth-123456789',
    emailAndPassword: { enabled: true },
    socialProviders: {
      github: { clientId: 'github-client', clientSecret: 'github-secret' },
    },
    account: {
      storeStateStrategy: strategy,
      encryptOAuthTokens: true,
      accountLinking: {
        trustedProviders: ['link'],
        allowDifferentEmails: true,
      },
    },
    logger: { disabled: true },
    advanced: { disableOriginCheck: false, disableCSRFCheck: false },
    plugins: [link({ ...credentials, ...linkOptions })],
  };
  await (await getMigrations(options)).runMigrations();
  const auth = betterAuth(options);
  const cookies = new Cookies();
  async function request(path: string, body?: unknown, jar = cookies) {
    const response = await auth.handler(
      new Request(`${options.baseURL}${basePath}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'content-type': 'application/json',
          origin: options.baseURL,
          cookie: jar.toString(),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    jar.absorb(response);
    return response;
  }
  async function signUp(email = 'app@example.com', jar = cookies) {
    const response = await request(
      '/sign-up/email',
      { email, password: 'password123456', name: 'App User' },
      jar,
    );
    expect(response.status).toBe(200);
    return (await response.json()).user.id as string;
  }
  const userId = await signUp();
  const client = createAuthClient({
    baseURL: options.baseURL,
    basePath,
    fetchOptions: {
      customFetchImpl: async (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set('cookie', cookies.toString());
        headers.set('origin', options.baseURL);
        const response = await auth.handler(
          new Request(input, { ...init, headers }),
        );
        cookies.absorb(response);
        return response;
      },
    },
  });
  async function start() {
    const result = await client.linkSocial({
      provider: 'link',
      callbackURL: '/done',
      errorCallbackURL: '/failed',
    });
    expect(result.error).toBeNull();
    return new URL(result.data?.url ?? '');
  }
  async function startSignIn() {
    const result = await client.signIn.social({
      provider: 'link',
      callbackURL: '/done',
      errorCallbackURL: '/failed',
    });
    expect(result.error).toBeNull();
    return new URL(result.data?.url ?? '');
  }
  async function complete(url: URL) {
    return request(
      `/callback/link?state=${url.searchParams.get('state')}&code=code-one`,
    );
  }
  async function connect() {
    expect((await complete(await start())).headers.get('location')).toBe(
      '/done',
    );
    const accounts = await client.listAccounts();
    const account = accounts.data?.find(
      (account) => account.providerId === 'link',
    );
    if (!account) throw new Error('No Link account');
    return account;
  }
  let profile: Record<string, unknown> = { ...linkProfile };
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
    if (String(input) === 'https://api.link.com/userinfo') {
      return Response.json(profile);
    }
    expect(String(input)).toBe('https://login.link.com/auth/token');
    return Response.json({
      access_token: 'access-one',
      refresh_token: 'refresh-one',
      expires_in: 3600,
      scope: 'payment_methods.agentic,userinfo:read',
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    auth,
    client,
    database,
    request,
    cookies,
    userId,
    signUp,
    start,
    startSignIn,
    complete,
    connect,
    fetchMock,
    setProfile(nextProfile: Record<string, unknown>) {
      profile = nextProfile;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) db.close();
});

describe.each(['database', 'cookie'] as const)('%s OAuth state', (strategy) => {
  it('creates a user with Link and signs back in by stable ID after an email change', async () => {
    const f = await fixture(strategy);
    await f.client.signOut();
    const url = await f.startSignIn();
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect((await f.complete(url)).headers.get('location')).toBe('/done');
    const firstSession = await f.client.getSession();
    const linkUser = firstSession.data?.user;
    expect(linkUser).toMatchObject({
      email: linkProfile.email,
      name: 'Link User',
      emailVerified: false,
    });
    expect(linkUser?.id).toBeTruthy();
    expect(linkUser?.id).not.toBe(f.userId);
    expect(linkUser?.id).not.toBe(linkProfile.id);
    const accounts = await f.client.listAccounts();
    expect(accounts.data).toHaveLength(1);
    const account = accounts.data?.[0];
    expect(account).toMatchObject({
      providerId: 'link',
      accountId: linkProfile.id,
      userId: linkUser?.id,
    });
    expect(account).not.toHaveProperty('accessToken');
    expect(account).not.toHaveProperty('refreshToken');
    await f.client.signOut();
    f.setProfile({ ...linkProfile, email: 'changed@example.com' });
    expect(
      (await f.complete(await f.startSignIn())).headers.get('location'),
    ).toBe('/done');
    expect((await f.client.getSession()).data?.user.id).toBe(linkUser?.id);
    expect((await f.client.listAccounts()).data).toEqual([
      expect.objectContaining({ id: account?.id, accountId: linkProfile.id }),
    ]);
    expect(f.database.prepare('select * from user').all()).toHaveLength(2);
  });

  it('uses native linking, PKCE, account storage, and token retrieval', async () => {
    const f = await fixture(strategy);
    const users = f.database.prepare('select * from user').all();
    const url = await f.start();
    expect(url.origin + url.pathname).toBe('https://login.link.com/auth');
    expect(url.searchParams.get('key')).toBe(credentials.publishableKey);
    expect(url.searchParams.get('scope')).toBe(
      'payment_methods.agentic userinfo:read',
    );
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/api/auth/callback/link',
    );
    expect(url.searchParams.has('client_secret')).toBe(false);
    expect((await f.complete(url)).headers.get('location')).toBe('/done');
    const exchange = f.fetchMock.mock.calls[0];
    expect(String(exchange?.[0])).toBe('https://login.link.com/auth/token');
    expect(new Headers(exchange?.[1]?.headers).get('authorization')).toBe(
      `Bearer ${credentials.publishableKey}`,
    );
    const body = new URLSearchParams(String(exchange?.[1]?.body));
    expect(body.get('client_id')).toBe(credentials.clientId);
    expect(body.get('client_secret')).toBe(credentials.clientSecret);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('redirect_uri')).toBe(url.searchParams.get('redirect_uri'));
    expect(
      createHash('sha256')
        .update(body.get('code_verifier') ?? '')
        .digest('base64url'),
    ).toBe(url.searchParams.get('code_challenge'));
    expect(f.database.prepare('select * from user').all()).toEqual(users);
    const account = f.database
      .prepare("select * from account where providerId = 'link'")
      .get();
    expect(account?.accountId).toBe(linkProfile.id);
    expect(account?.userId).toBe(f.userId);
    expect(account?.accessToken).not.toContain('access-one');
    expect(account?.refreshToken).not.toContain('refresh-one');
    const accountId = String(account?.id);
    expect(
      (await f.client.getAccessToken({ accountId })).data?.accessToken,
    ).toBe('access-one');
    expect(f.fetchMock).toHaveBeenCalledTimes(2);
    expect((await f.complete(url)).headers.get('location')).not.toBe('/done');
    expect(f.fetchMock).toHaveBeenCalledTimes(2);
    expect(
      f.database
        .prepare("select name from sqlite_master where name = 'linkConnection'")
        .get(),
    ).toBeUndefined();
  });

  it('uses a custom redirect URI for authorization and token exchange', async () => {
    const redirectURI = 'http://127.0.0.1:8787/callback';
    const f = await fixture(strategy, '/api/auth', { redirectURI });
    const url = await f.start();
    expect(url.searchParams.get('redirect_uri')).toBe(redirectURI);
    expect((await f.complete(url)).headers.get('location')).toBe('/done');
    const body = new URLSearchParams(
      String(f.fetchMock.mock.calls[0]?.[1]?.body),
    );
    expect(body.get('redirect_uri')).toBe(redirectURI);
    expect((await f.client.listAccounts()).data).toEqual(
      expect.arrayContaining([expect.objectContaining({ providerId: 'link' })]),
    );
  });

  it('rejects missing, mismatched, and expired state and handles denial', async () => {
    const f = await fixture(strategy);
    expect(
      (await f.request('/callback/link?code=code')).headers.get('location'),
    ).toContain('error=state_not_found');
    await f.start();
    expect(
      (await f.request('/callback/link?state=wrong&code=code')).headers.get(
        'location',
      ),
    ).toContain('error=state_mismatch');
    let url = await f.start();
    const denied = await f.request(
      `/callback/link?state=${url.searchParams.get('state')}&error=access_denied`,
    );
    expect(denied.headers.get('location')).toBe('/failed?error=access_denied');
    url = await f.start();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000);
    expect((await f.complete(url)).headers.get('location')).toContain(
      'error=state_mismatch',
    );
    expect(f.fetchMock).not.toHaveBeenCalled();
  });
});

it('requires app sign-in for explicit linking and preserves other social providers', async () => {
  const f = await fixture();
  expect(
    (
      await f.request(
        '/link-social',
        { provider: 'link', callbackURL: '/done' },
        new Cookies(),
      )
    ).status,
  ).toBe(401);
  const github = await f.client.signIn.social({
    provider: 'github',
    callbackURL: '/done',
  });
  expect(github.error).toBeNull();
  expect(github.data?.url).toContain('github.com');
});

it('signs in an existing app user through their linked Link account', async () => {
  const f = await fixture();
  const account = await f.connect();
  await f.client.signOut();
  expect(
    (await f.complete(await f.startSignIn())).headers.get('location'),
  ).toBe('/done');
  expect((await f.client.getSession()).data?.user.id).toBe(f.userId);
  expect((await f.client.listAccounts()).data).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: account.id })]),
  );
  expect(f.database.prepare('select * from user').all()).toHaveLength(1);
});

it('preserves Better Auth verification requirements when sign-in matches an unlinked app email', async () => {
  const f = await fixture();
  await f.client.signOut();
  f.setProfile({ ...linkProfile, email: 'app@example.com' });
  expect(
    (await f.complete(await f.startSignIn())).headers.get('location'),
  ).toBe('/failed?error=account_not_linked');
  expect((await f.client.getSession()).data).toBeNull();
  expect(f.database.prepare('select * from user').all()).toHaveLength(1);
  expect(
    f.database.prepare("select * from account where providerId = 'link'").all(),
  ).toHaveLength(0);
});

it.each([
  {
    profile: { ...linkProfile, id: undefined },
    error: 'unable_to_get_user_info',
  },
  { profile: { ...linkProfile, email: undefined }, error: 'email_not_found' },
])('rejects social sign-up with $error', async ({ profile, error }) => {
  const f = await fixture();
  await f.client.signOut();
  f.setProfile(profile);
  expect(
    (await f.complete(await f.startSignIn())).headers.get('location'),
  ).toBe(`/failed?error=${error}`);
  expect((await f.client.getSession()).data).toBeNull();
  expect(f.database.prepare('select * from user').all()).toHaveLength(1);
});

it('preserves Better Auth’s protection for the user’s only sign-in method', async () => {
  const f = await fixture();
  await f.client.signOut();
  expect(
    (await f.complete(await f.startSignIn())).headers.get('location'),
  ).toBe('/done');
  const accounts = await f.client.listAccounts();
  expect(accounts.data).toHaveLength(1);
  const accountId = accounts.data?.[0]?.id;
  if (!accountId) throw new Error('Expected a Link account');
  const callCount = f.fetchMock.mock.calls.length;
  expect((await f.client.unlinkAccount({ accountId })).error?.status).toBe(400);
  expect(f.fetchMock).toHaveBeenCalledTimes(callCount);
  expect((await f.client.listAccounts()).data).toHaveLength(1);
});

it.each([undefined, null, '', ' \t', 123, {}, []])(
  'rejects an invalid Link id (%j) without falling back to email',
  async (id) => {
    const f = await fixture();
    f.setProfile({ ...linkProfile, id });
    expect((await f.complete(await f.start())).headers.get('location')).toBe(
      '/failed?error=unable_to_get_user_info',
    );
    expect(
      f.database
        .prepare("select * from account where providerId = 'link'")
        .all(),
    ).toHaveLength(0);
  },
);

it('links by ID when email is absent and the app permits different emails', async () => {
  const f = await fixture();
  f.setProfile({ id: linkProfile.id, first_name: 'Link', last_name: 'User' });
  expect((await f.connect()).accountId).toBe(linkProfile.id);
});

it('keeps the same account when the Link email changes', async () => {
  const f = await fixture();
  const users = f.database.prepare('select * from user').all();
  const first = await f.connect();
  f.setProfile({ ...linkProfile, email: 'changed@example.com' });
  const reconnected = await f.connect();
  expect(reconnected.id).toBe(first.id);
  expect(reconnected.accountId).toBe(linkProfile.id);
  expect(
    f.database.prepare("select * from account where providerId = 'link'").all(),
  ).toHaveLength(1);
  expect(f.database.prepare('select * from user').all()).toEqual(users);
});

it('exposes the Link ID through accountInfo and preserves native account ownership', async () => {
  const f = await fixture();
  const account = await f.connect();
  const info = await f.client.accountInfo({ query: { accountId: account.id } });
  expect(info.error).toBeNull();
  expect(info.data).toMatchObject({
    account: { id: account.id, providerId: 'link', accountId: linkProfile.id },
    user: { email: linkProfile.email, name: 'Link User' },
    data: linkProfile,
  });
  expect(info.data?.account).not.toHaveProperty('accessToken');
  expect(info.data?.account).not.toHaveProperty('refreshToken');
  await f.signUp('other@example.com');
  expect(
    (await f.client.accountInfo({ query: { accountId: account.id } })).error,
  ).not.toBeNull();
});

it('prevents linking an existing Link ID to another app user even after an email change', async () => {
  const f = await fixture();
  const first = await f.connect();
  await f.signUp('other@example.com');
  f.setProfile({ ...linkProfile, email: 'other@example.com' });
  expect((await f.complete(await f.start())).headers.get('location')).toContain(
    'error=account_already_linked_to_different_user',
  );
  expect(
    f.database.prepare('select userId from account where id = ?').get(first.id)
      ?.userId,
  ).toBe(f.userId);
});

it('uses native refresh and background token access, retaining rotated refresh tokens', async () => {
  const f = await fixture();
  const account = await f.connect();
  const ctx = await f.auth.$context;
  await ctx.internalAdapter.updateAccount(account.id, {
    accessTokenExpiresAt: new Date(0),
  });
  f.fetchMock.mockResolvedValueOnce(
    Response.json({
      access_token: 'access-two',
      refresh_token: 'refresh-two',
      expires_in: 3600,
    }),
  );
  expect(
    (await f.client.getAccessToken({ accountId: account.id })).data
      ?.accessToken,
  ).toBe('access-two');
  const refresh = f.fetchMock.mock.lastCall;
  const body = new URLSearchParams(String(refresh?.[1]?.body));
  expect(body.get('grant_type')).toBe('refresh_token');
  expect(body.get('refresh_token')).toBe('refresh-one');
  expect(body.get('client_secret')).toBe(credentials.clientSecret);
  expect(new Headers(refresh?.[1]?.headers).get('authorization')).toBe(
    `Bearer ${credentials.publishableKey}`,
  );
  await ctx.internalAdapter.updateAccount(account.id, {
    accessTokenExpiresAt: new Date(0),
  });
  f.fetchMock.mockResolvedValueOnce(
    Response.json({
      access_token: 'access-three',
      refresh_token: 'refresh-three',
      expires_in: 3600,
    }),
  );
  expect(
    (await f.client.getAccessToken({ accountId: account.id })).data
      ?.accessToken,
  ).toBe('access-three');
  const rotatedBody = new URLSearchParams(
    String(f.fetchMock.mock.lastCall?.[1]?.body),
  );
  expect(rotatedBody.get('refresh_token')).toBe('refresh-two');
  await f.client.signOut();
  expect(
    await f.auth.api.getAccessToken({
      body: { accountId: account.id, userId: f.userId },
    }),
  ).toMatchObject({ accessToken: 'access-three' });
  expect(
    (
      await f.request(
        '/get-access-token',
        { accountId: account.id, userId: f.userId },
        new Cookies(),
      )
    ).status,
  ).toBe(401);
});

it('uses native unlinking with ownership checks and no provider requests', async () => {
  const f = await fixture();
  const account = await f.connect();
  await f.signUp('other@example.com');
  const callCount = f.fetchMock.mock.calls.length;
  expect(
    (await f.client.unlinkAccount({ accountId: account.id })).error,
  ).not.toBeNull();
  expect(f.fetchMock).toHaveBeenCalledTimes(callCount);
  await f.client.signIn.email({
    email: 'app@example.com',
    password: 'password123456',
  });
  expect(
    (await f.client.unlinkAccount({ accountId: account.id })).error,
  ).toBeNull();
  expect(f.fetchMock).toHaveBeenCalledTimes(callCount);
  expect(
    (await f.client.listAccounts()).data?.some((row) => row.id === account.id),
  ).toBe(false);
});

it('uses a custom base path and native redirect validation', async () => {
  const f = await fixture('database', '/custom/auth');
  const url = await f.start();
  expect(url.searchParams.get('redirect_uri')).toBe(
    'http://localhost:3000/custom/auth/callback/link',
  );
  expect((await f.complete(url)).headers.get('location')).toBe('/done');
  expect(
    (
      await f.client.linkSocial({
        provider: 'link',
        callbackURL: 'https://bad.example',
      })
    ).error?.status,
  ).toBe(403);
});

it('validates required credentials', () => {
  for (const field of ['clientId', 'clientSecret', 'publishableKey'] as const) {
    expect(() => link({ ...credentials, [field]: '' })).toThrow(
      `Link ${field} is required.`,
    );
  }
});
