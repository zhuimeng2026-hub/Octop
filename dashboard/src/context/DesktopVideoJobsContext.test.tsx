import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  const { jobs, cancel, retry, save } = useDesktopVideoJobs();
  return (
    <>
      <span>{jobs.length}</span>
      <button onClick={() => void cancel(job.id)}>cancel</button>
      <button onClick={() => void retry(job.id)}>retry</button>
      <button onClick={() => void save(job.id)}>save</button>
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
});
