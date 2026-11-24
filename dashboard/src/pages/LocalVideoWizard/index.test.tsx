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
  saveLocalBatch: vi.fn(),
}));
const planLocal = vi.hoisted(() => vi.fn());
const bridge = vi.hoisted(() => ({ supportsTargets: false }));
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
  supportsLocalRenderTargets: () => bridge.supportsTargets,
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
  bridge.supportsTargets = false;
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
  library.saveLocalBatch.mockResolvedValue(true);
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

it("keeps fine storyboard caption, asset swap, and ordering edits when submitted", async () => {
  const user = userEvent.setup();
  library.list.mockResolvedValue(photos);
  planLocal.mockResolvedValue({
    script: {
      title: "产品视频",
      width: 1080,
      height: 1920,
      scenes: [
        { id: "title", type: "title", text: "标题", duration: 2 },
        { id: "one", type: "image", asset: "front.jpg", duration: 4 },
        { id: "two", type: "image", asset: "detail.jpg", duration: 4 },
        { id: "end", type: "endcard", text: "购买", duration: 2 },
      ],
    },
    assets: [
      { id: "front", export_name: "front.jpg", media_type: "image/jpeg" },
      { id: "detail", export_name: "detail.jpg", media_type: "image/jpeg" },
    ],
    generator: "template",
  });
  library.renderLocal.mockResolvedValue({ jobId: "fine", state: "rendering" });
  setEnvironment({ state: "ready", stage: null, progress: null });
  renderFlow({
    pathname: "/local-video-wizard",
    state: { assetIds: ["front", "detail"] },
  });

  await user.click(
    await screen.findByRole("button", { name: zh.localVideoWizard.next }),
  );
  expect(
    screen.getByText(zh.localVideoWizard.beginnerSummaryTitle),
  ).toBeInTheDocument();
  await user.click(button(zh.localVideoWizard.moreParameters));
  await user.click(button(zh.localVideoWizard.generate));
  await user.click(button(zh.localVideoWizard.fineAdjustments));

  const captions = screen.getAllByRole("textbox", {
    name: zh.videoWizard.caption,
  });
  await user.type(captions[0], "重点字幕");
  const assetSelect = screen.getAllByRole("combobox", {
    name: zh.videoWizard.replaceAsset,
  })[0];
  await user.click(assetSelect);
  await user.click(screen.getAllByText(/detail\.jpg/).at(-1)!);
  const moveUp = screen.getAllByRole("button", { name: zh.videoWizard.moveUp });
  expect(moveUp[0]).toBeDisabled();
  expect(moveUp[1]).toBeDisabled();
  await user.click(moveUp[2]);
  await user.click(button(zh.localVideoWizard.hideFineAdjustments));
  await user.click(button(zh.localVideoWizard.next));
  await user.click(button(zh.localVideoWizard.render));

  await vi.waitFor(() => expect(library.renderLocal).toHaveBeenCalled());
  const submission = library.renderLocal.mock.calls.at(-1)?.[0];
  expect(submission.script.scenes[2].asset).toBe("detail.jpg");
  expect(submission.script.scenes[2].caption).toBe("重点字幕");
  expect(
    submission.script.scenes.map((scene: { id: string }) => scene.id),
  ).toEqual(["title", "two", "one", "end"]);
});

it("retries only the failed batch target and saves the prior batch job", async () => {
  const user = userEvent.setup();
  bridge.supportsTargets = true;
  setEnvironment({
    state: "ready",
    stage: null,
    progress: null,
    outputBatchSupported: true,
  });
  library.list.mockResolvedValue(photos);
  const targets = [
    {
      id: "douyin",
      platform: "douyin",
      profile: "short_vertical",
      width: 1080,
      height: 1920,
      fps: 30,
      filename: "douyin.mp4",
    },
    {
      id: "youtube",
      platform: "youtube",
      profile: "landscape",
      width: 1920,
      height: 1080,
      fps: 30,
      filename: "youtube.mp4",
    },
  ];
  const plan = {
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
  };
  const job = {
    id: "J1",
    state: "completed",
    targets: [
      {
        ...targets[0],
        status: "completed",
        videoUrl: "/douyin.mp4",
      },
      { ...targets[1], status: "failed", errorCode: "RENDER_FAILED" },
    ],
  };
  sessionStorage.setItem(
    "octop.local-video-wizard.draft.42",
    JSON.stringify({
      draftId: "draft-batch",
      assetIds: ["front"],
      productId: "",
      title: "批量商品视频",
      format: "portrait",
      language: "zh",
      seconds: 4,
      sellingPoints: true,
      instructions: "",
      generator: "template",
      purpose: "",
      audience: "",
      platforms: [],
      targetDuration: "",
      style: "",
      supplementalRequirements: "",
      advancedSettings: false,
      fineAdjustments: false,
      targets,
      step: 4,
      plan,
      job,
    }),
  );
  library.jobStatus.mockResolvedValue(job);
  library.renderLocal.mockResolvedValue({ jobId: "J2", state: "rendering" });
  renderFlow("/local-video-wizard");

  await user.click(
    await screen.findByRole("button", {
      name: zh.localVideoWizard.retryTarget,
    }),
  );
  await vi.waitFor(() =>
    expect(library.renderLocal).toHaveBeenCalledWith(
      expect.objectContaining({ targets: [targets[1]] }),
    ),
  );
  await user.click(
    await screen.findByRole("button", { name: zh.localVideoWizard.saveBatch }),
  );
  expect(library.saveLocalBatch).toHaveBeenCalledWith("J1");
});
