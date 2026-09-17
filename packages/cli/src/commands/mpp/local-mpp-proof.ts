import { Proof as TempoProof } from 'mppx/tempo';
import {
  createLocalPrivyEthereumAccount,
  type LocalPrivyEnvironment,
} from './local-signed-transaction';
import type { IMppProofSigner, MppProof } from './pay';

export interface MppProofAccount {
  address: `0x${string}`;
  signTypedData(
    typedData: ReturnType<typeof TempoProof.typedData>,
  ): Promise<`0x${string}`>;
}

export async function signMppProofWithAccount(
  parameters: Parameters<IMppProofSigner['signMppProof']>[0],
  account: MppProofAccount,
): Promise<MppProof> {
  const { challenge, chainId } = parameters;
  const signature = await account.signTypedData(
    TempoProof.typedData({
      account: account.address,
      chainId,
      challengeId: challenge.id,
      realm: challenge.realm,
    }),
  );
  return {
    signature,
    source: TempoProof.proofSource({ address: account.address, chainId }),
  };
}

export class LocalPrivyMppProofSigner implements IMppProofSigner {
  constructor(private readonly env: LocalPrivyEnvironment = process.env) {}

  async signMppProof(
    parameters: Parameters<IMppProofSigner['signMppProof']>[0],
  ): Promise<MppProof> {
    const { account } = await createLocalPrivyEthereumAccount(this.env);
    return signMppProofWithAccount(parameters, account);
  }
}
