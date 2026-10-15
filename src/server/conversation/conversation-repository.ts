import type { BookingMemoryState } from "@/core/booking/booking-memory";
import type { BookingFlowStatus } from "@/core/booking/booking-state-machine";
import type { PmsExtraOption, PmsExtraQuantity, PmsTicketOption, PmsTicketQuantity, PmsTimeOption } from "@/core/pms/types";
import { Prisma, type ManualInquiryStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redactCardShapedInput } from "@/core/security/card-detection";

const bookingFlowStatuses = new Set<BookingFlowStatus>([
  "DRAFT",
  "AVAILABILITY_CHECKED",
  "CAPTURED",
  "READY_TO_CONFIRM",
  "PAYMENT_PENDING",
  "EXTERNAL_BOOKING_PENDING",
  "CONFIRMED",
  "FAILED"
]);

function normalizeBookingFlowStatus(value: string | null): BookingFlowStatus {
  return value && bookingFlowStatuses.has(value as BookingFlowStatus) ? (value as BookingFlowStatus) : "DRAFT";
}

function normalizeTicketOptions(value: Prisma.JsonValue): PmsTicketOption[] | null {
  if (!Array.isArray(value)) return null;

  const options = value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      return typeof record.label === "string" && typeof record.unitPriceCents === "number"
        ? { label: record.label, unitPriceCents: record.unitPriceCents, ...(typeof record.currency === "string" ? { currency: record.currency } : {}) }
        : null;
    })
    .filter((item): item is PmsTicketOption => Boolean(item));

  return options.length > 0 ? options : null;
}

function normalizeTimeOptions(value: Prisma.JsonValue): PmsTimeOption[] | null {
  if (!Array.isArray(value)) return null;

  const options = value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      return typeof record.label === "string" &&
        typeof record.startTimeLocal === "string" &&
        typeof record.remaining === "number"
        ? {
            label: record.label,
            startTimeLocal: record.startTimeLocal,
            remaining: record.remaining,
            ...(typeof record.checkoutItemKey === "string" ? { checkoutItemKey: record.checkoutItemKey } : {}),
            ...(typeof record.checkoutSessionId === "string" ? { checkoutSessionId: record.checkoutSessionId } : {})
          }
        : null;
    })
    .filter((item): item is PmsTimeOption => Boolean(item));

  return options.length > 0 ? options : null;
}

function normalizeTicketQuantities(value: Prisma.JsonValue): PmsTicketQuantity[] | null {
  if (!Array.isArray(value)) return null;

  const quantities = value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      return typeof record.optionLabel === "string" && typeof record.quantity === "number"
        ? { optionLabel: record.optionLabel, quantity: record.quantity }
        : null;
    })
    .filter((item): item is PmsTicketQuantity => Boolean(item));

  return quantities.length > 0 ? quantities : null;
}

function normalizeExtraOptions(value: Prisma.JsonValue): PmsExtraOption[] | null {
  if (!Array.isArray(value)) return null;

  const options = value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      return typeof record.label === "string" && typeof record.unitPriceCents === "number"
        ? { label: record.label, unitPriceCents: record.unitPriceCents, ...(typeof record.currency === "string" ? { currency: record.currency } : {}) }
        : null;
    })
    .filter((item): item is PmsExtraOption => Boolean(item));

  return options.length > 0 ? options : null;
}

function normalizeExtraQuantities(value: Prisma.JsonValue): PmsExtraQuantity[] | null {
  if (!Array.isArray(value)) return null;

  const quantities = value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      return typeof record.optionLabel === "string" && typeof record.quantity === "number"
        ? { optionLabel: record.optionLabel, quantity: record.quantity }
        : null;
    })
    .filter((item): item is PmsExtraQuantity => Boolean(item));

  return quantities;
}

function toJsonArray<T extends object>(value: T[] | null | undefined) {
  return value ? (value as unknown as Prisma.InputJsonArray) : undefined;
}

