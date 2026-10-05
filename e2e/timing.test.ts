import { describe, expect, it } from "vitest";
import { fastest, timeRuns } from "./timing";

describe("fastest", () => {
  it("picks the smallest time", () => {
    expect(fastest([2400, 1800, 2950])).toBe(1800);
    expect(fastest([0])).toBe(0);
  });

  it("refuses no runs and times that are not durations", () => {
    expect(() => fastest([])).toThrow("No runs");
    expect(() => fastest([100, Number.NaN])).toThrow("Not a duration");
    expect(() => fastest([100, -1])).toThrow("Not a duration");
    expect(() => fastest([Number.POSITIVE_INFINITY])).toThrow("Not a duration");
  });
});

describe("timeRuns", () => {
  it("warms up first, then judges only the measured runs", async () => {
    const times = [100, 3000, 2500, 2700];
    const calls: number[] = [];
    const result = await timeRuns(() => {
      const time = times[calls.length] ?? 0;
      calls.push(time);
      return Promise.resolve(time);
    });
    expect(calls).toHaveLength(4);
    // The quick warm-up is not counted.
    expect(result).toEqual({
      warmUps: [100],
      runs: [3000, 2500, 2700],
      fastest: 2500,
    });
  });

  it("runs one at a time", async () => {
    let running = 0;
    let most = 0;
    await timeRuns(
      async () => {
        running++;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, 1));
        running--;
        return 1;
      },
      { warmUps: 2, runs: 4 },
    );
    expect(most).toBe(1);
  });

  it("takes the number of warm-ups and runs", async () => {
    let n = 0;
    const result = await timeRuns(() => Promise.resolve(++n), {
      warmUps: 0,
      runs: 2,
    });
    expect(result).toEqual({ warmUps: [], runs: [1, 2], fastest: 1 });
  });

  it("refuses fewer than one measured run", async () => {
    await expect(
      timeRuns(() => Promise.resolve(1), { runs: 0 }),
    ).rejects.toThrow("At least one");
  });
});
