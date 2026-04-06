-- Per-tenant rotation config: Infisical push + deploy trigger mappings
ALTER TABLE tenants ADD COLUMN rotation_config TEXT;
