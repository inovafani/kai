import { buildAffiliateTurnReply, decideAffiliateTurn } from "@/core/affiliate/affiliate-trips";
import { AFFILIATE_CATALOG_FEATURE } from "@/core/tenant/feature-flags";
import { prisma } from "@/lib/prisma";
import { fetchAffiliateTrips } from "@/server/affiliate/affiliate-trips-client";
import { createAssistantMessage, createTravellerMessage } from "@/server/conversation/conversation-repository";
import { normalizeLocalPhone } from "@/server/phone/normalize-local-phone";
import { sendWhatsAppText } from "@/server/whatsapp/client";
import { resolveBluePassConversationContext } from "@/server/whatsapp/au-operator-recommendation";

/**
 * WhatsApp's side of the resold trips (FareHarbor affiliate, Rezdy agent): answers with the trip and
 * its booking link, in the BluePass conversation, like the AU recommendation does.
 *
 * STRICT handles only an unmistakable request (a trip named by its title, or a number picked from
 * Kai's own list) and runs before an ongoing operator conversation can claim the message. BROAD also
 * answers a general request that fits ("anything in the Whitsundays?") and runs only after the
 * sticky check, so a traveller mid-booking with an operator is never pulled away.
 *
 * Off unless a tenant carries the affiliate_catalog feature, so this is a data switch.
 */
// Whether any tenant has the feature, remembered for a minute: this runs twice on every inbound
// WhatsApp message, and the answer only changes when an admin flips the switch.
let enabledCache: { at: number; enabled: boolean } | null = null;

async function affiliateCatalogEnabled(now = Date.now()) {
  if (enabledCache && now - enabledCache.at < 60_000) return enabledCache.enabled;
  const count = await prisma.tenant.count({
    where: { status: "ACTIVE", config: { enabledFeatures: { has: AFFILIATE_CATALOG_FEATURE } } }
  });
  enabledCache = { at: now, enabled: count > 0 };
  return enabledCache.enabled;
}

/** Tests only. */
export function clearAffiliateCatalogEnabledCache() {
  enabledCache = null;
}

export async function resolveWhatsAppAffiliateTurn(
  input: { messageText: string; fromPhone: string },
  mode: "STRICT" | "BROAD",
  env: Record<string, string | undefined> = process.env
): Promise<{ kind: "HANDLED" } | { kind: "NONE" }> {
  if (!(await affiliateCatalogEnabled())) return { kind: "NONE" };

  const trips = await fetchAffiliateTrips(env);
  if (trips.length === 0) return { kind: "NONE" };

  const phone = normalizeLocalPhone(input.fromPhone);
  const context = await resolveBluePassConversationContext(phone, env);
  if (!context) return { kind: "NONE" };

  const turn = decideAffiliateTurn({ message: input.messageText, trips, lastAssistantMessage: context.lastAssistantMessage });
  if (turn.kind === "NONE") return { kind: "NONE" };
  if (mode === "STRICT" && (turn.kind === "LIST" || turn.via === "MATCHED")) return { kind: "NONE" };

  const reply = buildAffiliateTurnReply(turn);
  await createTravellerMessage({ tenantId: context.tenant.id, conversationId: context.conversation.id, content: input.messageText });
  await createAssistantMessage({ tenantId: context.tenant.id, conversationId: context.conversation.id, content: reply });
  await sendWhatsAppText({ to: input.fromPhone, role: "kai", body: reply });
  return { kind: "HANDLED" };
}
