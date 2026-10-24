import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  ConfigProvider,
  Empty,
  Input,
  InputNumber,
  Radio,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  Upload,
} from "antd";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock3,
  Circle,
  Download,
  Image as ImageIcon,
  RefreshCw,
  Sparkles,
  Upload as UploadIcon,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  productLibraryApi,
  type Product,
  type ProductAsset,
  type ProductProject,
  type ProductSnapshotAsset,
  type StoryboardDraft,
  type StoryboardScene,
  type StoryboardScript,
  type VideoPlanRequest,
} from "../../api/modules/productLibrary";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import PageShell from "../../layouts/PageShell";
import { message } from "../../utils/antdMessage";
import {
  decodeVideoBrief,
  EMPTY_VIDEO_BRIEF,
  encodeVideoBrief,
  type VideoBrief,
} from "./brief";
import styles from "./index.module.less";

const initialRequest: VideoPlanRequest = {
  instructions: "",
  format: "portrait",
  language: "zh",
  seconds_per_asset: 4,
  include_selling_points: true,
};
const steps = [
  "chooseProduct",
  "requirements",
  "storyboard",
  "confirm",
  "download",
];

function mediaType(asset: ProductSnapshotAsset) {
  return asset.media_type.startsWith("image/")
    ? "image"
    : asset.media_type.startsWith("video/")
    ? "video"
    : null;
}

function exportName(asset: ProductSnapshotAsset, index: number) {
  const safe = asset.filename
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._]+|[._]+$/g, "");
  return `${asset.id}-${safe || `asset-${index}`}`;
}

function isNotFound(error: unknown) {
  return error instanceof Error && /Request failed: 404/.test(error.message);
}

