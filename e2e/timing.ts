// Timing helpers for the speed tests. A shared CI runner is noisy: one slow
// run says little about the editor. So each test opens once to warm up
// (the browser compiles and caches the editor's code), then measures a few
// opens and judges the fastest, which is the editor's own speed with the
// least interference from the machine.

/** The fastest of the measured times. */
export function fastest(times: readonly number[]): number {
  if (times.length === 0) throw new Error("No runs were measured.");
  for (const time of times) {
    if (!Number.isFinite(time) || time < 0) {
      throw new Error(`Not a duration: ${String(time)}.`);
    }
  }
  return Math.min(...times);
}

export interface Timings {
  warmUps: number[];
  runs: number[];
  fastest: number;
}

/**
 * Runs `measure` `warmUps` times, discarding the results, then `runs`
 * times, one after another, and returns every time and the fastest.
 */
export async function timeRuns(
  measure: () => Promise<number>,
  { warmUps = 1, runs = 3 }: { warmUps?: number; runs?: number } = {},
): Promise<Timings> {
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error("At least one measured run is needed.");
  }
  const warm: number[] = [];
  for (let i = 0; i < warmUps; i++) warm.push(await measure());
  const measured: number[] = [];
  for (let i = 0; i < runs; i++) measured.push(await measure());
  return { warmUps: warm, runs: measured, fastest: fastest(measured) };
}
