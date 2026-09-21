// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';

/**
 * These render the real component tree against a stubbed API. A typecheck
 * cannot catch a bad hook order, a null deref on first paint, or a `.map` over
 * an undefined field — mounting the tree does.
 */

const ASSETS = [
  {
    id: 'BTC.BITCOIN',
    symbol: 'BTC',
    name: 'Bitcoin',
    chain: 'bitcoin',
    chainName: 'Bitcoin',
    chainKind: 'utxo',
    decimals: 8,
    color: '#f7931a',
    colorTo: '#ffb347',
    usdPrice: 64_000,
    minUsd: 20,
    maxUsd: 500_000,
    addressPlaceholder: 'bc1q…',
    popular: true,
    stable: false,
    chainColor: { bg: 'bg-orange-950', text: 'text-orange-300', border: 'border-orange-800' },
  },
  {
    id: 'USDT.ETHEREUM',
    symbol: 'USDT',
    name: 'Tether',
    chain: 'ethereum',
    chainName: 'Ethereum',
    chainKind: 'evm',
    decimals: 6,
    address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    color: '#26a17b',
    colorTo: '#4fd1a5',
    usdPrice: 1,
    minUsd: 20,
    maxUsd: 500_000,
    addressPlaceholder: '0x…',
    popular: true,
    stable: true,
    chainColor: { bg: 'bg-indigo-950', text: 'text-indigo-300', border: 'border-indigo-800' },
  },
];

const PROVIDERS = [
  {
    id: 'thorchain',
    displayName: 'THORChain',
    docsUrl: 'https://dev.thorchain.org',
    feeMechanism: 'affiliate_bps in the swap memo',
  },
  {
    id: '0x',
    displayName: '0x Swap API',
    docsUrl: 'https://0x.org/docs',
    feeMechanism: 'swapFeeRecipient + swapFeeBps',
  },
];

const HEALTH = {
  ok: true,
  version: '0.2.0',
  providers: { zeroEx: false, oneInch: false, openOcean: true, jupiter: true, keyless: ['thorchain'] },
  fee: {
    floatBps: 50,
    fixedBps: 100,
    chargeOn: 'output',
    recipientConfigured: false,
    thornameConfigured: false,
    solanaConfigured: false,
  },
};

function makeQuote(overrides: Record<string, unknown> = {}) {
  return {
    requestId: `req_${Math.random().toString(36).slice(2)}`,
    fromAssetId: 'BTC.BITCOIN',
    toAssetId: 'USDT.ETHEREUM',
    sendAmount: '5000000',
    receiveAmount: '3178420000',
    rateType: 'float',
    unitRate: 63_568.4,
    sendUsd: 3200,
    receiveUsd: 3178.42,
    expiresAt: Date.now() + 120_000,
    warnings: [],
    anyLive: false,
    priceMode: 'reference',
    quotes: [
      {
        aggregator: 'thorchain',
        displayName: 'THORChain',
        source: 'simulated',
        grossOut: '3194400000',
        netOut: '3178420000',
        minOut: '3130000000',
        netOutUsd: 3178.42,
        gasUsd: 3.69,
        priceImpactPct: 1.127,
        etaSeconds: 600,
        route: [{ name: 'THORChain pool', percent: 100, fromSymbol: 'BTC', toSymbol: 'USDT' }],
        fee: {
          bps: 50,
          chargedOn: 'output',
          amount: '15980000',
          assetId: 'USDT.ETHEREUM',
          recipient: 'ee',
          amountUsd: 15.98,
        },
        isBest: true,
        advantageUsd: 12.4,
      },
      {
        aggregator: '0x',
        displayName: '0x Swap API',
        source: 'simulated',
        grossOut: '0',
        netOut: '0',
        minOut: '0',
        netOutUsd: 0,
        gasUsd: 0,
        priceImpactPct: 0,
        etaSeconds: 0,
        route: [],
        fee: {
          bps: 50,
          chargedOn: 'output',
          amount: '0',
          assetId: 'USDT.ETHEREUM',
          recipient: '0x8829',
          amountUsd: 0,
        },
        unavailableReason: '0x does not support cross-chain swaps from Bitcoin',
      },
    ],
    ...overrides,
  };
}

/** The server always echoes the winning route as `best`; mirror that here. */
function withBest(quote: ReturnType<typeof makeQuote>) {
  return { ...quote, best: quote.quotes.find((q) => (q as { isBest?: boolean }).isBest) };
}

let quoteCalls: unknown[] = [];