export default function ProductVideoWizardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const currentUser = useCurrentUser();
  const userId = currentUser?.id;
  const requestedProjectId = params.get("project");
  const [step, setStep] = useState(0);
  const [products, setProducts] = useState<Product[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const [assets, setAssets] = useState<ProductAsset[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [project, setProject] = useState<ProductProject | null>(null);
  const [request, setRequest] = useState<VideoPlanRequest>({
    ...initialRequest,
  });
  const [draft, setDraft] = useState<StoryboardDraft | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [assetLoadFailed, setAssetLoadFailed] = useState(false);
  const [assetRetry, setAssetRetry] = useState(0);
  const [previewRetry, setPreviewRetry] = useState(0);
  const [uploads, setUploads] = useState<File[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [brief, setBrief] = useState<VideoBrief>({ ...EMPTY_VIDEO_BRIEF });
  const urlsRef = useRef<Record<string, string>>({});
  const requestVersion = useRef(0);
  const productIdRef = useRef<string | null>(null);
  const tRef = useRef(t);
  tRef.current = t;

  const cleanUrls = () => {
    Object.values(urlsRef.current).forEach(URL.revokeObjectURL);
    urlsRef.current = {};
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    setProducts([]);
    setProduct(null);
    productIdRef.current = null;
    setAssets([]);
    setSelectedAssetIds([]);
    setProject(null);
    setDraft(null);
    setSaved(false);
    setStep(0);
    setRequest({ ...initialRequest });
    setBrief({ ...EMPTY_VIDEO_BRIEF });
    setUploads([]);
    setError("");
    setBusy(false);
    cleanUrls();
    setImageUrls({});
    const version = ++requestVersion.current;
    Promise.all([productLibraryApi.products(), productLibraryApi.projects()])
      .then(async ([p, pr]) => {
        if (!active || version !== requestVersion.current) return;
        setProducts(p.items);
        if (requestedProjectId) {
          const found = pr.items.find((item) => item.id === requestedProjectId);
          if (found) {
            setProject(found);
            setProduct(found.snapshot.product);
            productIdRef.current = found.product_id;
            setSelectedAssetIds(
              found.snapshot.assets
                .filter((a) => a.usage === "scene" && mediaType(a))
                .map((a) => a.id),
            );
            await productLibraryApi
              .getStoryboard(found.id)
              .then((loaded) => {
                if (!active || version !== requestVersion.current) return;
                setDraft(loaded);
                setRequest(loaded.request);
                const restoredBrief = decodeVideoBrief(
                  loaded.request.instructions,
                );
                setBrief({
                  ...restoredBrief,
                  sellingPoints:
                    restoredBrief.sellingPoints ||
                    found.snapshot.product.selling_points.join("\n"),
                });
                setSaved(true);
                setStep(loaded.confirmed ? 4 : 3);
              })
              .catch((err: unknown) => {
                if (!active || version !== requestVersion.current) return;
                if (isNotFound(err)) {
                  setStep(1);
                  setRequest({ ...initialRequest });
                  setBrief((current) => ({ ...current, extra: "" }));
                } else setError(tRef.current("videoWizard.loadFailed"));
              });
          } else {
            setError(tRef.current("videoWizard.unknownProject"));
          }
        }
      })
      .catch(() => {
        if (active && version === requestVersion.current) {
          setError(tRef.current("videoWizard.loadFailed"));
          setLoadFailed(true);
        }
      })
      .finally(() => {
        if (active && version === requestVersion.current) setLoading(false);
      });
    return () => {
      active = false;
      cleanUrls();
    };
  }, [userId, requestedProjectId]);

  useEffect(() => {
    if (!product || project) return;
    let current = true;
    const id = product.id;
    productIdRef.current = id;
    setAssets([]);
    setSelectedAssetIds([]);
    cleanUrls();
    setImageUrls({});
    void productLibraryApi
      .assets(id)
      .then(({ items }) => {
        if (!current) return;
        setAssetLoadFailed(false);
        setAssets(items);
        setSelectedAssetIds(
          items
            .filter(
              (asset) =>
                asset.active && asset.usage === "scene" && mediaType(asset),
            )
            .map((asset) => asset.id),
        );
      })
      .catch(() => {
        if (current) {
          setError(tRef.current("videoWizard.assetsFailed"));
          setAssetLoadFailed(true);
        }
      });
    return () => {
      current = false;
    };
  }, [product?.id, project?.id, assetRetry]);

  const allSnapshotSceneAssets = useMemo(
    () =>
      project
        ? project.snapshot.assets.filter((asset) => asset.usage === "scene")
        : assets.filter(
            (asset) =>
              asset.product_id === product?.id &&
              asset.active &&
              asset.usage === "scene",
          ),
    [assets, product?.id, project],
  );
  const orderedSceneAssets = useMemo(
    () =>
      [...allSnapshotSceneAssets].sort(
        (a, b) => Number(b.priority) - Number(a.priority),
      ),
    [allSnapshotSceneAssets],
  );
  const sceneAssets = useMemo(
    () => orderedSceneAssets.filter((asset) => mediaType(asset)),
    [orderedSceneAssets],
  );
  const assetByExportName = useMemo(() => {
    const result = new Map<string, ProductSnapshotAsset>();
    orderedSceneAssets.forEach((asset, index) =>
      result.set(exportName(asset, index), asset),
    );
    return result;
  }, [orderedSceneAssets]);
  const totalDuration =
    draft?.script.scenes.reduce((sum, scene) => sum + scene.duration, 0) ?? 0;
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});

  const pickProduct = (id: string) => {
    requestVersion.current += 1;
    const next = products.find((item) => item.id === id) ?? null;
    setProject(null);
    setDraft(null);
    setSaved(false);
    setProduct(next);
    productIdRef.current = next?.id ?? null;
    setBrief({
      ...EMPTY_VIDEO_BRIEF,
      sellingPoints: next?.selling_points.join("\n") ?? "",
    });
    setError("");
  };

  const changeBrief = (patch: Partial<typeof brief>) => {
    if (patch.sellingPoints !== undefined) {
      patch = {
        ...patch,
        sellingPoints: patch.sellingPoints
          .split("\n")
          .slice(0, 8)
          .map((line) => line.slice(0, 150))
          .join("\n"),
      };
    }
    setBrief((current) => ({ ...current, ...patch }));
    setSaved(false);
    setDraft((current) =>
      current ? { ...current, confirmed: false } : current,
    );
  };
  const changeRequest = (patch: Partial<VideoPlanRequest>) => {
    setRequest((current) => ({ ...current, ...patch }));
    setSaved(false);
    setDraft((current) =>
      current ? { ...current, confirmed: false } : current,
    );
  };

  const uploadAssets = async () => {
    if (!product || !uploads.length) return;
    const id = product.id;
    const version = requestVersion.current;
    setUploadBusy(true);
    try {
      await productLibraryApi.upload(id, uploads, "scene");
      if (productIdRef.current !== id || requestVersion.current !== version)
        return;
      const loaded = await productLibraryApi.assets(id);
      if (productIdRef.current !== id || requestVersion.current !== version)
        return;
      setAssets(loaded.items);
      setSelectedAssetIds(
        loaded.items
          .filter(
            (asset) =>
              asset.active && asset.usage === "scene" && mediaType(asset),
          )
          .map((asset) => asset.id),
      );
      setUploads([]);
      message.success(t("videoWizard.uploaded"));
    } catch {
      setError(t("videoWizard.uploadFailed"));
    } finally {
      setUploadBusy(false);
    }
  };

  const buildPlanRequest = (): VideoPlanRequest => {
    return { ...request, instructions: encodeVideoBrief(brief) };
  };

  const generate = async () => {
    if (!product || (!project && !selectedAssetIds.length)) return;
    let planRequest: VideoPlanRequest;
    try {
      planRequest = buildPlanRequest();
    } catch {
      setError(t("videoWizard.briefTooLong"));
      return;
    }
    const version = ++requestVersion.current;
    setBusy(true);
    setError("");
    setStep(2);
    try {
      let currentProduct = product;
      if (
        !project &&
        currentProduct &&
        brief.sellingPoints !== currentProduct.selling_points.join("\n")
      ) {
        currentProduct = await productLibraryApi.updateProduct(
          currentProduct.id,
          {
            name: currentProduct.name,
            model: currentProduct.model,
            category: currentProduct.category,
            selling_points: brief.sellingPoints
              .split("\n")
              .map((value) => value.trim().slice(0, 150))
              .filter(Boolean)
              .slice(0, 8),
            parameters: currentProduct.parameters,
            expression_limits: currentProduct.expression_limits,
          },
        );
        if (version !== requestVersion.current) return;
        setProduct(currentProduct);
      }
      let activeProject = project;
      if (!activeProject) {
        activeProject = await productLibraryApi.createProject({
          product_id: currentProduct!.id,
          name: `${currentProduct!.name} · ${t("videoWizard.projectSuffix")}`,
          asset_ids: selectedAssetIds,
        });
        if (version !== requestVersion.current) return;
        setProject(activeProject);
      }
      const result = await productLibraryApi.generateStoryboard(
        activeProject.id,
        planRequest,
      );
      if (version !== requestVersion.current) return;
      setRequest(planRequest);
      setDraft(result.draft);
      setSaved(true);
      setStep(3);
      navigate(
        `/product-library/video-wizard?project=${encodeURIComponent(
          activeProject.id,
        )}`,
        { replace: true },
      );
    } catch {
      if (version === requestVersion.current) {
        setError(t("videoWizard.generateFailed"));
        setStep(draft ? 3 : 1);
      }
    } finally {
      if (version === requestVersion.current) setBusy(false);
    }
  };

  const updateScene = (index: number, patch: Partial<StoryboardScene>) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            confirmed: false,
            script: {
              ...current.script,
              scenes: current.script.scenes.map((scene, i) =>
                i === index ? { ...scene, ...patch } : scene,
              ),
            },
          }
        : current,
    );
    setSaved(false);
  };

  const persist = async (confirmed: boolean) => {
    if (!project || !draft) return;
    let saveRequest: VideoPlanRequest;
    try {
      saveRequest = buildPlanRequest();
    } catch {
      setError(t("videoWizard.briefTooLong"));
      return;
    }
    const version = requestVersion.current;
    setBusy(true);
    setError("");
    try {
      const updated = await productLibraryApi.saveStoryboard(project.id, {
        request: saveRequest,
        script: draft.script,
        confirmed,
      });
      if (version !== requestVersion.current) return;
      setDraft(updated);
      setSaved(true);
      if (confirmed) setStep(4);
    } catch {
      if (version === requestVersion.current) {
        setError(t("videoWizard.saveFailed"));
        setSaved(false);
      }
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    if (!project || !draft?.confirmed || !saved) return;
    const version = requestVersion.current;
    setBusy(true);
    setError("");
    try {
      const blob = await productLibraryApi.downloadStoryboardPackage(
        project.id,
      );
      if (version !== requestVersion.current) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `storyboard-${project.id}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      if (version === requestVersion.current)
        setError(t("videoWizard.exportFailed"));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!draft || step !== 3) return;
    let active = true;
    const targets = [
      ...new Set(
        draft.script.scenes
          .filter((scene) => scene.type === "image" || scene.type === "video")
          .map((scene) =>
            scene.asset ? assetByExportName.get(scene.asset)?.id : undefined,
          )
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    targets.forEach((id) => {
      if (urlsRef.current[id]) return;
      void productLibraryApi
        .downloadAsset(id)
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          if (!active) {
            URL.revokeObjectURL(url);
            return;
          }
          urlsRef.current[id] = url;
          setImageUrls((current) => ({ ...current, [id]: url }));
        })
        .catch(() => {
          if (active) setError(tRef.current("videoWizard.previewFailed"));
        });
    });
    return () => {
      active = false;
    };
  }, [draft?.script.scenes, step, assetByExportName, previewRetry]);

  useEffect(() => {
    if (step !== 0 || !selectedAssetIds.length) return;
    let active = true;
    selectedAssetIds.forEach((id) => {
      if (urlsRef.current[id]) return;
      void productLibraryApi
        .downloadAsset(id)
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          if (!active) {
            URL.revokeObjectURL(url);
            return;
          }
          urlsRef.current[id] = url;
          setImageUrls((current) => ({ ...current, [id]: url }));
        })
        .catch(() => {
          if (active) setError(tRef.current("videoWizard.previewFailed"));
        });
    });
    return () => {
      active = false;
    };
  }, [step, selectedAssetIds]);

  const setStepSafe = (next: number) => {
    if (next > 0 && !product) return;
    if (next === 2 && !busy) return;
    if (next === 3 && !draft) return;
    if (next === 4 && !draft?.confirmed) return;
    setStep(next);
  };

  return (
    <PageShell
      title={t("videoWizard.title")}
      subtitle={t("videoWizard.subtitle")}
      fill
    >
      <ConfigProvider componentDisabled={busy || uploadBusy}>
        <div className={styles.wizard} data-busy={busy || uploadBusy}>
          <nav
            className={styles.steps}
            aria-label={t("videoWizard.stepsLabel")}
          >
            {steps.map((key, index) => (
              <button
                key={key}
                type="button"
                className={`${styles.step} ${
                  index <= step ? styles.stepActive : ""
                }`}
                onClick={() => setStepSafe(index === 2 && draft ? 3 : index)}
                disabled={
                  busy ||
                  uploadBusy ||
                  (index === 1 && !product) ||
                  (index === 2 && !draft && !busy) ||
                  (index === 3 && !draft) ||
                  (index === 4 && !draft?.confirmed)
                }
              >
                <span className={styles.stepCircle}>
                  {index < step ? <Check size={15} /> : index + 1}
                </span>
                <span className={styles.stepLabel}>
                  {t(`videoWizard.${key}`)}
                </span>
              </button>
            ))}
          </nav>

          {error && (
            <Alert
              type="error"
              showIcon
              message={error}
              closable
              onClose={() => setError("")}
              action={
                <Button
                  size="small"
                  onClick={() => {
                    setError("");
                    if (loadFailed) window.location.reload();
                    else if (assetLoadFailed)
                      setAssetRetry((value) => value + 1);
                    else if (error === t("videoWizard.previewFailed"))
                      setPreviewRetry((value) => value + 1);
                  }}
                >
                  {loadFailed ||
                  assetLoadFailed ||
                  error === t("videoWizard.previewFailed")
                    ? t("videoWizard.loadRetry")
                    : t("videoWizard.dismiss")}
                </Button>
              }
            />
          )}
          {loading ? (
            <div className={styles.loading}>
              <Spin />
            </div>
          ) : loadFailed ? null : products.length === 0 && !project ? (
            <Empty description={t("videoWizard.emptyProducts")}>
              <Button onClick={() => navigate("/product-library")}>
                {t("videoWizard.backToLibrary")}
              </Button>
            </Empty>
          ) : (
            <>
              {step === 0 && (
                <section>
                  <div className={styles.sectionHeader}>
                    <div>
                      <Typography.Title level={3}>
                        {t("videoWizard.chooseTitle")}
                      </Typography.Title>
                      <Typography.Text type="secondary">
                        {t("videoWizard.chooseHint")}
                      </Typography.Text>
                    </div>
                  </div>
                  <Card className={styles.summary}>
                    <Space wrap>
                      <Select
                        aria-label={t("videoWizard.product")}
                        placeholder={t("videoWizard.chooseProduct")}
                        value={product?.id}
                        onChange={pickProduct}
                        disabled={busy || uploadBusy}
                        options={products.map((item) => ({
                          value: item.id,
                          label: `${item.name}${
                            item.model ? ` · ${item.model}` : ""
                          }`,
                        }))}
                        className={styles.productSelect}
                      />
                      {product && (
                        <Tag>
                          {t("videoWizard.snapshotAssets", {
                            count: sceneAssets.length,
                          })}
                        </Tag>
                      )}
                      <Button onClick={() => navigate("/product-library")}>
                        {t("videoWizard.backToLibrary")}
                      </Button>
                    </Space>
                  </Card>
                  {product && (
                    <>
                      <div className={styles.assetToolbar}>
                        <Typography.Title level={4}>
                          {t("videoWizard.sceneAssets")}
                        </Typography.Title>
                        <Space wrap>
                          <Upload
                            multiple
                            accept="image/*,video/*"
                            beforeUpload={(file) => {
                              setUploads((list) => [...list, file]);
                              return false;
                            }}
                            fileList={uploads.map((file, i) => ({
                              uid: `${i}-${file.name}`,
                              name: file.name,
                              status: "done" as const,
                            }))}
                            onRemove={(file) => {
                              setUploads((list) =>
                                list.filter(
                                  (_, i) => !file.uid.startsWith(`${i}-`),
                                ),
                              );
                              return true;
                            }}
                          >
                            <Button
                              icon={<UploadIcon size={15} />}
                              disabled={Boolean(project) || busy || uploadBusy}
                            >
                              {t("videoWizard.addAssets")}
                            </Button>
                          </Upload>
                          {!!uploads.length && (
                            <Button
                              loading={uploadBusy}
                              disabled={uploadBusy}
                              onClick={() => void uploadAssets()}
                            >
                              {t("videoWizard.uploadAssets")}
                            </Button>
                          )}
                        </Space>
                      </div>
                      {project && (
                        <Alert
                          type="info"
                          showIcon
                          message={t("videoWizard.snapshotLocked")}
                        />
                      )}
                      {assetLoadFailed ? (
                        <Empty description={t("videoWizard.assetsFailed")}>
                          <Button
                            onClick={() => setAssetRetry((value) => value + 1)}
                          >
                            {t("videoWizard.loadRetry")}
                          </Button>
                        </Empty>
                      ) : sceneAssets.length ? (
                        <div className={styles.assetGrid}>
                          {sceneAssets.map((asset) => {
                            const checked = project
                              ? selectedAssetIds.includes(asset.id)
                              : selectedAssetIds.includes(asset.id);
                            return (
                              <button
                                key={asset.id}
                                type="button"
                                className={`${styles.assetTile} ${
                                  checked ? styles.assetSelected : ""
                                }`}
                                onClick={() =>
                                  !project &&
                                  setSelectedAssetIds((ids) =>
                                    checked
                                      ? ids.filter((id) => id !== asset.id)
                                      : [...ids, asset.id],
                                  )
                                }
                                disabled={
                                  Boolean(project) || busy || uploadBusy
                                }
                              >
                                <div className={styles.assetThumb}>
                                  {imageUrls[asset.id] ? (
                                    mediaType(asset) === "image" ? (
                                      <img src={imageUrls[asset.id]} alt="" />
                                    ) : (
                                      <video
                                        src={imageUrls[asset.id]}
                                        muted
                                        preload="metadata"
                                      />
                                    )
                                  ) : (
                                    <ImageIcon size={25} />
                                  )}
                                </div>
                                <span>{asset.filename}</span>
                                <Checkbox
                                  checked={checked}
                                  disabled={Boolean(project)}
                                />
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <Empty description={t("videoWizard.noSceneAssets")} />
                      )}
                      {product.selling_points.length > 0 && (
                        <Typography.Paragraph
                          type="secondary"
                          className={styles.points}
                        >
                          {t("videoWizard.productPoints", {
                            points: product.selling_points.join(" · "),
                          })}
                        </Typography.Paragraph>
                      )}
                    </>
                  )}
                </section>
              )}

              {step === 1 && (
                <section>
                  <Typography.Title level={3}>
                    {t("videoWizard.requirementsTitle")}
                  </Typography.Title>
                  <Card className={styles.formCard}>
                    <div className={styles.formGrid}>
                      <label>
                        {t("videoWizard.purpose")}
                        <Select
                          value={brief.purpose || undefined}
                          onChange={(purpose) => changeBrief({ purpose })}
                          placeholder={t("videoWizard.purposeHint")}
                          options={[
                            "launch",
                            "promotion",
                            "introduction",
                            "brand",
                          ].map((value) => ({
                            value,
                            label: t(`videoWizard.purposes.${value}`),
                          }))}
                        />
                      </label>
                      <label>
                        {t("videoWizard.audience")}
                        <Input
                          maxLength={200}
                          value={brief.audience}
                          onChange={(e) =>
                            changeBrief({ audience: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        {t("videoWizard.platform")}
                        <Input
                          maxLength={200}
                          value={brief.platform}
                          onChange={(e) =>
                            changeBrief({ platform: e.target.value })
                          }
                          placeholder={t("videoWizard.platformHint")}
                        />
                      </label>
                      <label>
                        {t("videoWizard.targetDuration")}
                        <Select
                          allowClear
                          value={brief.targetDuration || undefined}
                          onChange={(targetDuration) =>
                            changeBrief({
                              targetDuration: targetDuration ?? "",
                            })
                          }
                          options={[15, 30, 60].map((value) => ({
                            value: String(value),
                            label: `${value} ${t("videoWizard.seconds")}`,
                          }))}
                        />
                      </label>
                      <label>
                        {t("videoWizard.style")}
                        <Select
                          allowClear
                          value={brief.style || undefined}
                          onChange={(style) =>
                            changeBrief({ style: style ?? "" })
                          }
                          options={[
                            "natural",
                            "elegant",
                            "energetic",
                            "minimal",
                          ].map((value) => ({
                            value,
                            label: t(`videoWizard.styles.${value}`),
                          }))}
                        />
                      </label>
                      <label>
                        {t("videoWizard.language")}
                        <Select
                          value={request.language}
                          onChange={(language) => changeRequest({ language })}
                          options={[
                            { value: "zh", label: "中文" },
                            { value: "en", label: "English" },
                          ]}
                        />
                      </label>
                      <label>
                        {t("videoWizard.format")}
                        <Radio.Group
                          value={request.format}
                          onChange={(e) =>
                            changeRequest({ format: e.target.value })
                          }
                          optionType="button"
                          buttonStyle="solid"
                          options={[
                            { value: "portrait", label: "9:16" },
                            { value: "landscape", label: "16:9" },
                            { value: "square", label: "1:1" },
                          ]}
                        />
                      </label>
                    </div>
                    <Checkbox
                      checked={request.include_selling_points}
                      onChange={(e) =>
                        changeRequest({
                          include_selling_points: e.target.checked,
                        })
                      }
                    >
                      {t("videoWizard.includeSellingPoints")}
                    </Checkbox>
                    <Input.TextArea
                      className={styles.sellingPoints}
                      rows={3}
                      maxLength={1200}
                      disabled={Boolean(project) || busy}
                      value={brief.sellingPoints}
                      onChange={(e) =>
                        changeBrief({ sellingPoints: e.target.value })
                      }
                      placeholder={t("videoWizard.sellingPointsSupplement")}
                    />
                    <details className={styles.advanced}>
                      <summary>{t("videoWizard.advanced")}</summary>
                      <label className={styles.secondsPerAsset}>
                        {t("videoWizard.secondsPerAsset")}
                        <InputNumber
                          min={1}
                          max={15}
                          value={request.seconds_per_asset}
                          onChange={(value) =>
                            changeRequest({ seconds_per_asset: value ?? 4 })
                          }
                        />
                      </label>
                      <Input.TextArea
                        rows={4}
                        maxLength={2400}
                        showCount
                        value={brief.extra}
                        onChange={(e) => changeBrief({ extra: e.target.value })}
                        placeholder={t("videoWizard.instructionsHint")}
                      />
                    </details>
                    <Typography.Paragraph type="secondary">
                      {t("videoWizard.durationNote")}
                    </Typography.Paragraph>
                  </Card>
                </section>
              )}

              {step >= 2 && draft && (
                <>
                  <Card className={styles.summary}>
                    <Space wrap>
                      <strong>
                        {product?.name ?? project?.snapshot.product.name}
                      </strong>
                      <span className={styles.metaItem}>
                        <Clock3 size={15} />
                        {t("videoWizard.estimatedDuration", {
                          seconds: totalDuration,
                        })}
                      </span>
                      <span>
                        {draft.script.width === draft.script.height
                          ? "1:1"
                          : draft.script.width > draft.script.height
                          ? "16:9"
                          : "9:16"}
                      </span>
                      <span>
                        {draft.request.language === "zh"
                          ? t("videoWizard.chinese")
                          : "English"}
                      </span>
                      <Tag
                        color={
                          draft.confirmed && saved
                            ? "green"
                            : !saved
                            ? "orange"
                            : "gold"
                        }
                        icon={
                          draft.confirmed && saved ? (
                            <CheckCircle2 size={14} />
                          ) : (
                            <Circle size={14} />
                          )
                        }
                      >
                        {draft.confirmed && saved
                          ? t("videoWizard.confirmed")
                          : !saved
                          ? t("videoWizard.unsaved")
                          : t("videoWizard.pendingConfirmation")}
                      </Tag>
                    </Space>
                  </Card>
                  {step === 2 && (
                    <div className={styles.loading}>
                      <Spin tip={t("videoWizard.generating")}>
                        <div className={styles.spinArea} />
                      </Spin>
                    </div>
                  )}
                  {step === 3 && (
                    <section>
                      <div className={styles.sectionHeader}>
                        <div>
                          <Typography.Title level={3}>
                            {t("videoWizard.storyboardTitle")}
                          </Typography.Title>
                          <Typography.Text type="secondary">
                            {t("videoWizard.storyboardHint")}
                          </Typography.Text>
                        </div>
                        <Button
                          icon={<RefreshCw size={15} />}
                          loading={busy}
                          onClick={() => void generate()}
                        >
                          {t("videoWizard.regenerate")}
                        </Button>
                      </div>
                      {totalDuration > 180 && (
                        <Alert
                          type="error"
                          message={t("videoWizard.durationTooLong", {
                            seconds: totalDuration,
                          })}
                        />
                      )}
                      <div className={styles.sceneGrid}>
                        {draft.script.scenes.map((scene, index) => {
                          const currentAsset = scene.asset
                            ? assetByExportName.get(scene.asset)
                            : undefined;
                          const src = currentAsset
                            ? imageUrls[currentAsset.id]
                            : undefined;
                          const candidates = orderedSceneAssets.filter(
                            (asset) => mediaType(asset) === scene.type,
                          );
                          return (
                            <Card
                              key={`${scene.id}-${index}`}
                              className={styles.sceneCard}
                              title={
                                <Space>
                                  <span className={styles.sceneNumber}>
                                    {index + 1}
                                  </span>
                                  <Tag>
                                    {t(`videoWizard.sceneType.${scene.type}`)}
                                  </Tag>
                                </Space>
                              }
                              extra={
                                <InputNumber
                                  aria-label={t("videoWizard.sceneDuration")}
                                  min={0.25}
                                  max={15}
                                  step={0.25}
                                  value={scene.duration}
                                  onChange={(duration) =>
                                    updateScene(index, {
                                      duration: duration ?? 1,
                                    })
                                  }
                                  addonAfter={t("videoWizard.seconds")}
                                />
                              }
                            >
                              <div className={styles.scenePreview}>
                                {scene.type === "image" ||
                                scene.type === "video" ? (
                                  src &&
                                  currentAsset &&
                                  mediaType(currentAsset) === "image" ? (
                                    <img
                                      src={src}
                                      alt={currentAsset.filename}
                                    />
                                  ) : src && currentAsset ? (
                                    <video
                                      src={src}
                                      muted
                                      controls
                                      preload="metadata"
                                    />
                                  ) : (
                                    <div>
                                      <ImageIcon size={25} />
                                      <span>
                                        {scene.asset
                                          ? currentAsset?.filename ??
                                            scene.asset
                                          : t("videoWizard.previewPlaceholder")}
                                      </span>
                                    </div>
                                  )
                                ) : (
                                  <div className={styles.textPreview}>
                                    <strong>
                                      {scene.text ||
                                        scene.bullets?.[0] ||
                                        t("videoWizard.textCard")}
                                    </strong>
                                    {scene.subtitle && (
                                      <span>{scene.subtitle}</span>
                                    )}
                                    {scene.bullets
                                      ?.slice(1, 3)
                                      .map((line) => (
                                        <span key={line}>• {line}</span>
                                      ))}
                                  </div>
                                )}
                                <Tag className={styles.previewLabel}>
                                  {t("videoWizard.previewOnly")}
                                </Tag>
                              </div>
                              {(scene.type === "title" ||
                                scene.type === "text" ||
                                scene.type === "endcard") && (
                                <Input
                                  maxLength={400}
                                  aria-label={t("videoWizard.sceneText")}
                                  value={scene.text ?? ""}
                                  onChange={(e) =>
                                    updateScene(index, { text: e.target.value })
                                  }
                                  placeholder={t("videoWizard.sceneText")}
                                />
                              )}
                              {(scene.type === "title" ||
                                scene.type === "endcard") && (
                                <Input
                                  maxLength={400}
                                  aria-label={t("videoWizard.sceneSubtitle")}
                                  value={scene.subtitle ?? ""}
                                  onChange={(e) =>
                                    updateScene(index, {
                                      subtitle: e.target.value,
                                    })
                                  }
                                  placeholder={t("videoWizard.sceneSubtitle")}
                                />
                              )}
                              {(scene.type === "image" ||
                                scene.type === "video") && (
                                <>
                                  <Select
                                    aria-label={t("videoWizard.replaceAsset")}
                                    value={scene.asset}
                                    onChange={(asset) =>
                                      updateScene(index, { asset })
                                    }
                                    placeholder={t("videoWizard.replaceAsset")}
                                    options={candidates.map((asset) => ({
                                      value: exportName(
                                        asset,
                                        orderedSceneAssets.indexOf(asset),
                                      ),
                                      label: asset.filename,
                                    }))}
                                  />
                                  <Input
                                    maxLength={400}
                                    aria-label={t("videoWizard.caption")}
                                    value={scene.caption ?? ""}
                                    onChange={(e) =>
                                      updateScene(index, {
                                        caption: e.target.value,
                                      })
                                    }
                                    placeholder={t("videoWizard.caption")}
                                  />
                                </>
                              )}
                              {scene.type === "bullets" && (
                                <Input.TextArea
                                  aria-label={t("videoWizard.bullets")}
                                  rows={3}
                                  value={(scene.bullets ?? []).join("\n")}
                                  onChange={(e) =>
                                    updateScene(index, {
                                      bullets: e.target.value
                                        .split("\n")
                                        .slice(0, 8)
                                        .map((line) => line.slice(0, 150)),
                                    })
                                  }
                                />
                              )}
                              {scene.type === "text" && (
                                <Input
                                  maxLength={400}
                                  aria-label={t("videoWizard.caption")}
                                  value={scene.caption ?? ""}
                                  onChange={(e) =>
                                    updateScene(index, {
                                      caption: e.target.value,
                                    })
                                  }
                                  placeholder={t("videoWizard.caption")}
                                />
                              )}
                            </Card>
                          );
                        })}
                      </div>
                    </section>
                  )}
                </>
              )}

              {step === 2 && !draft && (
                <div className={styles.loading}>
                  <Spin tip={t("videoWizard.generating")} />
                </div>
              )}

              {step === 4 && draft?.confirmed && (
                <section className={styles.exportPanel}>
                  <Typography.Title level={3}>
                    {t("videoWizard.exportTitle")}
                  </Typography.Title>
                  <Alert
                    type="success"
                    showIcon
                    message={t("videoWizard.exportReady")}
                    description={
                      <div>
                        <p>{t("videoWizard.exportExtract")}</p>
                        <p>
                          <code>preview.cmd</code> ·{" "}
                          {t("videoWizard.windowsPreview")}
                        </p>
                        <p>
                          <code>preview.command</code> ·{" "}
                          {t("videoWizard.macPreview")}
                        </p>
                        <p>{t("videoWizard.renderGuide")}</p>
                        <p>{t("videoWizard.nodeGuide")}</p>
                      </div>
                    }
                  />
                </section>
              )}
            </>
          )}

          <footer className={styles.footer}>
            <span className={styles.footerStatus}>
              {busy ? (
                step === 2 ? (
                  t("videoWizard.generating")
                ) : (
                  t("videoWizard.saving")
                )
              ) : draft ? (
                saved ? (
                  <>
                    <CheckCircle2 size={16} />
                    {t("videoWizard.saved")}
                  </>
                ) : (
                  <>
                    <Circle size={14} />
                    {t("videoWizard.unsaved")}
                  </>
                )
              ) : (
                t("videoWizard.footerHint")
              )}
            </span>
            <Space>
              <Button
                icon={<ArrowLeft size={15} />}
                disabled={step === 0 || busy || uploadBusy}
                onClick={() =>
                  setStep(
                    step === 3 ? 1 : step === 4 ? 3 : Math.max(0, step - 1),
                  )
                }
              >
                {t("videoWizard.previous")}
              </Button>
              {step === 0 && (
                <Button
                  type="primary"
                  icon={<ArrowRight size={15} />}
                  disabled={
                    busy ||
                    uploadBusy ||
                    !product ||
                    assetLoadFailed ||
                    (!project && selectedAssetIds.length === 0)
                  }
                  onClick={() => setStep(1)}
                >
                  {t("videoWizard.next")}
                </Button>
              )}
              {step === 1 && (
                <Button
                  type="primary"
                  icon={<Sparkles size={15} />}
                  disabled={
                    busy ||
                    uploadBusy ||
                    !product ||
                    assetLoadFailed ||
                    (!project && selectedAssetIds.length === 0)
                  }
                  loading={busy}
                  onClick={() => void generate()}
                >
                  {t("videoWizard.generate")}
                </Button>
              )}
              {step === 3 && draft && (
                <>
                  <Button
                    disabled={busy || uploadBusy || saved}
                    loading={busy}
                    onClick={() => void persist(false)}
                  >
                    {t("videoWizard.saveChanges")}
                  </Button>
                  <Button
                    type="primary"
                    icon={<Check size={15} />}
                    loading={busy}
                    disabled={
                      busy ||
                      uploadBusy ||
                      !scriptValid(draft.script, assetByExportName)
                    }
                    onClick={() => void persist(true)}
                  >
                    {t("videoWizard.confirmContinue")}
                  </Button>
                </>
              )}
              {step === 4 && (
                <Button
                  type="primary"
                  icon={<Download size={15} />}
                  disabled={busy || uploadBusy || !draft?.confirmed || !saved}
                  loading={busy}
                  onClick={() => void download()}
                >
                  {t("videoWizard.downloadPackage")}
                </Button>
              )}
            </Space>
          </footer>
        </div>
      </ConfigProvider>
    </PageShell>
  );
}

function candidatesAssetValid(
  scene: StoryboardScene,
  allowed: Map<string, ProductSnapshotAsset>,
) {
  if (scene.type !== "image" && scene.type !== "video") return true;
  const asset = scene.asset ? allowed.get(scene.asset) : undefined;
  return Boolean(asset && mediaType(asset) === scene.type);
}

function scriptValid(
  script: StoryboardScript,
  allowed: Map<string, ProductSnapshotAsset>,
) {
  const total = script.scenes.reduce((sum, scene) => sum + scene.duration, 0);
  return (
    script.scenes.length >= 1 &&
    script.scenes.length <= 24 &&
    total <= 180 &&
    script.scenes.every(
      (scene) =>
        scene.duration >= 0.25 &&
        scene.duration <= 15 &&
        (scene.type !== "bullets" || Boolean(scene.bullets?.length)) &&
        (!scene.bullets ||
          (scene.bullets.length >= 1 &&
            scene.bullets.length <= 8 &&
            scene.bullets.every((line) => line.length <= 150))) &&
        [scene.text, scene.subtitle, scene.caption].every(
          (text) => text === undefined || text.length <= 400,
        ) &&
        candidatesAssetValid(scene, allowed),
    )
  );
}
