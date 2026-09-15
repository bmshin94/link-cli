import { LinkApiError } from '@stripe/link-sdk';
import { WALLET_URL } from '../payment-methods/add';

const BILLING_DETAILS_PREFIX = 'payment_method[billing_details]';

const BILLING_FIELD_LABELS: Record<string, string> = {
  '[name]': 'billing name',
  '[email]': 'billing email',
  '[phone]': 'billing phone number',
  '[address]': 'billing address',
  '[address][line1]': 'street address (line 1)',
  '[address][line2]': 'street address (line 2)',
  '[address][city]': 'billing address city',
  '[address][state]': 'billing address state',
  '[address][postal_code]': 'billing address postal code',
  '[address][country]': 'billing address country',
};

export interface UcpCheckoutError {
  message: string;
  missingBillingDetails: boolean;
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return JSON.stringify(error) ?? String(error);
}

function getMissingBillingDetailsParam(error: LinkApiError): string | null {
  if (error.status !== 400) return null;

  const details = error.details as {
    error?: { code?: unknown; param?: unknown };
  };
  const structuredParam = details?.error?.param;
  if (
    typeof structuredParam === 'string' &&
    (structuredParam === BILLING_DETAILS_PREFIX ||
      structuredParam.startsWith(`${BILLING_DETAILS_PREFIX}[`)) &&
    (details?.error?.code === 'parameter_missing' ||
      /Missing required param:/i.test(error.message))
  ) {
    return structuredParam;
  }

  const match = error.message.match(
    /Missing required param:\s*(payment_method\[billing_details\](?:\[[^\]]+\])+)/i,
  );
  return match?.[1] ?? null;
}

export function formatUcpCheckoutError(error: unknown): UcpCheckoutError {
  if (!(error instanceof LinkApiError)) {
    return { message: stringifyError(error), missingBillingDetails: false };
  }

  const param = getMissingBillingDetailsParam(error);
  if (!param) {
    return { message: error.message, missingBillingDetails: false };
  }

  const suffix = param.slice(BILLING_DETAILS_PREFIX.length);
  const field = BILLING_FIELD_LABELS[suffix] ?? 'billing information';
  return {
    message: `The selected card is missing a required billing detail: ${field}. Update or replace it in Link Wallet at ${WALLET_URL}, then create a new spend request and retry checkout.`,
    missingBillingDetails: true,
  };
}
