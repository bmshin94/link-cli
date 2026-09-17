import { Proof as TempoProof } from 'mppx/tempo';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it, vi } from 'vitest';
import { signMppProofWithAccount } from './local-mpp-proof';

describe('local MPP proof signing', () => {
  it('signs the canonical wallet-bound Tempo proof', async () => {
    const account = privateKeyToAccount(
      '0x0000000000000000000000000000000000000000000000000000000000000001',
    );
    const signTypedData = vi.spyOn(account, 'signTypedData');
    const challenge = {
      id: 'proof_001',
      realm: 'merchant.example',
      method: 'tempo',
      intent: 'charge',
      request: {
        amount: '0',
        currency: '0x20C000000000000000000000000b9537d11c60E8b50',
        methodDetails: { chainId: 4217 },
      },
    } as const;

    const proof = await signMppProofWithAccount(
      { challenge, chainId: 4217 },
      account,
    );

    expect(signTypedData).toHaveBeenCalledWith(
      TempoProof.typedData({
        account: account.address,
        chainId: 4217,
        challengeId: 'proof_001',
        realm: 'merchant.example',
      }),
    );
    expect(proof.signature).toMatch(/^0x[0-9a-f]{130}$/i);
    expect(proof.source).toBe(`did:pkh:eip155:4217:${account.address}`);
  });
});
