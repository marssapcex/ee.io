// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOONSHOT_DURATION_MS, MoonShot } from '../src/components/MoonShot';

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

describe('MoonShot', () => {
  it('stays dormant until triggered', () => {
    render(<MoonShot trigger={0} />);
    expect(screen.queryByTestId('moonshot')).toBeNull();
  });

  it('launches when the trigger increments', () => {
    const { rerender } = render(<MoonShot trigger={0} />);
    rerender(<MoonShot trigger={1} />);
    expect(screen.getByTestId('moonshot')).toBeDefined();
  });

  it('never blocks clicks on the UI underneath', () => {
    const { rerender } = render(<MoonShot trigger={0} />);
    rerender(<MoonShot trigger={1} />);
    expect(screen.getByTestId('moonshot').className).toContain('pointer-events-none');
  });

  it('unmounts itself once the run finishes', () => {
    const { rerender } = render(<MoonShot trigger={0} />);
    rerender(<MoonShot trigger={1} />);
    expect(screen.getByTestId('moonshot')).toBeDefined();

    act(() => {
      // Track the component's own duration; a hard-coded number silently
      // starts passing for the wrong reason when the timing changes.
      vi.advanceTimersByTime(MOONSHOT_DURATION_MS + 100);
    });
    expect(screen.queryByTestId('moonshot')).toBeNull();
  });

  it('does not animate for users who asked for reduced motion', () => {
    setReducedMotion(true);
    const { rerender } = render(<MoonShot trigger={0} />);
    rerender(<MoonShot trigger={1} />);
    expect(screen.queryByTestId('moonshot')).toBeNull();
  });

  it('is hidden from assistive tech — it carries no information', () => {
    const { rerender } = render(<MoonShot trigger={0} />);
    rerender(<MoonShot trigger={1} />);
    expect(screen.getByTestId('moonshot').getAttribute('aria-hidden')).toBe('true');
  });
});
