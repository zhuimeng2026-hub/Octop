import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { LocalAsset } from "../../api/localLibrary";
import type { DesktopVideoEnvironmentStatus } from "../../context/DesktopVideoJobsContext";
import zh from "../../locales/zh.json";
import LocalLibrary from "../LocalLibrary";
import VideoEnvironment from "../VideoEnvironment";
import LocalVideoWizard from "./index";

const library = vi.hoisted(() => ({
  list: vi.fn(),
  listProducts: vi.fn(),
  pickDirectory: vi.fn(),
  ingest: vi.fn(),
  recognizeExisting: vi.fn(),
  previewUrl: vi.fn(),
  renderLocal: vi.fn(),
  jobStatus: vi.fn(),
}));
const planLocal = vi.hoisted(() => vi.fn());
const environment = vi.hoisted(() => ({
  status: {
    state: "unknown",
    stage: null,
    progress: null,
  } as DesktopVideoEnvironmentStatus,
  subscribers: new Set<() => void>(),
  check: vi.fn(),
  install: vi.fn(),
  save: vi.fn(),
}));

vi.mock("../../api/localLibrary", () => ({
  isLocalLibraryAvailable: () => true,
  localLibrary: library,
  planLocal,
}));
vi.mock("../../context/DesktopVideoJobsContext", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useDesktopVideoJobs: () => ({
      environmentSupported: true,
      environmentStatus: useSyncExternalStore(
        (listener) => {
          environment.subscribers.add(listener);
          return () => environment.subscribers.delete(listener);
        },
        () => environment.status,
      ),
      checkEnvironment: environment.check,
      installEnvironment: environment.install,
      save: environment.save,
    }),
  };
});
vi.mock("../../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ id: 42 }),
}));
vi.mock("../../hooks/useDesktopMinimalMode", () => ({
  useDesktopMinimalMode: () => true,
}));
vi.mock("../../layouts/PageShell", () => ({
  default: ({
    actions,
    children,
  }: {
    actions?: ReactNode;
    children: ReactNode;
  }) => (
    <main>
      {actions}
      {children}
    </main>
  ),
}));
vi.mock("../../utils/antdMessage", () => ({
  message: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
}));

function translate(key: string, options?: Record<string, unknown>) {
  const value = key
    .split(".")
    .reduce<unknown>(
      (node, segment) =>
        node && typeof node === "object"
          ? (node as Record<string, unknown>)[segment]
          : undefined,
      zh,
    );
  return String(value ?? options?.defaultValue ?? key).replace(
    /\{\{(\w+)\}\}/g,
    (match, name: string) => String(options?.[name] ?? match),
  );
}

const photos: LocalAsset[] = ["front", "detail"].map((id) => ({
  id,
  filename: id + ".jpg",
  mediaType: "image/jpeg",
  bytes: 200,
  sha256: id,
  recognitionError: "MODEL_NOT_CONFIGURED",
}));

function setEnvironment(status: DesktopVideoEnvironmentStatus) {
  environment.status = status;
  for (const listener of environment.subscribers) listener();
  return status;
}

function renderFlow(
  initialEntry: string | { pathname: string; state: object },
) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Link to="/video-environment">组件设置侧栏入口</Link>
      <Link to="/local-video-wizard">制作向导侧栏入口</Link>
      <Routes>
        <Route path="/local-video-wizard" element={<LocalVideoWizard />} />
        <Route path="/local-library" element={<LocalLibrary />} />
        <Route path="/video-environment" element={<VideoEnvironment />} />
      </Routes>
    </MemoryRouter>,
  );
}

const button = (name: string) => screen.getByRole("button", { name });

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  environment.status = { state: "unknown", stage: null, progress: null };
  environment.check.mockImplementation(async () =>
    setEnvironment({
      state: "needs_setup",
      stage: "components",
      progress: null,
      requiresInstall: true,
    }),
  );
  environment.install.mockImplementation(async () =>
    setEnvironment({
      state: "ready",
      stage: null,
      progress: null,
    }),
  );
  environment.save.mockResolvedValue(true);
  library.list.mockResolvedValue([]);
  library.listProducts.mockResolvedValue([
    { id: "other-product", name: "已有商品", assetCount: 0 },
  ]);
  library.previewUrl.mockResolvedValue(null);
});

