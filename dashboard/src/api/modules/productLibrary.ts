import { request, requestBlob, requestUpload } from "../request";

export interface Product {
  id: string;
  name: string;
  model: string;
  category: string;
  selling_points: string[];
  parameters: Record<string, unknown>;
  expression_limits: string;
}

export interface ProductAsset {
  id: string;
  product_id: string;
  filename: string;
  media_type: string;
  byte_size: number;
  usage: "scene" | "reference" | "style";
  priority: number;
  active: number;
  content_hash: string;
}

export interface ProductProject {
  id: string;
  product_id: string;
  name: string;
  snapshot: { product: Product; assets: ProductAsset[]; version: number };
  created_at: number;
}

export const productLibraryApi = {
  products: () => request<{ items: Product[] }>("/product-library/products"),
  createProduct: (body: Omit<Product, "id">) =>
    request<Product>("/product-library/products", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateProduct: (id: string, body: Omit<Product, "id">) =>
    request<Product>(`/product-library/products/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteProduct: (id: string) =>
    request<void>(`/product-library/products/${id}`, { method: "DELETE" }),
  assets: (productId: string) =>
    request<{ items: ProductAsset[] }>(
      `/product-library/products/${productId}/assets`,
    ),
  upload: (productId: string, files: File[], usage: ProductAsset["usage"]) => {
    const body = new FormData();
    body.set("usage", usage);
    files.forEach((file) => body.append("files", file));
    return requestUpload<{ items: ProductAsset[] }>(
      `/product-library/products/${productId}/assets`,
      body,
    );
  },
  updateAsset: (
    id: string,
    body: { usage?: ProductAsset["usage"]; priority?: boolean; active?: boolean },
  ) =>
    request<ProductAsset>(`/product-library/assets/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  downloadAsset: (id: string) =>
    requestBlob(`/product-library/assets/${id}/download`),
  projects: () =>
    request<{ items: ProductProject[] }>("/product-library/projects"),
  createProject: (body: {
    product_id: string;
    name: string;
    asset_ids: string[];
  }) =>
    request<ProductProject>("/product-library/projects", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  prepareRender: (projectId: string, agentId: string) =>
    request<{
      status: string;
      job_id: string;
      workspace_path: string;
      rendered: boolean;
    }>(`/product-library/projects/${projectId}/prepare-render`, {
      method: "POST",
      body: JSON.stringify({ agent_id: agentId }),
    }),
};
