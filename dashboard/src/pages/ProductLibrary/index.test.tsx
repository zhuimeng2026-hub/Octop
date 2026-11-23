import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import ProductLibraryPage from "./index";
import { UploadRequestError } from "../../api/request";
import { MAX_IMPORT_FILE_BYTES, MAX_IMPORT_TOTAL_BYTES } from "./importFiles";

type UploadFileItem = { uid: string; name: string };
type UploadProps = {
  accept?: string;
  beforeUpload?: (file: File) => boolean | void;
  fileList?: UploadFileItem[];
  onRemove?: (file: UploadFileItem) => void;
  children?: ReactNode;
};

const api = vi.hoisted(() => ({
  products: vi.fn(),
  projects: vi.fn(),
  assets: vi.fn(),
  upload: vi.fn(),
  createProduct: vi.fn(),
  deleteProject: vi.fn(),
  analyzeImport: vi.fn(),
  commitImport: vi.fn(),
  downloadAsset: vi.fn().mockResolvedValue(new Blob()),
  message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
const compression = vi.hoisted(() => ({
  compressImportImage: vi.fn(),
  compressedEntryPath: vi.fn(),
}));
vi.mock("./importCompression", () => compression);
vi.mock("../../api/modules/productLibrary", async () => {
  const actual = await vi.importActual<
    typeof import("../../api/modules/productLibrary")
  >("../../api/modules/productLibrary");
  return {
    ...actual,
    productLibraryApi: { ...actual.productLibraryApi, ...api },
  };
});
vi.mock("../../api/request", async () => {
  const actual = await vi.importActual<typeof import("../../api/request")>(
    "../../api/request",
  );
  return { ...actual, request: vi.fn().mockResolvedValue([]) };
});
vi.mock("../../context/DesktopVideoJobsContext", () => ({
  useDesktopVideoJobs: () => ({ bridgeAvailable: false }),
}));
vi.mock("../../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ id: 7 }),
}));
vi.mock("../../layouts/PageShell", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../utils/antdMessage", () => ({
  message: api.message,
}));
vi.mock("antd", async (importOriginal) => {
  const actual = await importOriginal<typeof import("antd")>();
  return {
    ...actual,
    Upload: ({
      accept,
      beforeUpload,
      fileList = [],
      onRemove,
      children,
    }: UploadProps) => (
      <div>
        <input
          aria-label="asset file picker"
          type="file"
          accept={accept}
          multiple
          onChange={(event) => {
            Array.from(event.currentTarget.files ?? []).forEach(
              (file) => beforeUpload?.(file),
            );
            event.currentTarget.value = "";
          }}
        />
        {fileList.map((file) => (
          <div key={file.uid}>
            <span>{file.name}</span>
            <button
              aria-label={`remove-${file.uid}`}
              onClick={() => onRemove?.(file)}
            >
              remove
            </button>
          </div>
        ))}
        {children}
      </div>
    ),
  };
});

const product = {
  id: "product-new",
  name: "New product",
  model: "",
  category: "",
  selling_points: [],
  parameters: {},
  expression_limits: "",
};
const imageAsset = {
  id: "image-1",
  product_id: product.id,
  filename: "photo.png",
  media_type: "image/png",
  byte_size: 10,
  usage: "scene" as const,
  priority: 0,
  active: 1,
  content_hash: "image",
};
const documentAsset = {
  id: "document-1",
  product_id: product.id,
  filename: "brief.pdf",
  media_type: "application/pdf",
  byte_size: 10,
  usage: "reference" as const,
  priority: 0,
  active: 1,
  content_hash: "doc",
};

function renderPage() {
  return render(
    <MemoryRouter>
      <ProductLibraryPage />
    </MemoryRouter>,
  );
}

function sizedFile(name: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type: "image/jpeg" });
}