export async function createWidgetConversation(input: { tenantId: string; travellerId?: string }) {
  return prisma.conversation.create({
    data: {
      tenantId: input.tenantId,
      channel: "WEB_WIDGET",
      controlMode: "AI",
      ...(input.travellerId ? { travellerId: input.travellerId } : {})
    }
  });
}

export async function findTenantConversation(input: { tenantId: string; conversationId: string }) {
  return prisma.conversation.findFirst({
    where: {
      id: input.conversationId,
      tenantId: input.tenantId
    }
  });
}

// Widget counterpart to findTenantConversation, for the moment a conversation has already been
// handed off to a different tenant than the one the caller's widget key resolves to (see the AU
// cross-tenant handoff in api/widget/messages/route.ts) - the caller only knows a bounded,
// already-trusted set of candidate tenant ids (the AU-eligible recommendation list), never an
// arbitrary tenant, so this stays a safe widened lookup rather than a fully unscoped one.
export async function findConversationAmongTenants(input: { conversationId: string; tenantIds: string[] }) {
  if (input.tenantIds.length === 0) return null;

  return prisma.conversation.findFirst({
    where: {
      id: input.conversationId,
      tenantId: { in: input.tenantIds }
    }
  });
}

// First-touch referral attribution: only fills in the conversation's referral fields if they're
// still null, mirroring booking-inquiry-service.ts's `session.value ?? existing.value` convention
// for the marketplace flow. Needed so the generic booking flow (AU/Boattime etc.) - which never
// creates a BluePassInquiry - has a durable place to read attribution back from at checkout-creation
// time (createBluePassCheckoutSessionForPmsBooking), since the per-message `referral` payload isn't
// otherwise persisted anywhere for that flow. A no-op once attribution is already set, so a later
// message with a different/no referral cookie never overwrites the original attribution.
export async function captureConversationReferralAttribution(input: {
  conversation: {
    id: string;
    referralPartnerId: string | null;
    referralLinkId: string | null;
    referralCode: string | null;
    referralRole: string | null;
  };
  referral?: {
    referralPartnerId?: string | null;
    referralLinkId?: string | null;
    referralCode?: string | null;
    referralRole?: string | null;
  } | null;
}) {
  if (!input.referral || input.conversation.referralPartnerId) {
    return;
  }

  const { referralPartnerId, referralLinkId, referralCode, referralRole } = input.referral;
  if (!referralPartnerId && !referralCode) {
    return;
  }

  await prisma.conversation.update({
    where: { id: input.conversation.id },
    data: {
      referralPartnerId: referralPartnerId ?? null,
      referralLinkId: referralLinkId ?? null,
      referralCode: referralCode ?? null,
      referralRole: referralRole ?? null
    }
  });
}

// Generalizes the find-or-create-by-phone pattern BluePass's own WhatsApp path already used
// privately (bluepass-whatsapp-conversation.ts) so any tenant's WhatsApp traffic - not just
// BluePass's - can resume the same Conversation across turns instead of starting fresh every time.
// Keyed by the dedicated whatsappPhone column (DB-enforced unique per tenant), not travellerId -
// the same column setWhatsAppConversationControlMode uses for human-takeover.
export async function findOrCreateWhatsAppConversation(input: { tenantId: string; whatsappPhone: string }) {
  const existing = await prisma.conversation.findFirst({
    where: {
      tenantId: input.tenantId,
      whatsappPhone: input.whatsappPhone
    }
  });
  if (existing) return existing;

  return prisma.conversation.create({
    data: {
      tenantId: input.tenantId,
      channel: "WHATSAPP",
      controlMode: "AI",
      whatsappPhone: input.whatsappPhone
    }
  });
}

/**
 * Starts a genuinely fresh WhatsApp thread for this phone (new conversation id, so future turns
 * never see the old message history) without violating the tenantId+whatsappPhone unique
 * constraint. Postgres treats multiple NULLs as non-conflicting for a unique index, so clearing
 * whatsappPhone on any existing row(s) for this phone frees the slot for the new row - the old
 * conversation and its messages stay in the database, just detached from this phone number.
 */
