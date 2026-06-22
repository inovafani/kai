import type { BookingMemoryState } from "@/core/booking/booking-memory";
import type { BookingFlowStatus } from "@/core/booking/booking-state-machine";
import type { PmsTicketOption, PmsTicketQuantity } from "@/core/pms/types";
import { Prisma, type ManualInquiryStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const bookingFlowStatuses = new Set<BookingFlowStatus>([
  "DRAFT",
  "AVAILABILITY_CHECKED",
  "CAPTURED",
  "READY_TO_CONFIRM",
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
        ? { label: record.label, unitPriceCents: record.unitPriceCents }
        : null;
    })
    .filter((item): item is PmsTicketOption => Boolean(item));

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

function toJsonArray<T extends object>(value: T[] | null | undefined) {
  return value ? (value as unknown as Prisma.InputJsonArray) : undefined;
}

export async function createWidgetConversation(input: { tenantId: string }) {
  return prisma.conversation.create({
    data: {
      tenantId: input.tenantId,
      channel: "WEB_WIDGET",
      controlMode: "AI"
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

export async function createTravellerMessage(input: {
  tenantId: string;
  conversationId: string;
  content: string;
}) {
  return prisma.message.create({
    data: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      role: "TRAVELLER",
      content: input.content
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
      ticketOptions: true,
      ticketQuantities: true
    }
  });

  return state
    ? {
        ...state,
        bookingStatus: normalizeBookingFlowStatus(state.bookingStatus),
        ticketOptions: normalizeTicketOptions(state.ticketOptions),
        ticketQuantities: normalizeTicketQuantities(state.ticketQuantities)
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
      ticketOptions: toJsonArray(input.state.ticketOptions),
      ticketQuantities: toJsonArray(input.state.ticketQuantities)
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
      ticketOptions: toJsonArray(input.state.ticketOptions),
      ticketQuantities: toJsonArray(input.state.ticketQuantities)
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
              bookingError: true
            }
          }
        }
      }
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