function installFetch(quoteFactory: () => ReturnType<typeof makeQuote> = makeQuote) {
  quoteCalls = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    if (url.includes('/api/assets')) return json({ assets: ASSETS, priceMode: 'reference' });
    if (url.includes('/api/providers')) return json({ providers: PROVIDERS, chains: [] });
    if (url.includes('/api/health')) return json(HEALTH);
    if (url.includes('/api/validate-address')) {
      const address = new URL(url, 'http://x').searchParams.get('address') ?? '';
      const valid = /^0x[0-9a-fA-F]{40}$/.test(address);
      return json(
        valid ? { isValid: true, normalized: address } : { isValid: false, message: 'Invalid address' },
      );
    }
    if (url.includes('/api/quote')) {
      quoteCalls.push(JSON.parse(String(init?.body)));
      return json(withBest(quoteFactory()));
    }
    if (url.includes('/api/plan')) {
      return json({ plan: {}, order: {}, feeBps: 50 });
    }
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.useRealTimers();
  installFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App shell', () => {
  it('mounts and renders the swap form without crashing', async () => {
    render(<App />);
    expect(await screen.findByLabelText('You send')).toBeDefined();
    expect(screen.getByLabelText('You receive')).toBeDefined();
    expect(screen.getByLabelText(/Destination/i)).toBeDefined();
  });

  it('shows the brand mark', async () => {
    render(<App />);
    await screen.findByLabelText('You send');
    expect(screen.getAllByText('ee.io').length).toBeGreaterThan(0);
  });

  it('marks simulated routes so they are never mistaken for live pricing', async () => {
    render(<App />);
    expect(await screen.findByText('Sim', {}, { timeout: 3000 })).toBeDefined();
  });

  it('renders the fee policy from /api/health rather than hard-coding it', async () => {
    render(<App />);
    await screen.findByLabelText('You send');
    // floatBps 50 -> the Float fee bar shows 0.50%, no Fixed pill
    expect(screen.getByText(/0\.50%/)).toBeDefined();
    expect(screen.queryByText('1.00%')).toBeNull();
    expect(screen.queryByText('Fixed')).toBeNull();
    expect(screen.getByText(/Float/)).toBeDefined();
  });
});

describe('quote flow', () => {
  it('requests a quote and fills in the receive box', async () => {
    render(<App />);
    await screen.findByLabelText('You send');

    await waitFor(() => expect(quoteCalls.length).toBeGreaterThan(0), { timeout: 3000 });

    const receive = screen.getByLabelText('You receive') as HTMLInputElement;
    await waitFor(() => expect(receive.value).toBe('3178.42'));
  });

  it('debounces typing into a single request', async () => {
    render(<App />);
    const send = (await screen.findByLabelText('You send')) as HTMLInputElement;

    await waitFor(() => expect(quoteCalls.length).toBeGreaterThan(0), { timeout: 3000 });
    const before = quoteCalls.length;

    for (const value of ['0.1', '0.12', '0.123', '0.1234']) {
      fireEvent.change(send, { target: { value } });
    }

    await waitFor(() => expect(quoteCalls.length).toBe(before + 1), { timeout: 3000 });
  });

  it('switches to receive-side quoting when the user edits the output box', async () => {
    render(<App />);
    const receive = (await screen.findByLabelText('You receive')) as HTMLInputElement;
    await waitFor(() => expect(quoteCalls.length).toBeGreaterThan(0), { timeout: 3000 });

    fireEvent.change(receive, { target: { value: '5000' } });

    await waitFor(
      () => {
        const last = quoteCalls[quoteCalls.length - 1] as { side: string; amount: string };
        expect(last.side).toBe('receive');
        expect(last.amount).toBe('5000000000'); // 5000 USDT at 6 dp
      },
      { timeout: 3000 },
    );
  });

  it('rejects non-numeric characters in the amount field', async () => {
    render(<App />);
    const send = (await screen.findByLabelText('You send')) as HTMLInputElement;
    const original = send.value;

    fireEvent.change(send, { target: { value: 'abc' } });
    expect(send.value).toBe(original);

    fireEvent.change(send, { target: { value: '1.2.3' } });
    expect(send.value).toBe(original);
  });

  it('accepts a comma as a decimal separator', async () => {
    render(<App />);
    const send = (await screen.findByLabelText('You send')) as HTMLInputElement;
    fireEvent.change(send, { target: { value: '0,25' } });
    expect(send.value).toBe('0.25');
  });
});

