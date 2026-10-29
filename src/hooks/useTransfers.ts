import { useCallback, useEffect, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { nativeTool } from "../lib/toolsBridge";
export interface TransferJob {
  id: string;
  session: string;
  local: string;
  remote: string;
  upload: boolean;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  bytes: number;
  total: number | null;
  error?: string;
}
export function useTransfers(onComplete: () => void) {
  const [jobs, setJobs] = useState<TransferJob[]>([]);
  const pending = useRef<TransferJob[]>([]);
  const active = useRef<TransferJob | null>(null);
  const alive = useRef(true);
  const complete = useRef(onComplete);
  complete.current = onComplete;
  const update = (id: string, patch: Partial<TransferJob>) => {
    if (alive.current)
      setJobs((previous) =>
        previous.map((job) => (job.id === id ? { ...job, ...patch } : job)),
      );
  };
  const pump = useCallback(async () => {
    if (active.current || !alive.current) return;
    const job = pending.current.shift();
    if (!job) return;
    active.current = job;
    update(job.id, { status: "running" });
    const progress = new Channel<{ bytes: number; total: number | null }>();
    progress.onmessage = (value) => update(job.id, value);
    try {
      const bytes = await nativeTool<number>("sftp_transfer", {
        id: job.session,
        request: {
          operationId: job.id,
          remote: job.remote,
          local: job.local,
          upload: job.upload,
        },
        progress,
      });
      update(job.id, { status: "done", bytes });
      if (alive.current) complete.current();
    } catch (error) {
      update(job.id, {
        status: job.status === "cancelled" ? "cancelled" : "failed",
        error: String(error),
      });
    } finally {
      active.current = null;
      if (alive.current) void pump();
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      pending.current = [];
      if (active.current)
        void nativeTool("cancel_operation", {
          operationId: active.current.id,
        }).catch(() => {});
    };
  }, []);
  const enqueue = useCallback(
    (input: {
      session: string;
      local: string;
      remote: string;
      upload: boolean;
    }) => {
      if (pending.current.length >= 20)
        throw new Error("Transfer queue is full (20 waiting files).");
      const job: TransferJob = {
        ...input,
        id: crypto.randomUUID(),
        status: "queued",
        bytes: 0,
        total: null,
      };
      pending.current.push(job);
      setJobs((previous) => [...previous.slice(-49), job]);
      void pump();
    },
    [pump],
  );
  const cancel = useCallback((id: string) => {
    pending.current = pending.current.filter((job) => job.id !== id);
    if (active.current?.id === id) {
      active.current.status = "cancelled";
      void nativeTool("cancel_operation", { operationId: id }).catch(() => {});
    }
    update(id, { status: "cancelled" });
  }, []);
  const cancelSession = useCallback(
    (session: string) => {
      for (const job of pending.current.filter(
        (job) => job.session === session,
      ))
        cancel(job.id);
      if (active.current?.session === session) cancel(active.current.id);
    },
    [cancel],
  );
  return {
    jobs,
    enqueue,
    cancel,
    cancelSession,
    clear: () =>
      setJobs((previous) =>
        previous.filter(
          (job) => job.status === "running" || job.status === "queued",
        ),
      ),
  };
}
