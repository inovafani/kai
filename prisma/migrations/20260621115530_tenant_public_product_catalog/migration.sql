-- AlterTable
ALTER TABLE "TenantConfig" ADD COLUMN     "publicProductCatalog" JSONB NOT NULL DEFAULT '[]';
