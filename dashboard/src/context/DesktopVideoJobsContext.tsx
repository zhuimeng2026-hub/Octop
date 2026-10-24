import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getAuthToken } from "../api/request";
import { useCurrentUser } from "../hooks/useCurrentUser";

export type DesktopVideoJobState =
  | "preparing"
  | "downloading"
  | "rendering"
  | "saving"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface DesktopVideoJob {
  id: string;
  projectId: string;
  ownerId: string | number;
  name: string;
  state: DesktopVideoJobState;
  progress: number | null;
  errorCode?: string;
  videoUrl?: string;
  updatedAt: number;
}

export interface DesktopVideoBridge {
  version: number;
  request: <T = unknown>(
    action: "start" | "list" | "get" | "cancel" | "retry" | "save",
    payload: Record<string, unknown>,
  ) => Promise<T>;
}

declare global {
  interface Window {
    octopDesktopVideo?: DesktopVideoBridge;
  }
}

export class DesktopVideoBridgeError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "DesktopVideoBridgeError";
    this.code = code;
  }
}

interface DesktopVideoJobsContextValue {
  bridgeAvailable: boolean;
  jobs: DesktopVideoJob[];
  start: (projectId: string) => Promise<DesktopVideoJob>;
  cancel: (jobId: string) => Promise<DesktopVideoJob>;
  retry: (jobId: string) => Promise<DesktopVideoJob>;
  save: (jobId: string) => Promise<boolean>;
  refresh: () => Promise<void>;
}

const missingBridge = async (): Promise<never> => {
  throw new DesktopVideoBridgeError("RUNTIME_UNAVAILABLE");
};

const DesktopVideoJobsContext = createContext<DesktopVideoJobsContextValue>({
  bridgeAvailable: false,
  jobs: [],
  start: missingBridge,
  cancel: missingBridge,
  retry: missingBridge,
  save: missingBridge,
  refresh: async () => undefined,
});

export function isActiveDesktopVideoJob(job: DesktopVideoJob): boolean {
  return ["preparing", "downloading", "rendering", "saving"].includes(
    job.state,
  );
}

function nativeErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z_]+$/.test(code)) return code;
  }
  return "INTERNAL";
}

export function DesktopVideoJobsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const userId = useCurrentUser()?.id ?? null;
  const ownerRef = useRef<string | number | null>(userId);
  ownerRef.current = userId;
  const [bridgeAvailable, setBridgeAvailable] = useState(
    () => window.octopDesktopVideo?.version === 1,
  );
  const [jobs, setJobs] = useState<DesktopVideoJob[]>([]);
  const [jobsOwnerId, setJobsOwnerId] = useState<string | number | null>(null);

  useEffect(() => {
    if (window.octopDesktopVideo?.version === 1) {
      setBridgeAvailable(true);
      return;
    }
    const poll = window.setInterval(() => {
      if (window.octopDesktopVideo?.version === 1) {
        setBridgeAvailable(true);
        window.clearInterval(poll);
      }
    }, 200);
    return () => window.clearInterval(poll);
  }, []);

  const call = useCallback(
    async <T,>(
      action: "start" | "list" | "get" | "cancel" | "retry" | "save",
      payload: Record<string, unknown> = {},
    ): Promise<T> => {
      const token = getAuthToken();
      if (!userId || !token) throw new DesktopVideoBridgeError("AUTH_REQUIRED");
      const bridge = window.octopDesktopVideo;
      if (!bridge || bridge.version !== 1) {
        throw new DesktopVideoBridgeError("RUNTIME_UNAVAILABLE");
      }
      try {
        return await bridge.request<T>(action, { ...payload, token });
      } catch (error) {
        throw new DesktopVideoBridgeError(nativeErrorCode(error));
      }
    },
    [userId],
  );

  const refresh = useCallback(async () => {
    if (!userId || !getAuthToken() || !bridgeAvailable) {
      setJobs([]);
      setJobsOwnerId(null);
      return;
    }
    try {
      const listed = await call<DesktopVideoJob[]>("list");
      if (ownerRef.current !== userId) return;
      setJobsOwnerId(userId);
      setJobs(
        listed
          .filter((job) => String(job.ownerId) === String(userId))
          .sort((a, b) => b.updatedAt - a.updatedAt),
      );
    } catch (error) {
      if (ownerRef.current !== userId) return;
      if (nativeErrorCode(error) === "AUTH_REQUIRED") {
        setJobs([]);
        setJobsOwnerId(null);
      }
    }
  }, [bridgeAvailable, call, userId]);

  useEffect(() => {
    setJobs([]);
    if (!userId || !bridgeAvailable) return;
    void refresh();
    const interval = window.setInterval(() => void refresh(), 1800);
    return () => window.clearInterval(interval);
  }, [bridgeAvailable, refresh, userId]);

  const updateJob = useCallback(
    async (
      action: "start" | "cancel" | "retry",
      payload: Record<string, unknown>,
    ) => {
      const job = await call<DesktopVideoJob>(action, payload);
      if (ownerRef.current !== userId) {
        throw new DesktopVideoBridgeError("AUTH_REQUIRED");
      }
      setJobsOwnerId(userId);
      setJobs((current) =>
        [job, ...current.filter((item) => item.id !== job.id)].sort(
          (a, b) => b.updatedAt - a.updatedAt,
        ),
      );
      return job;
    },
    [call, userId],
  );

  const start = useCallback(
    (projectId: string) => updateJob("start", { projectId }),
    [updateJob],
  );
  const cancel = useCallback(
    (jobId: string) => updateJob("cancel", { jobId }),
    [updateJob],
  );
  const retry = useCallback(
    (jobId: string) => updateJob("retry", { jobId }),
    [updateJob],
  );
  const save = useCallback(
    async (jobId: string) => {
      const result = await call<{ saved: boolean }>("save", { jobId });
      return result.saved;
    },
    [call],
  );

  const value = useMemo(
    () => ({
      bridgeAvailable,
      jobs: jobsOwnerId === userId ? jobs : [],
      start,
      cancel,
      retry,
      save,
      refresh,
    }),
    [
      bridgeAvailable,
      jobs,
      jobsOwnerId,
      userId,
      start,
      cancel,
      retry,
      save,
      refresh,
    ],
  );
  return (
    <DesktopVideoJobsContext.Provider value={value}>
      {children}
    </DesktopVideoJobsContext.Provider>
  );
}

export function useDesktopVideoJobs() {
  return useContext(DesktopVideoJobsContext);
}