it("keeps imported photos usable when AI recognition fails and carries only the selected photo into the wizard", async () => {
  const user = userEvent.setup();
  library.pickDirectory.mockResolvedValue(
    photos.map((photo) => ({ path: photo.filename })),
  );
  library.ingest.mockImplementation(async () => {
    library.list.mockResolvedValue(photos);
    return photos;
  });
  library.recognizeExisting.mockResolvedValue(photos);
  renderFlow("/local-video-wizard");

  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: zh.localVideoWizard.next }),
  ).not.toBeInTheDocument();
  await user.click(button("导入图片"));
  await user.click(button("导入图片"));

  const feedback = await screen.findByText(/已导入 2 张图片.*AI.*未能识别/);
  expect(feedback).toHaveTextContent(/仍可.*制作视频/);
  await user.click(screen.getByRole("button", { name: /重新分析待识别/ }));
  expect(library.recognizeExisting).toHaveBeenCalledWith(["front", "detail"]);
  expect(library.ingest).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("checkbox", { name: "front.jpg" }));
  await user.click(button(zh.localLibrary.makeVideo));

  expect(
    await screen.findByRole("checkbox", { name: "front.jpg" }),
  ).toBeChecked();
  expect(
    screen.getByRole("checkbox", { name: "detail.jpg" }),
  ).not.toBeChecked();
  expect(screen.getByText("已选 1 张")).toBeInTheDocument();
});

it("keeps storyboard edits across the sidebar and component setup and retries with a single submission", async () => {
  const user = userEvent.setup();
  library.list.mockResolvedValue(photos);
  planLocal.mockResolvedValue({
    script: {
      title: "产品视频",
      width: 1080,
      height: 1920,
      scenes: [{ id: "scene", type: "image", asset: "front.jpg", duration: 4 }],
    },
    assets: [
      { id: "front", export_name: "front.jpg", media_type: "image/jpeg" },
    ],
    generator: "template",
  });
  let finishFirstSubmission!: (result: {
    jobId: string;
    state: string;
  }) => void;
  const firstSubmission = new Promise<{ jobId: string; state: string }>(
    (resolve) => {
      finishFirstSubmission = resolve;
    },
  );
  library.renderLocal
    .mockReturnValueOnce(firstSubmission)
    .mockResolvedValueOnce({ jobId: "retried", state: "rendering" });
  library.jobStatus.mockImplementation(async (id: string) =>
    id === "first"
      ? { id, state: "failed", errorCode: "RENDER_FAILED" }
      : { id, state: "completed", videoUrl: "/sample.mp4", progress: 1 },
  );
  renderFlow({
    pathname: "/local-video-wizard",
    state: { assetIds: ["front"] },
  });

  await user.click(
    await screen.findByRole("button", { name: zh.localVideoWizard.next }),
  );
  await user.click(button(zh.localVideoWizard.generate));
  const duration = await screen.findByRole("spinbutton");
  await user.clear(duration);
  await user.type(duration, "7");
  await user.tab();
  await user.click(button(zh.localVideoWizard.next));

  await user.click(screen.getByRole("link", { name: "组件设置侧栏入口" }));
  await user.click(screen.getByRole("link", { name: "制作向导侧栏入口" }));
  await user.click(await screen.findByRole("button", { name: "安装视频组件" }));
  await user.click(button(zh.videoEnvironment.installNow));
  await user.click(
    await screen.findByRole("button", { name: "返回并生成视频" }),
  );

  expect(library.renderLocal).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("link", { name: "组件设置侧栏入口" }));
  await act(async () => {
    finishFirstSubmission({ jobId: "first", state: "rendering" });
  });
  await user.click(screen.getByRole("link", { name: "制作向导侧栏入口" }));

  expect(
    await screen.findByText("视频未生成", {}, { timeout: 3000 }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "下载 MP4" }),
  ).not.toBeInTheDocument();
  const retry = button("重新生成视频");
  act(() => {
    fireEvent.click(retry);
    fireEvent.click(retry);
  });
  const download = await screen.findByRole(
    "button",
    { name: "下载 MP4" },
    { timeout: 3000 },
  );
  expect(document.querySelector("video")).toHaveAttribute("src", "/sample.mp4");
  await user.click(download);
  expect(environment.save).toHaveBeenCalledExactlyOnceWith("retried");
  expect(library.renderLocal).toHaveBeenCalledTimes(2);
  for (const [submission] of library.renderLocal.mock.calls) {
    expect(submission.assetMap).toEqual({ "front.jpg": "front" });
    expect(submission.script.scenes[0].duration).toBe(7);
  }
});
