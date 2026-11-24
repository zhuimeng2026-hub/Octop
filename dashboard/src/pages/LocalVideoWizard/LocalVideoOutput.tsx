import {
  Alert,
  Button,
  Card,
  InputNumber,
  List,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import { useTranslation } from "react-i18next";
import type {
  DesktopVideoOutput,
  DesktopVideoTargetRequest,
} from "../../context/DesktopVideoJobsContext";
import {
  PLATFORM_RENDER_PROFILES,
  RENDER_PROFILE_SIZES,
  type PlatformKey,
  type RenderProfile,
} from "../ProductVideoWizard/platforms";

export type LocalVideoTarget = DesktopVideoTargetRequest;

export interface LocalVideoTargetOption {
  key: PlatformKey;
  label: string;
}

export interface LocalVideoTargetSettingsProps {
  targets: LocalVideoTarget[];
  platformOptions: LocalVideoTargetOption[];
  onChange: (targets: LocalVideoTarget[]) => void;
  disabled?: boolean;
}

const profiles: Array<{ value: RenderProfile; labelKey: string }> = [
  { value: "short_vertical", labelKey: "shortVertical" },
  { value: "landscape", labelKey: "landscape" },
  { value: "square", labelKey: "square" },
  { value: "custom", labelKey: "custom" },
];

function filenameFor(platform: string | undefined, index: number): string {
  const suffix = platform ? platform.replace(/[^a-z0-9_-]/gi, "-") : "custom";
  return `video-${suffix || index + 1}.mp4`;
}

export function defaultLocalVideoTargets(
  platforms: PlatformKey[],
): LocalVideoTarget[] {
  return platforms.map((platform, index) => {
    const profile = PLATFORM_RENDER_PROFILES[platform];
    const size = sizeForProfile(profile) ?? { width: 1080, height: 1080 };
    return {
      id: `target-${platform}`,
      platform,
      profile,
      width: size.width,
      height: size.height,
      fps: 30,
      filename: filenameFor(platform, index),
    };
  });
}

function sizeForProfile(profile: RenderProfile) {
  return profile === "custom" ? null : RENDER_PROFILE_SIZES[profile];
}

export function LocalVideoTargetSettings({
  targets,
  platformOptions,
  onChange,
  disabled = false,
}: LocalVideoTargetSettingsProps) {
  const { t } = useTranslation();
  const selectedPlatforms = targets
    .map((target) => target.platform)
    .filter((platform): platform is PlatformKey =>
      platformOptions.some((option) => option.key === platform),
    );

  const updateTarget = (id: string, patch: Partial<LocalVideoTarget>) =>
    onChange(
      targets.map((target) =>
        target.id === id ? { ...target, ...patch } : target,
      ),
    );

  const setPlatforms = (next: PlatformKey[]) => {
    const custom = targets.filter((target) => !target.platform);
    const nextTargets = next.map((platform, index) => {
      const existing = targets.find((target) => target.platform === platform);
      if (existing) return existing;
      const profile = PLATFORM_RENDER_PROFILES[platform];
      const size = sizeForProfile(profile) ?? { width: 1080, height: 1080 };
      return {
        id: `target-${platform}`,
        platform,
        profile,
        width: size.width,
        height: size.height,
        fps: 30,
        filename: filenameFor(platform, index),
      };
    });
    onChange([...nextTargets, ...custom]);
  };

  const addCustom = () => {
    if (targets.some((target) => !target.platform)) return;
    onChange([
      ...targets,
      {
        id: "target-custom",
        profile: "custom",
        width: 1080,
        height: 1080,
        fps: 30,
        filename: filenameFor(undefined, targets.length),
      },
    ]);
  };

  return (
    <Card title={t("localVideoWizard.multiOutputTitle")} size="small">
      <Space direction="vertical" style={{ width: "100%" }}>
        <Typography.Text type="secondary">
          {t("localVideoWizard.multiOutputHint")}
        </Typography.Text>
        <Select
          mode="multiple"
          value={selectedPlatforms}
          disabled={disabled}
          style={{ width: "100%" }}
          placeholder={t("localVideoWizard.targetPlatform")}
          options={platformOptions.map((option) => ({
            value: option.key,
            label: option.label,
          }))}
          onChange={(value: PlatformKey[]) => setPlatforms(value)}
        />
        <Button
          onClick={addCustom}
          disabled={disabled || targets.some((target) => !target.platform)}
        >
          {t("localVideoWizard.addCustomTarget")}
        </Button>
        <List
          dataSource={targets}
          locale={{ emptyText: t("localVideoWizard.noTargets") }}
          renderItem={(target) => {
            const size = sizeForProfile(target.profile ?? "custom");
            return (
              <List.Item
                actions={[
                  <Button
                    key="remove"
                    type="link"
                    disabled={disabled}
                    onClick={() =>
                      onChange(targets.filter((item) => item.id !== target.id))
                    }
                  >
                    {t("localVideoWizard.removeTarget")}
                  </Button>,
                ]}
              >
                <Space wrap>
                  <Typography.Text strong>
                    {platformOptions.find(
                      (option) => option.key === target.platform,
                    )?.label ?? t("localVideoWizard.customTarget")}
                  </Typography.Text>
                  <Select
                    value={target.profile ?? "custom"}
                    disabled={disabled}
                    options={profiles.map((profile) => ({
                      value: profile.value,
                      label: t(
                        `localVideoWizard.targetFormats.${profile.labelKey}`,
                      ),
                    }))}
                    onChange={(profile: RenderProfile) => {
                      const nextSize = sizeForProfile(profile);
                      updateTarget(target.id, {
                        profile,
                        ...(nextSize ?? {}),
                      });
                    }}
                  />
                  <InputNumber
                    min={1}
                    max={4096}
                    value={size?.width ?? target.width}
                    disabled={disabled || Boolean(size)}
                    addonBefore={t("localVideoWizard.width")}
                    onChange={(width) =>
                      width != null && updateTarget(target.id, { width })
                    }
                  />
                  <InputNumber
                    min={1}
                    max={4096}
                    value={size?.height ?? target.height}
                    disabled={disabled || Boolean(size)}
                    addonBefore={t("localVideoWizard.height")}
                    onChange={(height) =>
                      height != null && updateTarget(target.id, { height })
                    }
                  />
                  <Tag>{t("localVideoWizard.fpsValue", { fps: 30 })}</Tag>
                </Space>
              </List.Item>
            );
          }}
        />
      </Space>
    </Card>
  );
}

export interface LocalVideoJobResultsProps {
  job: {
    state: string;
    progress?: number | null;
    errorCode?: string;
    videoUrl?: string;
    targets?: DesktopVideoOutput[];
  };
  onSave?: () => void;
  onSaveBatch?: () => void;
  onRetryTarget?: (targetId: string) => void;
  saving?: boolean;
}

export function LocalVideoJobResults({
  job,
  onSave,
  onSaveBatch,
  onRetryTarget,
  saving = false,
}: LocalVideoJobResultsProps) {
  const { t } = useTranslation();
  const targets = job.targets ?? [];
  const hasCompleted = targets.some((target) => target.status === "completed");
  const hasFailed = targets.some((target) => target.status === "failed");

  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      <Typography.Text>
        {t("localVideoWizard.jobState", {
          state: t(`localLibrary.state.${job.state}`, {
            defaultValue: job.state,
          }),
        })}
      </Typography.Text>
      {job.progress != null && (
        <ProgressPlaceholder percent={job.progress * 100} />
      )}
      {job.errorCode && <Alert type="error" message={job.errorCode} />}
      {targets.length > 0 ? (
        <List
          dataSource={targets}
          renderItem={(target) => (
            <List.Item
              actions={[
                target.status === "failed" && onRetryTarget ? (
                  <Button key="retry" onClick={() => onRetryTarget(target.id)}>
                    {t("localVideoWizard.retryTarget")}
                  </Button>
                ) : null,
              ].filter(Boolean)}
            >
              <Space direction="vertical" style={{ width: "100%" }}>
                <Space>
                  <Typography.Text strong>{target.filename}</Typography.Text>
                  <Tag
                    color={
                      target.status === "failed"
                        ? "error"
                        : target.status === "completed"
                        ? "success"
                        : "processing"
                    }
                  >
                    {t(`localVideoWizard.outputStatus.${target.status}`, {
                      defaultValue: target.status,
                    })}
                  </Tag>
                </Space>
                {target.videoUrl && (
                  <video
                    controls
                    src={target.videoUrl}
                    style={{ maxWidth: "100%", maxHeight: 320 }}
                  />
                )}
                {target.errorCode && (
                  <Typography.Text type="danger">
                    {target.errorCode}
                  </Typography.Text>
                )}
              </Space>
            </List.Item>
          )}
        />
      ) : (
        job.videoUrl && (
          <video
            controls
            src={job.videoUrl}
            style={{ maxWidth: "100%", maxHeight: 480 }}
          />
        )
      )}
      <Space>
        {hasCompleted && onSaveBatch && (
          <Button type="primary" loading={saving} onClick={onSaveBatch}>
            {t("localVideoWizard.saveBatch")}
          </Button>
        )}
        {!targets.length && job.videoUrl && onSave && (
          <Button type="primary" loading={saving} onClick={onSave}>
            {t("localVideoWizard.download")}
          </Button>
        )}
        {hasFailed && (
          <Typography.Text type="secondary">
            {t("localVideoWizard.partialOutputHint")}
          </Typography.Text>
        )}
      </Space>
    </Space>
  );
}

function ProgressPlaceholder({ percent }: { percent: number }) {
  return (
    <Typography.Text type="secondary">{Math.round(percent)}%</Typography.Text>
  );
}

export default LocalVideoJobResults;