export async function resetWhatsAppConversation(input: { tenantId: string; whatsappPhone: string }) {
  await prisma.conversation.updateMany({
    where: { tenantId: input.tenantId, whatsappPhone: input.whatsappPhone },
    data: { whatsappPhone: null }
  });

  return prisma.conversation.create({
    data: {
      tenantId: input.tenantId,
      channel: "WHATSAPP",
      controlMode: "AI",
      whatsappPhone: input.whatsappPhone
    }
  });
}

/**
 * Flip control of a WhatsApp thread (e.g. a human answered from the Business phone app, so the
 * concierge must go quiet). Creates the conversation when the human replied before any inbound
 * message from this traveller ever reached us.
 */
export async function setWhatsAppConversationControlMode(input: {
  tenantId: string;
  whatsappPhone: string;
  controlMode: "AI" | "HUMAN" | "PAUSED";
}) {
  const conversation = await findOrCreateWhatsAppConversation({
    tenantId: input.tenantId,
    whatsappPhone: input.whatsappPhone
  });

  return prisma.conversation.update({
    where: { id: conversation.id },
    data: { controlMode: input.controlMode }
  });
}

/**
 * Hands a chat to a person on the team (HUMAN: Kai stays quiet and only records messages) or back
 * to Kai (AI). Used by the handoff itself and by the admin conversation page.
 */
export async function setConversationControlMode(input: {
  tenantId: string;
  conversationId: string;
  controlMode: "AI" | "HUMAN" | "PAUSED";
}) {
  return prisma.conversation.updateMany({
    where: { id: input.conversationId, tenantId: input.tenantId },
    data: { controlMode: input.controlMode }
  });
}

export async function setConversationControlModeForTenantSlug(input: {
  tenantSlug: string;
  conversationId: string;
  controlMode: "AI" | "HUMAN" | "PAUSED";
}) {
  return prisma.conversation.updateMany({
    where: { id: input.conversationId, tenant: { slug: input.tenantSlug } },
    data: { controlMode: input.controlMode }
  });
}

// Lets a logged-in traveller's Kai memory follow their account instead of one browser's local
// storage: the widget session endpoint uses this to resume their most recent conversation with a
// tenant (if any) rather than always starting fresh, so switching devices/browsers while logged in
// doesn't lose context.
export async function findRecentWidgetConversationForTraveller(input: {
  tenantId: string;
  travellerId: string;
}) {
  return prisma.conversation.findFirst({
    where: {
      tenantId: input.tenantId,
      channel: "WEB_WIDGET",
      travellerId: input.travellerId
    },
    orderBy: { updatedAt: "desc" }
  });
}

export async function createTravellerMessage(input: {
  tenantId: string;
  conversationId: string;
  content: string;
}) {
  // kai-conversation-flow-notes.md finding #16: a traveller pasted a full card number/expiry/CVV -
  // Kai correctly refused to transact with it, but the raw PAN was still written to this table
  // verbatim. This is the single choke point every traveller-message write path goes through
  // (WhatsApp, web chat, inquiry capture), so redacting here catches all of them, not just one path.
  return prisma.message.create({
    data: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      role: "TRAVELLER",
      content: redactCardShapedInput(input.content)
    }
  });
}


export async function createAssistantMessage(input: {
  tenantId: string;
  conversationId: string;
  content: string;
}) {
  return prisma.message.create({
    data: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      role: "ASSISTANT",
      content: input.content
    }
  });
}

export async function listRecentTravellerMessageContents(input: {
  tenantId: string;
  conversationId: string;
  take?: number;
}) {
  const messages = await prisma.message.findMany({
    where: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      role: "TRAVELLER"
    },
    orderBy: {
      createdAt: "desc"
    },
    take: input.take ?? 8,
    select: {
      content: true
    }
  });

  return messages.reverse().map((message) => message.content);
}

