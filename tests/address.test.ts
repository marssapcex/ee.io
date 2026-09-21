import { describe, expect, it } from 'vitest';
import { bech32Decode } from '../shared/address';
import { requireAsset } from '../shared/assets';

/** Validation lives on the asset so the server and browser share one rule set. */
const check = (assetId: string, address: string) => requireAsset(assetId).validate(address);

/** Real mainnet addresses, used only as format fixtures. */
const VALID: Record<string, string[]> = {
  'ETH.ETHEREUM': [
    '0x8829C3516E8E67f5B6aC815F89a50aE68840a664', // ee.io default fee recipient
    '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', // vitalik.eth
    '0x111111125421ca6dc452d289314280a0f8842a65', // all-lowercase is legal
  ],
  'BTC.BITCOIN': [
    '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', // P2PKH, genesis
    '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', // P2SH
    'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', // P2WPKH
    'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297', // P2TR
  ],
  'LTC.LITECOIN': [
    'LM2WMpR1Rp6j3Sa59cMXMs1SPzj9eXpGc1',
    'ltc1qqufp62pn8ey4ghm2wkqgh94p4jmu9nwcdaln86', // checksum-verified P2WPKH
  ],
  'DOGE.DOGECOIN': ['DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L'],
  'SOL.SOLANA': ['7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', 'So11111111111111111111111111111111111111112'],
  'TRX.TRON': ['TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'],
  'XRP.RIPPLE': ['rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH'],
  'ATOM.COSMOS': ['cosmos1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu'],
};

const INVALID: Record<string, string[]> = {
  'ETH.ETHEREUM': [
    '0x8829C3516E8e67F5B6Ac815F89A50aE68840A66', // 39 nibbles
    '0x8829C3516E8e67F5B6Ac815F89A50aE68840A6644', // 41
    '8829C3516E8e67F5B6Ac815F89A50aE68840A664', // no 0x
    '0xZZ29C3516E8e67F5B6Ac815F89A50aE68840A664', // non-hex
    '0x0000000000000000000000000000000000000000', // burns funds
    '',
  ],
  'BTC.BITCOIN': [
    'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdx', // bad bech32 checksum
    '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb', // bad base58 checksum
    '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfN0', // '0' is not in the base58 alphabet
    'ltc1qqufp62pn8ey4ghm2wkqgh94p4jmu9nwcdaln86', // valid bech32, wrong chain hrp
  ],
  'SOL.SOLANA': [
    'IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII', // 'I' is not in the base58 alphabet
    '0x8829C3516E8e67F5B6Ac815F89A50aE68840A664',
    '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsUx', // 45 chars, over-long
  ],
  'TRX.TRON': ['TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u'],
};

describe('address validation', () => {
  for (const [assetId, addresses] of Object.entries(VALID)) {
    it(`accepts valid ${assetId} addresses`, () => {
      for (const address of addresses) {
        const result = check(assetId, address);
        expect(result.isValid, `${address} should be valid: ${result.message}`).toBe(true);
      }
    });
  }

  for (const [assetId, addresses] of Object.entries(INVALID)) {
    it(`rejects malformed ${assetId} addresses`, () => {
      for (const address of addresses) {
        expect(check(assetId, address).isValid, `${address} should be invalid`).toBe(false);
      }
    });
  }

  it('is checksum-aware for EVM without rejecting all-lowercase input', () => {
    // All-lowercase is unchecksummed but legal, and wallets emit it.
    expect(check('ETH.ETHEREUM', '0x8829c3516e8e67f5b6ac815f89a50ae68840a664').isValid).toBe(true);
    // Mixed case with a *wrong* checksum is a typo — flag it.
    const bad = check('ETH.ETHEREUM', '0x8829C3516E8E67f5B6aC815F89a50aE68840a665');
    expect(bad.isValid === false || Boolean(bad.warning)).toBe(true);
  });

  it('trims surrounding whitespace from pasted addresses', () => {
    expect(check('ETH.ETHEREUM', '  0x8829C3516E8E67f5B6aC815F89a50aE68840a664  ').isValid).toBe(
      true,
    );
  });

  it('rejects an address that is valid on a different chain', () => {
    // A Litecoin bech32 address passes bech32 decoding but has hrp "ltc".
    const result = check('BTC.BITCOIN', 'ltc1qqufp62pn8ey4ghm2wkqgh94p4jmu9nwcdaln86');
    expect(result.isValid).toBe(false);
  });

  it('returns an actionable message, never a bare boolean', () => {
    const result = check('BTC.BITCOIN', 'nonsense');
    expect(result.isValid).toBe(false);
    expect(result.message).toBeTruthy();
    expect(result.message!.length).toBeGreaterThan(8);
  });
});

/**
 * BIP-173 / BIP-350 conformance vectors, verbatim from the specifications.
 *
 * These caught two real defects in the decoder: it accepted strings up to 120
 * characters (the spec caps them at 90) and it allowed control characters in
 * the human-readable part.
 */
describe('bech32 conformance (BIP-173 / BIP-350)', () => {
  const VALID_STRINGS = [
    'A12UEL5L',
    'a12uel5l',
    'an83characterlonghumanreadablepartthatcontainsthenumber1andtheexcludedcharactersbio1tt5tgs',
    'abcdef1qpzry9x8gf2tvdw0s3jn54khce6mua7lmqqqxw',
    '11qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqc8247j',
    'split1checkupstagehandshakeupstreamerranterredcaperred2y9e3w',
    '?1ezyfcl',
  ];

  const INVALID_STRINGS: [string, string][] = [
    ['\x201nwldj5', 'HRP character out of range (space)'],
    ['\x7f1axkwrx', 'HRP character out of range (DEL)'],
    [
      'an84characterslonghumanreadablepartthatcontainsthenumber1andtheexcludedcharactersbio1569pvx',
      'exceeds 90 characters',
    ],
    ['pzry9x0s0muk', 'no separator'],
    ['1pzry9x0s0muk', 'empty HRP'],
    ['x1b4n0q5v', 'invalid data character'],
    ['li1dgmt3', 'checksum too short'],
    ['A1G7SGD8', 'checksum mismatch'],
    ['10a06t8', 'empty HRP'],
    ['1qzzfhee', 'empty HRP'],
  ];

  it.each(VALID_STRINGS)('accepts %s', (value) => {
    expect(bech32Decode(value)).not.toBeNull();
  });

  it.each(INVALID_STRINGS)('rejects %s — %s', (value) => {
    expect(bech32Decode(value)).toBeNull();
  });

  it('distinguishes bech32 from bech32m (segwit v0 vs v1+)', () => {
    // v0 P2WPKH uses bech32; v1 taproot uses bech32m. Confusing them lets a
    // user send to an address the network will not credit.
    expect(bech32Decode('BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4')?.variant).toBe('bech32');
    expect(
      bech32Decode('bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297')?.variant,
    ).toBe('bech32m');
  });

  it('rejects mixed-case strings, which are ambiguous', () => {
    expect(bech32Decode('bc1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4')).toBeNull();
  });
});
