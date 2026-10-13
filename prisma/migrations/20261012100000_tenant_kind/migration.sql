-- CreateEnum
CREATE TYPE "TenantKind" AS ENUM ('OPERATOR', 'PLATFORM');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "kind" "TenantKind" NOT NULL DEFAULT 'OPERATOR';