export async function listRecentConversationMessages(input: {
  tenantId: string;
  conversationId: string;
  take?: number;
}) {
  const messages = await prisma.message.findMany({
    where: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      role: {
        in: ["TRAVELLER", "ASSISTANT"]
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    take: input.take ?? 16,
    select: {
      role: true,
      content: true
    }
  });

  return messages.reverse().map((message) => ({
    role: message.role === "ASSISTANT" ? ("assistant" as const) : ("traveller" as const),
    content: message.content
  }));
}

export async function findConversationBookingState(input: {
  tenantId: string;
  conversationId: string;
}): Promise<BookingMemoryState | null> {
  const state = await prisma.conversationBookingState.findFirst({
    where: {
      tenantId: input.tenantId,
      conversationId: input.conversationId
    },
    select: {
      productExternalId: true,
      productTitle: true,
      dateText: true,
      guests: true,
      travellerName: true,
      travellerEmail: true,
      travellerPhone: true,
      bookingStatus: true,
      confirmationSummary: true,
      externalBookingId: true,
      externalProvider: true,
      bookingError: true,
      timeOptions: true,
      ticketOptions: true,
      ticketQuantities: true,
      extraOptions: true,
      extraQuantities: true
    }
  });

  return state
    ? {
        ...state,
        bookingStatus: normalizeBookingFlowStatus(state.bookingStatus),
        timeOptions: normalizeTimeOptions(state.timeOptions),
        ticketOptions: normalizeTicketOptions(state.ticketOptions),
        ticketQuantities: normalizeTicketQuantities(state.ticketQuantities),
        extraOptions: normalizeExtraOptions(state.extraOptions),
        extraQuantities: normalizeExtraQuantities(state.extraQuantities)
      }
    : null;
}

export async function upsertConversationBookingState(input: {
  tenantId: string;
  conversationId: string;
  state: BookingMemoryState;
}) {
  return prisma.conversationBookingState.upsert({
    where: {
      conversationId: input.conversationId
    },
    create: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      productExternalId: input.state.productExternalId,
      productTitle: input.state.productTitle,
      dateText: input.state.dateText,
      guests: input.state.guests,
      travellerName: input.state.travellerName ?? null,
      travellerEmail: input.state.travellerEmail ?? null,
      travellerPhone: input.state.travellerPhone ?? null,
      bookingStatus: input.state.bookingStatus ?? "DRAFT",
      confirmationSummary: input.state.confirmationSummary ?? null,
      externalBookingId: input.state.externalBookingId ?? null,
      externalProvider: input.state.externalProvider ?? null,
      bookingError: input.state.bookingError ?? null,
      timeOptions: toJsonArray(input.state.timeOptions),
      ticketOptions: toJsonArray(input.state.ticketOptions),
      ticketQuantities: toJsonArray(input.state.ticketQuantities),
      extraOptions: toJsonArray(input.state.extraOptions),
      extraQuantities: toJsonArray(input.state.extraQuantities)
    },
    update: {
      productExternalId: input.state.productExternalId,
      productTitle: input.state.productTitle,
      dateText: input.state.dateText,
      guests: input.state.guests,
      travellerName: input.state.travellerName ?? null,
      travellerEmail: input.state.travellerEmail ?? null,
      travellerPhone: input.state.travellerPhone ?? null,
      bookingStatus: input.state.bookingStatus ?? "DRAFT",
      confirmationSummary: input.state.confirmationSummary ?? null,
      externalBookingId: input.state.externalBookingId ?? null,
      externalProvider: input.state.externalProvider ?? null,
      bookingError: input.state.bookingError ?? null,
      timeOptions: toJsonArray(input.state.timeOptions),
      ticketOptions: toJsonArray(input.state.ticketOptions),
      ticketQuantities: toJsonArray(input.state.ticketQuantities),
      extraOptions: toJsonArray(input.state.extraOptions),
      extraQuantities: toJsonArray(input.state.extraQuantities)
    }
  });
}

