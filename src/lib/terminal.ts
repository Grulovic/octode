/** Keep UTF-16 surrogate pairs intact when converting terminal paste chunks to UTF-8. */
export function splitTerminalInput(data: string, size = 8192): string[] {
  if (!Number.isInteger(size) || size < 2)
    throw new Error("Terminal chunk size must be at least two characters");
  const chunks: string[] = [];
  for (let start = 0; start < data.length; ) {
    let end = Math.min(start + size, data.length);
    const last = data.charCodeAt(end - 1);
    if (end < data.length && last >= 0xd800 && last <= 0xdbff) end--;
    chunks.push(data.slice(start, end));
    start = end;
  }
  return chunks;
}

/** Serialize IPC writes and bound queued input; a failed paste does not send its tail. */
export function createTerminalInputQueue(
  write: (chunk: string) => Promise<void>,
  onError: (error: unknown) => void,
  limit = 1024 * 1024,
) {
  let tail = Promise.resolve();
  let pending = 0;
  let closed = false;
  return {
    send(data: string) {
      if (closed) return;
      if (pending + data.length > limit) {
        onError(
          new Error("Terminal input queue is full. This input was not sent."),
        );
        return;
      }
      const batch = { failed: false };
      for (const chunk of splitTerminalInput(data)) {
        pending += chunk.length;
        tail = tail
          .then(async () => {
            if (closed || batch.failed) return;
            try {
              await write(chunk);
            } catch (error) {
              batch.failed = true;
              onError(error);
            }
          })
          .finally(() => {
            pending -= chunk.length;
          });
      }
    },
    close() {
      closed = true;
    },
    flush() {
      return tail;
    },
  };
}
