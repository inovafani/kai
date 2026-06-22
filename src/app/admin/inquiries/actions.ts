"use server";

import type { ManualInquiryStatus } from "@prisma/client";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { updateManualInquiryStatusForTenantSlug } from "@/server/conversation/conversation-repository";

const allowedStatuses = new Set<ManualInquiryStatus>(["OPERATOR_NOTIFIED", "CLOSED"]);

export async function updateManualInquiryStatusAction(formData: FormData) {
  const tenantSlug = String(formData.get("tenantSlug") ?? "");
  const inquiryId = String(formData.get("inquiryId") ?? "");
  const status = String(formData.get("status") ?? "") as ManualInquiryStatus;

  if (!tenantSlug || !inquiryId || !allowedStatuses.has(status)) {
    throw new Error("Invalid manual inquiry status update.");
  }

  await updateManualInquiryStatusForTenantSlug({
    tenantSlug,
    inquiryId,
    status
  });

  revalidatePath(`/admin/${tenantSlug}/inquiries`);
}


export async function submitAdminTokenAction(formData: FormData) {
  const tenantSlug = String(formData.get("tenantSlug") ?? "kai-demo");
  const token = String(formData.get("token") ?? "");
  const expectedToken = process.env.KAI_ADMIN_TOKEN;

  if (!expectedToken || token !== expectedToken) {
    throw new Error("Invalid admin token.");
  }

  const cookieStore = await cookies();
  cookieStore.set("kai_admin_token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8
  });

  revalidatePath(`/admin/${tenantSlug}/inquiries`);
}
