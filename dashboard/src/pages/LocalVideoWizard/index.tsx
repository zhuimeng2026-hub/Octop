import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Empty,
  Image,
  Input,
  InputNumber,
  Progress,
  Spin,
  Select,
  Space,
  Steps,
  Switch,
  Typography,
  Collapse,
} from "antd";
import { encodeVideoBrief, joinPlatforms } from "../ProductVideoWizard/brief";
import type { PlatformKey } from "../ProductVideoWizard/platforms";
import PageShell from "../../layouts/PageShell";
import VideoEnvironmentPage from "../VideoEnvironment";
import { useDesktopVideoJobs } from "../../context/DesktopVideoJobsContext";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { message } from "../../utils/antdMessage";
import {
  isLocalLibraryAvailable,
  localLibrary,
  supportsLocalRenderTargets,
  planLocal,
  type LocalAsset,
  type LocalPlanResult,
  type LocalProduct,
} from "../../api/localLibrary";
import {
  LocalVideoJobResults,
  LocalVideoTargetSettings,
  defaultLocalVideoTargets,
  type LocalVideoTarget,
} from "./LocalVideoOutput";
import type { DesktopVideoOutput } from "../../context/DesktopVideoJobsContext";

const activeStates = new Set([
  "preparing",
  "downloading",
  "rendering",
  "starting",
  "saving",
]);
const pendingSubmissions = new Map<
  string,
  Promise<{ jobId: string; state: string }>
>();
const pendingTargetSpecs = new Map<string, LocalVideoTarget[]>();
const platformOptions: ReadonlyArray<readonly [PlatformKey, string]> = [
  ["douyin", "抖音"],
  ["xiaohongshu", "小红书"],
  ["channels", "视频号"],
  ["kuaishou", "快手"],
  ["bilibili", "B站"],
  ["tiktok", "TikTok"],
  ["instagram", "Instagram"],
  ["youtube", "YouTube"],
] as const;
const newDraftId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
type Job = {
  id: string;
  state: string;
  progress?: number | null;
  errorCode?: string;
  videoUrl?: string;
  targets?: DesktopVideoOutput[];
};
type Entry = { assetIds?: string[]; productId?: string };
type WizardDraft = {
  draftId: string;
  assetIds: string[];
  productId: string;
  sourceProductIds?: string[];
  title: string;
  format: "portrait" | "landscape" | "square";
  language: "zh" | "en";
  seconds: number;
  sellingPoints: boolean;
  instructions: string;
  generator: "template" | "llm";
  purpose: string;
  audience: string;
  platforms: string[];
  targetDuration: string;
  style: string;
  supplementalRequirements: string;
  advancedSettings: boolean;
  fineAdjustments: boolean;
  targets: LocalVideoTarget[];
  step: number;
  plan: LocalPlanResult | null;
  job: Job | null;
  batchHistory?: Job[];
};
function readDraft(key: string): WizardDraft | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as WizardDraft) : null;
  } catch {
    return null;
  }
}

