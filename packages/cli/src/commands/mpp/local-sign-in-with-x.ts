import {
  createSIWxPayload,
  encodeSIWxHeader,
  type SIWxSigner,
  validateSIWxMessage,
} from '@x402/extensions/sign-in-with-x';
import { createLocalPrivyEthereumAccount } from './local-signed-transaction';
import type {
  ISignInWithXCredentialResource,
  SignInWithXChallenge,
} from './sign-in-with-x';

export class LocalPrivySignInWithXResource
  implements ISignInWithXCredentialResource
{
  async createCredential(
    challenge: SignInWithXChallenge,
    requestUrl: string,
  ): Promise<string> {
    const { account } = await createLocalPrivyEthereumAccount();
    return createSignInWithXCredential(challenge, requestUrl, account);
  }
}

export async function createSignInWithXCredential(
  challenge: SignInWithXChallenge,
  requestUrl: string,
  signer: SIWxSigner,
): Promise<string> {
  const matchingChain = challenge.supportedChains.find(
    (chain) => chain.type === 'eip191' && chain.chainId.startsWith('eip155:'),
  );
  if (!matchingChain) {
    throw new Error(
      'SIWX challenge does not support an EIP-191 Ethereum signature',
    );
  }

  const challengeUri = new URL(challenge.info.uri);
  if (challengeUri.href !== new URL(requestUrl).href) {
    throw new Error(
      `SIWX challenge URI "${challengeUri.href}" does not match request URL "${requestUrl}"`,
    );
  }

  const payload = await createSIWxPayload(
    {
      ...challenge.info,
      chainId: matchingChain.chainId,
      type: matchingChain.type,
      signatureScheme: matchingChain.signatureScheme,
    },
    signer,
    requestUrl,
  );
  const validation = await validateSIWxMessage(payload, new URL(requestUrl));
  if (!validation.isValid) {
    throw new Error(
      `Invalid SIWX challenge: ${validation.invalidMessage} (${validation.invalidReason})`,
    );
  }
  return encodeSIWxHeader(payload);
}
