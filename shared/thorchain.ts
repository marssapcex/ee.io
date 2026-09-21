/**
 * THORChain memo construction.
 *
 * Reference: https://dev.thorchain.org/concepts/memos.html#swap
 *
 *     SWAP:ASSET:DESTADDR:LIM/INTERVAL/QUANTITY:AFFILIATE:FEE
 *
 * Three corrections versus the naive version of this builder:
 *
 *  1. The 4th field is LIM — a *minimum output* (trade limit) that triggers a
 *     refund if unmet. It is NOT "the amount the user receives". Putting the
 *     expected output there makes any adverse price move refund the swap.
 *
 *  2. All amounts in THORChain memos are 1e8 regardless of the asset's native
 *     decimals. ETH (18dp) and BTC (8dp) both express amounts in 1e8 here.
 *
 *  3. The affiliate fee is *deducted by the protocol* and accrued in the
 *     AffiliateCollector module — paid out in RUNE (or the THORName's
 *     preferred asset) once it crosses a threshold. It is not a second
 *     outbound transfer of the destination asset in the same block.
 *     https://dev.thorchain.org/affiliate-guide/affiliate-fee-guide.html
 *
 * Memos are capped at 250 bytes by the network, and further capped at 80 bytes
 * by Bitcoin's OP_RETURN, so the builder also produces a shortened variant.
 */

export const THORCHAIN_MEMO_MAX_BYTES = 250;
export const OP_RETURN_MAX_BYTES = 80;
/** Total affiliate fee across all affiliates may not exceed 1000 bps (10%). */
export const THORCHAIN_MAX_AFFILIATE_BPS = 1000;

/** Single-letter aliases the state machine accepts for native assets. */
export const THORCHAIN_ASSET_SHORTHAND: Record<string, string> = {
  'THOR.RUNE': 'r',
  'AVAX.AVAX': 'a',
  'BTC.BTC': 'b',
  'BCH.BCH': 'c',
  'DOGE.DOGE': 'd',
  'ETH.ETH': 'e',
  'BASE.ETH': 'f',
  'GAIA.ATOM': 'g',
  'LTC.LTC': 'l',
  'POL.POL': 'p',
  'BSC.BNB': 's',
  'TRON.TRX': 'tr',
  'XRP.XRP': 'x',
};

export interface ThorchainAffiliate {
  /** THORName (preferred, short) or a thor1… address. */
  name: string;
  bps: number;
}

export interface SwapMemoParams {
  /** Destination asset in THORChain notation, e.g. "ETH.ETH". */
  asset: string;
  destination: string;
  /** Minimum acceptable output in 1e8 base units. 0n disables the limit. */
  limit1e8?: bigint;
  /** Streaming swap block interval. 0 = network-chosen rapid streaming. */
  streamingInterval?: number;
  /** Streaming sub-swap count. 0 = network decides. */
  streamingQuantity?: number;
  affiliates?: ThorchainAffiliate[];
  /** Emit abbreviated asset names + scientific notation to fit OP_RETURN. */
  compact?: boolean;
}

/**
 * Compress an integer to THORChain's memo scientific notation, keeping
 * `significantDigits` of precision. Always rounds DOWN so the limit stays
 * achievable — rounding up would refund swaps that should have filled.
 *
 * ⚠ The official docs contain an arithmetic error worth knowing about.
 * memo-length-reduction.html states the decoding rule as `NeM` == N x 10^M
 * ("In memo: 1e8 -> THORChain reads: 100000000", "51e7 -> 510000000"), which
 * is what THORNode implements. But the same page's two headline examples claim
 * 1612345678 reduces to `161e6` and 10012345678 to `100e7` — both decode to
 * one tenth of the intended value.
 *
 * We follow the stated rule (1612345678 -> `161e7`). Emitting the doc's `161e6`
 * would set a trade limit 10x below the intended floor, silently disabling the
 * user's slippage protection on every streaming swap.
 */
export function toScientificNotation(value: bigint, significantDigits = 3): string {
  if (value <= 0n) return '0';
  const digits = value.toString();
  if (digits.length <= significantDigits) return digits;

  const exponent = digits.length - significantDigits;
  const mantissa = digits.slice(0, significantDigits).replace(/0+$/, '');
  if (mantissa === '') return '0';

  const droppedZeros = significantDigits - mantissa.length;
  return `${mantissa}e${exponent + droppedZeros}`;
}

export function shortenAsset(asset: string, compact: boolean): string {
  if (!compact) return asset;
  const shorthand = THORCHAIN_ASSET_SHORTHAND[asset.toUpperCase()];
  if (shorthand) return shorthand;

  // ETH.USDT-0xdac1…ec7 → ETH.USDT-ec7 (fuzzy matching resolves the rest;
  // ties are broken by pool depth, per the docs).
  const match = asset.match(/^([A-Z]+)\.([A-Z0-9]+)-0x([0-9a-fA-F]+)$/i);
  if (match) return `${match[1]}.${match[2]}-${match[3].slice(-3)}`;
  return asset;
}

