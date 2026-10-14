import { describe, expect, it, vi } from "vitest";
import { MockPmsAdapter } from "@/core/pms/mock-pms-adapter";
import {
  handleTravellerBookingMessage,
  resolveFinalGenericBookingIntent,
  shouldEscalateGenericBookingRouterToLlm
} from "./booking-orchestrator";
import type { GenericBookingRouterLlmClient } from "@/core/llm/generic-booking-router";

describe("booking orchestrator", () => {
  const komodoDayTripAvailabilityCheckedPatch = {
    productExternalId: "mock-komodo-day-trip",
    productTitle: "Komodo Day Trip",
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
    ticketQuantities: null
  };

  // kai-conversation-flow-notes.md item 9: what buildProductCards attaches for MockPmsAdapter's
  // fixed product list when a date is already known (Komodo Day Trip/Reef Day Snorkel get a real
  // priceLabel from getAvailability; Private Charter is MANUAL_INQUIRY, no live price to fetch).
  const defaultProductCards = [
    {
      slug: "mock-komodo-day-trip",
      title: "Komodo Day Trip",
      description: "A shared day trip with auto-booking.",
      bookingMode: "AUTO_BOOKING",
      productUrl: null,
      priceLabel: "US$185",
      dateChecked: true
    },
    {
      slug: "mock-private-charter",
      title: "Private Charter",
      description: "A custom charter that requires operator confirmation.",
      bookingMode: "MANUAL_INQUIRY",
      productUrl: null,
      priceLabel: null,
      dateChecked: true
    },
    {
      slug: "mock-reef-day-snorkel",
      title: "Reef Day Snorkel",
      description: "A guided snorkeling tour over bright reef sites.",
      bookingMode: "AUTO_BOOKING",
      productUrl: null,
      priceLabel: "US$85",
      dateChecked: true
    }
  ];

  it("checks PMS availability when product, date, and guests are known", async () => {
    const result = await handleTravellerBookingMessage({
      message: "Can you check Komodo Day Trip for 3 guests tomorrow?",
      pmsAdapter: new MockPmsAdapter()
    });

    expect(result).toEqual({
      action: "AVAILABILITY_CHECKED",
      reply:
        "Good news, Komodo Day Trip has room for 3 guests tomorrow. There are 7 seats available at US$185 per guest. Nothing's booked yet, so just say the word if it looks good.",
      replySource: "DETERMINISTIC",
      bookingStatePatch: komodoDayTripAvailabilityCheckedPatch
    });
  });

  it("can use a safe LLM rewrite without changing the PMS action", async () => {
    const result = await handleTravellerBookingMessage({
      message: "Can you check Komodo Day Trip for 3 guests tomorrow?",
      pmsAdapter: new MockPmsAdapter(),
      llmClient: {
        async composeReply() {
          return "Komodo Day Trip is available for 3 guests tomorrow. There are 7 seats available at US$185 per guest. I have not confirmed a booking yet.";
        }
      }
    });

    expect(result).toEqual({
      action: "AVAILABILITY_CHECKED",
      reply:
        "Komodo Day Trip is available for 3 guests tomorrow. There are 7 seats available at US$185 per guest. I have not confirmed a booking yet.",
      replySource: "LLM",
      bookingStatePatch: komodoDayTripAvailabilityCheckedPatch
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
        "Good news, Komodo Day Trip has room for 3 guests tomorrow. There are 7 seats available at US$185 per guest. Nothing's booked yet, so just say the word if it looks good.",
      replySource: "DETERMINISTIC",
      bookingStatePatch: komodoDayTripAvailabilityCheckedPatch
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
        "Which one sounds closest to what you're after?",
      replySource: "DETERMINISTIC",
      productCards: defaultProductCards
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
        "Which one sounds closest to what you're after?",
      replySource: "DETERMINISTIC",
      productCards: defaultProductCards
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
        "Which one sounds closest to what you're after?",
      replySource: "DETERMINISTIC",
      productCards: defaultProductCards
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
        "Gold Coast Whale Escape is a luxury whale watching cruise. You can see the full details here: http://localhost:3107/demo/boattime#gold-coast-whale-escape. If it looks good, tell me your date and how many of you, and I'll check it.",
      replySource: "DETERMINISTIC"
    });
  });

  it("switches product context when the traveller asks about another product", async () => {
    const result = await handleTravellerBookingMessage({
      message: "what about twilight drift?",
      priorTravellerMessages: ["can you give me recommendation?", "info on gold coast whale escape please"],
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
          },
          {
            externalProductId: "boattime-twilight-drift",
            title: "Twilight Drift",
            description: "Sunset cruise experience",
            bookingMode: "AUTO_BOOKING",
            productUrl: "http://localhost:3107/demo/boattime#twilight-drift"
          }
        ],
        getAvailability: async () => {
          throw new Error("Availability should not be checked for product switching info requests.");
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
        "Twilight Drift is a sunset cruise experience. You can see the full details here: http://localhost:3107/demo/boattime#twilight-drift. If it looks good, tell me your date and how many of you, and I'll check it.",
      replySource: "DETERMINISTIC"
    });
  });

  // Reported live on WhatsApp, 2026-09-21: Kai showed a fresh 10-item numbered list, the traveller
  // replied "1"/"option 1", and got a generic "I can help with availability, booking, or handing you
  // off to the team" instead of the selection - stale, unrelated memory from an earlier session
  // (productTitle already set to something else) blocked the numbered-selection branch outright, the
  // same class of "stuck loop" bug as the weekday/weekend date gaps above. Fixed by trusting a
  // numbered reply to the *just-shown* list over old memory, the same way naming a product switches
  // context in the test above.
  it("selects a product by number from the list Kai just showed, even with an unrelated productTitle already in memory", async () => {
    const pmsAdapter = {
      provider: "MOCK" as const,
      listProducts: async () => [
        {
          externalProductId: "boattime-whale-escape",
          title: "Gold Coast Whale Escape",
          description: "Luxury whale watching cruise",
          bookingMode: "AUTO_BOOKING" as const,
          productUrl: "http://localhost:3107/demo/boattime#gold-coast-whale-escape"
        },
        {
          externalProductId: "boattime-twilight-drift",
          title: "Twilight Drift",
          description: "Sunset cruise experience",
          bookingMode: "AUTO_BOOKING" as const,
          productUrl: "http://localhost:3107/demo/boattime#twilight-drift"
        }
      ],
      getAvailability: async () => {
        throw new Error("Availability should not be checked for a numbered product pick.");
      },
      createBooking: async () => {
        throw new Error("Booking should not be created for a numbered product pick.");
      },
      cancelBooking: async () => ({ cancelled: false }),
      getBooking: async () => null
    };
    const conversationHistory = [
      {
        role: "assistant" as const,
        content:
          "You can choose from:\n1. Gold Coast Whale Escape - live availability\n2. Twilight Drift - live availability\n\nWhich one sounds closest? Tell me your date too and I'll check pricing."
      }
    ];
    const staleMemory = {
      productExternalId: "some-old-product-id",
      productTitle: "Some Old Product From An Earlier Session",
      dateText: null,
      guests: null
    };

    const bareNumber = await handleTravellerBookingMessage({
      message: "1",
      bookingMemory: staleMemory,
      conversationHistory,
      pmsAdapter
    });
    expect(bareNumber).toEqual({
      action: "PRODUCT_LINK",
      reply:
        "Gold Coast Whale Escape is a luxury whale watching cruise. You can see the full details here: http://localhost:3107/demo/boattime#gold-coast-whale-escape. If it looks good, tell me your date and how many of you, and I'll check it.",
      replySource: "DETERMINISTIC",
      bookingStatePatch: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: null,
        guests: null,
        travellerName: null,
        travellerEmail: null,
        travellerPhone: null,
        bookingStatus: "DRAFT",
        confirmationSummary: null,
        externalBookingId: null,
        externalProvider: null,
        bookingError: null
      }
    });

    const wordedOption = await handleTravellerBookingMessage({
      message: "option 1",
      bookingMemory: staleMemory,
      conversationHistory,
      pmsAdapter
    });
    expect(wordedOption.action).toBe("PRODUCT_LINK");
  });

  // Found by running docs/kai-personality.md against production, 2026-10-03.
  describe("personality doc checks against the live flow", () => {
    const adapter = {
      provider: "MOCK" as const,
      listProducts: async () => [
        { externalProductId: "whale", title: "Gold Coast Whale Escape", description: "Whale watching cruise", bookingMode: "AUTO_BOOKING" as const, productUrl: null },
        { externalProductId: "drift", title: "Twilight Drift", description: "Sunset cruise", bookingMode: "AUTO_BOOKING" as const, productUrl: null }
      ],
      getAvailability: async () => {
        throw new Error("Availability should not be checked here.");
      },
      createBooking: async () => {
        throw new Error("Booking should not be created here.");
      },
      cancelBooking: async () => ({ cancelled: false }),
      getBooking: async () => null
    };

    it("takes a trip named with a group size as a choice and asks only for the date", async () => {
      for (const [message, guests] of [
        ["I want the Gold Coast Whale Escape for 3 of us", 3],
        ["Gold Coast Whale Escape, 2 adults and 1 child", 3],
        ["the whale escape for just me", 1]
      ] as const) {
        const result = await handleTravellerBookingMessage({ message, pmsAdapter: adapter });

        expect(result.action, message).toBe("PRODUCT_LINK");
        expect(result.reply, message).toBe(`Gold Coast Whale Escape for ${guests}, sounds good. What date works for you?`);
        expect(result.bookingStatePatch?.productTitle, message).toBe("Gold Coast Whale Escape");
        expect(result.bookingStatePatch?.guests, message).toBe(guests);
      }
    });

    it("takes 'I want <trip>' as a choice instead of reading the menu", async () => {
      const result = await handleTravellerBookingMessage({ message: "I want the Gold Coast Whale Escape", pmsAdapter: adapter });

      expect(result.action).toBe("PRODUCT_LINK");
      expect(result.reply).toContain("Gold Coast Whale Escape");
    });

    it("answers 'are you a bot?' straight even with a trip and date already on the table", async () => {
      const result = await handleTravellerBookingMessage({
        message: "are you a bot?",
        pmsAdapter: adapter,
        bookingMemory: {
          productExternalId: "whale",
          productTitle: "Gold Coast Whale Escape",
          dateText: "2026-10-03",
          guests: 3
        }
      });

      expect(result.action).toBe("GENERAL_REPLY");
      expect(result.reply).toContain("not a person");
      expect(result.reply).not.toContain("you can choose from");
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
        "Good news, Gold Coast Whale Escape has room for 2 guests tomorrow. There are 22 seats available at A$99 per guest. Nothing's booked yet, so just say the word if it looks good.",
      replySource: "DETERMINISTIC",
      bookingStatePatch: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "tomorrow",
        guests: 2,
        travellerName: null,
        travellerEmail: null,
        travellerPhone: null,
        bookingStatus: "AVAILABILITY_CHECKED",
        confirmationSummary: null,
        externalBookingId: null,
        externalProvider: null,
        bookingError: null,
        ticketQuantities: null
      }
    });
  });

  it("checks availability when traveller follows product browsing with only date and guest count", async () => {
    const result = await handleTravellerBookingMessage({
      message: "for 24th of june for 2 people",
      priorTravellerMessages: ["what do you have for me?", "i want gold coast whale escape"],
      // Fixed reference "now" (well before June) - see resolveDefaultYear in booking-brain.ts;
      // without this, the hardcoded "2026-06-24" expectation below drifts once June is in the past.
      now: new Date("2026-01-01T00:00:00Z"),
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
        "Good news, Gold Coast Whale Escape has room for 2 guests on Wednesday 24 June 2026. There are 18 seats available at A$99 per guest. Nothing's booked yet, so just say the word if it looks good.",
      replySource: "DETERMINISTIC",
      bookingStatePatch: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-24",
        guests: 2,
        travellerName: null,
        travellerEmail: null,
        travellerPhone: null,
        bookingStatus: "AVAILABILITY_CHECKED",
        confirmationSummary: null,
        externalBookingId: null,
        externalProvider: null,
        bookingError: null,
        ticketQuantities: null
      }
    });
  });

  it("returns no dateOptions on an unavailable check when the PMS adapter can't search a date range", async () => {
    // MockPmsAdapter doesn't implement findAvailableDates - this is the "everyone except Rezdy"
    // path, and it must degrade to no date suggestions rather than throw.
    const result = await handleTravellerBookingMessage({
      message: "Can you check Komodo Day Trip for 99 guests tomorrow?",
      pmsAdapter: new MockPmsAdapter()
    });

    expect(result).toMatchObject({
      action: "AVAILABILITY_CHECKED",
      reply: "Sorry, Komodo Day Trip isn't available for 99 guests tomorrow. Want me to check another date or a different trip?",
      dateOptions: null
    });
  });

  it("attaches real alternative dates to an unavailable check when the PMS adapter supports it", async () => {
    // kai-conversation-flow-notes.md-style regression: a follow-up like "what date do you have?"
    // carries no new date, so effectiveSlots.dateText falls back to the memorized (already-failed)
    // date and getAvailability would just repeat the identical unavailable reply. Real dates
    // attached to the FIRST unavailable reply sidestep that follow-up loop entirely.
    let findAvailableDatesCall: unknown = null;
    const result = await handleTravellerBookingMessage({
      message: "Can you check Komodo Day Trip for 3 guests tomorrow?",
      pmsAdapter: {
        provider: "MOCK",
        listProducts: async () => [
          {
            externalProductId: "komodo-day-trip",
            title: "Komodo Day Trip",
            description: "A shared day trip with auto-booking.",
            bookingMode: "AUTO_BOOKING",
            productUrl: null
          }
        ],
        getAvailability: async (input) => ({
          productId: input.productId,
          date: input.date,
          available: false,
          remaining: 0,
          currency: "USD",
          unitPriceCents: 18500
        }),
        findAvailableDates: async (input) => {
          findAvailableDatesCall = input;
          return { dates: ["2026-06-24", "2026-06-27"] };
        },
        createBooking: async () => {
          throw new Error("Booking should not be created for availability checks.");
        },
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(result).toMatchObject({
      action: "AVAILABILITY_CHECKED",
      dateOptions: ["2026-06-24", "2026-06-27"]
    });
    expect(findAvailableDatesCall).toEqual({
      productId: "komodo-day-trip",
      guests: 3,
      fromDate: "tomorrow",
      daysToSearch: 60
    });
  });

  it("shows a real calendar for 'what dates are available?' instead of asking for a date to check", async () => {
    // Reported live: "what dates are available?" - OPEN_DATE_QUESTION_PATTERN only matched the
    // singular "what date"/"which date" before this, so the plural fell through to the generic
    // "please share a date" prompt, which is circular (the traveller is asking which date to
    // share). No guest count was given either, so this also proves the 1-guest default kicks in.
    let findAvailableDatesCall: unknown = null;
    const result = await handleTravellerBookingMessage({
      message: "what dates are available?",
      bookingMemory: {
        productExternalId: "komodo-day-trip",
        productTitle: "Komodo Day Trip",
        dateText: null,
        guests: null
      },
      pmsAdapter: {
        provider: "MOCK",
        listProducts: async () => [
          {
            externalProductId: "komodo-day-trip",
            title: "Komodo Day Trip",
            description: "A shared day trip with auto-booking.",
            bookingMode: "AUTO_BOOKING",
            productUrl: null
          }
        ],
        getAvailability: async () => {
          throw new Error("A specific date was never given - getAvailability should not run.");
        },
        findAvailableDates: async (input) => {
          findAvailableDatesCall = input;
          return { dates: ["2026-06-24", "2026-06-27"] };
        },
        createBooking: async () => {
          throw new Error("Booking should not be created for availability checks.");
        },
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(result).toEqual({
      action: "AVAILABILITY_CHECKED",
      reply: "Here are the open dates for Komodo Day Trip. Pick one and I'll check the price.",
      replySource: "DETERMINISTIC",
      dateOptions: ["2026-06-24", "2026-06-27"]
    });
    expect(findAvailableDatesCall).toEqual({
      productId: "komodo-day-trip",
      guests: 1,
      fromDate: "today",
      daysToSearch: 60
    });
  });

  it("answers 'what dates are available?' honestly when none are open in the search window", async () => {
    const result = await handleTravellerBookingMessage({
      message: "any dates available for this?",
      bookingMemory: {
        productExternalId: "komodo-day-trip",
        productTitle: "Komodo Day Trip",
        dateText: null,
        guests: 4
      },
      pmsAdapter: {
        provider: "MOCK",
        listProducts: async () => [
          {
            externalProductId: "komodo-day-trip",
            title: "Komodo Day Trip",
            description: "A shared day trip with auto-booking.",
            bookingMode: "AUTO_BOOKING",
            productUrl: null
          }
        ],
        getAvailability: async () => {
          throw new Error("A specific date was never given - getAvailability should not run.");
        },
        findAvailableDates: async () => ({ dates: [] }),
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
        "I couldn't find any open dates for Komodo Day Trip for 4 guests in the next 60 days. Want me to pass this to the team, or look at a different trip?",
      replySource: "DETERMINISTIC",
      dateOptions: null
    });
  });

  it("checks availability when traveller types a compact date after product browsing", async () => {
    const result = await handleTravellerBookingMessage({
      message: "28june, 3 people",
      priorTravellerMessages: ["can you give me recommendation?", "info on gold coast whale escape please"],
      now: new Date("2026-01-01T00:00:00Z"),
      bookingMemory: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: null,
        guests: null
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
        getAvailability: async (input) => ({
          productId: input.productId,
          date: "2026-06-28 09:00:00",
          available: true,
          remaining: 78,
          currency: "AUD",
          unitPriceCents: 7900,
          timeOptions: [
            { label: "9:00 AM", startTimeLocal: "2026-06-28 09:00:00", remaining: 78 },
            { label: "12:00 PM", startTimeLocal: "2026-06-28 12:00:00", remaining: 75 },
            { label: "1:30 PM", startTimeLocal: "2026-06-28 13:30:00", remaining: 75 }
          ],
          ticketOptions: [
            { label: "Family (2A +2C) 3-13", unitPriceCents: 24900 },
            { label: '"2 people for $149.00', unitPriceCents: 14900 }
          ]
        }),
        createBooking: async () => {
          throw new Error("Booking should not be created during availability checks.");
        },
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(result).toMatchObject({
      action: "BOOKING_TIME_SELECTION_REQUIRED",
      bookingStatePatch: {
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-28",
        guests: 3
      }
    });
    expect(result.reply).toContain("Good news, Gold Coast Whale Escape has room for 3 guests on Sunday 28 June 2026");
    expect(result.reply).toContain("1. 9:00 AM - 78 spots");
  });

  it("locks the only available time before ticket and extras selection", async () => {
    const availabilityResult = await handleTravellerBookingMessage({
      message: "26 june for 4 people",
      priorTravellerMessages: ["can you give me recommendation?", "1"],
      bookingMemory: {
        productExternalId: "PGG8QT",
        productTitle: "Gold Coast Whale Escape",
        dateText: null,
        guests: null
      },
      bookingWriteEnabled: true,
      pmsAdapter: {
        provider: "REZDY",
        listProducts: async () => [
          {
            externalProductId: "PGG8QT",
            title: "Gold Coast Whale Escape",
            description: "Luxury whale watching cruise",
            bookingMode: "AUTO_BOOKING"
          }
        ],
        getAvailability: async (input) => ({
          productId: input.productId,
          date: "2026-06-26 09:00:00",
          available: true,
          remaining: 67,
          currency: "AUD",
          unitPriceCents: 7900,
          timeOptions: [{ label: "9:00 AM", startTimeLocal: "2026-06-26 09:00:00", remaining: 67 }],
          ticketOptions: [
            { label: "Family (2A +2C) 3-13", unitPriceCents: 24900 },
            { label: '"2 people for $149.00', unitPriceCents: 14900 },
            { label: "Child (3-13)", unitPriceCents: 5900 },
            { label: "Infant (under 3)", unitPriceCents: 0 },
            { label: "Adult (Winter Special)", unitPriceCents: 7900 }
          ],
          extraOptions: [
            { label: "Corona Bucket", unitPriceCents: 3000 },
            { label: "Sparkling for 2", unitPriceCents: 4000 }
          ]
        }),
        createBooking: async () => {
          throw new Error("Booking should not be created before time, tickets, extras, and contact are complete.");
        },
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(availabilityResult).toMatchObject({
      action: "BOOKING_TICKET_SELECTION_REQUIRED",
      bookingStatePatch: {
        dateText: "2026-06-26 09:00:00",
        extraOptions: [
          { label: "Corona Bucket", unitPriceCents: 3000 },
          { label: "Sparkling for 2", unitPriceCents: 4000 }
        ]
      }
    });
    expect(availabilityResult.reply).toContain("only available time is 9:00 AM");

    const ticketResult = await handleTravellerBookingMessage({
      message: "option 5",
      bookingMemory: availabilityResult.bookingStatePatch,
      bookingWriteEnabled: true,
      pmsAdapter: {
        provider: "REZDY",
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
          throw new Error("Availability should not be rechecked during ticket selection.");
        },
        createBooking: async () => {
          throw new Error("Booking should not be created before extras are handled.");
        },
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(ticketResult).toMatchObject({
      action: "BOOKING_EXTRAS_SELECTION_REQUIRED",
      bookingStatePatch: {
        dateText: "2026-06-26 09:00:00",
        ticketQuantities: [{ optionLabel: "Adult (Winter Special)", quantity: 4 }],
        extraOptions: [
          { label: "Corona Bucket", unitPriceCents: 3000 },
          { label: "Sparkling for 2", unitPriceCents: 4000 }
        ],
        extraQuantities: null
      }
    });
    expect(ticketResult.reply).toContain("Optional extras");
  });

  it("does not silently change an already-confirmed time when tickets are selected by number", async () => {
    // Regression, found live on WhatsApp: after confirming 1:30 PM (time option 3 of 4), the
    // traveller picked tickets by number ("option 2 and option 5, dont you understand?"). Ticket
    // option 2 and time option 2 are both just the digit "2" - the ticket-selection turn's own
    // time-correction check used to reinterpret that "2" as time option 2 (12:00 PM) and silently
    // overwrote the already-confirmed 1:30 PM with zero user intent to change it.
    const timeOptions = [
      { label: "9:00 AM", startTimeLocal: "2026-07-24 09:00:00", remaining: 83 },
      { label: "12:00 PM", startTimeLocal: "2026-07-24 12:00:00", remaining: 87 },
      { label: "1:30 PM", startTimeLocal: "2026-07-24 13:30:00", remaining: 87 },
      { label: "2:30 PM", startTimeLocal: "2026-07-24 14:30:00", remaining: 90 }
    ];
    const ticketOptions = [
      { label: "Family (2A +2C) 3-13", unitPriceCents: 24900 },
      { label: "2 people for $149.00", unitPriceCents: 14900 },
      { label: "Child (3-13)", unitPriceCents: 5900 },
      { label: "Infant (under 3)", unitPriceCents: 0 },
      { label: "Adult (Winter Special)", unitPriceCents: 7900 }
    ];
    const extraOptions = [
      { label: "Corona Bucket", unitPriceCents: 3000 },
      { label: "Sparkling for 2", unitPriceCents: 4000 }
    ];
    const pmsAdapter = {
      provider: "REZDY" as const,
      listProducts: async () => [
        {
          externalProductId: "boattime-whale-escape",
          title: "Gold Coast Whale Escape",
          description: "Luxury whale watching cruise",
          bookingMode: "AUTO_BOOKING" as const
        }
      ],
      getAvailability: async () => {
        throw new Error("Availability should not be rechecked during time or ticket selection.");
      },
      createBooking: async () => {
        throw new Error("Booking should not be created before extras and contact are handled.");
      },
      cancelBooking: async () => ({ cancelled: false }),
      getBooking: async () => null
    };

    const timeResult = await handleTravellerBookingMessage({
      message: "1:30pm",
      bookingMemory: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-07-24",
        guests: 3,
        timeOptions,
        ticketOptions,
        extraOptions
      },
      bookingWriteEnabled: true,
      pmsAdapter
    });

    expect(timeResult).toMatchObject({
      action: "BOOKING_TICKET_SELECTION_REQUIRED",
      bookingStatePatch: { dateText: "2026-07-24 13:30:00" }
    });

    const ticketResult = await handleTravellerBookingMessage({
      message: "yes i want to mix option 2 and option 5, dont you understand?",
      bookingMemory: timeResult.bookingStatePatch,
      bookingWriteEnabled: true,
      pmsAdapter
    });

    expect(ticketResult).toMatchObject({
      action: "BOOKING_EXTRAS_SELECTION_REQUIRED",
      bookingStatePatch: {
        dateText: "2026-07-24 13:30:00",
        ticketQuantities: [
          { optionLabel: "2 people for $149.00", quantity: 1 },
          { optionLabel: "Adult (Winter Special)", quantity: 1 }
        ]
      }
    });
    expect(ticketResult.reply).toContain("1:30 PM");
    expect(ticketResult.reply).not.toContain("12:00 PM");
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
        "Good news, Gold Coast Whale Escape has room for 3 guests tomorrow. There are 22 seats available.\n\n" +
        "Ticket options:\n" +
        "1. 2 people - A$149\n" +
        "2. Family (2A +2C) 3-13 - A$249\n" +
        "3. Child (3-13) - A$59\n" +
        "4. Infant (under 3) - A$0\n" +
        "5. Adult (Winter Special) - A$79\n\n" +
        "Which ticket suits? Just say \"option 2\" or \"1 x 2 people\". Nothing's booked yet.",
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
      },
      // Mirrors bookingStatePatch.ticketOptions above - see the handleTravellerBookingMessage
      // wrapper's comment for why this is attached once there instead of at every one of the many
      // BOOKING_TICKET_SELECTION_REQUIRED return points in the function it wraps.
      ticketOptions: [
        { label: '"2 people for $149.00', unitPriceCents: 14900 },
        { label: "Family (2A +2C) 3-13", unitPriceCents: 24900 },
        { label: "Child (3-13)", unitPriceCents: 5900 },
        { label: "Infant (under 3)", unitPriceCents: 0 },
        { label: "Adult (Winter Special)", unitPriceCents: 7900 }
      ]
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
        "Good news, Gold Coast Whale Escape has room for 3 guests on Saturday 27 June 2026. Here are the available times:\n" +
        "1. 9:00 AM - 77 spots\n" +
        "2. 12:00 PM - 79 spots\n\n" +
        "Which time works best? Nothing's booked yet.",
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
      },
      // See the ticket-selection test above for why this mirrors bookingStatePatch.timeOptions.
      timeOptions: [
        { label: "9:00 AM", startTimeLocal: "2026-06-27 09:00:00", remaining: 77 },
        { label: "12:00 PM", startTimeLocal: "2026-06-27 12:00:00", remaining: 79 }
      ]
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
        "Got it: Gold Coast Whale Escape on Saturday 27 June 2026 at 12:00 PM for 2 guests.\n\n" +
        "Ticket options:\n" +
        "1. 2 people - A$149\n" +
        "2. Adult (Winter Special) - A$79\n\n" +
        "Which ticket suits? Just say \"option 2\" or \"1 x 2 people\".",
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
      },
      ticketOptions: [
        { label: '"2 people for $149.00', unitPriceCents: 14900 },
        { label: "Adult (Winter Special)", unitPriceCents: 7900 }
      ]
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

  it("understands time labels with minutes even when the traveller omits am or pm", async () => {
    const result = await handleTravellerBookingMessage({
      message: "1:30 please",
      bookingMemory: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-28",
        guests: 3,
        timeOptions: [
          { label: "9:00 AM", startTimeLocal: "2026-06-28 09:00:00", remaining: 78 },
          { label: "12:00 PM", startTimeLocal: "2026-06-28 12:00:00", remaining: 75 },
          { label: "1:30 PM", startTimeLocal: "2026-06-28 13:30:00", remaining: 75 }
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
        dateText: "2026-06-28 13:30:00"
      }
    });
    expect(result.reply).toContain("at 1:30 PM");
  });

  it.each(["12p", "12 pm", "noon please"])("understands common shorthand time selection: %s", async (message) => {
    const result = await handleTravellerBookingMessage({
      message,
      bookingMemory: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-28",
        guests: 3,
        timeOptions: [
          { label: "9:00 AM", startTimeLocal: "2026-06-28 09:00:00", remaining: 78 },
          { label: "12:00 PM", startTimeLocal: "2026-06-28 12:00:00", remaining: 75 },
          { label: "1:30 PM", startTimeLocal: "2026-06-28 13:30:00", remaining: 75 }
        ],
        ticketOptions: [
          { label: "Family (2A +2C) 3-13", unitPriceCents: 24900 },
          { label: '"2 people for $149.00', unitPriceCents: 14900 }
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
        dateText: "2026-06-28 12:00:00"
      }
    });
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
    expect(result.reply).toContain("with 1 x 2 people for $149.00");
  });

  // Regression: confirmed live that a bare "2" (no "option"/"choice" prefix) matched nothing here,
  // even though the exact same bare-number style already worked one step earlier for picking a
  // product/operator from a numbered list. Silently falling through then re-ran availability from
  // scratch, showing the same time-selection prompt again no matter what the traveller typed next -
  // stuck in an unrecoverable loop the moment they replied with just a number, as most people
  // naturally would after being shown a numbered list.
  it("understands a bare numbered ticket option selection with no 'option' prefix", async () => {
    const result = await handleTravellerBookingMessage({
      message: "2",
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
  });

  it("understands mixed numbered ticket option selections from the displayed list", async () => {
    const result = await handleTravellerBookingMessage({
      message: "option 2 + option 5 please",
      bookingMemory: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-29 13:30:00",
        guests: 3,
        ticketOptions: [
          { label: "Family (2A +2C) 3-13", unitPriceCents: 24900 },
          { label: "2 people for $149.00", unitPriceCents: 14900 },
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
        ticketQuantities: [
          { optionLabel: "2 people for $149.00", quantity: 1 },
          { optionLabel: "Adult (Winter Special)", quantity: 1 }
        ]
      }
    });
    expect(result.reply).toContain("with 1 x 2 people for $149.00 and 1 x Adult (Winter Special)");
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
        "Got it: Gold Coast Whale Escape tomorrow for 3 guests with 2 x Adult (Winter Special) and 1 x Child (3-13). Pop through your name, email and phone number and I'll set up secure payment.",
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
    expect(result.reply).toContain("1 x 2 people for $149.00");
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
    expect(result.reply).toContain("with 1 x 2 people for $149.00");
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
        "Thanks, I've got everything for Gold Coast Whale Escape on Saturday 27 June 2026 for 2 guests with 1 x 2 people for $149.00 under RegaTest, regatest@gmail.com, 086554789650.\n\n" +
        "I've passed this to the operator, and they'll be in touch to sort out payment. I never see or store your card details.",
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
          "Gold Coast Whale Escape on 2026-06-27 for 2 guests with 1 x 2 people for $149.00 under RegaTest, regatest@gmail.com, 086554789650.",
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
    expect(result.reply).toContain("Which would you like?");
  });

  it("does not use a raw Rezdy service checkout link as the secure payment handoff", async () => {
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
    expect(result.reply).toContain("they'll be in touch to sort out payment");
    expect(result.paymentHandoffUrl).toBeUndefined();
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
    expect(result.reply).toContain("they'll be in touch to sort out payment");
    expect(result.reply).not.toContain("https://www.boattimeyachtcharters.com/cruise-tickets-luxury-whale-watching#book");
    expect(result.reply).not.toContain("https://boattimeyachtcharters.rezdy.com/services/431872");
  });

  it("creates a pending external order with the traveller details before sending the payment handoff when enabled", async () => {
    const createBookingCalls: unknown[] = [];
    const result = await handleTravellerBookingMessage({
      message: "My name is Raga Test, email is ragatest@gmail.com and phone number is 085664326198",
      priorTravellerMessages: [
        "Can you check Gold Coast Whale Escape for 3 guests on 2026-06-28?",
        "12:00 PM please",
        "3 adults",
        "1 corona bucket"
      ],
      bookingMemory: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-28 12:00:00",
        guests: 3,
        bookingStatus: "AVAILABILITY_CHECKED",
        ticketQuantities: [{ optionLabel: "Adult (Winter Special)", quantity: 3 }],
        extraQuantities: [{ optionLabel: "Corona Bucket", quantity: 1 }]
      },
      bookingWriteEnabled: true,
      allowUnpaidExternalBooking: true,
      pmsAdapter: {
        provider: "REZDY",
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
        createBooking: async (request) => {
          createBookingCalls.push(request);
          return {
            externalBookingId: "RZ-PENDING",
            provider: "REZDY",
            status: "PENDING",
            paymentUrl: "https://boattimeyachtcharters.rezdy.com/pay/RZ-PENDING"
          };
        },
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(createBookingCalls).toEqual([
      {
        productId: "boattime-whale-escape",
        date: "2026-06-28 12:00:00",
        guests: 3,
        travellerName: "Raga Test",
        travellerEmail: "ragatest@gmail.com",
        travellerPhone: "085664326198",
        ticketQuantities: [{ optionLabel: "Adult (Winter Special)", quantity: 3 }],
        extraQuantities: [{ optionLabel: "Corona Bucket", quantity: 1 }],
        confirmationMode: "PAYMENT_HOLD"
      }
    ]);
    expect(result.action).toBe("BOOKING_PAYMENT_REQUIRED");
    expect(result.paymentHandoffUrl).toBe("https://boattimeyachtcharters.rezdy.com/pay/RZ-PENDING");
    expect(result.reply).toContain("You can pay on the secure Rezdy payment link below");
    expect(result.bookingStatePatch).toMatchObject({
      bookingStatus: "PAYMENT_PENDING",
      externalBookingId: "RZ-PENDING",
      externalProvider: "REZDY",
      bookingError: null
    });
  });

  it("does not imply Rezdy emailed a payment link when a pending order has no checkout URL", async () => {
    const result = await handleTravellerBookingMessage({
      message: "My name is Raja Test, email is rajatest@gmail.com and phone number is 087665349192",
      priorTravellerMessages: [
        "Can you check Gold Coast Whale Escape for 3 guests on 2026-06-29?",
        "9:00 AM please",
        "3 adults",
        "no extras"
      ],
      bookingMemory: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-29 09:00:00",
        guests: 3,
        bookingStatus: "AVAILABILITY_CHECKED",
        ticketQuantities: [{ optionLabel: "Adult (Winter Special)", quantity: 3 }],
        extraQuantities: []
      },
      bookingWriteEnabled: true,
      allowUnpaidExternalBooking: true,
      pmsAdapter: {
        provider: "REZDY",
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
        createBooking: async () => ({
          externalBookingId: "RZ-ABANDONED",
          provider: "REZDY",
          status: "PENDING"
        }),
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(result.action).toBe("BOOKING_PAYMENT_REQUIRED");
    expect(result.reply).toContain("(reference RZ-ABANDONED)");
    expect(result.reply).toContain("Thanks, I've got everything for Gold Coast Whale Escape on Monday 29 June 2026 at 9:00 AM for 3 guests with 3 x Adult (Winter Special) under Raja Test, rajatest@gmail.com, 087665349192.");
    expect(result.reply).not.toContain("may send the secure payment link by email");
    expect(result.paymentHandoffUrl).toBeUndefined();
  });

  it("does not claim availability for manual inquiry products", async () => {
    const result = await handleTravellerBookingMessage({
      message: "Can you check Private Charter for 2 guests tomorrow?",
      pmsAdapter: new MockPmsAdapter()
    });

    expect(result).toEqual({
      action: "MANUAL_INQUIRY_REQUIRED",
      reply:
        "The crew confirm Private Charter bookings themselves, so I can't lock it in on the spot. I can take your details and pass the request on, and nothing's booked until they confirm.",
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
        "For tomorrow, you can choose from:\n1. Komodo Day Trip - live availability\n2. Private Charter - operator confirmation required\n3. Reef Day Snorkel - live availability\n\nWhich one sounds closest to what you're after?",
      replySource: "DETERMINISTIC",
      productCards: defaultProductCards
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
        "The crew confirm Private Charter bookings themselves, so I can't lock it in on the spot. I can take your details and pass the request on, and nothing's booked until they confirm.",
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
        "The crew confirm Private Charter bookings themselves, so I can't lock it in on the spot. I can take your details and pass the request on, and nothing's booked until they confirm.",
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
        "Good news, Komodo Day Trip has room for 3 guests on Tuesday 23 June 2026. There are 7 seats available at US$185 per guest. Nothing's booked yet, so just say the word if it looks good.",
      replySource: "DETERMINISTIC",
      bookingStatePatch: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
        dateText: "2026-06-23",
        guests: 3,
        travellerName: null,
        travellerEmail: null,
        travellerPhone: null,
        bookingStatus: "AVAILABILITY_CHECKED",
        confirmationSummary: null,
        externalBookingId: null,
        externalProvider: null,
        bookingError: null,
        ticketQuantities: null
      }
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
        "Sure thing, here's the page for Komodo Day Trip: https://tenant.example/products/komodo-day-trip. Have a look, and if it feels right, just tell me you'd like to go ahead.",
      replySource: "DETERMINISTIC"
    });
  });

  it("checks real availability instead of skipping straight to contact details for an unconfirmed auto-booking product", async () => {
    // Regression: a free-text booking-intent phrase ("yes I want it") combined with an
    // already-known product/date/guests used to let this skip straight to "give me your contact
    // details", even though getAvailability had never actually been called - the traveller could
    // reach a real Stripe/PMS booking without ever seeing a real time slot or ticket price. The
    // capture shortcut now only applies once bookingMemory shows genuine evidence of a prior
    // availability check.
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
      action: "AVAILABILITY_CHECKED",
      reply:
        "Good news, Komodo Day Trip has room for 3 guests tomorrow. There are 7 seats available at US$185 per guest. Nothing's booked yet, so just say the word if it looks good.",
      replySource: "DETERMINISTIC",
      bookingStatePatch: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
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
        ticketQuantities: null
      }
    });
  });

  it("checks real availability instead of continuing to contact collection when traveller naturally accepts an available writable product", async () => {
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
      action: "AVAILABILITY_CHECKED",
      reply:
        "Good news, Komodo Day Trip has room for 2 guests tomorrow. There are 8 seats available at US$185 per guest. Nothing's booked yet, so just say the word if it looks good.",
      replySource: "DETERMINISTIC",
      bookingStatePatch: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
        dateText: "tomorrow",
        guests: 2,
        travellerName: null,
        travellerEmail: null,
        travellerPhone: null,
        bookingStatus: "AVAILABILITY_CHECKED",
        confirmationSummary: null,
        externalBookingId: null,
        externalProvider: null,
        bookingError: null,
        ticketQuantities: null
      }
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
        "Happy to set that up. Just tell me the date and how many of you, so I get it right.",
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
      reply: "Nice, Komodo Day Trip tomorrow. How many of you are going?",
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
      reply: "Nice, Komodo Day Trip tomorrow. How many of you are going?",
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
      now: new Date("2026-01-01T00:00:00Z"),
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
        "Nice, Gold Coast Whale Escape on Friday 26 June 2026. How many of you are going?",
      replySource: "DETERMINISTIC"
    });
  });

  // Reported live on boattimeyachtcharters.com (2026-08-23): a traveller asked "what date that you
  // have?" instead of naming one, twice in a row, and got the identical generic prompt back
  // verbatim both times - reading as a stuck loop even though guests (2) had genuinely been
  // captured in between.
  it("answers an open date question honestly instead of repeating the same prompt verbatim", async () => {
    const result = await handleTravellerBookingMessage({
      message: "what date that you have?",
      priorTravellerMessages: ["i think i want that komodo day trip", "what date available for it? for 2 people"],
      bookingMemory: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
        dateText: null,
        guests: 2
      },
      bookingWriteEnabled: true,
      pmsAdapter: new MockPmsAdapter()
    });

    expect(result).toEqual({
      action: "NEEDS_MORE_DETAILS",
      reply:
        "I can only check one date at a time for Komodo Day Trip, so I can't show you a calendar just yet. Got a date in mind for 2 guests? I'll check it straight away.",
      replySource: "DETERMINISTIC"
    });
  });

  it("still asks for a date plainly when the traveller simply hasn't given one yet", async () => {
    const result = await handleTravellerBookingMessage({
      message: "can you check availability?",
      priorTravellerMessages: ["i think i want that komodo day trip", "2 guests please"],
      bookingMemory: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
        dateText: null,
        guests: 2
      },
      bookingWriteEnabled: true,
      pmsAdapter: new MockPmsAdapter()
    });

    expect(result).toEqual({
      action: "NEEDS_MORE_DETAILS",
      reply: "Nice, Komodo Day Trip for 2 guests. What date suits you?",
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
        "Good news, Komodo Day Trip has room for 2 guests tomorrow. There are 8 seats available at US$185 per guest. Nothing's booked yet, so just say the word if it looks good.",
      replySource: "DETERMINISTIC",
      bookingStatePatch: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
        dateText: "tomorrow",
        guests: 2,
        travellerName: null,
        travellerEmail: null,
        travellerPhone: null,
        bookingStatus: "AVAILABILITY_CHECKED",
        confirmationSummary: null,
        externalBookingId: null,
        externalProvider: null,
        bookingError: null,
        ticketQuantities: null
      }
    });
  });

  // kai-conversation-flow-notes.md finding #5: a bare "2" in reply to "how many guests?" fell
  // through and re-asked the same question - only "2 guests"/"2 people" etc. worked before.
  it("accepts a bare numeral as the guest count when Kai specifically just asked for it", async () => {
    const result = await handleTravellerBookingMessage({
      message: "2",
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

    expect(result.action).toBe("AVAILABILITY_CHECKED");
    expect(result.reply).not.toMatch(/please share the number of guests/i);
    expect((result.bookingStatePatch as { guests?: number } | null)?.guests).toBe(2);
  });

  // kai-conversation-flow-notes.md finding #2 (critical): across 9 traveller turns Kai never once
  // declined - it kept re-offering the same 4 products, including after an explicit "I don't want
  // a yacht charter." This is the "say no, then capture" fix.
  it("declines instead of re-showing the same product list once it's already been seen and still doesn't fit", async () => {
    const conversationHistory = [
      { role: "traveller" as const, content: "what do you have for me?" },
      {
        role: "assistant" as const,
        content:
          "You can choose from:\n1. Komodo Day Trip - live availability\n2. Private Charter - operator confirmation required\n\nWhich one sounds closest to what you're after?"
      }
    ];

    const result = await handleTravellerBookingMessage({
      message: "none of those, what else do you have?",
      priorTravellerMessages: ["what do you have for me?"],
      conversationHistory,
      pmsAdapter: new MockPmsAdapter()
    });

    expect(result.action).toBe("PRODUCT_RECOMMENDATION");
    expect(result.reply.toLowerCase()).not.toContain("komodo day trip");
    expect(result.reply.toLowerCase()).toMatch(/not yet|email/);
  });

  it("hands off to a human with the traveller's email once they leave one after a decline", async () => {
    const conversationHistory = [
      { role: "traveller" as const, content: "what do you have for me?" },
      {
        role: "assistant" as const,
        content:
          "You can choose from:\n1. Komodo Day Trip - live availability\n2. Private Charter - operator confirmation required\n\nWhich one sounds closest to what you're after?"
      },
      { role: "traveller" as const, content: "none of those" },
      { role: "assistant" as const, content: "None of these quite fit what you're after, and I'd rather not force it. Want to leave your email so the team can follow up when something does?" }
    ];

    const result = await handleTravellerBookingMessage({
      message: "sure, sarah@example.com",
      priorTravellerMessages: ["what do you have for me?", "none of those"],
      conversationHistory,
      pmsAdapter: new MockPmsAdapter()
    });

    expect(result.action).toBe("HUMAN_HANDOFF");
    expect(result.reply).toContain("sarah@example.com");
  });

  // kai-conversation-flow-notes.md finding #16 (compliance): checked before anything else, so a
  // pasted card number never reaches intent classification, availability checks, or an LLM call.
  it("refuses card-shaped input immediately, before any booking logic runs", async () => {
    const result = await handleTravellerBookingMessage({
      message: "Fine, book Komodo Day Trip. My card is 4111 1111 1111 1111, exp 04/29, cvv 123.",
      pmsAdapter: {
        provider: "MOCK",
        listProducts: async () => {
          throw new Error("Card-shaped input must short-circuit before any PMS call.");
        },
        getAvailability: async () => {
          throw new Error("Card-shaped input must short-circuit before any PMS call.");
        },
        createBooking: async () => {
          throw new Error("Card-shaped input must never reach booking creation.");
        },
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(result).toEqual({
      action: "GENERAL_REPLY",
      reply:
        "I can't take card or payment details in chat, so I didn't save that. Best not to paste them here. When you're ready to pay, I'll send you a secure checkout link, and your card details never pass through me.",
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
      reply: "Happy to set that up. Just tell me how many of you, so I get it right.",
      replySource: "DETERMINISTIC",
      inquiryDraft: null
    });
  });

  it("still checks real availability when traveller says book it, even with product/date/guests already known", async () => {
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
      action: "AVAILABILITY_CHECKED",
      reply:
        "Good news, Komodo Day Trip has room for 3 guests tomorrow. There are 7 seats available at US$185 per guest. Nothing's booked yet, so just say the word if it looks good.",
      replySource: "DETERMINISTIC",
      bookingStatePatch: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
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
        ticketQuantities: null
      }
    });
  });

  it("checks real availability instead of completing an inquiry draft, since no availability check ever happened", async () => {
    // The traveller's contact details in this message are not captured here - since real
    // availability was never confirmed for this booking, the correct, safe behavior is to check it
    // now rather than accept contact details toward an inquiry/payment. The traveller would supply
    // their details again on a later turn once availability is genuinely confirmed.
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
      action: "AVAILABILITY_CHECKED",
      reply:
        "Good news, Komodo Day Trip has room for 3 guests tomorrow. There are 7 seats available at US$185 per guest. Nothing's booked yet, so just say the word if it looks good.",
      replySource: "DETERMINISTIC",
      bookingStatePatch: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
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
        ticketQuantities: null
      }
    });
  });

  it("still checks real availability even when booking-write is disabled, for an unconfirmed auto-booking product", async () => {
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
      action: "AVAILABILITY_CHECKED",
      reply:
        "Good news, Komodo Day Trip has room for 3 guests tomorrow. There are 7 seats available at US$185 per guest. Nothing's booked yet, so just say the word if it looks good.",
      replySource: "DETERMINISTIC",
      bookingStatePatch: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
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
        ticketQuantities: null
      }
    });
  });

  it("checks real availability instead of moving straight to secure payment for an unconfirmed auto-booking product", async () => {
    // This is the exact real-money-risk scenario the guard exists for: a traveller's contact
    // details plus a capture-intent phrase ("yes book it") earlier in the conversation used to be
    // enough to request secure payment for an AUTO_BOOKING (live-Rezdy) product without Kai ever
    // having called getAvailability - meaning the traveller could be sent to pay for a slot that was
    // never actually confirmed available, at a price that was never actually confirmed correct.
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
      action: "AVAILABILITY_CHECKED",
      reply:
        "Good news, Komodo Day Trip has room for 3 guests tomorrow. There are 7 seats available at US$185 per guest. Nothing's booked yet, so just say the word if it looks good.",
      replySource: "DETERMINISTIC",
      bookingStatePatch: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
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
        ticketQuantities: null
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
        "Thanks, I've got everything for Gold Coast Whale Escape on Saturday 27 June 2026 at 12:00 PM for 2 guests with 1 x 2 people for $149.00 under Kaka, kaka@gmail.com, 086554329189.\n\n" +
        "I've passed this to the operator, and they'll be in touch to sort out payment. I never see or store your card details.",
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
          "Gold Coast Whale Escape on 2026-06-27 12:00:00 for 2 guests with 1 x 2 people for $149.00 under Kaka, kaka@gmail.com, 086554329189.",
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

  it("keeps collecting contact details when the traveller only sends a bare name", async () => {
    const result = await handleTravellerBookingMessage({
      message: "David Samantha",
      priorTravellerMessages: [
        "Can you check Gold Coast Whale Escape for 2 guests on 2026-06-28?",
        "12:00 PM",
        "option 2 please"
      ],
      bookingMemory: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-28 12:00:00",
        guests: 2,
        bookingStatus: "AVAILABILITY_CHECKED",
        timeOptions: [
          { label: "9:00 AM", startTimeLocal: "2026-06-28 09:00:00", remaining: 78 },
          { label: "12:00 PM", startTimeLocal: "2026-06-28 12:00:00", remaining: 75 },
          { label: "1:30 PM", startTimeLocal: "2026-06-28 13:30:00", remaining: 75 }
        ],
        ticketOptions: [
          { label: "Adult (Winter Special)", unitPriceCents: 7900 },
          { label: '"2 people for $149.00', unitPriceCents: 14900 }
        ],
        ticketQuantities: [{ optionLabel: '"2 people for $149.00', quantity: 1 }],
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
          throw new Error("Availability should not be rechecked while collecting contact details.");
        },
        createBooking: async () => {
          throw new Error("Booking should not be created before secure payment succeeds.");
        },
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(result).toEqual({
      action: "BOOKING_DETAILS_REQUIRED",
      reply:
        "Thanks, David. I just need your email and phone number to set up secure payment.",
      replySource: "DETERMINISTIC",
      inquiryDraft: null,
      bookingStatePatch: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-28 12:00:00",
        guests: 2,
        travellerName: "David Samantha",
        travellerEmail: null,
        travellerPhone: null,
        bookingStatus: "AVAILABILITY_CHECKED",
        confirmationSummary: null,
        externalBookingId: null,
        externalProvider: null,
        bookingError: null,
        timeOptions: [
          { label: "9:00 AM", startTimeLocal: "2026-06-28 09:00:00", remaining: 78 },
          { label: "12:00 PM", startTimeLocal: "2026-06-28 12:00:00", remaining: 75 },
          { label: "1:30 PM", startTimeLocal: "2026-06-28 13:30:00", remaining: 75 }
        ],
        ticketOptions: [
          { label: "Adult (Winter Special)", unitPriceCents: 7900 },
          { label: '"2 people for $149.00', unitPriceCents: 14900 }
        ],
        ticketQuantities: [{ optionLabel: '"2 people for $149.00', quantity: 1 }],
        extraQuantities: []
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
        "You're booked in: Komodo Day Trip tomorrow for 3 guests, confirmation reference mock-booking-mock-komodo-day-trip-tomorrow-3. I haven't taken any payment here, so the operator will sort that with you.",
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
        "I've saved your booking request for the operator. Nothing has been paid yet, so I won't lock in the booking until payment is sorted, and they'll follow up with you on that.",
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
        "Got it: Gold Coast Whale Escape on Friday 26 June 2026 at 1:30 PM for 2 guests with 1 x 2 people for $149.00.\n\n" +
        "Optional extras:\n" +
        "1. Corona Bucket - A$30\n" +
        "2. Sparkling for 2 - A$40\n" +
        "3. Cheese Platter for 2 - A$10\n\n" +
        "Want to add any? Just say \"no extras\" or \"1 x Corona Bucket\".",
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
      },
      extraOptions: [
        { label: "Corona Bucket", unitPriceCents: 3000 },
        { label: "Sparkling for 2", unitPriceCents: 4000 },
        { label: "Cheese Platter for 2", unitPriceCents: 1000 }
      ]
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
        "No extras, no worries. Pop through your name, email and phone number and I'll set up secure payment.",
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

  // Same bare-number gap as ticket selection, fixed for the same reason: a traveller shouldn't need
  // to say "option 1" or "extra 1" here when a bare "1" already worked for picking the ticket option
  // one turn earlier in the same conversation.
  it("understands a bare numbered extra option selection with no 'option'/'extra' prefix", async () => {
    const result = await handleTravellerBookingMessage({
      message: "1",
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

    expect(result).toMatchObject({
      action: "BOOKING_DETAILS_REQUIRED",
      bookingStatePatch: {
        extraQuantities: [{ optionLabel: "Corona Bucket", quantity: 1 }]
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
        "Thanks, I've got everything for Gold Coast Whale Escape on Friday 26 June 2026 at 1:30 PM for 2 guests with 1 x 2 people for $149.00 under Test, test@gmail.com, 086775428176.\n\n" +
        "I've passed this to the operator, and they'll be in touch to sort out payment. I never see or store your card details.",
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
          "Gold Coast Whale Escape on 2026-06-26 13:30:00 for 2 guests with 1 x 2 people for $149.00 under Test, test@gmail.com, 086775428176.",
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

  it("does not reserve a PMS hold or populate pmsCheckoutHold when bluePassStripeCheckoutEnabled is explicitly false (regression guard)", async () => {
    const result = await handleTravellerBookingMessage({
      message: "My name is Test, email test@gmail.com, phone 086775428176",
      priorTravellerMessages: ["option 2 please", "no extras thanks"],
      bookingMemory: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-26 13:30:00",
        guests: 2,
        ticketQuantities: [{ optionLabel: "Adult", quantity: 2 }],
        ticketOptions: [{ label: "Adult", unitPriceCents: 5000 }],
        extraQuantities: []
      },
      bookingWriteEnabled: true,
      bluePassStripeCheckoutEnabled: false,
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
          throw new Error("No PMS hold should be reserved when bluePassStripeCheckoutEnabled is false.");
        },
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(result.pmsCheckoutHold).toBeUndefined();
    expect(result.paymentHandoffUrl).toBeUndefined();
    expect(result.reply).toContain("they'll be in touch to sort out payment");
  });

  it("reserves a PMS hold and populates pmsCheckoutHold with the computed price when bluePassStripeCheckoutEnabled is true and pricing is resolvable", async () => {
    const result = await handleTravellerBookingMessage({
      message: "My name is Test, email test@gmail.com, phone 086775428176",
      priorTravellerMessages: ["option 2 please", "no extras thanks"],
      bookingMemory: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-26 13:30:00",
        guests: 2,
        ticketQuantities: [{ optionLabel: "Adult", quantity: 2 }],
        ticketOptions: [{ label: "Adult", unitPriceCents: 5000 }],
        extraQuantities: []
      },
      bookingWriteEnabled: true,
      bluePassStripeCheckoutEnabled: true,
      pmsAdapter: {
        provider: "REZDY",
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
        createBooking: async () => ({
          externalBookingId: "RZ-HOLD-1",
          provider: "REZDY",
          status: "PENDING"
        }),
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(result.action).toBe("BOOKING_PAYMENT_REQUIRED");
    expect(result.paymentHandoffUrl).toBeUndefined();
    expect(result.pmsCheckoutHold).toEqual({
      externalBookingId: "RZ-HOLD-1",
      pmsProvider: "REZDY",
      productExternalId: "boattime-whale-escape",
      productTitle: "Gold Coast Whale Escape",
      dateText: "2026-06-26 13:30:00",
      guests: 2,
      travellerName: "Test",
      travellerEmail: "test@gmail.com",
      travellerPhone: "086775428176",
      ticketQuantities: [{ optionLabel: "Adult", quantity: 2 }],
      extraQuantities: [],
      grossAmountCents: 10000,
      currency: "AUD"
    });
    expect(result.reply).toContain("I'm setting up your secure payment link now.");
  });

  it("falls back to the existing lead-saved reply when bluePassStripeCheckoutEnabled is true but the price cannot be resolved", async () => {
    const result = await handleTravellerBookingMessage({
      message: "My name is Test, email test@gmail.com, phone 086775428176",
      priorTravellerMessages: ["option 2 please", "no extras thanks"],
      bookingMemory: {
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-26 13:30:00",
        guests: 2,
        ticketQuantities: [{ optionLabel: "Adult", quantity: 2 }],
        ticketOptions: [{ label: "Senior", unitPriceCents: 5000 }],
        extraQuantities: []
      },
      bookingWriteEnabled: true,
      bluePassStripeCheckoutEnabled: true,
      pmsAdapter: {
        provider: "REZDY",
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
        createBooking: async () => ({
          externalBookingId: "RZ-HOLD-2",
          provider: "REZDY",
          status: "PENDING"
        }),
        cancelBooking: async () => ({ cancelled: false }),
        getBooking: async () => null
      }
    });

    expect(result.pmsCheckoutHold).toBeUndefined();
    expect(result.reply).toContain("I've put a hold on it with the operator (reference RZ-HOLD-2)");
  });

});

function fakeRouterClient(intent: string) {
  return {
    route: vi.fn().mockResolvedValue({ intent })
  } as unknown as GenericBookingRouterLlmClient & { route: ReturnType<typeof vi.fn> };
}

describe("handleTravellerBookingMessage with a generic booking router client", () => {
  it("escalates a novel question the regex cascade cannot classify and honors the router's reclassification", async () => {
    const routerClient = fakeRouterClient("HUMAN_HANDOFF");

    const result = await handleTravellerBookingMessage({
      message: "is this suitable for kids?",
      pmsAdapter: new MockPmsAdapter(),
      routerClient
    });

    expect(routerClient.route).toHaveBeenCalledTimes(1);
    expect(result.action).toBe("HUMAN_HANDOFF");
  });

  it("never calls the router when product, date, and guests are already fully known", async () => {
    const routerClient = fakeRouterClient("GENERAL_QUESTION");

    await handleTravellerBookingMessage({
      message: "Can you check Komodo Day Trip for 3 guests tomorrow?",
      pmsAdapter: new MockPmsAdapter(),
      routerClient
    });

    expect(routerClient.route).not.toHaveBeenCalled();
  });

  it("falls back to the regex result when the router throws", async () => {
    const routerClient: GenericBookingRouterLlmClient = {
      route: vi.fn().mockRejectedValue(new Error("network timeout"))
    };

    const result = await handleTravellerBookingMessage({
      message: "is this suitable for kids?",
      pmsAdapter: new MockPmsAdapter(),
      routerClient
    });

    expect(result.action).toBe("GENERAL_REPLY");
  });

  it("never trusts a hallucinated BOOKING_INQUIRY over an independent CHECK_AVAILABILITY regex match, keeping capture suppressed", async () => {
    const routerClient = fakeRouterClient("BOOKING_INQUIRY");

    // Guest count is deliberately left out so all 3 slots are NOT known - only then does
    // shouldEscalateGenericBookingRouterToLlm actually call the router for a CHECK_AVAILABILITY
    // regex match, letting this test exercise the hallucination guard through the real orchestrator
    // rather than only the isolated resolveFinalGenericBookingIntent unit test below.
    const result = await handleTravellerBookingMessage({
      message: "any availability for Komodo Day Trip tomorrow?",
      pmsAdapter: new MockPmsAdapter(),
      routerClient
    });

    expect(routerClient.route).toHaveBeenCalledTimes(1);
    expect(result.action).toBe("NEEDS_MORE_DETAILS");
    expect(result.reply).not.toContain("name");
    expect(result.reply).not.toContain("email");
  });

  it("regression: a router misreading a bare 'yes' as CHECK_AVAILABILITY does not stall the traveller forever, even once availability is genuinely unconfirmed", async () => {
    // Reproduces a real production regression: with product/date/guests already known and an
    // active capture in progress, a traveller replying with a bare "yes" (no "book"/"please"/etc.,
    // so the regex cascade itself resolves to GENERAL_QUESTION) used to correctly advance to
    // contact collection. Once the router could feed shouldHandleCapture, a router that guesses
    // CHECK_AVAILABILITY for this ambiguous "yes" silently re-triggered the availability check
    // instead - the traveller got stuck being told "availability confirmed, would you like to
    // proceed?" forever, since shouldHandleCapture used to consult the router's own guess.
    //
    // Updated for the AUTO_BOOKING/real-availability-evidence guard (see captureAppliesToKnownProduct
    // above): this bookingMemory carries no evidence that getAvailability was ever actually called,
    // so turn 1 now correctly reaches a real availability check first, rather than assuming it is
    // safe to ask for contact details - this is the exact real-money-risk fix, not a regression of
    // it. shouldHandleCapture itself is still regex-only, unaffected by the router's guess; what
    // changed is that a fresh availability check is the right thing to do here regardless. Turn 2
    // proves the original regression guard's real concern still holds: once availability HAS been
    // checked (turn 1's own bookingStatePatch persists that evidence), a second bare "yes" still
    // progresses forward to contact collection instead of looping on availability forever.
    const routerClient = fakeRouterClient("CHECK_AVAILABILITY");

    const turn1 = await handleTravellerBookingMessage({
      message: "yes",
      bookingMemory: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
        dateText: "tomorrow",
        guests: 3
      },
      pmsAdapter: new MockPmsAdapter(),
      routerClient
    });

    expect(turn1.action).toBe("AVAILABILITY_CHECKED");
    expect(turn1.bookingStatePatch?.bookingStatus).toBe("AVAILABILITY_CHECKED");

    const turn2 = await handleTravellerBookingMessage({
      message: "yes",
      bookingMemory: turn1.bookingStatePatch,
      pmsAdapter: new MockPmsAdapter(),
      routerClient
    });

    expect(turn2.action).not.toBe("AVAILABILITY_CHECKED");
    expect(turn2.action).toBe("BOOKING_DETAILS_REQUIRED");
  });

  it("regression: a stale 'options' keyword from an earlier turn does not loop a typo'd detail reply back to product selection", async () => {
    // Reproduces a second real production regression, same root cause as the test above (context
    // widening), different branch: once a product is already selected, a typo'd detail reply (e.g.
    // "22july for 2 poeple" - "poeple" fails guest extraction) falls through to GENERAL_QUESTION on
    // its own, triggering context-widening. bookingMemoryToContext re-embeds the selected product's
    // name, AND the word "options" survives from an much earlier "what options do you have?" message
    // still in priorTravellerMessages - together these misclassify the reply as
    // PRODUCT_RECOMMENDATION, which used to loop the traveller back to product info/selection
    // instead of asking for just the missing guest count. ("22july for 2 poeple" is now read as 2
    // guests via "for 2", so the typo'd count here has no "for" to fall back on.)
    const result = await handleTravellerBookingMessage({
      message: "22july 2 poeple",
      priorTravellerMessages: ["what options do you have?", "1"],
      now: new Date("2026-01-01T00:00:00Z"),
      bookingMemory: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
        dateText: null,
        guests: null
      },
      pmsAdapter: new MockPmsAdapter()
    });

    expect(result.action).not.toBe("PRODUCT_RECOMMENDATION");
    expect(result.action).not.toBe("PRODUCT_LINK");
    expect(result.action).toBe("NEEDS_MORE_DETAILS");
    expect(result.reply).toContain("Komodo Day Trip");
    expect(result.reply).toContain("Wednesday 22 July 2026");
    expect(result.reply).toContain("How many of you are going?");
  });

  it("reads \"for 2\" as the group size even when the word after it is misspelt", async () => {
    const result = await handleTravellerBookingMessage({
      message: "22july for 2 poeple",
      priorTravellerMessages: ["what options do you have?", "1"],
      now: new Date("2026-01-01T00:00:00Z"),
      bookingMemory: {
        productExternalId: "mock-komodo-day-trip",
        productTitle: "Komodo Day Trip",
        dateText: null,
        guests: null
      },
      pmsAdapter: new MockPmsAdapter()
    });

    expect(result.action).toBe("AVAILABILITY_CHECKED");
    expect(result.reply).toContain("Komodo Day Trip");
    expect(result.reply).not.toContain("How many of you are going?");
  });
});

describe("shouldEscalateGenericBookingRouterToLlm", () => {
  it("always escalates the regex cascade's own catch-all", () => {
    expect(
      shouldEscalateGenericBookingRouterToLlm({
        regexResult: {
          intent: "GENERAL_QUESTION",
          confidence: "HIGH",
          slots: { productHint: null, dateText: null, guests: null, budget: null },
          missingSlots: []
        }
      })
    ).toBe(true);
  });

  it("always escalates HUMAN_HANDOFF, since its regex still collides with bare guest-count phrasing", () => {
    expect(
      shouldEscalateGenericBookingRouterToLlm({
        regexResult: {
          intent: "HUMAN_HANDOFF",
          confidence: "HIGH",
          slots: { productHint: null, dateText: null, guests: null, budget: null },
          missingSlots: []
        }
      })
    ).toBe(true);
  });

  it("skips the LLM for a cleanly slotted CHECK_AVAILABILITY match", () => {
    expect(
      shouldEscalateGenericBookingRouterToLlm({
        regexResult: {
          intent: "CHECK_AVAILABILITY",
          confidence: "HIGH",
          slots: { productHint: "Komodo Day Trip", dateText: "tomorrow", guests: 3, budget: null },
          missingSlots: []
        }
      })
    ).toBe(false);
  });

  it("escalates a partially slotted CHECK_AVAILABILITY match", () => {
    expect(
      shouldEscalateGenericBookingRouterToLlm({
        regexResult: {
          intent: "CHECK_AVAILABILITY",
          confidence: "MEDIUM",
          slots: { productHint: "Komodo Day Trip", dateText: null, guests: null, budget: null },
          missingSlots: ["date", "guests"]
        }
      })
    ).toBe(true);
  });

  it("skips the LLM for a PRODUCT_RECOMMENDATION that already names a specific product", () => {
    expect(
      shouldEscalateGenericBookingRouterToLlm({
        regexResult: {
          intent: "PRODUCT_RECOMMENDATION",
          confidence: "HIGH",
          slots: { productHint: "Komodo Day Trip", dateText: null, guests: null, budget: null },
          missingSlots: []
        }
      })
    ).toBe(false);
  });

  it("escalates a PRODUCT_RECOMMENDATION with no named product", () => {
    expect(
      shouldEscalateGenericBookingRouterToLlm({
        regexResult: {
          intent: "PRODUCT_RECOMMENDATION",
          confidence: "HIGH",
          slots: { productHint: null, dateText: null, guests: null, budget: null },
          missingSlots: []
        }
      })
    ).toBe(true);
  });
});

describe("resolveFinalGenericBookingIntent", () => {
  it("returns the regex intent when there is no LLM decision", () => {
    expect(
      resolveFinalGenericBookingIntent({
        llmIntent: null,
        regexResult: {
          intent: "CHECK_AVAILABILITY",
          confidence: "HIGH",
          slots: { productHint: null, dateText: null, guests: null, budget: null },
          missingSlots: []
        }
      })
    ).toBe("CHECK_AVAILABILITY");
  });

  it("trusts the LLM's re-classification for non-BOOKING_INQUIRY intents", () => {
    expect(
      resolveFinalGenericBookingIntent({
        llmIntent: "HUMAN_HANDOFF",
        regexResult: {
          intent: "GENERAL_QUESTION",
          confidence: "HIGH",
          slots: { productHint: null, dateText: null, guests: null, budget: null },
          missingSlots: []
        }
      })
    ).toBe("HUMAN_HANDOFF");
  });

  it("rejects a hallucinated BOOKING_INQUIRY when the regex cascade disagrees", () => {
    expect(
      resolveFinalGenericBookingIntent({
        llmIntent: "BOOKING_INQUIRY",
        regexResult: {
          intent: "CHECK_AVAILABILITY",
          confidence: "HIGH",
          slots: { productHint: "Komodo Day Trip", dateText: "tomorrow", guests: 3, budget: null },
          missingSlots: []
        }
      })
    ).toBe("CHECK_AVAILABILITY");
  });

  it("trusts BOOKING_INQUIRY when the regex cascade independently agrees", () => {
    expect(
      resolveFinalGenericBookingIntent({
        llmIntent: "BOOKING_INQUIRY",
        regexResult: {
          intent: "BOOKING_INQUIRY",
          confidence: "HIGH",
          slots: { productHint: "Komodo Day Trip", dateText: null, guests: null, budget: null },
          missingSlots: ["date", "guests"]
        }
      })
    ).toBe("BOOKING_INQUIRY");
  });
});




describe("handing the payment to the operator's own Rezdy page", () => {
  const memory = {
    productExternalId: "PGG8QT",
    productTitle: "Gold Coast Whale Escape",
    dateText: "2026-06-26 13:30:00",
    guests: 2,
    ticketQuantities: [{ optionLabel: "Adult", quantity: 2 }],
    ticketOptions: [{ label: "Adult", unitPriceCents: 5000 }],
    extraQuantities: [],
    timeOptions: [{ label: "1:30 PM", startTimeLocal: "2026-06-26 13:30:00", remaining: 8, checkoutItemKey: "item-431872-480938442" }]
  };

  function pms(overrides: { productUrl?: string | null } = {}) {
    return {
      provider: "REZDY" as const,
      listProducts: async () => [
        {
          externalProductId: "PGG8QT",
          title: "Gold Coast Whale Escape",
          description: "Whale watching cruise",
          bookingMode: "AUTO_BOOKING" as const,
          productUrl: overrides.productUrl === undefined ? "https://boattimeyachtcharters.rezdy.com/services/431872" : overrides.productUrl
        }
      ],
      getAvailability: async () => {
        throw new Error("Availability should not be rechecked.");
      },
      createBooking: async () => {
        throw new Error("Nothing may be reserved or charged through BluePass when the payment is handed to Rezdy.");
      },
      cancelBooking: async () => ({ cancelled: false }),
      getBooking: async () => null
    };
  }

  const ask = (extra: Partial<Parameters<typeof handleTravellerBookingMessage>[0]>) =>
    handleTravellerBookingMessage({
      message: "My name is Test, email test@gmail.com, phone 086775428176",
      priorTravellerMessages: ["option 2 please", "no extras thanks"],
      bookingMemory: memory,
      bookingWriteEnabled: true,
      bluePassStripeCheckoutEnabled: true, // still carried by the tenant: the hand-off must win
      tenantContext: { tenantName: "Boattime Yacht Charters", brandVoice: null, pmsProvider: "REZDY", responseGuardrails: [], productTitles: [], knowledgeSummary: "" },
      pmsAdapter: pms(),
      ...extra
    } as Parameters<typeof handleTravellerBookingMessage>[0]);

  it("sends the traveller to the Rezdy page for the chosen time, with no hold and no BluePass checkout", async () => {
    const result = await ask({
      rezdyCheckoutHandoff: { buildUrl: () => "https://boattimeyachtcharters.rezdy.com/services/431872?itemKey=item-431872-480938442&useTransparentSessions=1" }
    });

    expect(result.action).toBe("BOOKING_PAYMENT_REQUIRED");
    expect(result.rezdyHandoff).toBe(true);
    expect(result.paymentHandoffUrl).toContain("itemKey=item-431872-480938442");
    expect(result.pmsCheckoutHold).toBeUndefined();
    expect(result.inquiryDraft).toBeUndefined();
    expect(result.reply).toContain(result.paymentHandoffUrl as string);
    expect(result.reply).toContain("Boattime Yacht Charters");
    expect(result.reply).not.toMatch(/stripe|bluepass payment|payment link below/i);
  });

  it("passes the chosen time and product to the link builder", async () => {
    const calls: unknown[] = [];
    await ask({
      rezdyCheckoutHandoff: {
        buildUrl: (args) => {
          calls.push(args);
          return "https://boattimeyachtcharters.rezdy.com/services/431872";
        }
      }
    });
    expect(calls).toEqual([
      {
        productExternalId: "PGG8QT",
        productUrl: "https://boattimeyachtcharters.rezdy.com/services/431872",
        dateText: "2026-06-26 13:30:00",
        timeOptions: memory.timeOptions
      }
    ]);
  });

  it("falls back to the product page when no time-specific link can be built", async () => {
    const result = await ask({ rezdyCheckoutHandoff: { buildUrl: () => null } });
    expect(result.paymentHandoffUrl).toBe("https://boattimeyachtcharters.rezdy.com/services/431872");
    expect(result.rezdyHandoff).toBe(true);
  });

  it("tells the traveller the operator will be in touch when there is no page to send them to", async () => {
    const result = await ask({
      bluePassStripeCheckoutEnabled: false,
      pmsAdapter: pms({ productUrl: null }),
      rezdyCheckoutHandoff: { buildUrl: () => null }
    });
    expect(result.rezdyHandoff).toBeUndefined();
    expect(result.paymentHandoffUrl).toBeUndefined();
    expect(result.reply).toContain("they'll be in touch to sort out payment");
  });
});
