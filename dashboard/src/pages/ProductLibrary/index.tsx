import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Card,
  Descriptions,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Tag,
  Typography,
  Upload,
} from "antd";
import {
  Archive,
  Download,
  FilePlus2,
  Package,
  Plus,
  Sparkles,
  Upload as UploadIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { request } from "../../api/request";
import {
  productLibraryApi,
  type Product,
  type ProductAsset,
  type ProductProject,
} from "../../api/modules/productLibrary";
import type { OctopAgent } from "../../context/AgentContext";
import PageShell from "../../layouts/PageShell";
import { message } from "../../utils/antdMessage";

const blank: Omit<Product, "id"> = {
  name: "",
  model: "",
  category: "",
  selling_points: [],
  parameters: {},
  expression_limits: "",
};

export default function ProductLibraryPage() {
  const { t } = useTranslation();
  const [products, setProducts] = useState<Product[]>([]);
  const [projects, setProjects] = useState<ProductProject[]>([]);
  const [active, setActive] = useState<Product | null>(null);
  const [assets, setAssets] = useState<ProductAsset[]>([]);
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [usage, setUsage] = useState<ProductAsset["usage"]>("reference");
  const [projectName, setProjectName] = useState("");
  const [agentId, setAgentId] = useState("");
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [assetSearch, setAssetSearch] = useState("");
  const [assetKind, setAssetKind] = useState("all");
  const [parameterRows, setParameterRows] = useState<[string, string][]>([]);
  const [agents, setAgents] = useState<OctopAgent[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const previewUrls = useRef<Record<string, string>>({});
  const previewProductId = useRef<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [projectBusy, setProjectBusy] = useState(false);
  const [preparingId, setPreparingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const reload = async () => {
    const [p, pr] = await Promise.all([
      productLibraryApi.products(),
      productLibraryApi.projects(),
    ]);
    setProducts(p.items);
    setProjects(pr.items);
    if (active) setActive(p.items.find((x) => x.id === active.id) ?? null);
  };
  useEffect(() => {
    void reload().catch(() => message.error(t("productLibrary.failed")));
    void request<OctopAgent[]>("/agents?scope=all")
      .then((rows) =>
        setAgents(rows.filter((a) => a.is_owner && a.state === "running")),
      )
      .catch(() => setAgents([]));
  }, []);
  useEffect(() => {
    setAssets([]);
    setSelectedAssets([]);
    setFiles([]);
    if (!active) {
      return;
    }
    let current = true;
    setFiles([]);
    void productLibraryApi
      .assets(active.id)
      .then((r) => {
        if (current) {
          setAssets(r.items);
          setSelectedAssets(r.items.filter((a) => a.active).map((a) => a.id));
        }
      })
      .catch(() => {
        if (current) message.error(t("productLibrary.failed"));
      });
    return () => {
      current = false;
    };
  }, [active?.id]);
  useEffect(() => {
    previewProductId.current = active?.id ?? null;
    setPreviews({});
    return () => {
      Object.values(previewUrls.current).forEach(URL.revokeObjectURL);
      previewUrls.current = {};
    };
  }, [active?.id]);
  useEffect(() => {
    if (active) {
      setProjectName("");
      setAgentId("");
    }
  }, [active?.id]);
  const activeCount = useMemo(
    () => assets.filter((a) => a.active).length,
    [assets],
  );
  const visibleAssets = useMemo(
    () =>
      assets.filter((a) => {
        const typeMatches =
          assetKind === "all" ||
          (assetKind === "document"
            ? !a.media_type.startsWith("image/") &&
              !a.media_type.startsWith("video/")
            : a.media_type.startsWith(`${assetKind}/`));
        return (
          typeMatches &&
          a.filename.toLowerCase().includes(assetSearch.toLowerCase())
        );
      }),
    [assets, assetKind, assetSearch],
  );

  const openCreate = () => {
    setForm(blank);
    setParameterRows([]);
    setEditing(false);
    setActive(null);
    setBusy(true);
  };
  const openEdit = () => {
    if (!active) return;
    setForm({
      name: active.name,
      model: active.model,
      category: active.category,
      selling_points: active.selling_points,
      parameters: active.parameters,
      expression_limits: active.expression_limits,
    });
    setParameterRows(
      Object.entries(active.parameters).map(([k, v]) => [k, String(v)]),
    );
    setEditing(true);
    setBusy(true);
  };
  const saveProduct = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        name: form.name.trim(),
        selling_points: form.selling_points.map((point) => point.trim()).filter(Boolean),
        parameters: Object.fromEntries(
          parameterRows
            .filter(([key]) => key.trim())
            .map(([key, value]) => [key.trim(), value]),
        ),
      };
      if (editing && active)
        await productLibraryApi.updateProduct(active.id, payload);
      else await productLibraryApi.createProduct(payload);
      setBusy(false);
      await reload();
      message.success(t("productLibrary.saved"));
    } catch {
      message.error(t("productLibrary.failed"));
    } finally {
      setSaving(false);
    }
  };
  const upload = async () => {
    if (!active || !files.length) return;
    setUploadBusy(true);
    try {
      await productLibraryApi.upload(active.id, files, usage);
      setFiles([]);
      const r = await productLibraryApi.assets(active.id);
      setAssets(r.items);
      setSelectedAssets(r.items.filter((asset) => asset.active).map((asset) => asset.id));
      message.success(t("productLibrary.uploaded"));
    } catch {
      message.error(t("productLibrary.failed"));
    } finally {
      setUploadBusy(false);
    }
  };
  const createProject = async () => {
    if (!active || !projectName.trim()) return;
    setProjectBusy(true);
    try {
      const p = await productLibraryApi.createProject({
        product_id: active.id,
        name: projectName,
        asset_ids: selectedAssets,
      });
      setProjects((current) => [p, ...current]);
      setProjectName("");
      message.success(t("productLibrary.snapshotCreated"));
    } catch {
      message.error(t("productLibrary.failed"));
    } finally {
      setProjectBusy(false);
    }
  };
  const prepare = async (project: ProductProject) => {
    if (!agentId) return message.warning(t("productLibrary.agentRequired"));
    setPreparingId(project.id);
    try {
      const result = await productLibraryApi.prepareRender(project.id, agentId);
      message.success(
        `${t("productLibrary.prepared")}: ${result.workspace_path}`,
      );
    } catch {
      message.error(t("productLibrary.prepareFailed"));
    } finally {
      setPreparingId(null);
    }
  };
  const downloadPackage = async (project: ProductProject) => {
    setDownloadingId(project.id);
    try {
      const blob = await productLibraryApi.downloadPackage(project.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `video-project-${project.id}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      message.success(t("productLibrary.packageDownloaded"));
    } catch {
      message.error(t("productLibrary.packageFailed"));
    } finally {
      setDownloadingId(null);
    }
  };
  const previewAsset = async (asset: ProductAsset) => {
    if (previews[asset.id]) return;
    const productId = active?.id;
    setPreviewBusy(asset.id);
    try {
      const blob = await productLibraryApi.downloadAsset(asset.id);
      const url = URL.createObjectURL(blob);
      if (previewProductId.current !== productId) {
        URL.revokeObjectURL(url);
        return;
      }
      previewUrls.current[asset.id] = url;
      setPreviews((all) => ({ ...all, [asset.id]: url }));
    } catch {
      message.error(t("productLibrary.failed"));
    } finally {
      setPreviewBusy(null);
    }
  };

  return (
    <PageShell
      title={t("productLibrary.title")}
      subtitle={t("productLibrary.subtitle")}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(100%, 300px), 1fr))",
          gap: 20,
          alignItems: "start",
        }}
      >
        <Card
          title={t("productLibrary.products")}
          extra={
            <Button
              type="primary"
              icon={<Plus size={16} />}
              onClick={openCreate}
            >
              {t("productLibrary.addProduct")}
            </Button>
          }
        >
          <Input.Search
            placeholder={t("productLibrary.searchProducts")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ marginBottom: 12 }}
          />
          <Space direction="vertical" style={{ width: "100%" }}>
            {products.filter((p) =>
              `${p.name} ${p.model} ${p.category}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            ).length ? (
              products
                .filter((p) =>
                  `${p.name} ${p.model} ${p.category}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((p) => (
                  <Button
                    key={p.id}
                    block
                    type={active?.id === p.id ? "primary" : "default"}
                    onClick={() => setActive(p)}
                    style={{ height: "auto", textAlign: "left", padding: 12 }}
                  >
                    <div>
                      <strong>{p.name}</strong>
                      <div style={{ opacity: 0.65, fontSize: 12 }}>
                        {[p.model, p.category].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                  </Button>
                ))
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t("productLibrary.noProducts")}
              />
            )}
          </Space>
        </Card>
        <div style={{ display: "grid", gap: 16 }}>
          {active ? (
            <>
              <Card
                title={
                  <Space>
                    <Package size={17} />
                    {active.name}
                    <Tag>
                      {active.category || t("productLibrary.uncategorized")}
                    </Tag>
                  </Space>
                }
                extra={
                  <Space>
                    <Button onClick={openEdit}>
                      {t("productLibrary.edit")}
                    </Button>
                    <Button
                      danger
                      onClick={() =>
                        Modal.confirm({
                          title: t("productLibrary.deleteConfirm"),
                          onOk: async () => {
                            await productLibraryApi.deleteProduct(active.id);
                            setActive(null);
                            await reload();
                          },
                        })
                      }
                    >
                      {t("productLibrary.delete")}
                    </Button>
                  </Space>
                }
              >
                <Typography.Paragraph type="secondary">
                  {active.model}
                </Typography.Paragraph>
                {active.selling_points.length > 0 && (
                  <Typography.Paragraph>
                    {active.selling_points.join(" · ")}
                  </Typography.Paragraph>
                )}
                <Typography.Paragraph type="secondary">
                  {active.expression_limits || t("productLibrary.noLimits")}
                </Typography.Paragraph>
                {Object.keys(active.parameters).length > 0 && (
                  <Descriptions
                    size="small"
                    column={1}
                    items={Object.entries(active.parameters).map(
                      ([key, value]) => ({
                        key,
                        label: key,
                        children: String(value),
                      }),
                    )}
                  />
                )}
              </Card>
              <Card
                title={t("productLibrary.assets")}
                extra={<Tag color="magenta">{activeCount}</Tag>}
              >
                <Space wrap style={{ marginBottom: 12 }}>
                  <Upload
                    multiple
                    beforeUpload={(file) => {
                      setFiles((all) => [...all, file]);
                      return false;
                    }}
                    fileList={files.map((f, i) => ({
                      uid: `${i}-${f.name}`,
                      name: f.name,
                      status: "done" as const,
                    }))}
                    onRemove={(file) => {
                      setFiles((all) =>
                        all.filter((f) => f.name !== file.name),
                      );
                      return true;
                    }}
                  >
                    <Button icon={<FilePlus2 size={16} />}>
                      {t("productLibrary.chooseFiles")}
                    </Button>
                  </Upload>
                  <Select
                    value={usage}
                    onChange={setUsage}
                    options={[
                      { value: "scene", label: t("productLibrary.scene") },
                      {
                        value: "reference",
                        label: t("productLibrary.reference"),
                      },
                      { value: "style", label: t("productLibrary.style") },
                    ]}
                  />
                  <Button
                    type="primary"
                    icon={<UploadIcon size={15} />}
                    onClick={() => void upload()}
                    disabled={!files.length}
                    loading={uploadBusy}
                  >
                    {t("productLibrary.upload")}
                  </Button>
                </Space>
                <Space wrap style={{ display: "flex", marginBottom: 12 }}>
                  <Input.Search
                    placeholder={t("productLibrary.searchAssets")}
                    value={assetSearch}
                    onChange={(e) => setAssetSearch(e.target.value)}
                    style={{ maxWidth: 260 }}
                  />
                  <Select
                    value={assetKind}
                    onChange={setAssetKind}
                    options={[
                      { value: "all", label: t("productLibrary.allTypes") },
                      { value: "image", label: t("productLibrary.images") },
                      { value: "video", label: t("productLibrary.videos") },
                      {
                        value: "document",
                        label: t("productLibrary.documents"),
                      },
                    ]}
                  />
                </Space>
                {visibleAssets.length ? (
                  <Space direction="vertical" style={{ width: "100%" }}>
                    {visibleAssets.map((a) => (
                      <div
                        key={a.id}
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          alignItems: "center",
                          gap: 10,
                          borderBottom: "1px solid #eee",
                          padding: "8px 0",
                        }}
                      >
                        {previews[a.id] &&
                          (a.media_type.startsWith("image/") ? (
                            <img
                              src={previews[a.id]}
                              alt={a.filename}
                              style={{
                                width: 220,
                                maxHeight: 170,
                                objectFit: "contain",
                                borderRadius: 6,
                              }}
                            />
                          ) : (
                            <video
                              src={previews[a.id]}
                              controls
                              style={{ width: 260, maxHeight: 170 }}
                            />
                          ))}
                        <input
                          aria-label={a.filename}
                          type="checkbox"
                          checked={selectedAssets.includes(a.id)}
                          disabled={!a.active}
                          onChange={(e) =>
                            setSelectedAssets((all) =>
                              e.target.checked
                                ? [...all, a.id]
                                : all.filter((id) => id !== a.id),
                            )
                          }
                        />
                        <span style={{ flex: 1 }}>
                          {a.filename}{" "}
                          <Typography.Text type="secondary">
                            ({Math.ceil(a.byte_size / 1024)} KB)
                          </Typography.Text>
                        </span>
                        {(a.media_type.startsWith("image/") ||
                          a.media_type.startsWith("video/")) && (
                          <Button
                            size="small"
                            loading={previewBusy === a.id}
                            onClick={() => void previewAsset(a)}
                          >
                            {previews[a.id]
                              ? t("productLibrary.previewLoaded")
                              : t("productLibrary.preview")}
                          </Button>
                        )}
                        <Select
                          size="small"
                          value={a.usage}
                          style={{ width: 130 }}
                          onChange={async (v) => {
                            await productLibraryApi.updateAsset(a.id, {
                              usage: v,
                            });
                            setAssets((all) =>
                              all.map((x) =>
                                x.id === a.id ? { ...x, usage: v } : x,
                              ),
                            );
                          }}
                          options={[
                            {
                              value: "scene",
                              label: t("productLibrary.scene"),
                            },
                            {
                              value: "reference",
                              label: t("productLibrary.reference"),
                            },
                            {
                              value: "style",
                              label: t("productLibrary.style"),
                            },
                          ]}
                        />
                        <Button
                          size="small"
                          onClick={async () => {
                            const blob = await productLibraryApi.downloadAsset(
                              a.id,
                            );
                            const url = URL.createObjectURL(blob);
                            const link = document.createElement("a");
                            link.href = url;
                            link.download = a.filename;
                            link.click();
                            window.setTimeout(
                              () => URL.revokeObjectURL(url),
                              30_000,
                            );
                          }}
                        >
                          {t("productLibrary.download")}
                        </Button>
                        <Button
                          size="small"
                          type={a.priority ? "primary" : "default"}
                          onClick={async () => {
                            const priority = !a.priority;
                            await productLibraryApi.updateAsset(a.id, {
                              priority,
                            });
                            setAssets((all) =>
                              all.map((x) =>
                                x.id === a.id
                                  ? { ...x, priority: Number(priority) }
                                  : x,
                              ),
                            );
                          }}
                        >
                          {a.priority
                            ? t("productLibrary.priority")
                            : t("productLibrary.setPriority")}
                        </Button>
                        <Button
                          size="small"
                          onClick={async () => {
                            const activeFlag = !a.active;
                            await productLibraryApi.updateAsset(a.id, {
                              active: activeFlag,
                            });
                            setAssets((all) =>
                              all.map((x) =>
                                x.id === a.id
                                  ? { ...x, active: Number(activeFlag) }
                                  : x,
                              ),
                            );
                            if (!activeFlag)
                              setSelectedAssets((all) =>
                                all.filter((id) => id !== a.id),
                              );
                          }}
                        >
                          {a.active
                            ? t("productLibrary.disable")
                            : t("productLibrary.enable")}
                        </Button>
                      </div>
                    ))}
                  </Space>
                ) : (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      assets.length
                        ? t("productLibrary.noMatchingAssets")
                        : t("productLibrary.noAssets")
                    }
                  />
                )}
              </Card>
              <Card
                title={
                  <Space>
                    <Sparkles size={17} />
                    {t("productLibrary.videoProjects")}
                  </Space>
                }
              >
                <Space wrap style={{ marginBottom: 16 }}>
                  <Input
                    placeholder={t("productLibrary.projectName")}
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    style={{ width: 220 }}
                  />
                  <Button
                    type="primary"
                    onClick={() => void createProject()}
                    loading={projectBusy}
                  >
                    {t("productLibrary.createSnapshot")}
                  </Button>
                </Space>
                <Typography.Text type="secondary">
                  {t("productLibrary.snapshotHint")}
                </Typography.Text>
              </Card>
            </>
          ) : (
            <Card>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t("productLibrary.selectProduct")}
              />
            </Card>
          )}
        </div>
        <Card
          title={
            <Space>
              <Archive size={17} />
              {t("productLibrary.allProjects")}
            </Space>
          }
          style={{ gridColumn: "1 / -1" }}
        >
          <Typography.Paragraph type="secondary">
            {t("productLibrary.localWorkflow")}
          </Typography.Paragraph>
          {projects.length ? (
            projects.map((p) => (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 10,
                  alignItems: "center",
                  borderBottom: "1px solid #eee",
                  padding: "10px 0",
                }}
              >
                <Archive size={16} />
                <span style={{ flex: 1 }}>
                  {p.name} · {p.snapshot.product.name}{" "}
                  <Tag>
                    {t("productLibrary.version")}
                    {p.snapshot.version}
                  </Tag>{" "}
                  · {p.snapshot.assets.length} {t("productLibrary.assetsCount")}
                </span>
                <Button
                  type="primary"
                  icon={<Download size={16} />}
                  loading={downloadingId === p.id}
                  onClick={() => void downloadPackage(p)}
                >
                  {t("productLibrary.downloadPackage")}
                </Button>
                <details>
                  <summary style={{ cursor: "pointer" }}>
                    {t("productLibrary.advancedAgentSync")}
                  </summary>
                  <Space wrap style={{ marginTop: 8 }}>
                    <Select
                      showSearch
                      placeholder={t("productLibrary.selectAgent")}
                      value={agentId || undefined}
                      onChange={setAgentId}
                      style={{ width: 220 }}
                      options={agents.map((a) => ({
                        value: a.agent_id,
                        label: a.name,
                      }))}
                    />
                    <Button
                      loading={preparingId === p.id}
                      disabled={!agents.length}
                      onClick={() => void prepare(p)}
                    >
                      {t("productLibrary.prepareRender")}
                    </Button>
                  </Space>
                </details>
              </div>
            ))
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t("productLibrary.noProjects")}
            />
          )}
        </Card>
      </div>
      <Modal
        open={busy}
        title={
          editing
            ? t("productLibrary.editProduct")
            : t("productLibrary.addProduct")
        }
        onCancel={() => setBusy(false)}
        onOk={() => void saveProduct()}
        confirmLoading={saving}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input
            placeholder={t("productLibrary.name")}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Input
            placeholder={t("productLibrary.model")}
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
          />
          <Input
            placeholder={t("productLibrary.category")}
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          />
          <Input.TextArea
            placeholder={t("productLibrary.sellingPoints")}
            value={form.selling_points.join("\n")}
            onChange={(e) =>
              setForm({
                ...form,
                selling_points: e.target.value.split("\n"),
              })
            }
            rows={3}
          />
          <Typography.Text strong>
            {t("productLibrary.parameters")}
          </Typography.Text>
          {parameterRows.map(([key, value], index) => (
            <Space key={index} style={{ display: "flex" }}>
              <Input
                placeholder={t("productLibrary.parameterName")}
                value={key}
                onChange={(e) =>
                  setParameterRows((rows) =>
                    rows.map<[string, string]>((row, i) =>
                      i === index ? [e.target.value, row[1]] : row,
                    ),
                  )
                }
              />
              <Input
                placeholder={t("productLibrary.parameterValue")}
                value={value}
                onChange={(e) =>
                  setParameterRows((rows) =>
                    rows.map<[string, string]>((row, i) =>
                      i === index ? [row[0], e.target.value] : row,
                    ),
                  )
                }
              />
              <Button
                danger
                onClick={() =>
                  setParameterRows((rows) => rows.filter((_, i) => i !== index))
                }
              >
                ×
              </Button>
            </Space>
          ))}
          <Button
            onClick={() => setParameterRows((rows) => [...rows, ["", ""]])}
          >
            {t("productLibrary.addParameter")}
          </Button>
          <Input.TextArea
            placeholder={t("productLibrary.expressionLimits")}
            value={form.expression_limits}
            onChange={(e) =>
              setForm({ ...form, expression_limits: e.target.value })
            }
            rows={2}
          />
        </Space>
      </Modal>
    </PageShell>
  );
}