export function buildSwapMemo(params: SwapMemoParams): string {
  const {
    asset,
    destination,
    limit1e8 = 0n,
    streamingInterval,
    streamingQuantity,
    affiliates = [],
    compact = false,
  } = params;

  const totalBps = affiliates.reduce((sum, a) => sum + a.bps, 0);
  if (totalBps > THORCHAIN_MAX_AFFILIATE_BPS) {
    throw new Error(
      `THORChain rejects affiliate fees above ${THORCHAIN_MAX_AFFILIATE_BPS} bps (got ${totalBps})`,
    );
  }

  const assetField = shortenAsset(asset, compact);

  // Field 4 packs LIM/INTERVAL/QUANTITY. Emit the shortest valid form.
  let limitField = '';
  const hasStreaming = streamingInterval !== undefined || streamingQuantity !== undefined;
  const limitStr =
    limit1e8 > 0n ? (compact ? toScientificNotation(limit1e8) : limit1e8.toString()) : '0';

  if (hasStreaming) {
    limitField = `${limitStr}/${streamingInterval ?? 0}/${streamingQuantity ?? 0}`;
  } else if (limit1e8 > 0n) {
    limitField = limitStr;
  }

  const parts = ['=', assetField, destination, limitField];

  if (affiliates.length > 0) {
    parts.push(affiliates.map((a) => a.name).join('/'));
    const allSame = affiliates.every((a) => a.bps === affiliates[0].bps);
    parts.push(allSame ? String(affiliates[0].bps) : affiliates.map((a) => a.bps).join('/'));
  }

  // Trailing empty optional fields add bytes for nothing.
  while (parts.length > 3 && parts[parts.length - 1] === '') parts.pop();

  return parts.join(':');
}

export function memoByteLength(memo: string): number {
  return new TextEncoder().encode(memo).length;
}

export interface MemoFitResult {
  memo: string;
  bytes: number;
  fitsOpReturn: boolean;
  fitsThorchain: boolean;
  /** True when the compact encoding was needed. */
  compacted: boolean;
  warning?: string;
}

/**
 * Build the memo, falling back to the compact encoding when the full form is
 * too long for the source chain's memo field.
 */
export function buildSwapMemoForChain(
  params: SwapMemoParams,
  sourceChainKind: 'utxo' | 'other',
): MemoFitResult {
  const limit = sourceChainKind === 'utxo' ? OP_RETURN_MAX_BYTES : THORCHAIN_MEMO_MAX_BYTES;

  const full = buildSwapMemo({ ...params, compact: false });
  if (memoByteLength(full) <= limit) {
    return {
      memo: full,
      bytes: memoByteLength(full),
      fitsOpReturn: memoByteLength(full) <= OP_RETURN_MAX_BYTES,
      fitsThorchain: true,
      compacted: false,
    };
  }

  const compact = buildSwapMemo({ ...params, compact: true });
  const bytes = memoByteLength(compact);
  return {
    memo: compact,
    bytes,
    fitsOpReturn: bytes <= OP_RETURN_MAX_BYTES,
    fitsThorchain: bytes <= THORCHAIN_MEMO_MAX_BYTES,
    compacted: true,
    warning:
      bytes > limit
        ? `Memo is ${bytes} bytes but this chain allows ${limit}. Register a THORName for the ` +
          `affiliate and use a reference memo: https://dev.thorchain.org/swap-guide/memoless-swaps.html`
        : undefined,
  };
}

/** Parse a memo back into its fields — used by the inspector to prove intent. */
export function parseSwapMemo(memo: string): {
  function: string;
  asset: string;
  destination: string;
  limit?: string;
  streamingInterval?: string;
  streamingQuantity?: string;
  affiliates?: string[];
  affiliateBps?: string[];
} | null {
  const parts = memo.split(':');
  if (parts.length < 3) return null;

  const [fn, asset, destination, limitField, affiliateField, feeField] = parts;
  const [limit, streamingInterval, streamingQuantity] = (limitField ?? '').split('/');

  return {
    function: fn,
    asset,
    destination,
    limit: limit || undefined,
    streamingInterval,
    streamingQuantity,
    affiliates: affiliateField ? affiliateField.split('/') : undefined,
    affiliateBps: feeField ? feeField.split('/') : undefined,
  };
}

/** THORChain expresses every amount in 1e8, independent of native decimals. */
export function toThorchain1e8(amount: bigint, decimals: number): bigint {
  if (decimals === 8) return amount;
  if (decimals > 8) return amount / 10n ** BigInt(decimals - 8);
  return amount * 10n ** BigInt(8 - decimals);
}

export function fromThorchain1e8(amount1e8: bigint, decimals: number): bigint {
  if (decimals === 8) return amount1e8;
  if (decimals > 8) return amount1e8 * 10n ** BigInt(decimals - 8);
  return amount1e8 / 10n ** BigInt(8 - decimals);
}