describe('route comparison', () => {
  it('labels the winner', async () => {
    render(<App />);
    await screen.findByText('Routes');

    expect(screen.getByText('Best')).toBeDefined();
  });

  it('lists only routable venues — an unusable venue is noise, not a row', async () => {
    render(<App />);
    await screen.findByText('Routes');

    // The fixture marks 0x unavailable for this pair.
    expect(screen.queryByText(/unavailable/i)).toBeNull();
    expect(screen.queryByText(/does not support cross-chain swaps/i)).toBeNull();
    expect(screen.getByText(/1 venue quoted/i)).toBeDefined();
  });

  it('discloses the fee on every route', async () => {
    render(<App />);
    await screen.findByText('Routes');
    // Rendered twice by design: a dedicated column on desktop, a collapsed
    // metric strip on mobile. jsdom evaluates no media queries, so both are
    // in the tree here.
    expect(screen.getAllByText('50bps').length).toBeGreaterThan(0);
  });
});

describe('address validation', () => {
  it('marks a well-formed address valid', async () => {
    render(<App />);
    const input = await screen.findByLabelText(/Destination/i);

    fireEvent.change(input, {
      target: { value: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' },
    });

    // A valid address enables the submit button; that is the user-visible effect.
    const submit = screen.getByRole('button', {
      name: /Enter destination address|Exchange now|Get deposit address/i,
    }) as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false), { timeout: 3000 });
  });

  it('rejects a malformed address with an explanation', async () => {
    render(<App />);
    const input = await screen.findByLabelText(/Destination/i);

    fireEvent.change(input, { target: { value: 'not-an-address' } });
    fireEvent.blur(input);

    expect(await screen.findByText(/Invalid address/i, {}, { timeout: 3000 })).toBeDefined();
  });

  it('keeps the submit button disabled until the address is valid', async () => {
    render(<App />);
    await screen.findByLabelText('You send');

    // The CTA doubles as a status line, so it is matched by role + prompt text.
    const submit = screen.getByRole('button', {
      name: /Enter destination address/i,
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/Destination/i), {
      target: { value: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' },
    });

    await waitFor(() => expect(submit.disabled).toBe(false), { timeout: 3000 });
    expect(submit.textContent).toMatch(/Exchange now|Get deposit address/i);
  });
});

describe('asset selection', () => {
  it('opens the picker and swaps the selected asset', async () => {
    render(<App />);
    await screen.findByLabelText('You send');

    // Target the button by its accessible name rather than by its visible
    // ticker — the header also renders a BTC price chip, so a bare text
    // lookup is ambiguous.
    fireEvent.click(screen.getByLabelText(/Change send asset/i));

    const dialog = await screen.findByText(/Select asset to send/i);
    expect(dialog).toBeDefined();
  });

  it('flips the pair without losing the amounts', async () => {
    render(<App />);
    await screen.findByLabelText('You send');
    await waitFor(() => expect(quoteCalls.length).toBeGreaterThan(0), { timeout: 3000 });

    fireEvent.click(screen.getByLabelText(/Swap direction/i));

    await waitFor(
      () => {
        const last = quoteCalls[quoteCalls.length - 1] as { fromAssetId: string; toAssetId: string };
        expect(last.fromAssetId).toBe('USDT.ETHEREUM');
        expect(last.toAssetId).toBe('BTC.BITCOIN');
      },
      { timeout: 3000 },
    );
  });
});

describe('rate type', () => {
  it('is always float — no Fixed toggle exists', async () => {
    render(<App />);
    await screen.findByLabelText('You send');
    await waitFor(() => expect(quoteCalls.length).toBeGreaterThan(0), { timeout: 3000 });

    expect(screen.queryByText('Fixed')).toBeNull();
    expect(screen.getByText(/Float/)).toBeDefined();
    // Every quote must be float
    for (const q of quoteCalls as Array<{ rateType: string }>) {
      expect(q.rateType).toBe('float');
    }
  });
});

describe('failure handling', () => {
  it('shows a recoverable error when the API is unreachable at boot', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Failed to fetch');
      }),
    );
    render(<App />);
    expect(await screen.findByText(/Quote API unreachable/i)).toBeDefined();
  });

  it('renders min/max guidance for the selected asset', async () => {
    render(<App />);
    await screen.findByLabelText('You send');
    expect(screen.getByText(/^min /)).toBeDefined();
    expect(screen.getByText(/^max /)).toBeDefined();
  });

  it('surfaces server warnings to the user', async () => {
    installFetch(() => makeQuote({ warnings: ['Amount is below the minimum for this pair'] }));
    render(<App />);
    expect(
      await screen.findByText(/below the minimum/i, {}, { timeout: 3000 }),
    ).toBeDefined();
  });
});
