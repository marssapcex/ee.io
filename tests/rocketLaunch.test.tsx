// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROCKET_LAUNCH_MS, RocketLaunch } from '../src/components/RocketLaunch';

/**
 * The launch animation is decoration, so the bar it has to clear is that it
 * never interferes: it must not mount for reduced-motion users, must not
 * intercept pointer events, and must clean itself up.
 */

function setReducedMotion(reduce: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  setReducedMotion(false);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('RocketLaunch', () => {
  it('stays dormant until triggered', () => {
    render(<RocketLaunch trigger={0} />);
    expect(screen.queryByTestId('rocket-launch')).toBeNull();
  });

  it('launches when the trigger increments', () => {
    const { rerender } = render(<RocketLaunch trigger={0} />);
    rerender(<RocketLaunch trigger={1} />);
    expect(screen.getByTestId('rocket-launch')).toBeDefined();
  });

  it('never blocks clicks on the UI underneath', () => {
    const { rerender } = render(<RocketLaunch trigger={0} />);
    rerender(<RocketLaunch trigger={1} />);
    expect(screen.getByTestId('rocket-launch').className).toContain('pointer-events-none');
  });

  it('unmounts itself once the run finishes', () => {
    const { rerender } = render(<RocketLaunch trigger={0} />);
    rerender(<RocketLaunch trigger={1} />);
    expect(screen.getByTestId('rocket-launch')).toBeDefined();

    act(() => {
      // Track the component's own duration; a hard-coded number silently
      // starts passing for the wrong reason when the timing changes.
      vi.advanceTimersByTime(ROCKET_LAUNCH_MS + 100);
    });
    expect(screen.queryByTestId('rocket-launch')).toBeNull();
  });

  it('does not animate for users who asked for reduced motion', () => {
    setReducedMotion(true);
    const { rerender } = render(<RocketLaunch trigger={0} />);
    rerender(<RocketLaunch trigger={1} />);
    expect(screen.queryByTestId('rocket-launch')).toBeNull();
  });

  it('is hidden from assistive tech — it carries no information', () => {
    const { rerender } = render(<RocketLaunch trigger={0} />);
    rerender(<RocketLaunch trigger={1} />);
    expect(screen.getByTestId('rocket-launch').getAttribute('aria-hidden')).toBe('true');
  });
});

describe('RocketLaunch — page open', () => {
  it('plays once as the page opens', () => {
    render(<RocketLaunch playOnMount />);
    expect(screen.getByTestId('rocket-launch')).toBeDefined();
  });

  it('carries the coins up as payload', () => {
    render(<RocketLaunch playOnMount />);
    const scene = screen.getByTestId('rocket-launch');
    // BTC rides on the hull badge and as payload; the payload coins are the
    // ones that matter here.
    expect(scene.querySelectorAll('.animate-coin-ride').length).toBeGreaterThan(0);
  });

  it('holds on the pad before it climbs — the shake layer is present', () => {
    render(<RocketLaunch playOnMount />);
    const scene = screen.getByTestId('rocket-launch');
    expect(scene.querySelector('.animate-liftoff')).not.toBeNull();
    expect(scene.querySelector('.animate-pad-shake')).not.toBeNull();
    expect(scene.querySelector('.animate-flame-grow')).not.toBeNull();
  });

  it('floods the pad with exhaust', () => {
    render(<RocketLaunch playOnMount />);
    const scene = screen.getByTestId('rocket-launch');
    expect(scene.querySelectorAll('.animate-smoke-puff').length).toBeGreaterThan(8);
  });

  it('stays silent on open for reduced-motion users', () => {
    setReducedMotion(true);
    render(<RocketLaunch playOnMount />);
    expect(screen.queryByTestId('rocket-launch')).toBeNull();
  });
});

describe('RocketLaunch — must never block the UI', () => {
  it('a button underneath still receives its click mid-flight', () => {
    const onClick = vi.fn();
    render(
      <div>
        <button onClick={onClick}>Exchange now</button>
        <RocketLaunch playOnMount />
      </div>,
    );
    // The overlay is on screen and sits above the page (z-70).
    expect(screen.getByTestId('rocket-launch')).toBeDefined();

    fireEvent.click(screen.getByText('Exchange now'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('has no descendant that re-enables pointer events', () => {
    render(<RocketLaunch playOnMount />);
    const scene = screen.getByTestId('rocket-launch');
    expect(scene.className).toContain('pointer-events-none');
    expect(scene.querySelectorAll('.pointer-events-auto').length).toBe(0);
  });
});
