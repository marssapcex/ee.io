/**
 * Save the evidence receipt (immutable trade terms + keccak digest) as a
 * JSON file. Verifiable forever without trusting this server to keep serving.
 */
export async function downloadReceipt(url: string, name: string): Promise<void> {
  try {
    const body = (await fetch(url).then((r) => r.json())) as { receipt: unknown };
    const blob = new Blob([JSON.stringify(body.receipt, null, 2)], { type: 'application/json' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `${name}-receipt.json`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  } catch {
    /* server down — the button is a convenience, not a dependency */
  }
}
