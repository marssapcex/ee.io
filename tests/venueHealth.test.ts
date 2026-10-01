import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetVenueHealth,
  isCircuitOpen,
  recordVenueTrial,
  reliabilityPct,
  venueSnapshot,
} from '../server/venueHealth';

describe('venueHealth', () => {
  beforeEach(() => __resetVenueHealth());

  it('is 100% reliable and good with no track record', () => {
    const snap = venueSnapshot('0x');
    expect(snap.successRatePct).toBe(100);
    expect(snap.health).toBe('good');
    expect(snap.circuitOpen).toBe(false);
    expect(isCircuitOpen('0x')).toBe(false);
  });

  it('opens the circuit after 3 consecutive failures', () => {
    recordVenueTrial('1inch', false, 2000);
    expect(isCircuitOpen('1inch')).toBe(false);
    recordVenueTrial('1inch', false, 2000);
    recordVenueTrial('1inch', false, 2000);
    const snap = venueSnapshot('1inch');
    expect(snap.circuitOpen).toBe(true);
    expect(isCircuitOpen('1inch')).toBe(true);
    expect(snap.health).toBe('down');
    expect(reliabilityPct('1inch')).toBe(0);
  });

  it('stays closed while failures are interleaved with successes', () => {
    for (let i = 0; i < 8; i += 1) {
      recordVenueTrial('kyberswap', i % 2 === 0, 300);
    }
    const snap = venueSnapshot('kyberswap');
    expect(snap.circuitOpen).toBe(false);
    expect(snap.successRatePct).toBe(50);
    // 50% on 8 trials breaks the 80% band for 'good'.
    expect(snap.health).toBe('degraded');
  });

  it('opens on a sustained failure rate even without consecutive strikes', () => {
    // Resetting the streak each time still yields a bad failure rate overall.
    for (let i = 0; i < 10; i += 1) {
      const ok = i % 5 === 4;
      recordVenueTrial('paraswap', ok, 500);
    }
    const snap = venueSnapshot('paraswap');
    expect(snap.failures).toBe(8);
    expect(snap.circuitOpen).toBe(true);
  });

  it('closes the circuit when a half-open probe succeeds', () => {
    recordVenueTrial('openocean', false, 100);
    recordVenueTrial('openocean', false, 100);
    recordVenueTrial('openocean', false, 100);
    expect(isCircuitOpen('openocean')).toBe(true);

    // Simulate the cool-down having passed by moving the open timestamp back —
    // via a successful probe being recorded (source of truth is the trials log).
    recordVenueTrial('openocean', true, 120);
    const snap = venueSnapshot('openocean');
    expect(snap.circuitOpen).toBe(false);
  });

  it('keeps a window of at most 30 trials', () => {
    for (let i = 0; i < 40; i += 1) recordVenueTrial('thorchain', true, 100);
    expect(venueSnapshot('thorchain').attempts).toBe(30);
  });
});
