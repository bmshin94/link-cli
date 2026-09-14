export { default, Link } from './client';
export type { LinkOptions, LinkSdkLogger } from './config';
export {
  LinkApiError,
  LinkConfigurationError,
  LinkResponseError,
  LinkSdkError,
  LinkTransportError,
} from './errors';
export * from './types/index';
export * from './resources/interfaces';
export * from './resources/attestations';
export {
  computeChallengeDigest,
  encodeStableTokenChallenge,
  parseFinalToken,
} from './resources/attestations-crypto';
export * from './resources/credentials';
export {
  holderJwkThumbprint,
  holderJwksEqual,
  parseHolderPublicJwk,
} from './resources/holder-jwk';
export {
  assemblePresentation,
  claimReferenceKey,
  prepareKbJwt,
  selectDisclosures,
  verifyAssembledPresentation,
} from './resources/sd-jwt-kb';
export type {
  ClaimPathComponent,
  ClaimReference,
  DisclosureSelection,
  HolderSigner,
  KbJwtAlgorithm,
  PreparedKbJwt,
} from './resources/sd-jwt-kb';
export { getDuplicateSpendRequest } from './resources/spend-request';
