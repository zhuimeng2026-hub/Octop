import { Button } from "antd";
import { useState } from "react";
import { LoaderCircle, Video, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import {
  isActiveDesktopVideoJob,
  useDesktopVideoJobs,
} from "../context/DesktopVideoJobsContext";
import styles from "./DesktopVideoGlobalStatus.module.less";

export default function DesktopVideoGlobalStatus() {
  const { t } = useTranslation();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const { jobs } = useDesktopVideoJobs();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const activeJob =
    jobs.find(isActiveDesktopVideoJob) ??
    jobs.find(
      (job) =>
        job.state === "completed" &&
        job.id !== dismissed &&
        job.updatedAt >= Date.now() / 1000 - 300,
    );
  const completed = activeJob?.state === "completed";
  const currentProject = new URLSearchParams(search).get("project");

  if (
    !activeJob ||
    (pathname === "/product-library/video-wizard" &&
      currentProject === activeJob.projectId)
  ) {
    return null;
  }

  return (
    <div className={styles.status} role="status">
      {completed ? (
        <Video size={19} />
      ) : (
        <LoaderCircle className={styles.spinner} size={19} />
      )}
      <div className={styles.copy}>
        <strong>
          {t(
            completed
              ? "videoWizard.completedTitle"
              : "videoWizard.backgroundTitle",
          )}
        </strong>
        <span>
          {completed
            ? activeJob.name
            : t(`videoWizard.stage.${activeJob.state}`)}
        </span>
      </div>
      <Button
        type="text"
        icon={<Video size={16} />}
        onClick={() =>
          navigate(
            `/product-library/video-wizard?project=${encodeURIComponent(
              activeJob.projectId,
            )}`,
          )
        }
      >
        {t(completed ? "videoWizard.viewVideo" : "videoWizard.viewProgress")}
      </Button>
      {completed && (
        <Button
          type="text"
          icon={<X size={16} />}
          aria-label={t("common.close")}
          onClick={() => setDismissed(activeJob.id)}
        />
      )}
    </div>
  );
}
