import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function LegacyAdminInquiriesPage() {
  redirect("/admin/kai-demo/inquiries");
}
