/**
 * A byte stream that produces `totalBytes` in `chunkSize` pieces only when it is
 * pulled, and records how far it was read. `highWaterMark: 0` means nothing is
 * pulled until a reader asks, so `pulls === 0` proves a body was never read and
 * `pulls` bounds how much of it was.
 */
export interface CountingStream {
  stream: ReadableStream<Uint8Array>;
  readonly pulls: number;
  readonly bytesProduced: number;
  readonly cancelled: boolean;
}

export function countingStream(
  totalBytes: number,
  chunkSize: number,
  fill: (offset: number, chunk: Uint8Array) => void = () => {}
): CountingStream {
  let pulls = 0;
  let bytesProduced = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulls += 1;
        if (bytesProduced >= totalBytes) {
          controller.close();
          return;
        }
        const size = Math.min(chunkSize, totalBytes - bytesProduced);
        const chunk = new Uint8Array(size);
        fill(bytesProduced, chunk);
        bytesProduced += size;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 }
  );
  return {
    stream,
    get pulls() {
      return pulls;
    },
    get bytesProduced() {
      return bytesProduced;
    },
    get cancelled() {
      return cancelled;
    },
  };
}
