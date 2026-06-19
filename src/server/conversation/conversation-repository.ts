import type { BookingMemoryState } from "@/core/booking/booking-memory";
import type { ManualInquiryStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

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
      guests: true
    }
  });

  return state;
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
      guests: input.state.guests
    },
    update: {
      productExternalId: input.state.productExternalId,
      productTitle: input.state.productTitle,
      dateText: input.state.dateText,
      guests: input.state.guests
    }
  });
}

export async function createManualInquiry(input: {
  tenantId: string;
  conversationId: string;
  state: BookingMemoryState;
  travellerMessage: string;
}) {
  return prisma.manualInquiry.create({
    data: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      productExternalId: input.state.productExternalId,
      productTitle: input.state.productTitle,
      dateText: input.state.dateText,
      guests: input.state.guests,
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
          channel: true
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