export async function createManualInquiry(input: {
  tenantId: string;
  conversationId: string;
  state: BookingMemoryState;
  travellerMessage: string;
  travellerName?: string | null;
  travellerEmail?: string | null;
  travellerPhone?: string | null;
}) {
  return prisma.manualInquiry.create({
    data: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      productExternalId: input.state.productExternalId,
      productTitle: input.state.productTitle,
      dateText: input.state.dateText,
      guests: input.state.guests,
      travellerName: input.travellerName ?? null,
      travellerEmail: input.travellerEmail ?? null,
      travellerPhone: input.travellerPhone ?? null,
      travellerMessage: input.travellerMessage
    }
  });
}

export async function listManualInquiriesForTenantSlug(input: {
  tenantSlug: string;
  take?: number;
}) {
  return prisma.manualInquiry.findMany({
    where: {
      tenant: {
        slug: input.tenantSlug
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    take: input.take ?? 50,
    include: {
      tenant: {
        select: {
          slug: true,
          name: true
        }
      },
      conversation: {
        select: {
          controlMode: true,
          channel: true,
          bookingState: {
            select: {
              bookingStatus: true,
              confirmationSummary: true,
              bookingError: true,
              externalBookingId: true,
              externalProvider: true
            }
          }
        }
      }
    }
  });
}


/**
 * An operator's own manual-inquiry history, keyed by the Rezdy product ids their bluepass-redesign
 * listings carry (`OperatorListing.externalProductId`) - not by tenantId directly, since every
 * Rezdy-Agent-synced operator's inquiries land under the one shared canonical "bluepass" tenant (see
 * bluepass-redesign's `INDONESIA_TENANT_SLUG`/`operatorBookingSource` for the other half of this).
 * Filtering by product id is what turns that one shared bucket back into "this operator's rows".
 *
 * Empty `productExternalIds` returns no rows rather than every inquiry on the tenant - an operator
 * with no linked product id yet must never see every other operator's traveller contact details.
 */
export async function listManualInquiriesForTenantSlugAndProductExternalIds(input: {
  tenantSlug: string;
  productExternalIds: string[];
}) {
  if (input.productExternalIds.length === 0) {
    return [];
  }

  return prisma.manualInquiry.findMany({
    where: {
      tenant: { slug: input.tenantSlug },
      productExternalId: { in: input.productExternalIds }
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      productExternalId: true,
      productTitle: true,
      dateText: true,
      guests: true,
      travellerName: true,
      travellerEmail: true,
      travellerPhone: true,
      travellerMessage: true,
      createdAt: true
    }
  });
}

export async function updateManualInquiryStatusForTenantSlug(input: {
  tenantSlug: string;
  inquiryId: string;
  status: ManualInquiryStatus;
}) {
  return prisma.manualInquiry.updateMany({
    where: {
      id: input.inquiryId,
      tenant: {
        slug: input.tenantSlug
      }
    },
    data: {
      status: input.status
    }
  });
}

/**
 * Removes one manual inquiry, and only if it belongs to the tenant in the URL. The conversation it
 * came from, with its messages, stays: only the inquiry record (the item in the inbox) is deleted.
 */
export async function deleteManualInquiryForTenantSlug(input: { tenantSlug: string; inquiryId: string }) {
  return prisma.manualInquiry.deleteMany({
    where: {
      id: input.inquiryId,
      tenant: {
        slug: input.tenantSlug
      }
    }
  });
}

export async function findConversationTranscriptForTenantSlug(input: {
  tenantSlug: string;
  conversationId: string;
}) {
  return prisma.conversation.findFirst({
    where: {
      id: input.conversationId,
      tenant: {
        slug: input.tenantSlug
      }
    },
    include: {
      tenant: {
        select: {
          slug: true,
          name: true
        }
      },
      bookingState: true,
      manualInquiries: {
        orderBy: {
          createdAt: "desc"
        }
      },
      messages: {
        orderBy: {
          createdAt: "asc"
        }
      }
    }
  });
}
