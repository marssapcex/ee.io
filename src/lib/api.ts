/**
 * Browser API client.
 *
 * All requests go to relative /api/* URLs so they work through the dev-server
 * proxy and behind any reverse proxy in production. The browser never talks to
 * an aggregator directly (keys + CORS) and never to localhost.
 */

import type {
  ExecutionPlan,
  OrderRecord,
  QuoteRequest,
  QuoteResponse,
} from '../../shared/types';
import type { AddressValidation } from '../../shared/address';

export interface AssetSummary {
  id: string;
  symbol: string;
  name: string;
  chain: string;
  chainName: string;
  chainKind: string;
  decimals: number;
  address?: string;
  color: string;
  colorTo: string;
  usdPrice: number;
  minUsd: number;
  maxUsd: number;
  addressPlaceholder: string;
  popular: boolean;
  stable: boolean;
  thorchainAsset?: string;
  chainColor: { bg: string; text: string; border: string };
}

export interface ProviderSummary {
  id: string;
  displayName: string;
  docsUrl: string;
  feeMechanism: string;
}

export interface HealthResponse {
  ok: boolean;
  version: string;
  providers: {
    zeroEx: boolean;
    oneInch: boolean;
    openOcean: boolean;
    jupiter: boolean;
    keyless: string[];
  };
  fee: {
    floatBps: number;
    fixedBps: number;
    chargeOn: 'input' | 'output';
    recipientConfigured: boolean;
    thornameConfigured: boolean;
    solanaConfigured: boolean;
  };
}

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });

  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(`Malformed response from ${path}`, response.status);
  }

  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body
        ? String((body as { error: unknown }).error)
        : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return body as T;
}

export const api = {
  health: () => request<HealthResponse>('/api/health'),

  assets: () =>
    request<{ assets: AssetSummary[]; priceMode: 'live' | 'reference' }>('/api/assets'),

  providers: () =>
    request<{ providers: ProviderSummary[]; chains: unknown[] }>('/api/providers'),

  quote: (body: QuoteRequest, signal?: AbortSignal) =>
    request<QuoteResponse>('/api/quote', {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
    }),

  validateAddress: (assetId: string, address: string, signal?: AbortSignal) =>
    request<AddressValidation>(
      `/api/validate-address?assetId=${encodeURIComponent(assetId)}&address=${encodeURIComponent(address)}`,
      { signal },
    ),

  plan: (body: {
    fromAssetId: string;
    toAssetId: string;
    sendAmount: string;
    destinationAddress: string;
    takerAddress?: string;
    rateType: 'float' | 'fixed';
    aggregator: string;
    slippageBps?: number;
  }) =>
    request<{ plan: ExecutionPlan; order: OrderRecord; feeBps: number }>('/api/plan', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  order: (orderId: string) => request<{ order: OrderRecord }>(`/api/orders/${orderId}`),

  simulateDeposit: (orderId: string) =>
    request<{ order: OrderRecord }>(`/api/orders/${orderId}/simulate-deposit`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
};

export { ApiError };