function LocalVideoWizardInner({ ownerId }: { ownerId: string | number }) {
  const { t } = useTranslation();
  const desktopVideo = useDesktopVideoJobs();
  const currentUser = { id: ownerId };
  const navigate = useNavigate();
  const location = useLocation();
  const entry = (location.state || {}) as Entry;
  const hasEntry = Boolean(entry.assetIds?.length || entry.productId);
  const draftKey =
    currentUser?.id && ownerId !== "anonymous"
      ? `octop.local-video-wizard.draft.${currentUser.id}`
      : null;
  const draft = useMemo(
    () => (draftKey && !hasEntry ? readDraft(draftKey) : null),
    [draftKey, hasEntry],
  );
  const [assets, setAssets] = useState<LocalAsset[]>([]);
  const [products, setProducts] = useState<LocalProduct[]>([]);
  const [productId, setProductId] = useState(
    hasEntry ? entry.productId || "" : draft?.productId || "",
  );
  const [sourceProductIds, setSourceProductIds] = useState<string[]>(
    draft?.sourceProductIds ?? (draft?.productId ? [draft.productId] : []),
  );
  const [selected, setSelected] = useState<string[]>(
    (hasEntry ? entry.assetIds || [] : draft?.assetIds || []).slice(0, 200),
  );
  const [draftId] = useState(() => draft?.draftId || newDraftId());
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [title, setTitle] = useState(draft?.title || "");
  const [format, setFormat] = useState<"portrait" | "landscape" | "square">(
    draft?.format || "portrait",
  );
  const [language, setLanguage] = useState<"zh" | "en">(
    draft?.language || "zh",
  );
  const [seconds, setSeconds] = useState(draft?.seconds || 4);
  const [sellingPoints, setSellingPoints] = useState(
    draft?.sellingPoints ?? true,
  );
  const [instructions, setInstructions] = useState(draft?.instructions || "");
  const [generator, setGenerator] = useState<"template" | "llm">(
    draft?.generator || "template",
  );
  const [purpose, setPurpose] = useState(draft?.purpose || "");
  const [audience, setAudience] = useState(draft?.audience || "");
  const [platforms, setPlatforms] = useState<string[]>(draft?.platforms || []);
  const [targetDuration, setTargetDuration] = useState(
    draft?.targetDuration || "",
  );
  const [style, setStyle] = useState(draft?.style || "");
  const [supplementalRequirements, setSupplementalRequirements] = useState(
    draft?.supplementalRequirements || "",
  );
  const [advancedSettings, setAdvancedSettings] = useState(
    draft?.advancedSettings ?? false,
  );
  const [fineAdjustments, setFineAdjustments] = useState(
    draft?.fineAdjustments ?? false,
  );
  const [targets, setTargets] = useState<LocalVideoTarget[]>(
    draft?.targets || [],
  );
  const [savingOutput, setSavingOutput] = useState(false);
  const [step, setStep] = useState(draft?.step ?? 0);
  const [showEnvironment, setShowEnvironment] = useState(false);
  const [plan, setPlan] = useState<LocalPlanResult | null>(draft?.plan || null);
  const [job, setJob] = useState<Job | null>(draft?.job || null);
  const [batchHistory, setBatchHistory] = useState<Job[]>(
    draft?.batchHistory || [],
  );
  const [busy, setBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const renderSubmitting = useRef(false);
  const submittedTargets = useRef(new Map<string, LocalVideoTarget[]>());
  const pendingTargets = useRef(new Map<string, LocalVideoTarget[]>());
  const [error, setError] = useState("");
  const [environmentError, setEnvironmentError] = useState(false);
  const available = isLocalLibraryAvailable();
  const environmentReady =
    !desktopVideo.environmentSupported ||
    desktopVideo.environmentStatus.state === "ready";
  const batchSupported =
    typeof supportsLocalRenderTargets === "function" &&
    supportsLocalRenderTargets() &&
    desktopVideo.environmentStatus.outputBatchSupported === true;
  const product = products.find((p) => p.id === productId);
  const visible = assets.filter((a) =>
    sourceProductIds.includes(a.productId || ""),
  );
  const chosen = assets.filter((a) => selected.includes(a.id));
  const name = (
    title.trim() ||
    product?.name ||
    t("localVideoWizard.defaultTitle")
  ).slice(0, 200);
  const normalizeJob = (raw: Job, expected?: LocalVideoTarget[]): Job => {
    const specs = expected ?? submittedTargets.current.get(raw.id);
    if (!specs?.length) return raw;
    const actual = new Map(
      (raw.targets ?? []).map((target) => [target.id, target]),
    );
    return {
      ...raw,
      targets: specs.map((spec) => ({
        ...spec,
        ...(actual.get(spec.id) ?? {}),
        id: spec.id,
        platform: spec.platform,
        filename: spec.filename,
        width: spec.width,
        height: spec.height,
        fps: spec.fps,
        status:
          actual.get(spec.id)?.status ??
          (raw.state === "completed" || raw.state === "failed"
            ? "failed"
            : "queued"),
        ...(actual.has(spec.id)
          ? {}
          : raw.state === "completed" || raw.state === "failed"
          ? { errorCode: "TARGET_RESULT_MISSING" }
          : {}),
      })),
    };
  };
  useEffect(() => {
    if (!job?.targets?.length) return;
    submittedTargets.current.set(
      job.id,
      job.targets.map((target) => ({
        id: target.id,
        platform: target.platform,
        profile: target.profile,
        width: target.width,
        height: target.height,
        fps: target.fps,
        filename: target.filename,
      })),
    );
  }, [job?.id, job?.targets]);

  useEffect(() => {
    if (!available) return;
    let alive = true;
    Promise.all([localLibrary.list(), localLibrary.listProducts()])
      .then(([items, prods]) => {
        if (!alive) return;
        setAssets(items);
        setProducts(prods);
        const initialProduct = hasEntry
          ? entry.productId ||
            items.find((a) => entry.assetIds?.includes(a.id))?.productId ||
            ""
          : draft?.productId || prods[0]?.id || "";
        const initialSources = hasEntry
          ? Array.from(
              new Set([
                initialProduct,
                ...items
                  .filter((a) => entry.assetIds?.includes(a.id))
                  .map((a) => a.productId || ""),
              ]),
            )
          : draft?.sourceProductIds ?? [initialProduct];
        if (hasEntry || !draft) setProductId(initialProduct);
        setSourceProductIds(initialSources);
        if (!hasEntry && !draft)
          setSelected(
            items
              .filter((a) => initialSources.includes(a.productId || ""))
              .map((a) => a.id)
              .slice(0, 200),
          );
      })
      .catch(() => {
        if (alive) setError(t("localVideoWizard.loadFailed"));
      });
    return () => {
      alive = false;
    };
    // Entry state is consumed only on mount; a sidebar round-trip restores the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available]);
  useEffect(() => {
    try {
      if (!draftKey) return;
      sessionStorage.setItem(
        draftKey,
        JSON.stringify({
          assetIds: selected,
          draftId,
          productId,
          sourceProductIds,
          title,
          format,
          language,
          seconds,
          sellingPoints,
          instructions,
          generator,
          purpose,
          audience,
          platforms,
          targetDuration,
          style,
          supplementalRequirements,
          advancedSettings,
          fineAdjustments,
          targets,
          step,
          plan,
          job: job ? { ...job, videoUrl: undefined } : null,
          batchHistory,
        } satisfies WizardDraft),
      );
    } catch {
      // Draft persistence is best effort; the inline environment route still preserves state.
    }
  }, [
    draftId,
    draftKey,
    format,
    generator,
    instructions,
    job,
    language,
    plan,
    productId,
    sourceProductIds,
    seconds,
    selected,
    sellingPoints,
    step,
    title,
    purpose,
    audience,
    platforms,
    targetDuration,
    style,
    supplementalRequirements,
    advancedSettings,
    fineAdjustments,
    targets,
    batchHistory,
  ]);
  useEffect(() => {
    let alive = true;
    visible.forEach((a) => {
      if (a.mediaType.startsWith("image/") && !previews[a.id])
        void localLibrary.previewUrl(a.id).then((url) => {
          if (alive && url) setPreviews((old) => ({ ...old, [a.id]: url }));
        });
    });
    return () => {
      alive = false;
    };
  }, [assets, sourceProductIds, previews]);
  useEffect(() => {
    if (!job || !activeStates.has(job.state)) return;
    let alive = true;
    const timer = window.setInterval(() => {
      void localLibrary
        .jobStatus(job.id)
        .then((next) => {
          if (alive) setJob(normalizeJob(next));
        })
        .catch(() => {
          if (alive) setError(t("localVideoWizard.statusFailed"));
        });
    }, 1200);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [job?.id, job?.state, t]);
  useEffect(() => {
    if (!job || job.state !== "completed" || job.videoUrl) return;
    let alive = true;
    void localLibrary
      .jobStatus(job.id)
      .then((updated) => {
        if (alive) setJob(normalizeJob(updated));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [job?.id, job?.state, job?.videoUrl]);
  useEffect(() => {
    if (!currentUser?.id || !plan) return;
    const pending = pendingSubmissions.get(draftId);
    if (!pending) return;
    let alive = true;
    setBusy(true);
    void pending
      .then((result) => {
        if (alive) {
          setJob(
            normalizeJob(
              { id: result.jobId, state: result.state },
              pendingTargetSpecs.get(draftId) ??
                pendingTargets.current.get(draftId),
            ),
          );
          setStep(4);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setBusy(false);
        if (pendingSubmissions.get(draftId) === pending) {
          pendingSubmissions.delete(draftId);
        }
      });
    return () => {
      alive = false;
    };
  }, [draftId, job, plan]);

  useEffect(() => {
    if (
      step !== 3 ||
      !desktopVideo.environmentSupported ||
      desktopVideo.environmentStatus.state !== "unknown"
    )
      return;
    void desktopVideo.checkEnvironment().catch(() => {
      setError(t("localVideoWizard.environmentCheckFailed"));
      setEnvironmentError(true);
    });
  }, [
    step,
    desktopVideo.environmentSupported,
    desktopVideo.environmentStatus.state,
    desktopVideo.checkEnvironment,
    t,
  ]);

  const changeProduct = (id: string) => {
    setProductId(id);
    setTitle("");
  };
  const generate = async () => {
    if (!chosen.length) {
      setError(t("localVideoWizard.selectFirst"));
      return;
    }
    setBusy(true);
    setError("");
    setEnvironmentError(false);
    try {
      const briefInstructions =
        generator === "llm"
          ? encodeVideoBrief({
              purpose,
              audience,
              platform: joinPlatforms(platforms),
              targetDuration,
              style,
              sellingPoints: sellingPoints
                ? t("localVideoWizard.sellingPointsEnabled")
                : "",
              extra: [instructions, supplementalRequirements]
                .filter(Boolean)
                .join("\n")
                .slice(0, 1800),
            })
          : instructions;
      const result = await planLocal({
        product: {
          name,
          model: product?.model,
          category: product?.category,
          selling_points: product?.sellingPoints,
        },
        assets: chosen.map((a) => ({
          id: a.id,
          filename: a.filename,
          media_type: a.mediaType,
          ...(generator === "llm"
            ? { description: a.description, tags: a.tags, category: a.category }
            : {}),
          usage: "scene",
          priority: 0,
        })),
        generator,
        request: {
          instructions: briefInstructions,
          format,
          language,
          seconds_per_asset: seconds,
          include_selling_points: sellingPoints,
        },
      });
      setPlan(result);
      setStep(2);
    } catch (e) {
      if (
        e instanceof Error &&
        e.message === "Video brief exceeds the instructions limit"
      ) {
        setError(t("localVideoWizard.briefTooLong"));
        setBusy(false);
        return;
      }
      setError(
        `${t("localVideoWizard.planFailed")} ${String(
          (e as Error)?.message || "",
        )}`,
      );
    } finally {
      setBusy(false);
    }
  };
  const render = async (
    requestTargets?: LocalVideoTarget[],
    priorJob?: Job,
  ) => {
    if (!plan || renderSubmitting.current) {
      if (renderSubmitting.current) setError(t("localVideoWizard.busy"));
      return;
    }
    if (requestTargets) {
      if (!batchSupported) {
        setError(t("localVideoWizard.batchUnavailable"));
        return;
      }
      if (
        !requestTargets.length ||
        requestTargets.some((target) => target.width < 1 || target.height < 1)
      ) {
        setError(t("localVideoWizard.invalidTarget"));
        return;
      }
    }
    const pending = pendingSubmissions.get(draftId);
    if (pending) {
      setError(t("localVideoWizard.renderAlreadyRunning"));
      return;
    }
    renderSubmitting.current = true;
    setBusy(true);
    setError("");
    setEnvironmentError(false);
    let submission: Promise<{ jobId: string; state: string }> | undefined;
    try {
      const assetMap = Object.fromEntries(
        plan.assets.map((a) => [a.export_name, a.id]),
      );
      const projectId = `local-${Date.now()}`;
      const effectiveTargets =
        requestTargets ?? (targets.length ? targets : undefined);
      if (effectiveTargets?.length && !batchSupported) {
        setError(t("localVideoWizard.batchUnavailable"));
        return;
      }
      if (
        effectiveTargets?.some(
          (target) => target.width < 1 || target.height < 1,
        )
      ) {
        setError(t("localVideoWizard.invalidTarget"));
        return;
      }
      submission = localLibrary.renderLocal({
        projectId,
        title: name,
        script: plan.script,
        assetMap,
        ...(effectiveTargets ? { targets: effectiveTargets } : {}),
      });
      if (effectiveTargets?.length) {
        const specs = effectiveTargets.map((target) => ({ ...target }));
        pendingTargets.current.set(draftId, specs);
        pendingTargetSpecs.set(draftId, specs);
      }
      pendingSubmissions.set(draftId, submission);
      const result = await submission;
      const submitted = effectiveTargets?.length
        ? effectiveTargets.map((target) => ({ ...target }))
        : undefined;
      if (submitted) submittedTargets.current.set(result.jobId, submitted);
      const nextJob = {
        id: result.jobId,
        state: result.state,
        ...(submitted
          ? {
              targets: normalizeJob(
                { id: result.jobId, state: result.state },
                submitted,
              ).targets,
            }
          : {}),
      };
      setJob(nextJob);
      const nextHistory = effectiveTargets
        ? priorJob &&
          priorJob.targets?.some((target) => target.status === "completed")
          ? [
              priorJob,
              ...batchHistory.filter((item) => item.id !== priorJob.id),
            ]
          : batchHistory
        : [];
      setBatchHistory(nextHistory);
      setStep(4);
      if (draftKey) {
        try {
          const stored = JSON.parse(
            sessionStorage.getItem(draftKey) || "null",
          ) as WizardDraft | null;
          if (stored?.draftId === draftId) {
            sessionStorage.setItem(
              draftKey,
              JSON.stringify({
                ...stored,
                step: 4,
                job: nextJob,
                batchHistory: nextHistory,
              }),
            );
          }
        } catch {
          // Draft persistence is best effort.
        }
      }
    } catch (e) {
      const err = e as { code?: string; message?: string };
      setEnvironmentError(
        /RUNTIME_MISSING|BROWSER_MISSING|ENV_/.test(
          err.code || err.message || "",
        ),
      );
      const code = err.code || err.message || "";
      setError(
        code === "BUSY"
          ? t("localVideoWizard.busy")
          : code === "BATCH_UNAVAILABLE"
          ? t("localVideoWizard.batchUnavailable")
          : code === "INVALID_TARGETS"
          ? t("localVideoWizard.invalidTarget")
          : t("localVideoWizard.renderStartFailed"),
      );
    } finally {
      if (submission) {
        pendingSubmissions.delete(draftId);
      }
      pendingTargets.current.delete(draftId);
      pendingTargetSpecs.delete(draftId);
      renderSubmitting.current = false;
      setBusy(false);
    }
  };
  const retryTarget = async (targetId: string) => {
    const failed = job?.targets?.find(
      (target) => target.id === targetId && target.status === "failed",
    );
    const retrySpec =
      submittedTargets.current
        .get(job?.id ?? "")
        ?.find((target) => target.id === targetId) ??
      targets.find((target) => target.id === targetId);
    if (!job || !failed || !retrySpec) return;
    await render([retrySpec], job);
  };
  const saveOutput = async (targetJob: Job) => {
    if (savingOutput) return;
    setSavingOutput(true);
    try {
      const bridgeSupportsSave =
        typeof supportsLocalRenderTargets === "function" &&
        supportsLocalRenderTargets();
      const saved = targetJob.targets?.length
        ? bridgeSupportsSave
          ? await localLibrary.saveLocalBatch(targetJob.id)
          : await desktopVideo.save(targetJob.id)
        : bridgeSupportsSave
        ? await localLibrary.saveLocal(targetJob.id)
        : await desktopVideo.save(targetJob.id);
      if (saved) message.success(t("localVideoWizard.videoSaved"));
    } catch {
      message.error(t("localVideoWizard.downloadFailed"));
    } finally {
      setSavingOutput(false);
    }
  };
  const setDuration = (index: number, value: number | null) => {
    if (!plan || value === null) return;
    setPlan({
      ...plan,
      script: {
        ...plan.script,
        scenes: plan.script.scenes.map((scene, i) =>
          i === index ? { ...scene, duration: value } : scene,
        ),
      },
    });
  };
  const updateScene = (index: number, changes: Record<string, unknown>) => {
    if (!plan) return;
    setPlan({
      ...plan,
      script: {
        ...plan.script,
        scenes: plan.script.scenes.map((scene, i) =>
          i === index ? { ...scene, ...changes } : scene,
        ),
      },
    });
  };
  const moveScene = (index: number, direction: -1 | 1) => {
    if (!plan) return;
    const next = index + direction;
    if (next < 0 || next >= plan.script.scenes.length) return;
    const scenes = [...plan.script.scenes];
    [scenes[index], scenes[next]] = [scenes[next], scenes[index]];
    setPlan({ ...plan, script: { ...plan.script, scenes } });
  };
  const saveVideo = async () => {
    if (!job || job.state !== "completed" || !job.videoUrl || downloadBusy)
      return;
    setDownloadBusy(true);
    try {
      const saved = await desktopVideo.save(job.id);
      if (saved) message.success(t("localVideoWizard.videoSaved"));
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code !== "CANCELLED")
        message.error(t("localVideoWizard.downloadFailed"));
    } finally {
      setDownloadBusy(false);
    }
  };
  const envLink = (
    <Button
      type={environmentReady ? "link" : "primary"}
      onClick={() => setShowEnvironment(true)}
    >
      {t(
        environmentReady
          ? "localVideoWizard.environment"
          : desktopVideo.environmentStatus.requiresInstall ||
            ["RUNTIME_MISSING", "BROWSER_MISSING"].includes(
              desktopVideo.environmentStatus.errorCode || "",
            )
          ? "localVideoWizard.installComponents"
          : "localVideoWizard.checkEnvironment",
      )}
    </Button>
  );
  if (available && !currentUser)
    return (
      <PageShell
        title={t("localVideoWizard.title")}
        subtitle={t("localVideoWizard.subtitle")}
      >
        <Spin tip={t("localVideoWizard.loadingUser")} />
      </PageShell>
    );
  if (showEnvironment)
    return (
      <VideoEnvironmentPage
        onReturn={() => setShowEnvironment(false)}
        onReady={() => {
          setShowEnvironment(false);
          void render();
        }}
      />
    );
  return (
    <PageShell
      title={t("localVideoWizard.title")}
      subtitle={t("localVideoWizard.subtitle")}
    >
      {!available ? (
        <Alert type="warning" message={t("localVideoWizard.desktopOnly")} />
      ) : (
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          <Steps
            current={step}
            items={[
              "materials",
              "settings",
              "storyboard",
              "confirm",
              "result",
            ].map((key) => ({ title: t(`localVideoWizard.steps.${key}`) }))}
          />
          {error && (
            <Alert
              type="error"
              showIcon
              message={error}
              action={
                environmentError ? (
                  envLink
                ) : plan && step === 3 ? (
                  <Button type="primary" onClick={() => void render()}>
                    {t("localVideoWizard.retryRender")}
                  </Button>
                ) : undefined
              }
              closable
              onClose={() => setError("")}
            />
          )}
          {step === 0 && (
            <Card title={t("localVideoWizard.steps.materials")}>
              <Space direction="vertical" style={{ width: "100%" }}>
                {assets.length > 0 && (
                  <Space direction="vertical" style={{ width: "100%" }}>
                    <Typography.Text strong>
                      {t("localVideoWizard.mainProduct")}
                    </Typography.Text>
                    <Select
                      aria-label={t("localVideoWizard.mainProduct")}
                      value={productId}
                      onChange={changeProduct}
                      style={{ width: 300 }}
                      options={[
                        ...products.map((p) => ({
                          value: p.id,
                          label: p.name,
                        })),
                        { value: "", label: t("localVideoWizard.inbox") },
                      ]}
                    />
                    <Typography.Text strong>
                      {t("localVideoWizard.materialSources")}
                    </Typography.Text>
                    <Space wrap>
                      {[
                        ...products,
                        { id: "", name: t("localVideoWizard.inbox") },
                      ].map((source) => (
                        <Checkbox
                          key={source.id || "inbox"}
                          aria-label={source.name}
                          checked={sourceProductIds.includes(source.id)}
                          onChange={(event) =>
                            setSourceProductIds((old) =>
                              event.target.checked
                                ? Array.from(new Set([...old, source.id]))
                                : old.filter((id) => id !== source.id),
                            )
                          }
                        >
                          {source.name}
                        </Checkbox>
                      ))}
                    </Space>
                  </Space>
                )}
                <Typography.Text type="secondary">
                  {t("localVideoWizard.selectedCount", {
                    count: selected.length,
                  })}
                </Typography.Text>
                {selected.length >= 200 && (
                  <Typography.Text type="warning">
                    {t("localVideoWizard.selectionLimit")}
                  </Typography.Text>
                )}
                {visible.length ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                    {visible.map((a) => (
                      <Card key={a.id} size="small" style={{ width: 150 }}>
                        <Checkbox
                          aria-label={a.filename}
                          disabled={
                            !selected.includes(a.id) && selected.length >= 200
                          }
                          checked={selected.includes(a.id)}
                          onChange={(e) =>
                            setSelected((old) =>
                              e.target.checked
                                ? [...old, a.id]
                                : old.filter((id) => id !== a.id),
                            )
                          }
                        />
                        {previews[a.id] && (
                          <Image
                            src={previews[a.id]}
                            alt={a.filename}
                            height={90}
                            style={{ objectFit: "contain" }}
                          />
                        )}
                        <Typography.Paragraph
                          ellipsis={{ rows: 2 }}
                          title={a.filename}
                        >
                          {a.filename}
                        </Typography.Paragraph>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <Empty description={t("localVideoWizard.noMaterials")}>
                    <Button
                      type="primary"
                      onClick={() => navigate("/local-library")}
                    >
                      {t("localVideoWizard.importImages")}
                    </Button>
                  </Empty>
                )}
                {chosen.length > 0 && (
                  <Button
                    type="primary"
                    onClick={() => {
                      setError("");
                      setStep(1);
                    }}
                  >
                    {t("localVideoWizard.next")}
                  </Button>
                )}
              </Space>
            </Card>
          )}
          {step === 1 && (
            <Card title={t("localVideoWizard.steps.settings")}>
              <Space direction="vertical" style={{ width: "100%" }}>
                <Typography.Title level={4} style={{ margin: 0 }}>
                  {t("localVideoWizard.beginnerSummaryTitle")}
                </Typography.Title>
                <Typography.Paragraph type="secondary">
                  {t("localVideoWizard.beginnerSummary", {
                    format: t(`localVideoWizard.formats.${format}`),
                    seconds,
                    sellingPoints: sellingPoints
                      ? t("localVideoWizard.sellingPointsEnabled")
                      : t("localVideoWizard.sellingPointsDisabled"),
                  })}
                </Typography.Paragraph>
                <Button
                  type="link"
                  onClick={() => setAdvancedSettings((value) => !value)}
                >
                  {advancedSettings
                    ? t("localVideoWizard.hideMoreParameters")
                    : t("localVideoWizard.moreParameters")}
                </Button>
                {!advancedSettings && (
                  <Typography.Text type="secondary">
                    {t("localVideoWizard.beginnerDefaults")}
                  </Typography.Text>
                )}
                {advancedSettings && (
                  <Collapse
                    defaultActiveKey={["settings"]}
                    items={[
                      {
                        key: "settings",
                        label: t("localVideoWizard.moreParameters"),
                        children: (
                          <Space direction="vertical" style={{ width: "100%" }}>
                            <label>
                              {t("localVideoWizard.videoTitle")}
                              <Input
                                value={title}
                                maxLength={200}
                                placeholder={
                                  product?.name ||
                                  t("localVideoWizard.defaultTitle")
                                }
                                onChange={(e) => setTitle(e.target.value)}
                              />
                            </label>
                            <label>
                              {t("localVideoWizard.format")}{" "}
                              <Select
                                value={format}
                                onChange={setFormat}
                                options={[
                                  "portrait",
                                  "landscape",
                                  "square",
                                ].map((v) => ({
                                  value: v,
                                  label: t(`localVideoWizard.formats.${v}`),
                                }))}
                              />
                            </label>
                            <label>
                              {t("localVideoWizard.generator")}{" "}
                              <Select
                                value={generator}
                                onChange={setGenerator}
                                options={[
                                  {
                                    value: "template",
                                    label: t("localVideoWizard.template"),
                                  },
                                  {
                                    value: "llm",
                                    label: t("localVideoWizard.ai"),
                                  },
                                ]}
                              />
                            </label>
                            {generator === "llm" && (
                              <Typography.Text type="secondary">
                                {t("localVideoWizard.aiHint")}
                              </Typography.Text>
                            )}
                            {generator === "llm" && (
                              <label>
                                {t("localVideoWizard.language")}{" "}
                                <Select
                                  value={language}
                                  onChange={setLanguage}
                                  options={[
                                    { value: "zh", label: "中文" },
                                    { value: "en", label: "English" },
                                  ]}
                                />
                              </label>
                            )}
                            <label>
                              {t("localVideoWizard.seconds")}{" "}
                              <InputNumber
                                min={1}
                                max={15}
                                value={seconds}
                                onChange={(v) => setSeconds(v ?? 4)}
                              />
                            </label>
                            <label>
                              {t("localVideoWizard.sellingPoints")}{" "}
                              <Switch
                                checked={sellingPoints}
                                onChange={setSellingPoints}
                              />
                            </label>
                            {generator === "llm" && (
                              <label>
                                {t("localVideoWizard.instructions")}
                                <Input.TextArea
                                  value={instructions}
                                  maxLength={3000}
                                  onChange={(e) =>
                                    setInstructions(e.target.value)
                                  }
                                />
                              </label>
                            )}
                            <label>
                              {t("localVideoWizard.purpose")}
                              <Input
                                value={purpose}
                                onChange={(e) => setPurpose(e.target.value)}
                              />
                            </label>
                            <label>
                              {t("localVideoWizard.audience")}
                              <Input
                                value={audience}
                                onChange={(e) => setAudience(e.target.value)}
                              />
                            </label>
                            <label>
                              {t("localVideoWizard.platforms")}
                              <Checkbox.Group
                                value={platforms}
                                onChange={(values) =>
                                  setPlatforms(values as string[])
                                }
                                style={{
                                  display: "flex",
                                  flexWrap: "wrap",
                                  gap: "8px 16px",
                                }}
                              >
                                {platformOptions.map(([value, label]) => (
                                  <Checkbox key={value} value={value}>
                                    {label}
                                  </Checkbox>
                                ))}
                              </Checkbox.Group>
                            </label>
                            <label>
                              {t("localVideoWizard.targetDuration")}
                              <Input
                                value={targetDuration}
                                onChange={(e) =>
                                  setTargetDuration(e.target.value)
                                }
                              />
                            </label>
                            <label>
                              {t("localVideoWizard.style")}
                              <Input
                                value={style}
                                onChange={(e) => setStyle(e.target.value)}
                              />
                            </label>
                            <label>
                              {t("localVideoWizard.supplementalRequirements")}
                              <Input.TextArea
                                value={supplementalRequirements}
                                maxLength={1000}
                                onChange={(e) =>
                                  setSupplementalRequirements(e.target.value)
                                }
                              />
                            </label>
                          </Space>
                        ),
                      },
                    ]}
                  />
                )}
                <Space>
                  <Button onClick={() => setStep(0)}>
                    {t("localVideoWizard.back")}
                  </Button>
                  <Button
                    type="primary"
                    loading={busy}
                    onClick={() => void generate()}
                  >
                    {t("localVideoWizard.generate")}
                  </Button>
                </Space>
              </Space>
            </Card>
          )}
          {step === 2 && plan && (
            <Card title={t("localVideoWizard.steps.storyboard")}>
              <Space direction="vertical" style={{ width: "100%" }}>
                <Typography.Text>
                  {t("localVideoWizard.storyboardHint")}
                </Typography.Text>
                {plan.script.scenes.map((scene, i) => {
                  const assetId = plan.assets.find(
                    (asset) => asset.export_name === scene.asset,
                  )?.id;
                  const asset = assets.find((item) => item.id === assetId);
                  const type = [
                    "title",
                    "bullets",
                    "image",
                    "video",
                    "endcard",
                  ].includes(scene.type)
                    ? scene.type
                    : "other";
                  return (
                    <Card
                      key={scene.id}
                      size="small"
                      title={`${i + 1}. ${t(
                        `localVideoWizard.sceneTypes.${type}`,
                      )}`}
                    >
                      <Space direction="vertical">
                        {asset && (
                          <Space>
                            {previews[asset.id] && (
                              <Image
                                src={previews[asset.id]}
                                alt={asset.filename}
                                height={80}
                              />
                            )}
                            <Typography.Text>{asset.filename}</Typography.Text>
                          </Space>
                        )}
                        {typeof scene.text === "string" && (
                          <Typography.Text>{scene.text}</Typography.Text>
                        )}
                        {typeof scene.subtitle === "string" &&
                          scene.subtitle && (
                            <Typography.Text>{scene.subtitle}</Typography.Text>
                          )}
                        {typeof scene.caption === "string" && scene.caption && (
                          <Typography.Text>{scene.caption}</Typography.Text>
                        )}
                        {Array.isArray(scene.bullets) && (
                          <ul>
                            {scene.bullets.map((bullet, index) => (
                              <li key={index}>{String(bullet)}</li>
                            ))}
                          </ul>
                        )}
                        {fineAdjustments &&
                          (typeof scene.text === "string" ||
                            typeof scene.subtitle === "string" ||
                            scene.type === "image" ||
                            scene.type === "video") && (
                            <Space
                              direction="vertical"
                              style={{ width: "100%" }}
                            >
                              {(scene.type === "title" ||
                                scene.type === "endcard" ||
                                typeof scene.text === "string") && (
                                <Input.TextArea
                                  aria-label={t("videoWizard.sceneText")}
                                  maxLength={400}
                                  value={
                                    typeof scene.text === "string"
                                      ? scene.text
                                      : ""
                                  }
                                  onChange={(e) =>
                                    updateScene(i, { text: e.target.value })
                                  }
                                />
                              )}
                              {(scene.type === "title" ||
                                scene.type === "endcard" ||
                                typeof scene.subtitle === "string") && (
                                <Input.TextArea
                                  aria-label={t("videoWizard.sceneSubtitle")}
                                  maxLength={400}
                                  value={
                                    typeof scene.subtitle === "string"
                                      ? scene.subtitle
                                      : ""
                                  }
                                  onChange={(e) =>
                                    updateScene(i, { subtitle: e.target.value })
                                  }
                                />
                              )}
                              {(scene.type === "image" ||
                                scene.type === "video") && (
                                <Input.TextArea
                                  aria-label={t("videoWizard.caption")}
                                  maxLength={400}
                                  value={
                                    typeof scene.caption === "string"
                                      ? scene.caption
                                      : ""
                                  }
                                  onChange={(e) =>
                                    updateScene(i, { caption: e.target.value })
                                  }
                                />
                              )}
                              {(scene.type === "image" ||
                                scene.type === "video") && (
                                <Select
                                  aria-label={t("videoWizard.replaceAsset")}
                                  value={scene.asset}
                                  style={{ width: "100%" }}
                                  options={plan.assets
                                    .filter(
                                      (candidate) =>
                                        candidate.media_type.startsWith(
                                          `${scene.type}/`,
                                        ) &&
                                        (assets.some(
                                          (item) => item.id === candidate.id,
                                        ) ||
                                          candidate.export_name ===
                                            scene.asset),
                                    )
                                    .map((candidate) => ({
                                      value: candidate.export_name,
                                      label: `${
                                        assets.find(
                                          (item) => item.id === candidate.id,
                                        )?.filename ?? candidate.export_name
                                      } (${candidate.export_name})`,
                                    }))}
                                  onChange={(value) =>
                                    updateScene(i, { asset: value })
                                  }
                                />
                              )}
                            </Space>
                          )}
                        <Space>
                          <span>{t("localVideoWizard.sceneDuration")}</span>
                          <InputNumber
                            min={0.25}
                            max={15}
                            step={0.25}
                            value={scene.duration}
                            onChange={(v) => setDuration(i, v)}
                          />
                          {fineAdjustments && (
                            <>
                              <Button
                                size="small"
                                onClick={() => moveScene(i, -1)}
                                disabled={
                                  i === 0 ||
                                  scene.type === "title" ||
                                  scene.type === "endcard" ||
                                  plan.script.scenes[i - 1]?.type === "title" ||
                                  plan.script.scenes[i - 1]?.type === "endcard"
                                }
                              >
                                {t("videoWizard.moveUp")}
                              </Button>
                              <Button
                                size="small"
                                onClick={() => moveScene(i, 1)}
                                disabled={
                                  i === plan.script.scenes.length - 1 ||
                                  scene.type === "title" ||
                                  scene.type === "endcard" ||
                                  plan.script.scenes[i + 1]?.type === "title" ||
                                  plan.script.scenes[i + 1]?.type === "endcard"
                                }
                              >
                                {t("videoWizard.moveDown")}
                              </Button>
                            </>
                          )}
                        </Space>
                      </Space>
                    </Card>
                  );
                })}
                <Button
                  type="link"
                  onClick={() => setFineAdjustments((value) => !value)}
                >
                  {fineAdjustments
                    ? t("localVideoWizard.hideFineAdjustments")
                    : t("localVideoWizard.fineAdjustments")}
                </Button>
                <Space>
                  <Button onClick={() => setStep(1)}>
                    {t("localVideoWizard.back")}
                  </Button>
                  <Button type="primary" onClick={() => setStep(3)}>
                    {t("localVideoWizard.next")}
                  </Button>
                </Space>
              </Space>
            </Card>
          )}
          {step === 3 && plan && (
            <Card title={t("localVideoWizard.steps.confirm")}>
              <Space direction="vertical" style={{ width: "100%" }}>
                <Typography.Text>
                  {name} · {plan.script.width} × {plan.script.height} ·{" "}
                  {t("localVideoWizard.sceneCount", {
                    count: plan.script.scenes.length,
                  })}
                </Typography.Text>
                <Typography.Text>
                  {t("localVideoWizard.localRender")}
                </Typography.Text>
                <Collapse
                  items={[
                    {
                      key: "batch",
                      label: t("localVideoWizard.multiOutputToggle"),
                      children: (
                        <Space direction="vertical" style={{ width: "100%" }}>
                          {!batchSupported && (
                            <Alert
                              type="info"
                              message={t(
                                "localVideoWizard.multiOutputUnavailable",
                              )}
                            />
                          )}
                          {batchSupported && (
                            <>
                              <LocalVideoTargetSettings
                                targets={targets}
                                platformOptions={platformOptions.map(
                                  ([key, label]) => ({
                                    key,
                                    label,
                                  }),
                                )}
                                onChange={setTargets}
                                disabled={busy}
                              />
                              <Button
                                onClick={() => {
                                  if (!targets.length) {
                                    setError(t("localVideoWizard.noTargets"));
                                    return;
                                  }
                                  void render(targets);
                                }}
                                loading={busy}
                              >
                                {t("localVideoWizard.startBatch")}
                              </Button>
                            </>
                          )}
                        </Space>
                      ),
                    },
                  ]}
                  onChange={(keys) => {
                    const open = keys.includes("batch");
                    if (open && !targets.length && platforms.length) {
                      setTargets(
                        defaultLocalVideoTargets(
                          platforms as Parameters<
                            typeof defaultLocalVideoTargets
                          >[0],
                        ),
                      );
                    }
                  }}
                />
                {environmentReady && envLink}
                {!environmentReady && (
                  <Alert
                    type="warning"
                    message={t("localVideoWizard.environmentNotReady")}
                    action={envLink}
                  />
                )}
                <Space>
                  <Button onClick={() => setStep(2)}>
                    {t("localVideoWizard.back")}
                  </Button>
                  {environmentReady && (
                    <Button
                      type="primary"
                      loading={busy}
                      onClick={() => void render()}
                    >
                      {t("localVideoWizard.render")}
                    </Button>
                  )}
                </Space>
              </Space>
            </Card>
          )}
          {step === 4 && job && (
            <Card title={t("localVideoWizard.steps.result")}>
              {batchHistory.map((historyJob) => (
                <LocalVideoJobResults
                  key={historyJob.id}
                  job={historyJob}
                  onSaveBatch={() => void saveOutput(historyJob)}
                  saving={savingOutput}
                />
              ))}
              {job.targets?.length ? (
                <LocalVideoJobResults
                  job={job}
                  onSaveBatch={() => void saveOutput(job)}
                  onRetryTarget={(targetId) => void retryTarget(targetId)}
                  saving={savingOutput}
                />
              ) : (
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Typography.Text>
                    {t("localVideoWizard.jobState", {
                      state: t(`localLibrary.state.${job.state}`, {
                        defaultValue: job.state,
                      }),
                    })}
                  </Typography.Text>
                  {job.progress != null && (
                    <Progress percent={Math.round(job.progress * 100)} />
                  )}
                  {job.state === "failed" && (
                    <Alert
                      type="error"
                      message={t("localVideoWizard.renderNotCreated")}
                      description={t("localVideoWizard.renderFailureHint")}
                      action={
                        job.errorCode &&
                        /RUNTIME_MISSING|BROWSER_MISSING|ENV_/.test(
                          job.errorCode,
                        )
                          ? envLink
                          : undefined
                      }
                    />
                  )}
                  {job.errorCode && (
                    <Collapse
                      items={[
                        {
                          key: "diagnostics",
                          label: t("localVideoWizard.diagnostics"),
                          children: (
                            <Typography.Text code>
                              {job.errorCode}
                            </Typography.Text>
                          ),
                        },
                      ]}
                    />
                  )}
                  {job.state === "completed" && job.videoUrl && (
                    <>
                      <video
                        controls
                        src={job.videoUrl}
                        style={{ maxWidth: "100%", maxHeight: 480 }}
                      />
                      <Button
                        type="primary"
                        loading={downloadBusy}
                        onClick={() => void saveVideo()}
                      >
                        {t("localVideoWizard.download")}
                      </Button>
                    </>
                  )}
                  {job.state === "failed" && (
                    <Button
                      type="primary"
                      loading={busy}
                      onClick={() => void render()}
                    >
                      {t("localVideoWizard.retryRender")}
                    </Button>
                  )}
                  {!activeStates.has(job.state) && (
                    <Button onClick={() => setStep(3)}>
                      {t("localVideoWizard.back")}
                    </Button>
                  )}
                </Space>
              )}
            </Card>
          )}
        </Space>
      )}
    </PageShell>
  );
}

export default function LocalVideoWizard() {
  const currentUser = useCurrentUser();
  if (!currentUser) {
    return (
      <PageShell title="" subtitle="">
        <Spin />
      </PageShell>
    );
  }
  return (
    <LocalVideoWizardInner
      key={String(currentUser.id)}
      ownerId={currentUser.id}
    />
  );
}
