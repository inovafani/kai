import { cookies } from "next/headers";

export const ADMIN_COOKIE = "kai_admin_token";

/** Reads the admin cookie and checks it against KAI_ADMIN_TOKEN. Pages use this to decide whether to show the gate. */
export async function readAdminSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE)?.value;
  const expected = process.env.KAI_ADMIN_TOKEN;
  return { token, allowed: Boolean(expected && token === expected) };
}

/** Server actions can be called directly, so each one that mutates data checks the session itself. */
export async function assertAdminAction() {
  const session = await readAdminSession();
  if (!session.allowed) {
    throw new Error("Admin access required.");
  }
}
