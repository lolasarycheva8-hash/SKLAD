/**
 * Capture the baseline from the same read that proves the counter is loaded.
 * A second DOM read can race a query refresh or page reload.
 */
export async function readLoadedCounter(
  readText: () => Promise<string>,
  pause: () => Promise<unknown>,
  attempts = 300,
): Promise<number> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const text = await readText();
    const match = text.match(/\((\d+)\)/);
    const count = match ? Number(match[1]) : NaN;
    if (Number.isSafeInteger(count) && count > 0) return count;
    await pause();
  }
  throw new Error("Timed out waiting for a loaded positive legacy assignment count");
}
