import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function TenantAdminIndexPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  redirect(`/admin/${tenantSlug}/settings`);
}
