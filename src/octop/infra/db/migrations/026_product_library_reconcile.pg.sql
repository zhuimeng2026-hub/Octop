-- Schema v26: ensure the fork's product library exists after upstream v24.
CREATE TABLE IF NOT EXISTS product_library_products (
    id BIGSERIAL PRIMARY KEY,
    product_id TEXT NOT NULL UNIQUE,
    owner_user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    selling_points TEXT NOT NULL DEFAULT '[]',
    parameters TEXT NOT NULL DEFAULT '{}',
    expression_limits TEXT NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_product_library_products_owner
    ON product_library_products(owner_user_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS product_library_assets (
    id BIGSERIAL PRIMARY KEY,
    asset_id TEXT NOT NULL UNIQUE,
    owner_user_id INTEGER NOT NULL,
    product_id TEXT NOT NULL REFERENCES product_library_products(product_id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    media_type TEXT NOT NULL,
    byte_size BIGINT NOT NULL,
    content_hash TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    usage TEXT NOT NULL DEFAULT 'reference',
    priority INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_product_library_assets_product
    ON product_library_assets(owner_user_id, product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_library_assets_hash
    ON product_library_assets(owner_user_id, product_id, content_hash);
CREATE TABLE IF NOT EXISTS product_library_projects (
    id BIGSERIAL PRIMARY KEY,
    project_id TEXT NOT NULL UNIQUE,
    owner_user_id INTEGER NOT NULL,
    product_id TEXT NOT NULL,
    name TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_product_library_projects_owner
    ON product_library_projects(owner_user_id, created_at DESC);

UPDATE _schema_version SET version = 26;
