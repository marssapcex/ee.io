/**
 * Runtime configuration.
 *
 * Fee recipients and API keys come from the environment so the operator's
 * revenue address is never hard-coded into the client bundle.
 */

import { isHexAddress, toChecksumAddress } from '../shared/address.js';
import type { FeePolicy } from '../shared/types.js';

/** Default affiliate fees: 0.5% on float orders, 1.0% on fixed-rate orders. */
export const DEFAULT_FLOAT_BPS = 50;
export const DEFAULT_FIXED_BPS = 100;

/**
 * The fixed-rate premium is not arbitrary: quoting a guaranteed rate for the
 * lifetime of a deposit window is a short option on the pair's volatility.
 * The extra 50 bps is what pays for that risk.
 */
export const FIXED_RATE_WINDOW_SECONDS = 600;
export const FLOAT_RATE_WINDOW_SECONDS = 120;

function readAddress(key: string, fallback: string): string {
  const value = process.env[key]?.trim();
  if (!value) return fallback;
  if (!isHexAddress(value)) {
    console.warn(`[config] ${key}="${value}" is not a valid EVM address; using default`);
    return fallback;
  }
  return toChecksumAddress(value);
}

/**
 * Placeholder revenue address. An operator MUST override this via
 * EE_FEE_RECIPIENT_EVM before taking real volume.
 *
 * Stored lowercase and normalised through toChecksumAddress() at load time.
 * The literal originally pasted into the spec —
 * 0x8829C3516E8e67F5B6Ac815F89A50aE68840A664 — carries an *invalid* EIP-55
 * checksum (the correct mixed case is 0x8829C3516E8E67f5B6aC815F89a50aE68840a664).
 * The bytes are identical, but strict integrators reject the malformed casing,
 * so we never hand the raw literal to an upstream API.
 */
const PLACEHOLDER_EVM = toChecksumAddress('0x8829c3516e8e67f5b6ac815f89a50ae68840a664');

export function loadFeePolicy(): FeePolicy {
  return {
    floatBps: Number(process.env.EE_FLOAT_FEE_BPS ?? DEFAULT_FLOAT_BPS),
    fixedBps: Number(process.env.EE_FIXED_FEE_BPS ?? DEFAULT_FIXED_BPS),
    recipients: {
      evm: readAddress('EE_FEE_RECIPIENT_EVM', PLACEHOLDER_EVM),
      solana: process.env.EE_FEE_RECIPIENT_SOLANA?.trim() || undefined,
      // A THORName is strongly preferred over a raw thor1 address: it is
      // shorter in the memo and enables preferred-asset payouts.
      thorchain: process.env.EE_THORNAME?.trim() || undefined,
    },
    clientId: process.env.EE_CLIENT_ID ?? 'ee-io',
    chargeOn: (process.env.EE_FEE_SIDE as 'input' | 'output') ?? 'output',
  };
}

export interface ProviderCredentials {
  zeroEx: boolean;
  oneInch: boolean;
  openOcean: boolean;
  jupiter: boolean;
  /** KyberSwap, ParaSwap and THORChain need no key. */
  keyless: string[];
}

export function credentialStatus(): ProviderCredentials {
  return {
    // These two refuse anonymous traffic outright — no key, no quote.
    zeroEx: Boolean(process.env.ZEROX_API_KEY),
    oneInch: Boolean(process.env.ONEINCH_API_KEY),
    // Keys are accepted (higher rate limits) but not required.
    openOcean: true,
    jupiter: true,
    /**
     * Providers that serve a usable public tier with no API key. A key raises
     * the rate limit for OpenOcean and Jupiter but is never mandatory, so they
     * belong here too — the UI reads this list to decide whether a router is
     * reachable or merely unconfigured.
     */
    keyless: ['kyberswap', 'paraswap', 'thorchain', 'openocean', 'jupiter'],
  };
}

export function isPlaceholderRecipient(policy: FeePolicy): boolean {
  return policy.recipients.evm.toLowerCase() === PLACEHOLDER_EVM.toLowerCase();
}

export const QUOTE_DEADLINE_MS = Number(process.env.EE_QUOTE_DEADLINE_MS ?? 7000);

/** Allow the operator to force simulation (useful for demos and CI). */
export const FORCE_SIMULATION = process.env.EE_FORCE_SIMULATION === '1';
