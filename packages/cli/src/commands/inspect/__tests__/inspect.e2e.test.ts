import { describe, expect, it, vi } from 'vitest';
import { localDirectoryId } from '../directory';
import { runInspect } from '../inspect';

const ORIGIN = 'https://myheadlessmerchant.com';
const CHECKOUT = `${ORIGIN}/checkout`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html' },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function notFound(): Response {
  return new Response('not found', { status: 404 });
}

/**
 * In-process fake of myheadlessmerchant.com: one fetch router that serves
 * every inspect probe path (OpenAPI MPP, x402, UCP, HTML/LPT, MCP, llms.txt,
 * provisioning copy).
 */
function fakeHeadlessMerchant(): typeof fetch {
  const routes: Record<string, () => Response> = {
    [`${ORIGIN}/api/openapi.json`]: () =>
      jsonResponse({
        openapi: '3.1.0',
        info: {
          title: 'Headless Merchant API',
          version: '1.0.0',
          description: 'Pay-per-call catalog for headless checkout.',
        },
        paths: {
          '/api/orders': {
            post: {
              operationId: 'createOrder',
              summary: 'Create an order',
              description: 'Pay with MPP to create an order',
              'x-payment-info': {
                offers: [
                  {
                    method: 'stripe',
                    intent: 'charge',
                    amount: '2500',
                    currency: 'usd',
                  },
                ],
              },
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      required: ['sku'],
                      properties: { sku: { type: 'string' } },
                    },
                  },
                },
              },
              responses: { 200: { description: 'ok' } },
            },
          },
        },
      }),
    [`${ORIGIN}/.well-known/x402.json`]: () =>
      jsonResponse({
        x402Version: 1,
        accepts: [{ scheme: 'exact', network: 'stripe' }],
      }),
    [`${ORIGIN}/.well-known/ucp`]: () =>
      jsonResponse({
        ucp: {
          version: '2026-04-08',
          merchant: 'Headless Merchant',
          description:
            'A test merchant that exposes every agent checkout path.',
          services: {
            'dev.ucp.shopping': [
              {
                version: '2026-04-08',
                transport: 'mcp',
                endpoint: `${ORIGIN}/api/ucp/mcp`,
              },
              {
                version: '2026-04-08',
                transport: 'rest',
                endpoint: `${ORIGIN}/api/ucp`,
              },
            ],
          },
          capabilities: {
            'dev.ucp.shopping.checkout': [{ version: '2026-04-08' }],
          },
        },
      }),
    [CHECKOUT]: () =>
      htmlResponse(`<!doctype html>
<html>
  <body>
    <h1>Checkout</h1>
    <div class="AiAgentPaymentSteering">I am an AI agent</div>
    <p>Agents can also run stripe provision headlessmerchant</p>
  </body>
</html>`),
    [`${ORIGIN}/.well-known/mcp.json`]: () =>
      jsonResponse({
        name: 'headless-mcp',
        description: 'Official Headless Merchant MCP',
        remotes: [{ url: `${ORIGIN}/mcp` }],
      }),
    [`${ORIGIN}/llms.txt`]: () =>
      textResponse(`# Headless Merchant Docs

> Agent-readable docs for Headless Merchant.

## MCP

- [Agents MCP](${ORIGIN}/agents/mcp)

Provision with \`stripe provision headlessmerchant\`.
`),
  };

  return vi.fn(async (input: string | URL) => {
    const url = input.toString();
    const handler = routes[url];
    return handler ? handler() : notFound();
  }) as unknown as typeof fetch;
}

describe('inspect fake merchant end-to-end', () => {
  it('returns a Directory object populated from every probe path', async () => {
    const fetchImpl = fakeHeadlessMerchant();

    const result = await runInspect(CHECKOUT, { fetchImpl });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('null');
    expect(serialized).not.toMatch(/:\[\]/);
    expect(result).not.toHaveProperty('profile_id');
    expect(result).not.toHaveProperty('username');

    expect(result).toEqual({
      id: localDirectoryId(ORIGIN),
      display_name: 'Headless Merchant',
      description: 'A test merchant that exposes every agent checkout path.',
      url: ORIGIN,
      llms_txt: [`${ORIGIN}/llms.txt`],
      available_tools: {
        machine_payments: [
          {
            command: `mppx '${ORIGIN}/api/orders'`,
            description: 'Pay with MPP to create an order (stripe)',
            url: `${ORIGIN}/api/orders`,
          },
        ],
        mcp: [
          {
            command: `'${ORIGIN}/api/ucp/mcp'`,
            description: 'Use MCP for dev.ucp.shopping',
            url: `${ORIGIN}/api/ucp/mcp`,
          },
          {
            command: `'${ORIGIN}/mcp'`,
            description: 'Official Headless Merchant MCP',
            url: `${ORIGIN}/mcp`,
          },
          {
            command: `'${ORIGIN}/agents/mcp'`,
            description: 'Use MCP to Agents MCP',
            url: `${ORIGIN}/agents/mcp`,
          },
        ],
        provisioning: [
          {
            command: "stripe provision 'headlessmerchant'",
            description: 'Provision this service using the provisioning API',
          },
        ],
        browser_checkout: {
          merchant_advice:
            'Merchant publishes a UCP profile — use the Universal Commerce Protocol for catalog, cart, and checkout. Checkout includes an AI-agent steering block. Create a card spend request and complete the Link Pay Token flow (enable "I am an AI agent" and inject the token from spend-request retrieve --include link_pay_token).',
          general_advice:
            'Create a Link spend request with the default card credential type, get it approved, then enter the returned card details into the site checkout form.',
        },
      },
    });

    const requested = (
      fetchImpl as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.map(([input]) => input.toString());
    expect(requested).toEqual(
      expect.arrayContaining([
        `${ORIGIN}/api/openapi.json`,
        `${ORIGIN}/.well-known/x402.json`,
        `${ORIGIN}/.well-known/ucp`,
        CHECKOUT,
        `${ORIGIN}/.well-known/mcp.json`,
        `${ORIGIN}/llms.txt`,
      ]),
    );
    // OpenAPI already declared stripe, so inspect must not live-probe /api/orders.
    expect(requested).not.toContain(`${ORIGIN}/api/orders`);
  });
});
