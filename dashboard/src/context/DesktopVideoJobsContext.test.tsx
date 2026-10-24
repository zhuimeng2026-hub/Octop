import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DesktopVideoJobsProvider,
  useDesktopVideoJobs,
  type DesktopVideoBridge,
  type DesktopVideoJob,
} from "./DesktopVideoJobsContext";

const auth = vi.hoisted(() => ({
  userId: 7,
  token: "token-7",
  request: vi.fn(),
}));

vi.mock("../api/request", () => ({ getAuthToken: () => auth.token }));
vi.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ id: auth.userId }),
}));

const job: DesktopVideoJob = {
  id: "job-7",
  projectId: "project-7",
  ownerId: "7",
  name: "Sample",
  state: "completed",
  progress: 1,
  updatedAt: 1,
  videoUrl: "http://127.0.0.1:9999/video",
};

function Probe() {
  const {
    jobs,
    cancel,
    retry,
    save,
    checkEnvironment,
    verifyEnvironment,
    refreshEnvironment,
    environmentStatus,
  } = useDesktopVideoJobs();
  return (
    <>
      <span>{jobs.length}</span>
      <button onClick={() => void cancel(job.id)}>cancel</button>
      <button onClick={() => void retry(job.id)}>retry</button>
      <button onClick={() => void save(job.id)}>save</button>
      <span>{environmentStatus.state}</span>
      <button onClick={() => void checkEnvironment()}>environment check</button>
      <button onClick={() => void verifyEnvironment()}>
        environment verify
      </button>
      <button onClick={() => void refreshEnvironment()}>
        environment status
      </button>
    </>
  );
}

describe("desktop video job bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.userId = 7;
    auth.token = "token-7";
    auth.request.mockImplementation((action: string) => {
      if (action === "list") return Promise.resolve([job]);
      if (action === "save") return Promise.resolve({ saved: true });
      return Promise.resolve(job);
    });
    window.octopDesktopVideo = {
      version: 1,
      request: auth.request,
    } as DesktopVideoBridge;
  });

  it("passes the auth token to cancel, retry, and native save requests", async () => {
    render(
      <DesktopVideoJobsProvider>
        <Probe />
      </DesktopVideoJobsProvider>,
    );
    await screen.findByText("1");
    fireEvent.click(screen.getByText("cancel"));
    fireEvent.click(screen.getByText("retry"));
    fireEvent.click(screen.getByText("save"));
    await waitFor(() =>
      expect(auth.request).toHaveBeenCalledWith("save", {
        jobId: job.id,
        token: "token-7",
      }),
    );
    expect(auth.request).toHaveBeenCalledWith("cancel", {
      jobId: job.id,
      token: "token-7",
    });
    expect(auth.request).toHaveBeenCalledWith("retry", {
      jobId: job.id,
      token: "token-7",
    });
  });

  it("hides jobs not owned by the signed-in user", async () => {
    const view = render(
      <DesktopVideoJobsProvider>
        <Probe />
      </DesktopVideoJobsProvider>,
    );
    await screen.findByText("1");
    auth.userId = 8;
    auth.token = "token-8";
    view.rerender(
      <DesktopVideoJobsProvider>
        <Probe />
      </DesktopVideoJobsProvider>,
    );
    await waitFor(() => expect(screen.getByText("0")).toBeInTheDocument());
  });

  it("uses only authenticated check, verify, and status bridge actions", async () => {
    (window.octopDesktopVideo as DesktopVideoBridge).environmentVersion = 1;
    auth.request.mockImplementation((action: string) => {
      if (action === "environment_check") {
        return Promise.resolve({
          state: "needs_setup",
          stage: "components",
          progress: null,
          requiresInstall: true,
        });
      }
      if (action === "environment_verify") {
        return Promise.resolve({
          state: "ready",
          stage: null,
          progress: null,
        });
      }
      if (action === "environment_status") {
        return Promise.resolve({
          state: "ready",
          stage: null,
          progress: null,
        });
      }
      if (action === "list") return Promise.resolve([]);
      return Promise.resolve(job);
    });
    const user = userEvent.setup();
    render(
      <DesktopVideoJobsProvider>
        <Probe />
      </DesktopVideoJobsProvider>,
    );
    await user.click(screen.getByText("environment check"));
    await waitFor(() =>
      expect(auth.request).toHaveBeenCalledWith("environment_check", {
        token: "token-7",
      }),
    );
    await user.click(screen.getByText("environment verify"));
    await waitFor(() => expect(screen.getByText("ready")).toBeInTheDocument());
    await user.click(screen.getByText("environment status"));
    await waitFor(() =>
      expect(auth.request).toHaveBeenCalledWith("environment_status", {
        token: "token-7",
      }),
    );
    expect(auth.request).toHaveBeenCalledWith("environment_verify", {
      token: "token-7",
    });
    expect(auth.request).not.toHaveBeenCalledWith(
      "environment_prepare",
      expect.anything(),
    );
  });
});
