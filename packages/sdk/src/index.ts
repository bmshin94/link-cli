export { default, Link } from './client';
export type { LinkOptions, LinkSdkLogger } from './config';
export {
  LinkApiError,
  LinkConfigurationError,
  LinkResponseError,
  LinkSdkError,
  LinkTransportError,
} from './errors';
export * from './resources/interfaces';
export * from './resources/attestations';
export * from './resources/credentials';
export {
  holderJwkThumbprint,
  holderJwksEqual,
  parseHolderPublicJwk,
} from './resources/holder-jwk';
export { getDuplicateSpendRequest } from './resources/spend-request';
export * from './types/index';