describe("product library MVP", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    compression.compressImportImage.mockReset();
    compression.compressedEntryPath.mockReset();
    api.products.mockResolvedValue({ items: [] });
    api.projects.mockResolvedValue({ items: [] });
    api.assets.mockResolvedValue({ items: [] });
    api.createProduct.mockResolvedValue(product);
  });

  it("selects a newly created product, classifies by extension, retains failed files for retry, and removes same-name rows independently", async () => {
    const user = userEvent.setup();
    api.products
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValue({ items: [product] });
    api.upload
      .mockResolvedValueOnce({ items: [imageAsset] })
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({ items: [documentAsset] });
    api.assets
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [imageAsset] })
      .mockResolvedValue({ items: [imageAsset, documentAsset] });
    renderPage();

    await user.click(
      screen.getByRole("button", { name: "productLibrary.addProduct" }),
    );
    await user.type(
      screen.getByPlaceholderText("productLibrary.name"),
      "New product",
    );
    await user.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText("productLibrary.assets");
    await waitFor(() => expect(api.assets).toHaveBeenCalledWith(product.id));

    const duplicateOne = new File(["one"], "duplicate.pdf", { type: "" });
    const duplicateTwo = new File(["two"], "duplicate.pdf", { type: "" });
    const photo = new File(["image"], "photo.png", { type: "" });
    const document = new File(["document"], "brief.pdf", { type: "" });
    const picker = screen.getByLabelText(
      "asset file picker",
    ) as HTMLInputElement;
    await user.upload(picker, [duplicateOne, duplicateTwo]);
    const duplicateRows = screen.getAllByText("duplicate.pdf");
    expect(duplicateRows).toHaveLength(2);
    const firstUid = duplicateRows[0].parentElement
      ?.querySelector("button")
      ?.getAttribute("aria-label");
    await user.click(screen.getByRole("button", { name: firstUid! }));
    expect(screen.getAllByText("duplicate.pdf")).toHaveLength(1);
    const remainingDuplicate = screen
      .getAllByText("duplicate.pdf")[0]
      .parentElement?.querySelector("button")
      ?.getAttribute("aria-label");
    await user.click(screen.getByRole("button", { name: remainingDuplicate! }));

    await user.upload(picker, [photo, document]);
    await user.click(
      screen.getByRole("button", { name: "productLibrary.upload" }),
    );
    await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(2));
    expect(api.upload.mock.calls[0][2]).toBe("scene");
    expect(api.upload.mock.calls[1][2]).toBe("reference");
    expect(screen.getByText("brief.pdf")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "productLibrary.upload" }),
    );
    await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(3));
    expect(api.upload.mock.calls[2][2]).toBe("reference");
  });

  it("deletes a project row only after the confirmation dialog is accepted", async () => {
    const user = userEvent.setup();
    const project = {
      id: "project-1",
      product_id: product.id,
      name: "Autumn launch",
      snapshot: { product, assets: [], version: 1 },
      created_at: 0,
    };
    api.products.mockResolvedValue({ items: [product] });
    api.projects.mockResolvedValue({ items: [project] });
    api.deleteProject.mockResolvedValue(undefined);
    renderPage();

    const continueButtons = await screen.findAllByRole("button", {
      name: "productLibrary.continueVideo",
    });
    expect(continueButtons).toHaveLength(1);
    expect(api.deleteProject).not.toHaveBeenCalled();

    const deleteButtons = screen.getAllByRole("button", {
      name: "productLibrary.delete",
    });
    await user.click(deleteButtons[deleteButtons.length - 1]);
    await user.click(await screen.findByRole("button", { name: "OK" }));

    await waitFor(() =>
      expect(api.deleteProject).toHaveBeenCalledWith("project-1"),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "productLibrary.continueVideo" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("shows an actionable message for an oversized import and keeps the queue", async () => {
    const user = userEvent.setup();
    api.analyzeImport.mockRejectedValue(
      new UploadRequestError(413, "<html>nginx error</html>"),
    );
    renderPage();

    await user.click(
      screen.getByRole("button", { name: "productLibrary.importDirectory" }),
    );
    const picker = document.querySelector(
      'input[type="file"][accept]',
    ) as HTMLInputElement;
    await user.upload(
      picker,
      new File(["image"], "queued.png", { type: "image/png" }),
    );
    await user.click(
      screen.getByRole("button", { name: "productLibrary.importAnalyze" }),
    );

    await waitFor(() => expect(api.analyzeImport).toHaveBeenCalled());
    expect(api.message.error).toHaveBeenCalledWith(
      "productLibrary.importTooLarge",
    );
    expect(api.analyzeImport.mock.calls[0][0][0].file.name).toBe("queued.png");

    await user.click(
      screen.getByRole("button", { name: "productLibrary.importAnalyze" }),
    );
    await waitFor(() => expect(api.analyzeImport).toHaveBeenCalledTimes(2));
    expect(api.analyzeImport.mock.calls[1][0][0].file.name).toBe("queued.png");
  });

  it("preflights file and batch limits before analyzing", async () => {
    const user = userEvent.setup();
    api.analyzeImport.mockResolvedValue({
      job_id: "job-1",
      groups: [],
      skipped: [],
      failed: [],
    });
    renderPage();
    await user.click(
      screen.getByRole("button", { name: "productLibrary.importDirectory" }),
    );
    const picker = document.querySelector(
      'input[type="file"][accept]',
    ) as HTMLInputElement;
    await user.upload(picker, sizedFile("exact.jpg", MAX_IMPORT_FILE_BYTES));
    await user.click(
      screen.getByRole("button", { name: "productLibrary.importAnalyze" }),
    );
    await waitFor(() => expect(api.analyzeImport).toHaveBeenCalledTimes(1));

    api.analyzeImport.mockClear();
    await user.click(
      screen.getByRole("button", { name: "productLibrary.importBack" }),
    );
    const retryPicker = document.querySelector(
      'input[type="file"][accept]',
    ) as HTMLInputElement;
    await user.upload(
      retryPicker,
      sizedFile("too-large.jpg", MAX_IMPORT_FILE_BYTES + 1),
    );
    expect(api.message.warning).toHaveBeenCalledWith(
      expect.stringContaining("productLibrary.importFileTooLarge"),
    );
    await user.upload(
      retryPicker,
      sizedFile("second.jpg", MAX_IMPORT_FILE_BYTES),
    );
    await user.upload(
      retryPicker,
      sizedFile(
        "batch-overflow.jpg",
        MAX_IMPORT_TOTAL_BYTES - MAX_IMPORT_FILE_BYTES * 2 + 1,
      ),
    );
    await user.click(
      screen.getByRole("button", { name: "productLibrary.importAnalyze" }),
    );
    expect(api.analyzeImport).not.toHaveBeenCalled();
    expect(api.message.warning).toHaveBeenCalledWith(
      expect.stringContaining("productLibrary.importTotalTooLarge"),
    );
  });

  it("compresses an oversized file locally before adding it", async () => {
    const user = userEvent.setup();
    const compressed = new File(["small"], "large.jpg", {
      type: "image/jpeg",
    });
    compression.compressImportImage.mockResolvedValue(compressed);
    compression.compressedEntryPath.mockReturnValue("large.jpg");
    api.analyzeImport.mockResolvedValue({
      job_id: "job-2",
      groups: [],
      skipped: [],
      failed: [],
    });
    renderPage();
    await user.click(
      screen.getByRole("button", { name: "productLibrary.importDirectory" }),
    );
    const picker = document.querySelector(
      'input[type="file"][accept]',
    ) as HTMLInputElement;
    await user.upload(
      picker,
      sizedFile("large.jpg", MAX_IMPORT_FILE_BYTES + 1),
    );
    await user.click(
      screen.getByRole("button", {
        name: "productLibrary.importCompressAndAdd",
      }),
    );
    await waitFor(() =>
      expect(compression.compressImportImage).toHaveBeenCalled(),
    );
    expect(api.message.success).toHaveBeenCalledWith(
      "productLibrary.importCompressed",
    );
    expect(
      screen.queryByRole("button", {
        name: "productLibrary.importCompressAndAdd",
      }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "productLibrary.importAnalyze" }),
    );
    await waitFor(() => expect(api.analyzeImport).toHaveBeenCalledTimes(1));
    expect(api.analyzeImport.mock.calls[0][0][0].file.name).toBe("large.jpg");
  });

  it("shows Done instead of Cancel once the directory import has completed", async () => {
    const user = userEvent.setup();
    api.analyzeImport.mockResolvedValue({
      job_id: "job-1",
      total: 1,
      groups: [
        {
          key: "g1",
          suggested_name: "Bag",
          category: "bags",
          items: [
            {
              index: 0,
              filename: "front.png",
              relative_path: "front.png",
              folder: "bag",
              confidence: 0.9,
              description: "",
              tags: [],
              group_source: "vision",
              duplicate: false,
            },
          ],
        },
      ],
      skipped: [],
      failed: [],
    });
    api.commitImport.mockResolvedValue({
      created_products: 1,
      reused_products: 0,
      imported_assets: 1,
      skipped_duplicates: 0,
      failed: [],
    });
    renderPage();

    await user.click(
      screen.getByRole("button", { name: "productLibrary.importDirectory" }),
    );
    const imagePicker = document.querySelector(
      'input[type="file"][accept=".png,.jpg,.jpeg,.webp,.gif,.bmp,.avif"]',
    ) as HTMLInputElement;
    fireEvent.change(imagePicker, {
      target: { files: [new File(["x"], "front.png", { type: "image/png" })] },
    });
    await user.click(
      screen.getByRole("button", { name: "productLibrary.importAnalyze" }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: "productLibrary.importConfirm",
      }),
    );

    expect(
      await screen.findByRole("button", {
        name: "productLibrary.importFinish",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "productLibrary.importCancel" }),
    ).not.toBeInTheDocument();
  });
});
