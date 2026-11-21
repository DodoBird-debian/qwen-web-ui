import { afterEach, expect, test, vi } from "vitest";
import { LatestPreview } from "../../src/resources/latest-preview";

afterEach(() => vi.useRealTimers());

test("coalesces settings changes, serializes encodes and discards stale resources", async () => {
  vi.useFakeTimers();
  const pending: { signal: AbortSignal; resolve: (value: string) => void }[] = [];
  const ready = vi.fn(), discard = vi.fn();
  const task = new LatestPreview({
    encode: signal => new Promise<string>(resolve => pending.push({ signal, resolve })),
    pending: vi.fn(), ready, discard, error: vi.fn(),
  });
  task.invalidate();
  task.invalidate();
  await vi.advanceTimersByTimeAsync(300);
  expect(pending).toHaveLength(1);
  task.invalidate();
  task.invalidate();
  expect(pending[0].signal.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(300);
  expect(pending).toHaveLength(1);
  pending[0].resolve("old URL");
  await vi.advanceTimersByTimeAsync(0);
  expect(discard).toHaveBeenCalledWith("old URL");
  expect(ready).not.toHaveBeenCalled();
  expect(pending).toHaveLength(2);
  pending[1].resolve("current URL");
  await vi.advanceTimersByTimeAsync(0);
  expect(ready).toHaveBeenCalledExactlyOnceWith("current URL");
  task.close();
});

test("closing cancels queued work and releases an encode that finishes after close", async () => {
  vi.useFakeTimers();
  let finish!: (value: string) => void;
  const discard = vi.fn(), ready = vi.fn();
  const encode = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
  const task = new LatestPreview({ encode, ready, discard, pending: vi.fn(), error: vi.fn() });
  const first = task.run();
  task.invalidate();
  task.close();
  finish("late URL");
  await first;
  await vi.advanceTimersByTimeAsync(1000);
  expect(encode).toHaveBeenCalledTimes(1);
  expect(ready).not.toHaveBeenCalled();
  expect(discard).toHaveBeenCalledExactlyOnceWith("late URL");
});

test("a failed preview can be retried with the current settings", async () => {
  const error = vi.fn(), ready = vi.fn();
  const encode = vi.fn().mockRejectedValueOnce(new Error("Invalid size")).mockResolvedValueOnce("valid");
  const task = new LatestPreview({ encode, ready, error, pending: vi.fn(), discard: vi.fn() });
  await task.run();
  expect(error).toHaveBeenCalledTimes(1);
  await task.run();
  expect(ready).toHaveBeenCalledExactlyOnceWith("valid");
  task.close();
});
