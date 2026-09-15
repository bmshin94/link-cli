import { LinkApiError } from '@stripe/link-sdk';
import { describe, expect, it } from 'vitest';
import { formatUcpCheckoutError } from '../checkout-error';

function apiError(
  message: string,
  options: { status?: number; param?: string } = {},
) {
  return new LinkApiError(message, {
    status: options.status ?? 400,
    details: options.param
      ? { error: { code: 'parameter_missing', param: options.param } }
      : undefined,
  });
}

describe('formatUcpCheckoutError', () => {
  it('formats a structured missing billing address parameter', () => {
    const result = formatUcpCheckoutError(
      apiError('Missing required param', {
        param: 'payment_method[billing_details][address][line1]',
      }),
    );

    expect(result.missingBillingDetails).toBe(true);
    expect(result.message).toContain('street address (line 1)');
    expect(result.message).toContain('https://app.link.com/wallet');
    expect(result.message).toContain('create a new spend request');
  });

  it('extracts a missing billing parameter from the API message', () => {
    const result = formatUcpCheckoutError(
      apiError(
        'Failed to complete UCP checkout (400): Missing required param: payment_method[billing_details][address][city].',
      ),
    );

    expect(result.missingBillingDetails).toBe(true);
    expect(result.message).toContain('billing address city');
  });

  it('uses a generic label for an unknown billing field', () => {
    const result = formatUcpCheckoutError(
      apiError('Missing required param', {
        param: 'payment_method[billing_details][address][district]',
      }),
    );

    expect(result.missingBillingDetails).toBe(true);
    expect(result.message).toContain('billing information');
  });

  it('leaves unrelated API errors unchanged', () => {
    const error = apiError(
      'Failed to complete UCP checkout (402): Your card was declined.',
      { status: 402 },
    );

    expect(formatUcpCheckoutError(error)).toEqual({
      message: error.message,
      missingBillingDetails: false,
    });
  });

  it('leaves missing non-billing parameters unchanged', () => {
    const error = apiError(
      'Failed to complete UCP checkout (400): Missing required param: payment_method[type].',
      { param: 'payment_method[type]' },
    );

    expect(formatUcpCheckoutError(error)).toEqual({
      message: error.message,
      missingBillingDetails: false,
    });
  });

  it('does not treat other billing parameter errors as missing details', () => {
    const error = new LinkApiError(
      'Failed to complete UCP checkout (400): Invalid billing address.',
      {
        status: 400,
        details: {
          error: {
            code: 'parameter_invalid',
            param: 'payment_method[billing_details][address][line1]',
          },
        },
      },
    );

    expect(formatUcpCheckoutError(error)).toEqual({
      message: error.message,
      missingBillingDetails: false,
    });
  });
});
