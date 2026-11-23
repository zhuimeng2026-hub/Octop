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
import PageShell from "../../layouts/PageShell";
import VideoEnvironmentPage from "../VideoEnvironment";
import { useDesktopVideoJobs } from "../../context/DesktopVideoJobsContext";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { message } from "../../utils/antdMessage";
import {
  isLocalLibraryAvailable,
  localLibrary,
  planLocal,
  type LocalAsset,
  type LocalPlanResult,
  type LocalProduct,
} from "../../api/localLibrary";

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
};
type Entry = { assetIds?: string[]; productId?: string };
type WizardDraft = {
  draftId: string;
  assetIds: string[];
  productId: string;
  title: string;
  format: "portrait" | "landscape" | "square";
  language: "zh" | "en";
  seconds: number;
  sellingPoints: boolean;
  instructions: string;
  generator: "template" | "llm";
  step: number;
  plan: LocalPlanResult | null;
  job: Job | null;
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
  const [step, setStep] = useState(draft?.step ?? 0);
  const [showEnvironment, setShowEnvironment] = useState(false);
  const [plan, setPlan] = useState<LocalPlanResult | null>(draft?.plan || null);
  const [job, setJob] = useState<Job | null>(draft?.job || null);
  const [busy, setBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const renderSubmitting = useRef(false);
  const [error, setError] = useState("");
  const [environmentError, setEnvironmentError] = useState(false);
  const available = isLocalLibraryAvailable();
  const environmentReady =
    !desktopVideo.environmentSupported ||
    desktopVideo.environmentStatus.state === "ready";
  const product = products.find((p) => p.id === productId);
  const visible = assets.filter((a) =>
    productId ? a.productId === productId : !a.productId,
  );
  const chosen = visible.filter((a) => selected.includes(a.id));
  const name = (
    title.trim() ||
    product?.name ||
    t("localVideoWizard.defaultTitle")
  ).slice(0, 200);

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
        if (hasEntry || !draft) setProductId(initialProduct);
        if (!hasEntry && !draft)
          setSelected(
            items
              .filter((a) =>
                initialProduct ? a.productId === initialProduct : !a.productId,
              )
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
          title,
          format,
          language,
          seconds,
          sellingPoints,
          instructions,
          generator,
          step,
          plan,
          job: job ? { ...job, videoUrl: undefined } : null,
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
    seconds,
    selected,
    sellingPoints,
    step,
    title,
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
  }, [assets, productId, previews]);
  useEffect(() => {
    if (!job || !activeStates.has(job.state)) return;
    const timer = window.setInterval(() => {
      void localLibrary
        .jobStatus(job.id)
        .then(setJob)
        .catch(() => setError(t("localVideoWizard.statusFailed")));
    }, 1200);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.state, t]);
  useEffect(() => {
    if (!job || job.state !== "completed" || job.videoUrl) return;
    let alive = true;
    void localLibrary
      .jobStatus(job.id)
      .then((updated) => {
        if (alive) setJob(updated);
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
          setJob({ id: result.jobId, state: result.state });
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
    setSelected(
      assets
        .filter((a) => (id ? a.productId === id : !a.productId))
        .map((a) => a.id)
        .slice(0, 200),
    );
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
          instructions,
          format,
          language,
          seconds_per_asset: seconds,
          include_selling_points: sellingPoints,
        },
      });
      setPlan(result);
      setStep(2);
    } catch (e) {
      setError(
        `${t("localVideoWizard.planFailed")} ${String(
          (e as Error)?.message || "",
        )}`,
      );
    } finally {
      setBusy(false);
    }
  };
  const render = async () => {
    if (!plan || renderSubmitting.current) {
      return;
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
      submission = localLibrary.renderLocal({
        projectId,
        title: name,
        script: plan.script,
        assetMap,
      });
      pendingSubmissions.set(draftId, submission);
      const result = await submission;
      setJob({ id: result.jobId, state: result.state });
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
                job: { id: result.jobId, state: result.state },
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
      setError(t("localVideoWizard.renderStartFailed"));
    } finally {
      if (submission) {
        pendingSubmissions.delete(draftId);
      }
      renderSubmitting.current = false;
      setBusy(false);
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
                  <Select
                    value={productId}
                    onChange={changeProduct}
                    style={{ width: 300 }}
                    options={[
                      ...products.map((p) => ({ value: p.id, label: p.name })),
                      { value: "", label: t("localVideoWizard.inbox") },
                    ]}
                  />
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
                <label>
                  {t("localVideoWizard.videoTitle")}
                  <Input
                    value={title}
                    maxLength={200}
                    placeholder={
                      product?.name || t("localVideoWizard.defaultTitle")
                    }
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
                <label>
                  {t("localVideoWizard.format")}{" "}
                  <Select
                    value={format}
                    onChange={setFormat}
                    options={["portrait", "landscape", "square"].map((v) => ({
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
                      { value: "llm", label: t("localVideoWizard.ai") },
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
                  <Switch checked={sellingPoints} onChange={setSellingPoints} />
                </label>
                {generator === "llm" && (
                  <label>
                    {t("localVideoWizard.instructions")}
                    <Input.TextArea
                      value={instructions}
                      maxLength={3000}
                      onChange={(e) => setInstructions(e.target.value)}
                    />
                  </label>
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
                        {Array.isArray(scene.bullets) && (
                          <ul>
                            {scene.bullets.map((bullet, index) => (
                              <li key={index}>{String(bullet)}</li>
                            ))}
                          </ul>
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
                        </Space>
                      </Space>
                    </Card>
                  );
                })}
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
              <Space direction="vertical">
                <Typography.Text>
                  {name} · {plan.script.width} × {plan.script.height} ·{" "}
                  {t("localVideoWizard.sceneCount", {
                    count: plan.script.scenes.length,
                  })}
                </Typography.Text>
                <Typography.Text>
                  {t("localVideoWizard.localRender")}
                </Typography.Text>
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
                      /RUNTIME_MISSING|BROWSER_MISSING|ENV_/.test(job.errorCode)
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
