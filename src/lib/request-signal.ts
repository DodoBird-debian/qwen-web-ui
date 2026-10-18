/** AbortSignal.any/timeout are missing in older mobile browsers. Release listeners/timers after each request. */
export function requestSignal(parent?: AbortSignal, timeoutMs = 60_000) {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason);
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException("RunPod request timed out", "TimeoutError"),
      ),
    timeoutMs,
  );
  if (parent?.aborted) abort();
  else parent?.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abort);
    },
  };
}
