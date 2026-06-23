import { describe, expect, it } from "vitest";
import { MockPmsAdapter } from "@/core/pms/mock-pms-adapter";
import { handleTravellerBookingMessage } from "./booking-orchestrator";

describe("booking orchestrator", () => {
  it("checks PMS availability when product, date, and guests are known", async () => {
    const result = await handleTravellerBookingMessage({
      message: "Can you check Komodo Day Trip for 3 guests tomorrow?",
      pmsAdapter: new MockPmsAdapter()
    });

    expect(result).toEqual({
      action: "AVAILABILITY_CHECKED",
      reply:
        "Good news, Komodo Day Trip has availability for 3 guests tomorrow. There are 7 spots left at USD 185.00 per guest. I have not confirmed anything yet, but I can help you continue if this looks good.",
      replySource: "DETERMINISTIC"
    });
  });

  it("can use a safe LLM rewrite without changing the PMS action", async () => {
    const result = await handleTravellerBookingMessage({
      message: "Can you check Komodo Day Trip for 3 guests tomorrow?",
      pmsAdapter: new MockPmsAdapter(),
      llmClient: {
        async composeReply() {
          return "Komodo Day Trip is available for 3 guests tomorrow. PMS shows 7 spots remaining at USD 185.00 per guest. I have not confirmed a booking yet.";
        }
      }
    });

    expect(result).toEqual({
      action: "AVAILABILITY_CHECKED",
      reply:
        "Komodo Day Trip is available for 3 guests tomorrow. PMS shows 7 spots remaining at USD 185.00 per guest. I have not confirmed a booking yet.",
      replySource: "LLM"
    });
  });

  it("keeps writable auto-booking availability replies deterministic so they do not imply team verification", async () => {
    const result = await handleTravellerBookingMessage({
      message: "Can you check Komodo Day Trip for 3 guests tomorrow?",
      bookingWriteEnabled: true,
      pmsAdapter: new MockPmsAdapter(),
      llmClient: {
        async composeReply() {
          return "This is available, but I need to verify with our team before confirming your booking.";
        }
      }
    });

    expect(result).toEqual({
      action: "AVAILABILITY_CHECKED",
      reply:
        "Good news, Komodo Day Trip has availability for 3 guests tomorrow. There are 7 spots left at USD 185.00 per guest. I have not confirmed anything yet, but I can help you continue if this looks good.",
      replySource: "DETERMINISTIC"
    });
  });

  it("recommends PMS products without inheriting stale product memory", async () => {
    const result = await handleTravellerBookingMessage({
      message: "do you have recommendation for me tomorrow?",
      bookingMemory: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
        dateText: null,
        guests: null
      },
      pmsAdapter: new MockPmsAdapter()
    });

    expect(result).toEqual({
      action: "PRODUCT_RECOMMENDATION",
      reply:
        "For tomorrow, you can choose from:\n" +
        "1. Komodo Day Trip - live availability\n" +
        "2. Private Charter - operator confirmation required\n" +
        "3. Reef Day Snorkel - live availability\n\n" +
        "Which one sounds closest to what you want?",
      replySource: "DETERMINISTIC"
    });
  });

  it("formats product recommendations as a readable list", async () => {
    const result = await handleTravellerBookingMessage({
      message: "what options do you have tomorrow?",
      pmsAdapter: new MockPmsAdapter()
    });

    expect(result).toEqual({
      action: "PRODUCT_RECOMMENDATION",
      reply:
        "For tomorrow, you can choose from:\n" +
        "1. Komodo Day Trip - live availability\n" +
        "2. Private Charter - operator confirmation required\n" +
        "3. Reef Day Snorkel - live availability\n\n" +
        "Which one sounds closest to what you want?",
      replySource: "DETERMINISTIC"
    });
  });

  it("keeps product recommendations deterministic so Kai does not sound like a generic PMS script", async () => {
    const result = await handleTravellerBookingMessage({
      message: "do you have recommendation for me tomorrow?",
      pmsAdapter: new MockPmsAdapter(),
      tenantContext: {
        tenantName: "Kai Demo",
        brandVoice: "Warm and precise.",
        pmsProvider: "MOCK",
        responseGuardrails: ["Do not invent availability."]
      },
      llmClient: {
        async composeReply() {
          return "We appreciate you considering our PMS options. Please provide more details so we can tailor a response.";
        }
      }
    });

    expect(result).toEqual({
      action: "PRODUCT_RECOMMENDATION",
      reply:
        "For tomorrow, you can choose from:\n" +
        "1. Komodo Day Trip - live availability\n" +
        "2. Private Charter - operator confirmation required\n" +
        "3. Reef Day Snorkel - live availability\n\n" +
        "Which one sounds closest to what you want?",
      replySource: "DETERMINISTIC"
    });
  });

  it("answers product info requests with the matched product and product page link", async () => {
    const result = await handleTravellerBookingMessage({
      message: "ok i think i would like to know about Gold Coast Whale Escape",
      pmsAdapter: {
        provider: "MOCK",
        listProducts: async () => [
          {
            externalProductId: "boattime-whale-escape",
            title: "Gold Coast Whale Escape",
            description: "Luxury whale watching cruise",
            bookingMode: "AUTO_BOOKING",
            productUrl: "http://localhost:3107/demo/boattime#gold-coast-whale-escape"
          }
        ],
        getAvailability: async () => {
          throw new Error("Availability should not be checked for product info requests.");
        },
        createBooking: async () => {
          throw new Error("Booking should not be created for product info requests.");
        },
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(result).toEqual({
      action: "PRODUCT_LINK",
      reply:
        "Gold Coast Whale Escape is a luxury whale watching cruise. You can see the product page here: http://localhost:3107/demo/boattime#gold-coast-whale-escape. If you like it, tell me your date and group size and I can check availability.",
      replySource: "DETERMINISTIC"
    });
  });

  it("uses the latest availability request instead of looping on an earlier product browsing intent", async () => {
    const result = await handleTravellerBookingMessage({
      message: "ok is it available tomorrow for 2 guests?",
      priorTravellerMessages: ["what do you have for me?", "let me see gold coast whale escape"],
      bookingMemory: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: null,
        guests: null
      },
      pmsAdapter: {
        provider: "MOCK",
        listProducts: async () => [
          {
            externalProductId: "boattime-whale-escape",
            title: "Gold Coast Whale Escape",
            description: "Luxury whale watching cruise",
            bookingMode: "AUTO_BOOKING",
            productUrl: "http://localhost:3107/demo/boattime#gold-coast-whale-escape"
          }
        ],
        getAvailability: async (input) => ({
          productId: input.productId,
          date: input.date,
          available: true,
          remaining: 22,
          currency: "AUD",
          unitPriceCents: 9900
        }),
        createBooking: async () => {
          throw new Error("Booking should not be created for availability checks.");
        },
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(result).toEqual({
      action: "AVAILABILITY_CHECKED",
      reply:
        "Good news, Gold Coast Whale Escape has availability for 2 guests tomorrow. There are 22 spots left at AUD 99.00 per guest. I have not confirmed anything yet, but I can help you continue if this looks good.",
      replySource: "DETERMINISTIC"
    });
  });

  it("checks availability when traveller follows product browsing with only date and guest count", async () => {
    const result = await handleTravellerBookingMessage({
      message: "for 24th of june for 2 people",
      priorTravellerMessages: ["what do you have for me?", "i want gold coast whale escape"],
      bookingMemory: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: null,
        guests: null
      },
      pmsAdapter: {
        provider: "MOCK",
        listProducts: async () => [
          {
            externalProductId: "boattime-whale-escape",
            title: "Gold Coast Whale Escape",
            description: "Luxury whale watching cruise",
            bookingMode: "AUTO_BOOKING",
            productUrl: "http://localhost:3107/demo/boattime#gold-coast-whale-escape"
          }
        ],
        getAvailability: async (input) => ({
          productId: input.productId,
          date: input.date,
          available: true,
          remaining: 18,
          currency: "AUD",
          unitPriceCents: 9900
        }),
        createBooking: async () => {
          throw new Error("Booking should not be created for availability checks.");
        },
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(result).toEqual({
      action: "AVAILABILITY_CHECKED",
      reply:
        "Good news, Gold Coast Whale Escape has availability for 2 guests on 2026-06-24. There are 18 spots left at AUD 99.00 per guest. I have not confirmed anything yet, but I can help you continue if this looks good.",
      replySource: "DETERMINISTIC"
    });
  });

  it("asks for a ticket option when an available product exposes multiple ticket options", async () => {
    const result = await handleTravellerBookingMessage({
      message: "Can you check Gold Coast Whale Escape for 3 guests tomorrow?",
      bookingWriteEnabled: true,
      pmsAdapter: {
        provider: "MOCK",
        listProducts: async () => [
          {
            externalProductId: "boattime-whale-escape",
            title: "Gold Coast Whale Escape",
            description: "Luxury whale watching cruise",
            bookingMode: "AUTO_BOOKING",
            productUrl: "http://localhost:3107/demo/boattime#gold-coast-whale-escape"
          }
        ],
        getAvailability: async (input) => ({
          productId: input.productId,
          date: input.date,
          available: true,
          remaining: 22,
          currency: "AUD",
          unitPriceCents: 7900,
          ticketOptions: [
            { label: '"2 people for $149.00', unitPriceCents: 14900 },
            { label: "Family (2A +2C) 3-13", unitPriceCents: 24900 },
            { label: "Child (3-13)", unitPriceCents: 5900 },
            { label: "Infant (under 3)", unitPriceCents: 0 },
            { label: "Adult (Winter Special)", unitPriceCents: 7900 }
          ]
        }),
        createBooking: async () => {
          throw new Error("Booking should not be created before ticket composition is chosen.");
        },
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(result).toEqual({
      action: "BOOKING_TICKET_SELECTION_REQUIRED",
      reply:
        "Gold Coast Whale Escape is available for 3 guests tomorrow. There are 22 spots left.\n\n" +
        "Ticket options:\n" +
        "1. 2 people for $149.00 - AUD 149.00\n" +
        "2. Family (2A +2C) 3-13 - AUD 249.00\n" +
        "3. Child (3-13) - AUD 59.00\n" +
        "4. Infant (under 3) - AUD 0.00\n" +
        "5. Adult (Winter Special) - AUD 79.00\n\n" +
        "Which ticket option should I use? You can say \"option 2\" or \"1 x 2 people\". Nothing is booked yet.",
      replySource: "DETERMINISTIC",
      bookingStatePatch: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "tomorrow",
        guests: 3,
        travellerName: null,
        travellerEmail: null,
        travellerPhone: null,
        bookingStatus: "AVAILABILITY_CHECKED",
        confirmationSummary: null,
        externalBookingId: null,
        externalProvider: null,
        bookingError: null,
        ticketOptions: [
          { label: '"2 people for $149.00', unitPriceCents: 14900 },
          { label: "Family (2A +2C) 3-13", unitPriceCents: 24900 },
          { label: "Child (3-13)", unitPriceCents: 5900 },
          { label: "Infant (under 3)", unitPriceCents: 0 },
          { label: "Adult (Winter Special)", unitPriceCents: 7900 }
        ],
        ticketQuantities: null
      }
    });
  });

  it("asks the traveller to choose an available time before ticket selection when Rezdy exposes multiple sessions", async () => {
    const result = await handleTravellerBookingMessage({
      message: "Can you check Gold Coast Whale Escape for 3 guests on 2026-06-27?",
      bookingWriteEnabled: true,
      pmsAdapter: {
        provider: "MOCK",
        listProducts: async () => [
          {
            externalProductId: "boattime-whale-escape",
            title: "Gold Coast Whale Escape",
            description: "Luxury whale watching cruise",
            bookingMode: "AUTO_BOOKING",
            productUrl: "https://boattimeyachtcharters.rezdy.com/services/431872"
          }
        ],
        getAvailability: async (input) => ({
          productId: input.productId,
          date: "2026-06-27 09:00:00",
          available: true,
          remaining: 77,
          currency: "AUD",
          unitPriceCents: 7900,
          timeOptions: [
            { label: "9:00 AM", startTimeLocal: "2026-06-27 09:00:00", remaining: 77 },
            { label: "12:00 PM", startTimeLocal: "2026-06-27 12:00:00", remaining: 79 }
          ],
          ticketOptions: [
            { label: '"2 people for $149.00', unitPriceCents: 14900 },
            { label: "Adult (Winter Special)", unitPriceCents: 7900 }
          ]
        }),
        createBooking: async () => {
          throw new Error("Booking should not be created before checkout handoff.");
        },
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(result).toEqual({
      action: "BOOKING_TIME_SELECTION_REQUIRED",
      reply:
        "Gold Coast Whale Escape is available for 3 guests on 2026-06-27. I found these times:\n" +
        "1. 9:00 AM - 77 spots\n" +
        "2. 12:00 PM - 79 spots\n\n" +
        "Which time works best? Nothing is booked yet.",
      replySource: "DETERMINISTIC",
      bookingStatePatch: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-27",
        guests: 3,
        travellerName: null,
        travellerEmail: null,
        travellerPhone: null,
        bookingStatus: "AVAILABILITY_CHECKED",
        confirmationSummary: null,
        externalBookingId: null,
        externalProvider: null,
        bookingError: null,
        timeOptions: [
          { label: "9:00 AM", startTimeLocal: "2026-06-27 09:00:00", remaining: 77 },
          { label: "12:00 PM", startTimeLocal: "2026-06-27 12:00:00", remaining: 79 }
        ],
        ticketOptions: [
          { label: '"2 people for $149.00', unitPriceCents: 14900 },
          { label: "Adult (Winter Special)", unitPriceCents: 7900 }
        ],
        ticketQuantities: null
      }
    });
  });

  it("stores the selected time and then asks for the ticket option as a list", async () => {
    const result = await handleTravellerBookingMessage({
      message: "12:00 PM please",
      bookingMemory: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-27",
        guests: 2,
        timeOptions: [
          { label: "9:00 AM", startTimeLocal: "2026-06-27 09:00:00", remaining: 77 },
          { label: "12:00 PM", startTimeLocal: "2026-06-27 12:00:00", remaining: 79 }
        ],
        ticketOptions: [
          { label: '"2 people for $149.00', unitPriceCents: 14900 },
          { label: "Adult (Winter Special)", unitPriceCents: 7900 }
        ],
        ticketQuantities: null
      },
      bookingWriteEnabled: true,
      pmsAdapter: {
        provider: "MOCK",
        listProducts: async () => [],
        getAvailability: async () => {
          throw new Error("Availability should not be rechecked when choosing a remembered time.");
        },
        createBooking: async () => {
          throw new Error("Booking should not be created before checkout handoff.");
        },
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(result).toEqual({
      action: "BOOKING_TICKET_SELECTION_REQUIRED",
      reply:
        "Got it: Gold Coast Whale Escape on 2026-06-27 at 12:00 PM for 2 guests.\n\n" +
        "Ticket options:\n" +
        "1. 2 people for $149.00 - AUD 149.00\n" +
        "2. Adult (Winter Special) - AUD 79.00\n\n" +
        "Which ticket option should I use? You can say \"option 2\" or \"1 x 2 people\".",
      replySource: "DETERMINISTIC",
      bookingStatePatch: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-27 12:00:00",
        guests: 2,
        travellerName: null,
        travellerEmail: null,
        travellerPhone: null,
        bookingStatus: "AVAILABILITY_CHECKED",
        confirmationSummary: null,
        externalBookingId: null,
        externalProvider: null,
        bookingError: null,
        timeOptions: [
          { label: "9:00 AM", startTimeLocal: "2026-06-27 09:00:00", remaining: 77 },
          { label: "12:00 PM", startTimeLocal: "2026-06-27 12:00:00", remaining: 79 }
        ],
        ticketOptions: [
          { label: '"2 people for $149.00', unitPriceCents: 14900 },
          { label: "Adult (Winter Special)", unitPriceCents: 7900 }
        ],
        ticketQuantities: null
      }
    });
  });

  it("understands compact time selections such as 9am", async () => {
    const result = await handleTravellerBookingMessage({
      message: "i think i want the 9am",
      bookingMemory: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-30",
        guests: 2,
        timeOptions: [
          { label: "9:00 AM", startTimeLocal: "2026-06-30 09:00:00", remaining: 82 },
          { label: "12:00 PM", startTimeLocal: "2026-06-30 12:00:00", remaining: 82 }
        ],
        ticketOptions: [
          { label: "Family (2A +2C) 3-13", unitPriceCents: 24900 },
          { label: '"2 people for $149.00', unitPriceCents: 14900 },
          { label: "Child (3-13)", unitPriceCents: 5900 },
          { label: "Infant (under 3)", unitPriceCents: 0 },
          { label: "Adult (Winter Special)", unitPriceCents: 7900 }
        ],
        ticketQuantities: null
      },
      bookingWriteEnabled: true,
      pmsAdapter: {
        provider: "MOCK",
        listProducts: async () => [],
        getAvailability: async () => {
          throw new Error("Availability should not be rechecked when choosing a remembered time.");
        },
        createBooking: async () => {
          throw new Error("Booking should not be created before checkout handoff.");
        },
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(result).toMatchObject({
      action: "BOOKING_TICKET_SELECTION_REQUIRED",
      bookingStatePatch: {
        dateText: "2026-06-30 09:00:00"
      }
    });
    expect(result.reply).toContain("at 9:00 AM");
    expect(result.reply).toContain("Ticket options:");
  });

  it("understands time labels with minutes before treating numbers as list choices", async () => {
    const result = await handleTravellerBookingMessage({
      message: "i want 1:30 pm",
      bookingMemory: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-26",
        guests: 2,
        timeOptions: [
          { label: "9:00 AM", startTimeLocal: "2026-06-26 09:00:00", remaining: 74 },
          { label: "12:00 PM", startTimeLocal: "2026-06-26 12:00:00", remaining: 90 },
          { label: "1:30 PM", startTimeLocal: "2026-06-26 13:30:00", remaining: 90 }
        ],
        ticketOptions: [
          { label: "Family (2A +2C) 3-13", unitPriceCents: 24900 },
          { label: '"2 people for $149.00', unitPriceCents: 14900 },
          { label: "Child (3-13)", unitPriceCents: 5900 },
          { label: "Infant (under 3)", unitPriceCents: 0 },
          { label: "Adult (Winter Special)", unitPriceCents: 7900 }
        ],
        ticketQuantities: null
      },
      bookingWriteEnabled: true,
      pmsAdapter: {
        provider: "MOCK",
        listProducts: async () => [],
        getAvailability: async () => {
          throw new Error("Availability should not be rechecked when choosing a remembered time.");
        },
        createBooking: async () => {
          throw new Error("Booking should not be created before checkout handoff.");
        },
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(result).toMatchObject({
      action: "BOOKING_TICKET_SELECTION_REQUIRED",
      bookingStatePatch: {
        dateText: "2026-06-26 13:30:00"
      }
    });
    expect(result.reply).toContain("at 1:30 PM");
  });

  it("understands numbered ticket option selections from the displayed list", async () => {
    const result = await handleTravellerBookingMessage({
      message: "option 2 please",
      bookingMemory: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-30 09:00:00",
        guests: 2,
        timeOptions: [
          { label: "9:00 AM", startTimeLocal: "2026-06-30 09:00:00", remaining: 82 },
          { label: "12:00 PM", startTimeLocal: "2026-06-30 12:00:00", remaining: 82 }
        ],
        ticketOptions: [
          { label: "Family (2A +2C) 3-13", unitPriceCents: 24900 },
          { label: '"2 people for $149.00', unitPriceCents: 14900 },
          { label: "Child (3-13)", unitPriceCents: 5900 },
          { label: "Infant (under 3)", unitPriceCents: 0 },
          { label: "Adult (Winter Special)", unitPriceCents: 7900 }
        ],
        ticketQuantities: null
      },
      bookingWriteEnabled: true,
      pmsAdapter: {
        provider: "MOCK",
        listProducts: async () => [],
        getAvailability: async () => {
          throw new Error("Availability should not be rechecked for ticket option parsing.");
        },
        createBooking: async () => {
          throw new Error("Booking should not be created before contact details are captured.");
        },
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(result).toMatchObject({
      action: "BOOKING_DETAILS_REQUIRED",
      bookingStatePatch: {
        ticketQuantities: [{ optionLabel: '"2 people for $149.00', quantity: 1 }]
      }
    });
    expect(result.reply).toContain("with 1 2 people for $149.00");
  });

  it("lets the traveller correct the selected time while choosing a ticket option", async () => {
    const result = await handleTravellerBookingMessage({
      message: "not 9am, i want 1:30 pm, option 3",
      bookingMemory: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-26 09:00:00",
        guests: 2,
        timeOptions: [
          { label: "9:00 AM", startTimeLocal: "2026-06-26 09:00:00", remaining: 74 },
          { label: "12:00 PM", startTimeLocal: "2026-06-26 12:00:00", remaining: 90 },
          { label: "1:30 PM", startTimeLocal: "2026-06-26 13:30:00", remaining: 90 }
        ],
        ticketOptions: [
          { label: "Family (2A +2C) 3-13", unitPriceCents: 24900 },
          { label: '"2 people for $149.00', unitPriceCents: 14900 },
          { label: "Child (3-13)", unitPriceCents: 5900 },
          { label: "Infant (under 3)", unitPriceCents: 0 },
          { label: "Adult (Winter Special)", unitPriceCents: 7900 }
        ],
        ticketQuantities: null
      },
      bookingWriteEnabled: true,
      pmsAdapter: {
        provider: "MOCK",
        listProducts: async () => [],
        getAvailability: async () => {
          throw new Error("Availability should not be rechecked for ticket option parsing.");
        },
        createBooking: async () => {
          throw new Error("Booking should not be created before contact details are captured.");
        },
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(result).toMatchObject({
      action: "BOOKING_DETAILS_REQUIRED",
      bookingStatePatch: {
        dateText: "2026-06-26 13:30:00",
        ticketQuantities: [{ optionLabel: "Child (3-13)", quantity: 2 }]
      }
    });
    expect(result.reply).toContain("at 1:30 PM");
  });

  it("uses selected ticket option quantities before collecting contact details for auto-booking", async () => {
    const result = await handleTravellerBookingMessage({
      message: "2 adults and 1 child",
      priorTravellerMessages: [
        "Can you check Gold Coast Whale Escape for 3 guests tomorrow?",
        "yes please i want it"
      ],
      bookingMemory: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "tomorrow",
        guests: 3,
        ticketOptions: [
          { label: "Child (3-13)", unitPriceCents: 5900 },
          { label: "Infant (under 3)", unitPriceCents: 0 },
          { label: "Adult (Winter Special)", unitPriceCents: 7900 }
        ],
        ticketQuantities: null
      },
      bookingWriteEnabled: true,
      pmsAdapter: {
        provider: "MOCK",
        listProducts: async () => [
          {
            externalProductId: "boattime-whale-escape",
            title: "Gold Coast Whale Escape",
            description: "Luxury whale watching cruise",
            bookingMode: "AUTO_BOOKING",
            productUrl: "http://localhost:3107/demo/boattime#gold-coast-whale-escape"
          }
        ],
        getAvailability: async () => {
          throw new Error("Availability should not be rechecked for ticket composition parsing.");
        },
        createBooking: async () => {
          throw new Error("Booking should not be created before contact details are captured.");
        },
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(result).toEqual({
      action: "BOOKING_DETAILS_REQUIRED",
      reply:
        "Got it. I have Gold Coast Whale Escape tomorrow for 3 guests with 2 Adult (Winter Special) and 1 Child (3-13). Please share your name, email, and phone number so I can prepare the secure payment step.",
      replySource: "DETERMINISTIC",
      inquiryDraft: null,
      bookingStatePatch: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "tomorrow",
        guests: 3,
        travellerName: null,
        travellerEmail: null,
        travellerPhone: null,
        bookingStatus: "AVAILABILITY_CHECKED",
        confirmationSummary: null,
        externalBookingId: null,
        externalProvider: null,
        bookingError: null,
        ticketOptions: [
          { label: "Child (3-13)", unitPriceCents: 5900 },
          { label: "Infant (under 3)", unitPriceCents: 0 },
          { label: "Adult (Winter Special)", unitPriceCents: 7900 }
        ],
        ticketQuantities: [
          { optionLabel: "Adult (Winter Special)", quantity: 2 },
          { optionLabel: "Child (3-13)", quantity: 1 }
        ]
      }
    });
  });

  it("understands bundled ticket options such as one two-person ticket", async () => {
    const result = await handleTravellerBookingMessage({
      message: "one 2 people ticket please",
      priorTravellerMessages: [
        "Can you check Gold Coast Whale Escape for 2 guests tomorrow?",
        "yes please i want it"
      ],
      bookingMemory: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "tomorrow",
        guests: 2,
        ticketOptions: [
          { label: "2 people for $149.00", unitPriceCents: 14900 },
          { label: "Child (3-13)", unitPriceCents: 5900 },
          { label: "Adult (Winter Special)", unitPriceCents: 7900 }
        ],
        ticketQuantities: null
      },
      bookingWriteEnabled: true,
      pmsAdapter: {
        provider: "MOCK",
        listProducts: async () => [
          {
            externalProductId: "boattime-whale-escape",
            title: "Gold Coast Whale Escape",
            description: "Luxury whale watching cruise",
            bookingMode: "AUTO_BOOKING",
            productUrl: "http://localhost:3107/demo/boattime#gold-coast-whale-escape"
          }
        ],
        getAvailability: async () => {
          throw new Error("Availability should not be rechecked for ticket composition parsing.");
        },
        createBooking: async () => {
          throw new Error("Booking should not be created before contact details are captured.");
        },
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(result).toMatchObject({
      action: "BOOKING_DETAILS_REQUIRED",
      bookingStatePatch: {
        ticketQuantities: [{ optionLabel: "2 people for $149.00", quantity: 1 }]
      }
    });
    expect(result.reply).toContain("1 2 people for $149.00");
  });

  it("understands a bundled ticket option selected by label and price", async () => {
    const result = await handleTravellerBookingMessage({
      message: "i want 2 people for $149.00 (AUD 149.00)",
      priorTravellerMessages: [
        "Can you check Gold Coast Whale Escape for 2 guests tomorrow?"
      ],
      bookingMemory: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "tomorrow",
        guests: 2,
        ticketOptions: [
          { label: '"2 people for $149.00', unitPriceCents: 14900 },
          { label: "Family (2A +2C) 3-13", unitPriceCents: 24900 },
          { label: "Child (3-13)", unitPriceCents: 5900 },
          { label: "Infant (under 3)", unitPriceCents: 0 },
          { label: "Adult (Winter Special)", unitPriceCents: 7900 }
        ],
        ticketQuantities: null
      },
      bookingWriteEnabled: true,
      pmsAdapter: {
        provider: "MOCK",
        listProducts: async () => [],
        getAvailability: async () => {
          throw new Error("Availability should not be rechecked for ticket option parsing.");
        },
        createBooking: async () => {
          throw new Error("Booking should not be created before contact details are captured.");
        },
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(result).toMatchObject({
      action: "BOOKING_DETAILS_REQUIRED",
      bookingStatePatch: {
        ticketQuantities: [{ optionLabel: '"2 people for $149.00', quantity: 1 }]
      }
    });
    expect(result.reply).toContain("with 1 2 people for $149.00");
  });

  it("moves to secure payment when contact details arrive after a ticket option was selected", async () => {
    const result = await handleTravellerBookingMessage({
      message: "My name is RegaTest, my email is regatest@gmail.com my phone number is 086554789650",
      priorTravellerMessages: [
        "can you check for 27th of june?",
        "for 2 people",
        "ok i want 2 people for $149.00"
      ],
      bookingMemory: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-27",
        guests: 2,
        bookingStatus: "AVAILABILITY_CHECKED",
        ticketOptions: [
          { label: "Family (2A +2C) 3-13", unitPriceCents: 24900 },
          { label: '"2 people for $149.00', unitPriceCents: 14900 },
          { label: "Child (3-13)", unitPriceCents: 5900 },
          { label: "Infant (under 3)", unitPriceCents: 0 },
          { label: "Adult (Winter Special)", unitPriceCents: 7900 }
        ],
        ticketQuantities: [{ optionLabel: '"2 people for $149.00', quantity: 1 }]
      },
      bookingWriteEnabled: true,
      pmsAdapter: {
        provider: "MOCK",
        listProducts: async () => [
          {
            externalProductId: "boattime-whale-escape",
            title: "Gold Coast Whale Escape",
            description: "Luxury whale watching cruise",
            bookingMode: "AUTO_BOOKING",
            productUrl: "http://localhost:3107/demo/boattime#gold-coast-whale-escape"
          }
        ],
        getAvailability: async () => {
          throw new Error("Availability should not be rechecked after ticket selection and contact details.");
        },
        createBooking: async () => {
          throw new Error("Booking should not be created before explicit confirmation.");
        },
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(result).toEqual({
      action: "BOOKING_PAYMENT_REQUIRED",
      reply:
        "Thanks, I have everything for Gold Coast Whale Escape on 2026-06-27 for 2 guests with 1 2 people for $149.00 under RegaTest, regatest@gmail.com, 086554789650.\n\n" +
        "Use the secure payment panel below when you are ready. I cannot take card details in chat.\n\n" +
        "For now, I saved this as a lead for the operator.",
      replySource: "DETERMINISTIC",
      inquiryDraft: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-27",
        guests: 2,
        travellerName: "RegaTest",
        travellerEmail: "regatest@gmail.com",
        travellerPhone: "086554789650"
      },
      bookingStatePatch: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-27",
        guests: 2,
        travellerName: "RegaTest",
        travellerEmail: "regatest@gmail.com",
        travellerPhone: "086554789650",
        bookingStatus: "PAYMENT_PENDING",
        confirmationSummary:
          "Gold Coast Whale Escape on 2026-06-27 for 2 guests with 1 2 people for $149.00 under RegaTest, regatest@gmail.com, 086554789650.",
        externalBookingId: null,
        externalProvider: null,
        bookingError: "Awaiting secure payment before creating the external booking.",
        ticketOptions: [
          { label: "Family (2A +2C) 3-13", unitPriceCents: 24900 },
          { label: '"2 people for $149.00', unitPriceCents: 14900 },
          { label: "Child (3-13)", unitPriceCents: 5900 },
          { label: "Infant (under 3)", unitPriceCents: 0 },
          { label: "Adult (Winter Special)", unitPriceCents: 7900 }
        ],
        ticketQuantities: [{ optionLabel: '"2 people for $149.00', quantity: 1 }]
      }
    });
  });

  it("does not confuse guest count wording with a bundled ticket selection", async () => {
    const result = await handleTravellerBookingMessage({
      message: "for 2 people",
      bookingMemory: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "tomorrow",
        guests: 2,
        ticketOptions: [
          { label: "2 people for $149.00", unitPriceCents: 14900 },
          { label: "Adult (Winter Special)", unitPriceCents: 7900 }
        ],
        ticketQuantities: null
      },
      bookingWriteEnabled: true,
      pmsAdapter: {
        provider: "MOCK",
        listProducts: async () => [],
        getAvailability: async () => {
          throw new Error("Availability should not be rechecked while waiting for ticket selection.");
        },
        createBooking: async () => {
          throw new Error("Booking should not be created before ticket composition is chosen.");
        },
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(result).toMatchObject({
      action: "BOOKING_TICKET_SELECTION_REQUIRED"
    });
    expect(result.reply).toContain("please choose one ticket option");
  });

  it("does not deep-link to Rezdy checkout even when the selected time carries a checkout session id", async () => {
    const result = await handleTravellerBookingMessage({
      message: "My name is Test, email is test@gmail.com and phone number is 086775428176",
      priorTravellerMessages: [
        "Can you check Gold Coast Whale Escape for 2 guests on 2026-06-25?",
        "12:00 PM please",
        "option 2 please"
      ],
      bookingMemory: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-25 12:00:00",
        guests: 2,
        bookingStatus: "AVAILABILITY_CHECKED",
        ticketOptions: [
          { label: "Adult (Winter Special)", unitPriceCents: 7900 },
          { label: '"2 people for $149.00', unitPriceCents: 14900 }
        ],
        ticketQuantities: [{ optionLabel: '"2 people for $149.00', quantity: 1 }],
        timeOptions: [
          { label: "9:00 AM", startTimeLocal: "2026-06-25 09:00:00", remaining: 82 },
          {
            label: "12:00 PM",
            startTimeLocal: "2026-06-25 12:00:00",
            remaining: 82,
            checkoutSessionId: "480938442"
          }
        ]
      },
      bookingWriteEnabled: true,
      pmsAdapter: {
        provider: "MOCK",
        listProducts: async () => [
          {
            externalProductId: "boattime-whale-escape",
            title: "Gold Coast Whale Escape",
            description: "Luxury whale watching cruise",
            bookingMode: "AUTO_BOOKING",
            productUrl: "http://localhost:3107/demo/boattime#gold-coast-whale-escape"
          }
        ],
        getAvailability: async () => {
          throw new Error("Availability should not be rechecked when contact details complete payment draft.");
        },
        createBooking: async () => {
          throw new Error("Kai should not create unpaid Rezdy bookings before secure payment.");
        },
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(result.action).toBe("BOOKING_PAYMENT_REQUIRED");
    expect(result.reply).toContain("Use the secure payment panel below when you are ready.");
    expect(result.reply).not.toContain("boattimeyachtcharters.rezdy.com/services/431872");
  });

  it("does not fall back to the website booking form when no cart session is available", async () => {
    const result = await handleTravellerBookingMessage({
      message: "My name is Test2, email is test2@gmail.com and phone number is 087665497800",
      priorTravellerMessages: [
        "Can you check Gold Coast Whale Escape for 2 guests on 2026-06-26?",
        "1:30 PM please",
        "option 2 please"
      ],
      bookingMemory: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-26 13:30:00",
        guests: 2,
        bookingStatus: "AVAILABILITY_CHECKED",
        ticketOptions: [
          { label: "Family (2A +2C) 3-13", unitPriceCents: 24900 },
          { label: '"2 people for $149.00', unitPriceCents: 14900 }
        ],
        ticketQuantities: [{ optionLabel: '"2 people for $149.00', quantity: 1 }],
        timeOptions: [
          { label: "9:00 AM", startTimeLocal: "2026-06-26 09:00:00", remaining: 74 },
          { label: "1:30 PM", startTimeLocal: "2026-06-26 13:30:00", remaining: 90 }
        ]
      },
      bookingWriteEnabled: true,
      pmsAdapter: {
        provider: "MOCK",
        listProducts: async () => [
          {
            externalProductId: "boattime-whale-escape",
            title: "Gold Coast Whale Escape",
            description: "Luxury whale watching cruise",
            bookingMode: "AUTO_BOOKING",
            productUrl: "https://boattimeyachtcharters.rezdy.com/services/431872"
          }
        ],
        getAvailability: async () => {
          throw new Error("Availability should not be rechecked when contact details complete payment draft.");
        },
        createBooking: async () => {
          throw new Error("Kai should not create unpaid Rezdy bookings before secure payment.");
        },
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(result.action).toBe("BOOKING_PAYMENT_REQUIRED");
    expect(result.reply).toContain("Use the secure payment panel below when you are ready.");
    expect(result.reply).not.toContain("https://www.boattimeyachtcharters.com/cruise-tickets-luxury-whale-watching#book");
    expect(result.reply).not.toContain("https://boattimeyachtcharters.rezdy.com/services/431872");
  });

  it("does not claim availability for manual inquiry products", async () => {
    const result = await handleTravellerBookingMessage({
      message: "Can you check Private Charter for 2 guests tomorrow?",
      pmsAdapter: new MockPmsAdapter()
    });

    expect(result).toEqual({
      action: "MANUAL_INQUIRY_REQUIRED",
      reply:
        "Private Charter requires operator confirmation. I can collect the details, but I will not confirm availability automatically.",
      replySource: "DETERMINISTIC"
    });
  });

  it("asks the traveller to choose a PMS product when product matching is unclear", async () => {
    const result = await handleTravellerBookingMessage({
      message: "Can you check a tour for 2 guests tomorrow?",
      pmsAdapter: new MockPmsAdapter()
    });

    expect(result).toEqual({
      action: "NEEDS_PRODUCT_SELECTION",
      reply:
        "Which tour should I check? Available options are Komodo Day Trip, Private Charter and Reef Day Snorkel.",
      replySource: "DETERMINISTIC"
    });
  });
  it("uses product matcher aliases before deciding PMS action", async () => {
    const result = await handleTravellerBookingMessage({
      message: "private boat for 2 guests tomorrow",
      pmsAdapter: new MockPmsAdapter()
    });

    expect(result).toEqual({
      action: "MANUAL_INQUIRY_REQUIRED",
      reply:
        "Private Charter requires operator confirmation. I can collect the details, but I will not confirm availability automatically.",
      replySource: "DETERMINISTIC"
    });
  });

  it("uses prior traveller messages as slot memory", async () => {
    const result = await handleTravellerBookingMessage({
      message: "tomorrow for 2 people",
      priorTravellerMessages: ["private boat"],
      pmsAdapter: new MockPmsAdapter()
    });

    expect(result).toEqual({
      action: "MANUAL_INQUIRY_REQUIRED",
      reply:
        "Private Charter requires operator confirmation. I can collect the details, but I will not confirm availability automatically.",
      replySource: "DETERMINISTIC"
    });
  });

  it("uses booking memory for date-only availability follow-ups", async () => {
    const result = await handleTravellerBookingMessage({
      message: "what about for 2026-06-23?",
      bookingMemory: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
        dateText: "tomorrow",
        guests: 3
      },
      pmsAdapter: new MockPmsAdapter()
    });

    expect(result).toEqual({
      action: "AVAILABILITY_CHECKED",
      reply:
        "Good news, Komodo Day Trip has availability for 3 guests on 2026-06-23. There are 7 spots left at USD 185.00 per guest. I have not confirmed anything yet, but I can help you continue if this looks good.",
      replySource: "DETERMINISTIC"
    });
  });

  it("shares the website product link when traveller wants to see the product first", async () => {
    const result = await handleTravellerBookingMessage({
      message: "can I see it first?",
      bookingMemory: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
        dateText: "tomorrow",
        guests: 3
      },
      pmsAdapter: {
        provider: "MOCK",
        listProducts: async () => [
          {
            externalProductId: "mock-komodo-day-trip",
            title: "Komodo Day Trip",
            description: "Shared day trip",
            bookingMode: "AUTO_BOOKING",
            productUrl: "https://tenant.example/products/komodo-day-trip"
          }
        ],
        getAvailability: async () => {
          throw new Error("Availability should not be checked for product link requests.");
        },
        createBooking: async () => {
          throw new Error("Booking should not be created for product link requests.");
        },
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(result).toEqual({
      action: "PRODUCT_LINK",
      reply:
        "Of course. Here is the page for Komodo Day Trip: https://tenant.example/products/komodo-day-trip. Take a look, and if it feels right, just tell me you want to continue.",
      replySource: "DETERMINISTIC"
    });
  });

  it("uses auto-booking wording when collecting contact details for a writable product", async () => {
    const result = await handleTravellerBookingMessage({
      message: "yes I want it",
      bookingMemory: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
        dateText: "tomorrow",
        guests: 3
      },
      bookingWriteEnabled: true,
      pmsAdapter: new MockPmsAdapter()
    });

    expect(result).toEqual({
      action: "BOOKING_DETAILS_REQUIRED",
      reply:
        "Nice. To prepare Komodo Day Trip for 3 guests tomorrow, I just need your name, email, and phone number. After that I will show you the details once more before creating the booking.",
      replySource: "DETERMINISTIC",
      inquiryDraft: null
    });
  });

  it("continues to contact collection when traveller naturally accepts an available writable product", async () => {
    const result = await handleTravellerBookingMessage({
      message: "yes please i want it",
      priorTravellerMessages: ["is it available for tomorrow for 2 guests?"],
      bookingMemory: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
        dateText: "tomorrow",
        guests: 2
      },
      bookingWriteEnabled: true,
      pmsAdapter: new MockPmsAdapter()
    });

    expect(result).toEqual({
      action: "BOOKING_DETAILS_REQUIRED",
      reply:
        "Nice. To prepare Komodo Day Trip for 2 guests tomorrow, I just need your name, email, and phone number. After that I will show you the details once more before creating the booking.",
      replySource: "DETERMINISTIC",
      inquiryDraft: null
    });
  });

  it("does not ask for contact details with null guests when traveller wants a product before date and guests are known", async () => {
    const result = await handleTravellerBookingMessage({
      message: "yup i think i want it!",
      bookingMemory: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
        dateText: null,
        guests: null
      },
      bookingWriteEnabled: true,
      pmsAdapter: new MockPmsAdapter()
    });

    expect(result).toEqual({
      action: "BOOKING_DETAILS_REQUIRED",
      reply:
        "I can prepare that booking request. Please share the date, guests first so I can keep it accurate.",
      replySource: "DETERMINISTIC",
      inquiryDraft: null
    });
  });

  it("treats an availability follow-up as availability intent even after an incomplete booking capture starts", async () => {
    const result = await handleTravellerBookingMessage({
      message: "can you check the availability for tomorrow?",
      priorTravellerMessages: ["yup i think i want it!"],
      bookingMemory: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
        dateText: null,
        guests: null
      },
      bookingWriteEnabled: true,
      pmsAdapter: new MockPmsAdapter()
    });

    expect(result).toEqual({
      action: "NEEDS_MORE_DETAILS",
      reply: "I have Komodo Day Trip for tomorrow. Please share the number of guests so I can check safely.",
      replySource: "DETERMINISTIC"
    });
  });

  it("keeps missing availability details deterministic even when an LLM client is configured", async () => {
    const result = await handleTravellerBookingMessage({
      message: "can you check the availability for tomorrow?",
      priorTravellerMessages: ["yup i think i want it!"],
      bookingMemory: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
        dateText: null,
        guests: null
      },
      bookingWriteEnabled: true,
      pmsAdapter: new MockPmsAdapter(),
      llmClient: {
        async composeReply() {
          return "Please share guests for the Private Yacht Charter.";
        }
      }
    });

    expect(result).toEqual({
      action: "NEEDS_MORE_DETAILS",
      reply: "I have Komodo Day Trip for tomorrow. Please share the number of guests so I can check safely.",
      replySource: "DETERMINISTIC"
    });
  });

  it("acknowledges known product and date instead of repeating a generic missing-guests prompt", async () => {
    const result = await handleTravellerBookingMessage({
      message: "what about for 26th of june?",
      priorTravellerMessages: [
        "i think i want that gold coast whale escape",
        "can you check for 26th of june?"
      ],
      bookingMemory: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-26",
        guests: null
      },
      bookingWriteEnabled: true,
      pmsAdapter: new MockPmsAdapter()
    });

    expect(result).toEqual({
      action: "NEEDS_MORE_DETAILS",
      reply:
        "I have Gold Coast Whale Escape for 2026-06-26. Please share the number of guests so I can check safely.",
      replySource: "DETERMINISTIC"
    });
  });

  it("checks availability when guests arrive after an availability request during an incomplete capture", async () => {
    const result = await handleTravellerBookingMessage({
      message: "for 2 guests",
      priorTravellerMessages: ["yup i think i want it!", "can you check the availability for tomorrow?"],
      bookingMemory: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
        dateText: "tomorrow",
        guests: null
      },
      bookingWriteEnabled: true,
      pmsAdapter: new MockPmsAdapter()
    });

    expect(result).toEqual({
      action: "AVAILABILITY_CHECKED",
      reply:
        "Good news, Komodo Day Trip has availability for 2 guests tomorrow. There are 8 spots left at USD 185.00 per guest. I have not confirmed anything yet, but I can help you continue if this looks good.",
      replySource: "DETERMINISTIC"
    });
  });

  it("does not create an inquiry from contact details while booking slots are still incomplete", async () => {
    const result = await handleTravellerBookingMessage({
      message: "my name is Eka, email is eka@gmail.com and phone is 085664326156",
      priorTravellerMessages: ["yup i think i want it!"],
      bookingMemory: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
        dateText: "tomorrow",
        guests: null
      },
      bookingWriteEnabled: true,
      pmsAdapter: new MockPmsAdapter()
    });

    expect(result).toEqual({
      action: "BOOKING_DETAILS_REQUIRED",
      reply: "I can prepare that booking request. Please share the guests first so I can keep it accurate.",
      replySource: "DETERMINISTIC",
      inquiryDraft: null
    });
  });

  it("starts booking capture when traveller says book it after availability is known", async () => {
    const result = await handleTravellerBookingMessage({
      message: "yes book it",
      bookingMemory: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
        dateText: "tomorrow",
        guests: 3
      },
      pmsAdapter: new MockPmsAdapter()
    });

    expect(result).toEqual({
      action: "BOOKING_DETAILS_REQUIRED",
      reply:
        "I can prepare that booking request for Komodo Day Trip on tomorrow for 3 guests. Please share your name, email, phone so the operator can follow up.",
      replySource: "DETERMINISTIC",
      inquiryDraft: null
    });
  });

  it("returns an inquiry draft when traveller contact details complete an active capture", async () => {
    const result = await handleTravellerBookingMessage({
      message: "My name is Maya Chen, email maya@example.com, phone +61 400 111 222",
      priorTravellerMessages: ["Can you check Komodo Day Trip for 3 guests tomorrow?", "yes book it"],
      bookingMemory: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
        dateText: "tomorrow",
        guests: 3
      },
      pmsAdapter: new MockPmsAdapter()
    });

    expect(result).toEqual({
      action: "BOOKING_INQUIRY_READY",
      reply:
        "Thanks, I have the details for Komodo Day Trip on tomorrow for 3 guests. I will send this to the operator for confirmation.",
      replySource: "DETERMINISTIC",
      inquiryDraft: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
        dateText: "tomorrow",
        guests: 3,
        travellerName: "Maya Chen",
        travellerEmail: "maya@example.com",
        travellerPhone: "+61 400 111 222"
      }
    });
  });

  it("keeps auto-booking products in safe operator fallback when booking-write is disabled", async () => {
    const result = await handleTravellerBookingMessage({
      message: "My name is Maya Chen, email maya@example.com, phone +61 400 111 222",
      priorTravellerMessages: ["Can you check Komodo Day Trip for 3 guests tomorrow?", "yes book it"],
      bookingMemory: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
        dateText: "tomorrow",
        guests: 3
      },
      bookingWriteEnabled: false,
      pmsAdapter: new MockPmsAdapter()
    });

    expect(result).toEqual({
      action: "BOOKING_WRITE_DISABLED",
      reply:
        "Thanks, I have the details for Komodo Day Trip on tomorrow for 3 guests. Booking confirmation is not enabled for this tenant yet, so I will send this to the operator for confirmation.",
      replySource: "DETERMINISTIC",
      inquiryDraft: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
        dateText: "tomorrow",
        guests: 3,
        travellerName: "Maya Chen",
        travellerEmail: "maya@example.com",
        travellerPhone: "+61 400 111 222"
      }
    });
  });

  it("moves auto-booking capture to secure payment when booking-write is enabled", async () => {
    const result = await handleTravellerBookingMessage({
      message: "My name is Maya Chen, email maya@example.com, phone +61 400 111 222",
      priorTravellerMessages: ["Can you check Komodo Day Trip for 3 guests tomorrow?", "yes book it"],
      bookingMemory: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
        dateText: "tomorrow",
        guests: 3
      },
      bookingWriteEnabled: true,
      pmsAdapter: new MockPmsAdapter()
    });

    expect(result).toEqual({
      action: "BOOKING_PAYMENT_REQUIRED",
      reply:
        "Thanks, I have everything for Komodo Day Trip tomorrow for 3 guests under Maya Chen, maya@example.com, +61 400 111 222.\n\n" +
        "Use the secure payment panel below when you are ready. I cannot take card details in chat.\n\n" +
        "For now, I saved this as a lead for the operator.",
      replySource: "DETERMINISTIC",
      inquiryDraft: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
        dateText: "tomorrow",
        guests: 3,
        travellerName: "Maya Chen",
        travellerEmail: "maya@example.com",
        travellerPhone: "+61 400 111 222"
      },
      bookingStatePatch: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
        dateText: "tomorrow",
        guests: 3,
        travellerName: "Maya Chen",
        travellerEmail: "maya@example.com",
        travellerPhone: "+61 400 111 222",
        bookingStatus: "PAYMENT_PENDING",
        confirmationSummary:
          "Komodo Day Trip on tomorrow for 3 guests under Maya Chen, maya@example.com, +61 400 111 222.",
        externalBookingId: null,
        externalProvider: null,
        bookingError: "Awaiting secure payment before creating the external booking."
      }
    });
  });

  it("creates a payment draft and inquiry instead of asking Kai to create an unpaid booking", async () => {
    const result = await handleTravellerBookingMessage({
      message: "My name is Kaka, email is kaka@gmail.com and phone number is 086554329189",
      priorTravellerMessages: [
        "Can you check Gold Coast Whale Escape for 2 guests on 2026-06-27?",
        "12:00 PM please",
        "1 x 2 people for $149.00"
      ],
      bookingMemory: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-27 12:00:00",
        guests: 2,
        bookingStatus: "AVAILABILITY_CHECKED",
        ticketOptions: [
          { label: '"2 people for $149.00', unitPriceCents: 14900 },
          { label: "Adult (Winter Special)", unitPriceCents: 7900 }
        ],
        ticketQuantities: [{ optionLabel: '"2 people for $149.00', quantity: 1 }],
        timeOptions: [
          { label: "9:00 AM", startTimeLocal: "2026-06-27 09:00:00", remaining: 77 },
          { label: "12:00 PM", startTimeLocal: "2026-06-27 12:00:00", remaining: 79 }
        ]
      },
      bookingWriteEnabled: true,
      pmsAdapter: {
        provider: "MOCK",
        listProducts: async () => [
          {
            externalProductId: "boattime-whale-escape",
            title: "Gold Coast Whale Escape",
            description: "Luxury whale watching cruise",
            bookingMode: "AUTO_BOOKING",
            productUrl: "https://boattimeyachtcharters.rezdy.com/services/431872"
          }
        ],
        getAvailability: async () => {
          throw new Error("Availability should not be rechecked when contact details complete payment draft.");
        },
        createBooking: async () => {
          throw new Error("Kai should not create unpaid Rezdy bookings before secure payment.");
        },
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(result).toEqual({
      action: "BOOKING_PAYMENT_REQUIRED",
      reply:
        "Thanks, I have everything for Gold Coast Whale Escape on 2026-06-27 at 12:00 PM for 2 guests with 1 2 people for $149.00 under Kaka, kaka@gmail.com, 086554329189.\n\n" +
        "Use the secure payment panel below when you are ready. I cannot take card details in chat.\n\n" +
        "For now, I saved this as a lead for the operator.",
      replySource: "DETERMINISTIC",
      inquiryDraft: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-27 12:00:00",
        guests: 2,
        travellerName: "Kaka",
        travellerEmail: "kaka@gmail.com",
        travellerPhone: "086554329189"
      },
      bookingStatePatch: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-27 12:00:00",
        guests: 2,
        travellerName: "Kaka",
        travellerEmail: "kaka@gmail.com",
        travellerPhone: "086554329189",
        bookingStatus: "PAYMENT_PENDING",
        confirmationSummary:
          "Gold Coast Whale Escape on 2026-06-27 12:00:00 for 2 guests with 1 2 people for $149.00 under Kaka, kaka@gmail.com, 086554329189.",
        externalBookingId: null,
        externalProvider: null,
        bookingError: "Awaiting secure payment before creating the external booking.",
        timeOptions: [
          { label: "9:00 AM", startTimeLocal: "2026-06-27 09:00:00", remaining: 77 },
          { label: "12:00 PM", startTimeLocal: "2026-06-27 12:00:00", remaining: 79 }
        ],
        ticketOptions: [
          { label: '"2 people for $149.00', unitPriceCents: 14900 },
          { label: "Adult (Winter Special)", unitPriceCents: 7900 }
        ],
        ticketQuantities: [{ optionLabel: '"2 people for $149.00', quantity: 1 }]
      }
    });
  });

  it("creates an external booking only after traveller confirms a ready booking", async () => {
    const result = await handleTravellerBookingMessage({
      message: "yes, please confirm it now",
      bookingMemory: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
        dateText: "tomorrow",
        guests: 3,
        travellerName: "Maya Chen",
        travellerEmail: "maya@example.com",
        travellerPhone: "+61 400 111 222",
        bookingStatus: "READY_TO_CONFIRM",
        confirmationSummary:
          "Komodo Day Trip on tomorrow for 3 guests under Maya Chen, maya@example.com, +61 400 111 222."
      },
      bookingWriteEnabled: true,
      allowUnpaidExternalBooking: true,
      pmsAdapter: new MockPmsAdapter()
    });

    expect(result).toEqual({
      action: "BOOKING_CONFIRMED",
      reply:
        "Your booking is confirmed. Confirmation reference mock-booking-mock-komodo-day-trip-tomorrow-3 belongs to Komodo Day Trip on tomorrow for 3 guests. I have not collected payment in Kai.",
      replySource: "DETERMINISTIC",
      bookingStatePatch: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
        dateText: "tomorrow",
        guests: 3,
        travellerName: "Maya Chen",
        travellerEmail: "maya@example.com",
        travellerPhone: "+61 400 111 222",
        bookingStatus: "CONFIRMED",
        confirmationSummary:
          "Komodo Day Trip on tomorrow for 3 guests under Maya Chen, maya@example.com, +61 400 111 222.",
        externalBookingId: "mock-booking-mock-komodo-day-trip-tomorrow-3",
        externalProvider: "MOCK",
        bookingError: null
      }
    });
  });

  it("does not create an unpaid external booking without an explicit safety override", async () => {
    const result = await handleTravellerBookingMessage({
      message: "yes, please confirm it now",
      bookingMemory: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
        dateText: "tomorrow",
        guests: 3,
        travellerName: "Maya Chen",
        travellerEmail: "maya@example.com",
        travellerPhone: "+61 400 111 222",
        bookingStatus: "READY_TO_CONFIRM",
        confirmationSummary:
          "Komodo Day Trip on tomorrow for 3 guests under Maya Chen, maya@example.com, +61 400 111 222."
      },
      bookingWriteEnabled: true,
      pmsAdapter: {
        provider: "MOCK",
        listProducts: async () => [],
        getAvailability: async () => {
          throw new Error("Availability should not be checked during final confirmation.");
        },
        createBooking: async () => {
          throw new Error("External booking should not be created without payment safety.");
        },
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(result).toEqual({
      action: "BOOKING_WRITE_DISABLED",
      reply:
        "I have saved this booking request for the operator. Kai has not collected payment yet, so I will not create an unpaid confirmed booking in the PMS automatically.",
      replySource: "DETERMINISTIC",
      inquiryDraft: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
        dateText: "tomorrow",
        guests: 3,
        travellerName: "Maya Chen",
        travellerEmail: "maya@example.com",
        travellerPhone: "+61 400 111 222"
      },
      bookingStatePatch: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
        dateText: "tomorrow",
        guests: 3,
        travellerName: "Maya Chen",
        travellerEmail: "maya@example.com",
        travellerPhone: "+61 400 111 222",
        bookingStatus: "READY_TO_CONFIRM",
        confirmationSummary:
          "Komodo Day Trip on tomorrow for 3 guests under Maya Chen, maya@example.com, +61 400 111 222.",
        externalBookingId: null,
        externalProvider: null,
        bookingError: "External booking blocked because payment has not been collected in Kai."
      }
    });
  });

  it("asks for optional extras after ticket selection when an instant product has extras", async () => {
    const result = await handleTravellerBookingMessage({
      message: "option 2 please",
      bookingMemory: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-26 13:30:00",
        guests: 2,
        ticketOptions: [
          { label: "Adult (Winter Special)", unitPriceCents: 7900 },
          { label: '"2 people for $149.00', unitPriceCents: 14900 }
        ],
        ticketQuantities: null,
        extraOptions: [
          { label: "Corona Bucket", unitPriceCents: 3000 },
          { label: "Sparkling for 2", unitPriceCents: 4000 },
          { label: "Cheese Platter for 2", unitPriceCents: 1000 }
        ],
        extraQuantities: null
      },
      bookingWriteEnabled: true,
      pmsAdapter: {
        provider: "MOCK",
        listProducts: async () => [],
        getAvailability: async () => {
          throw new Error("Availability should not be rechecked during ticket selection.");
        },
        createBooking: async () => {
          throw new Error("Booking should not be created before payment.");
        },
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(result).toEqual({
      action: "BOOKING_EXTRAS_SELECTION_REQUIRED",
      reply:
        "Got it: Gold Coast Whale Escape on 2026-06-26 at 1:30 PM for 2 guests with 1 2 people for $149.00.\n\n" +
        "Optional extras:\n" +
        "1. Corona Bucket - AUD 30.00\n" +
        "2. Sparkling for 2 - AUD 40.00\n" +
        "3. Cheese Platter for 2 - AUD 10.00\n\n" +
        "Would you like to add any extras? You can say \"no extras\" or \"1 x Corona Bucket\".",
      replySource: "DETERMINISTIC",
      bookingStatePatch: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-26 13:30:00",
        guests: 2,
        travellerName: null,
        travellerEmail: null,
        travellerPhone: null,
        bookingStatus: "AVAILABILITY_CHECKED",
        confirmationSummary: null,
        externalBookingId: null,
        externalProvider: null,
        bookingError: null,
        ticketOptions: [
          { label: "Adult (Winter Special)", unitPriceCents: 7900 },
          { label: '"2 people for $149.00', unitPriceCents: 14900 }
        ],
        ticketQuantities: [{ optionLabel: '"2 people for $149.00', quantity: 1 }],
        extraOptions: [
          { label: "Corona Bucket", unitPriceCents: 3000 },
          { label: "Sparkling for 2", unitPriceCents: 4000 },
          { label: "Cheese Platter for 2", unitPriceCents: 1000 }
        ],
        extraQuantities: null
      }
    });
  });

  it("continues to contact collection after traveller skips optional extras", async () => {
    const result = await handleTravellerBookingMessage({
      message: "no extras thanks",
      bookingMemory: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-26 13:30:00",
        guests: 2,
        ticketQuantities: [{ optionLabel: '"2 people for $149.00', quantity: 1 }],
        extraOptions: [
          { label: "Corona Bucket", unitPriceCents: 3000 },
          { label: "Sparkling for 2", unitPriceCents: 4000 }
        ],
        extraQuantities: null
      },
      bookingWriteEnabled: true,
      pmsAdapter: {
        provider: "MOCK",
        listProducts: async () => [],
        getAvailability: async () => {
          throw new Error("Availability should not be rechecked when choosing extras.");
        },
        createBooking: async () => {
          throw new Error("Booking should not be created before payment.");
        },
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(result).toEqual({
      action: "BOOKING_DETAILS_REQUIRED",
      reply:
        "No extras added. Please share your name, email, and phone number so I can prepare the secure payment step.",
      replySource: "DETERMINISTIC",
      bookingStatePatch: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-26 13:30:00",
        guests: 2,
        travellerName: null,
        travellerEmail: null,
        travellerPhone: null,
        bookingStatus: "AVAILABILITY_CHECKED",
        confirmationSummary: null,
        externalBookingId: null,
        externalProvider: null,
        bookingError: null,
        ticketQuantities: [{ optionLabel: '"2 people for $149.00', quantity: 1 }],
        extraOptions: [
          { label: "Corona Bucket", unitPriceCents: 3000 },
          { label: "Sparkling for 2", unitPriceCents: 4000 }
        ],
        extraQuantities: []
      }
    });
  });

  it("moves instant checkout to secure payment required after contact details are captured", async () => {
    const result = await handleTravellerBookingMessage({
      message: "My name is Test, email test@gmail.com, phone 086775428176",
      priorTravellerMessages: ["option 2 please", "no extras thanks"],
      bookingMemory: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-26 13:30:00",
        guests: 2,
        ticketQuantities: [{ optionLabel: '"2 people for $149.00', quantity: 1 }],
        extraOptions: [
          { label: "Corona Bucket", unitPriceCents: 3000 },
          { label: "Sparkling for 2", unitPriceCents: 4000 }
        ],
        extraQuantities: []
      },
      bookingWriteEnabled: true,
      pmsAdapter: {
        provider: "MOCK",
        listProducts: async () => [
          {
            externalProductId: "boattime-whale-escape",
            title: "Gold Coast Whale Escape",
            description: "Luxury whale watching cruise",
            bookingMode: "AUTO_BOOKING"
          }
        ],
        getAvailability: async () => {
          throw new Error("Availability should not be rechecked when contact details complete payment draft.");
        },
        createBooking: async () => {
          throw new Error("Booking should not be created before secure payment succeeds.");
        },
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(result).toEqual({
      action: "BOOKING_PAYMENT_REQUIRED",
      reply:
        "Thanks, I have everything for Gold Coast Whale Escape on 2026-06-26 at 1:30 PM for 2 guests with 1 2 people for $149.00 under Test, test@gmail.com, 086775428176.\n\n" +
        "Use the secure payment panel below when you are ready. I cannot take card details in chat.\n\n" +
        "For now, I saved this as a lead for the operator.",
      replySource: "DETERMINISTIC",
      inquiryDraft: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-26 13:30:00",
        guests: 2,
        travellerName: "Test",
        travellerEmail: "test@gmail.com",
        travellerPhone: "086775428176"
      },
      bookingStatePatch: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-26 13:30:00",
        guests: 2,
        travellerName: "Test",
        travellerEmail: "test@gmail.com",
        travellerPhone: "086775428176",
        bookingStatus: "PAYMENT_PENDING",
        confirmationSummary:
          "Gold Coast Whale Escape on 2026-06-26 13:30:00 for 2 guests with 1 2 people for $149.00 under Test, test@gmail.com, 086775428176.",
        externalBookingId: null,
        externalProvider: null,
        bookingError: "Awaiting secure payment before creating the external booking.",
        ticketQuantities: [{ optionLabel: '"2 people for $149.00', quantity: 1 }],
        extraOptions: [
          { label: "Corona Bucket", unitPriceCents: 3000 },
          { label: "Sparkling for 2", unitPriceCents: 4000 }
        ],
        extraQuantities: []
      }
    });
  });

});



