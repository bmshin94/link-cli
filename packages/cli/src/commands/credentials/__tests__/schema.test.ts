import { describe, expect, it } from 'vitest';
import { getOptions } from '../schema';

describe('credential options', () => {
  it('exposes only the external public key override', () => {
    expect(Object.keys(getOptions.shape)).toEqual(['publicKeyFile']);
    expect(getOptions.shape).not.toHaveProperty('accessToken');
    expect(getOptions.shape).not.toHaveProperty('keyFile');
    expect(getOptions.shape).not.toHaveProperty('outputFile');
  });
});
