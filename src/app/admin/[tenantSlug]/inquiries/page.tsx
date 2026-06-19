import { AdminInquiriesPageView } from "../../inquiries/admin-inquiries-page";

export const dynamic = "force-dynamic";

type TenantAdminInquiriesPageProps = {
  params: Promise<{ tenantSlug: string }>;
};

export default async function TenantAdminInquiriesPage({ params }: TenantAdminInquiriesPageProps) {
  const { tenantSlug } = await params;
  return <AdminInquiriesPageView tenantSlug={tenantSlug} />;
}
