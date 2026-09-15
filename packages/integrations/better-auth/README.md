# Link for Better Auth

Add Link social sign-in and sign-up to Better Auth, or connect a Link wallet to an existing app user. Link's stable user ID identifies the provider account; Better Auth manages sessions, OAuth state, PKCE, account ownership, token storage, and refresh.

## Setup

Requires Node.js 22+ and Better Auth 1.7.5+.

```sh
pnpm add @stripe/link-integrations-better-auth better-auth
```

[Register a confidential Link OAuth client](https://docs.stripe.com/agentic-commerce/link-cli/oauth) with the callback URL `https://yourapp.com/api/auth/callback/link`. Adjust `/api/auth` if you use a custom Better Auth base path. For local development, `http://localhost:3000/api/auth/callback/link` must be registered and explicitly allowed by Link as an HTTP loopback callback.

To override the callback URL, set `redirectURI` in `link(...)` and forward the OAuth response to Better Auth's `/api/auth/callback/link` handler. The override is used for both authorization and token exchange. The [local example](example/README.md) accepts this setting through `LINK_REDIRECT_URI`.

```ts
import { betterAuth } from 'better-auth';
import { link } from '@stripe/link-integrations-better-auth';

export const auth = betterAuth({
  account: {
    encryptOAuthTokens: true,
    accountLinking: {
      trustedProviders: ['link'],
      // The connected wallet may use a different email from the app login.
      allowDifferentEmails: true,
    },
  },
  plugins: [
    link({
      clientId: process.env.LINK_CLIENT_ID!,
      clientSecret: process.env.LINK_CLIENT_SECRET!,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY!,
    }),
  ],
});
```

Use the standard Better Auth client with `provider: 'link'`. Better Auth's normal account-linking and email-verification policies apply. Omit `allowDifferentEmails` if explicit linking must require matching emails. Keep client credentials and OAuth token access on the server.

## Sign in with Link

```ts
await authClient.signIn.social({
  provider: 'link',
  callbackURL: '/dashboard',
  errorCallbackURL: '/sign-in',
});
```

On first sign-in, Better Auth creates an app user from Link's profile, stores the Link account, and issues a session. Later sign-ins recognize the same stable Link ID, including accounts previously connected with `linkSocial`. Social sign-in requires both `id` and `email` in the provider response.

If an email/password account already exists but is not linked to Link, Better Auth applies its normal verification requirements before automatically linking by email. Users can instead sign in with their existing method and explicitly connect Link with `linkSocial`.

## Account identity

The plugin requires a nonempty string `id` from Link's `/userinfo` response and uses it as Better Auth's provider account subject. It preserves the ID exactly and never falls back to email. Changing a Link email preserves the linked account.

| Field | Meaning |
| --- | --- |
| `user.id` | Your app's Better Auth user ID. |
| `account.id` | Better Auth's account record ID; pass this to account operations. |
| `account.accountId` | The stable Link user ID returned by `/userinfo.id`. |
| `accountInfo.data.id` | The Link user ID in the fresh provider response. |

Earlier versions used email as `account.accountId`. Before using Link social sign-in for those connections, migrate them or disconnect and reconnect while signed in to the existing app user. To retain existing grants, migrate each account using the ID returned by its authenticated `/userinfo` request, preserving its Better Auth account record ID and app user ID. Never infer this mapping from email or merge accounts across users.

## Connect Link to an existing user

Use your existing Better Auth client. After the user signs in to your application:

```ts
await authClient.linkSocial({
  provider: 'link',
  callbackURL: '/settings',
});
```

Use the account record's `id` for subsequent operations:

```ts
const { data: accounts, error } = await authClient.listAccounts();
if (error) throw new Error(error.message);
const account = accounts?.find((account) => account.providerId === 'link');
if (!account) throw new Error('Connect Link first.');

const { data: info, error: profileError } = await authClient.accountInfo({
  query: { accountId: account.id },
});
if (profileError) throw new Error(profileError.message);

console.log(account.accountId); // Stable Link user ID.
console.log(info?.data); // Raw Link userinfo, including id.
console.log(info?.user); // Mapped name, email, and other Better Auth user fields.

// When the user chooses to disconnect:
await authClient.unlinkAccount({ accountId: account.id });
```

`accountInfo` fetches a fresh profile and refreshes expired access tokens through Better Auth. For server-side Link API calls, use `auth.api.getAccessToken` with authenticated request headers, or a trusted app user ID for background work. Do not accept an arbitrary client-supplied user ID.

`unlinkAccount` uses Better Auth's native behavior: it removes the local account connection and stored tokens, without revoking the grant at Link. Better Auth enforces account ownership, requires a fresh session, and prevents unlinking the user's only sign-in method by default.

The default scopes are `payment_methods.agentic` and `userinfo:read`. For sign-in and profile access only, configure `scopes: ['userinfo:read']`. If you override `scopes`, include `userinfo:read` so the plugin can retrieve the Link identity.

## Local Next.js example

See [example/](example/README.md) for a runnable Next.js app with Link and email/password
sign-in, SQLite, and Link account management. Set the required credentials in the example's
`.env.local` first, then run from the repository root:

```sh
pnpm --dir packages/integrations/better-auth/example dev
```
