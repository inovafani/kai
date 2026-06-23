import { describe, expect, it, vi } from "vitest";
import { InseanqPmsAdapter } from "./inseanq-pms-adapter";
import { RezdyPmsAdapter } from "./rezdy-pms-adapter";

describe("real PMS adapter shells", () => {
  it("exposes provider identity for Rezdy", async () => {
    const adapter = new RezdyPmsAdapter();

    expect(adapter.provider).toBe("REZDY");
    await expect(adapter.listProducts()).rejects.toThrow("REZDY PMS adapter requires baseUrl, apiKey, and productListPath before live calls.");
  });

  it("exposes provider identity for Inseanq", async () => {
    const adapter = new InseanqPmsAdapter();

    expect(adapter.provider).toBe("INSEANQ");
    await expect(
      adapter.getAvailability({ productId: "inseanq-product", date: "tomorrow", guests: 2 })
    ).rejects.toThrow("INSEANQ PMS adapter requires baseUrl, apiKey, and availabilityPath before live calls.");
  });

  it("fails closed with actionable setup requirements when Rezdy credentials are missing", async () => {
    const adapter = new RezdyPmsAdapter();

    await expect(adapter.listProducts()).rejects.toThrow(
      "REZDY PMS adapter requires baseUrl, apiKey, and productListPath before live calls."
    );
  });

  it("includes PMS error response details when a live request is rejected", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({ error: "Invalid price option Adult" }), { status: 406 });
    });
    const adapter = new RezdyPmsAdapter({
      baseUrl: "https://rezdy.example.test/v1",
      apiKey: "rezdy-secret",
      productListPath: "/products",
      fetcher
    });

    await expect(adapter.listProducts()).rejects.toThrow(
      'REZDY PMS API request failed with status 406: {"error":"Invalid price option Adult"}'
    );
  });

  it("maps Rezdy product responses into Kai products when credentials and mapping are configured", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          products: [
            {
              productCode: "RZ-001",
              name: "Sunset Cruise",
              description: "Evening cruise",
              bookingMode: "AUTO_BOOKING"
            }
          ]
        }),
        { status: 200 }
      );
    });
    const adapter = new RezdyPmsAdapter({
      baseUrl: "https://rezdy.example.test/api",
      apiKey: "rezdy-secret",
      productListPath: "/products",
      fetcher
    });

    await expect(adapter.listProducts()).resolves.toEqual([
      {
        externalProductId: "RZ-001",
        title: "Sunset Cruise",
        description: "Evening cruise",
        bookingMode: "AUTO_BOOKING"
      }
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://rezdy.example.test/api/products?apiKey=rezdy-secret",
      expect.objectContaining({
        method: "GET",
        headers: expect.not.objectContaining({ Authorization: expect.any(String) }),
        signal: expect.any(AbortSignal)
      })
    );
  });

  it("checks Rezdy availability with product code and local date query parameters", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          sessions: [
            {
              productCode: "PGG8QT",
              startTimeLocal: "2026-06-22 09:00:00",
              seatsAvailable: 12,
              priceOptions: [{ label: "Adult", price: 99 }]
            }
          ]
        }),
        { status: 200 }
      );
    });
    const adapter = new RezdyPmsAdapter({
      baseUrl: "https://rezdy.example.test/v1",
      apiKey: "rezdy-secret",
      productListPath: "/products",
      availabilityPath: "/availability",
      fetcher
    });

    await expect(adapter.getAvailability({ productId: "PGG8QT", date: "2026-06-22", guests: 2 })).resolves.toEqual({
      productId: "PGG8QT",
      date: "2026-06-22 09:00:00",
      available: true,
      remaining: 12,
      currency: "AUD",
      unitPriceCents: 9900,
      timeOptions: [{ label: "9:00 AM", startTimeLocal: "2026-06-22 09:00:00", remaining: 12 }],
      ticketOptions: [{ label: "Adult", unitPriceCents: 9900 }]
    });

    const [url, requestInit] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("https://rezdy.example.test/v1/availability?");
    expect(url).toContain("apiKey=rezdy-secret");
    expect(url).toContain("productCode=PGG8QT");
    expect(url).toContain("startTimeLocal=2026-06-22+00%3A00%3A00");
    expect(url).toContain("endTimeLocal=2026-06-23+00%3A00%3A00");
    expect(url).toContain("minAvailability=2");
    expect(requestInit).toEqual(expect.objectContaining({ method: "GET", body: undefined }));
  });

  it("maps Rezdy optional extras from availability sessions", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          sessions: [
            {
              productCode: "LWWVE",
              startTimeLocal: "2026-06-27 12:00:00",
              seatsAvailable: 82,
              priceOptions: [{ label: '"2 people for $149.00', price: 149 }],
              extras: [
                { name: "Corona Bucket", price: 30 },
                { label: "Sparkling for 2", advertisedPrice: 40 },
                { title: "Cheese Platter for 2", amount: 10 }
              ]
            }
          ]
        }),
        { status: 200 }
      );
    });
    const adapter = new RezdyPmsAdapter({
      baseUrl: "https://rezdy.example.test/v1",
      apiKey: "rezdy-secret",
      productListPath: "/products",
      availabilityPath: "/availability",
      fetcher
    });

    await expect(adapter.getAvailability({ productId: "LWWVE", date: "2026-06-27", guests: 2 })).resolves.toMatchObject({
      extraOptions: [
        { label: "Corona Bucket", unitPriceCents: 3000 },
        { label: "Sparkling for 2", unitPriceCents: 4000 },
        { label: "Cheese Platter for 2", unitPriceCents: 1000 }
      ]
    });
  });

  it("returns all Rezdy available time options for the requested date", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          sessions: [
            {
              productCode: "PGG8QT",
              startTimeLocal: "2026-06-27 09:00:00",
              seatsAvailable: 77,
              priceOptions: [{ label: "Adult", price: 79 }]
            },
            {
              productCode: "PGG8QT",
              startTimeLocal: "2026-06-27 12:00:00",
              seatsAvailable: 79,
              priceOptions: [{ label: "Adult", price: 79 }]
            }
          ]
        }),
        { status: 200 }
      );
    });
    const adapter = new RezdyPmsAdapter({
      baseUrl: "https://rezdy.example.test/v1",
      apiKey: "rezdy-secret",
      productListPath: "/products",
      availabilityPath: "/availability",
      fetcher
    });

    await expect(adapter.getAvailability({ productId: "PGG8QT", date: "2026-06-27", guests: 2 })).resolves.toMatchObject({
      productId: "PGG8QT",
      date: "2026-06-27 09:00:00",
      available: true,
      remaining: 77,
      timeOptions: [
        { label: "9:00 AM", startTimeLocal: "2026-06-27 09:00:00", remaining: 77 },
        { label: "12:00 PM", startTimeLocal: "2026-06-27 12:00:00", remaining: 79 }
      ]
    });
  });

  it("keeps Rezdy checkout session identifiers on time options when available", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          sessions: [
            {
              id: "480938442",
              productCode: "LWWVE",
              startTimeLocal: "2026-06-25 12:00:00",
              seatsAvailable: 82,
              priceOptions: [{ label: '"2 people for $149.00', price: 149 }]
            },
            {
              itemKey: "item-431872-480938443",
              productCode: "LWWVE",
              startTimeLocal: "2026-06-25 15:00:00",
              seatsAvailable: 82,
              priceOptions: [{ label: '"2 people for $149.00', price: 149 }]
            }
          ]
        }),
        { status: 200 }
      );
    });
    const adapter = new RezdyPmsAdapter({
      baseUrl: "https://rezdy.example.test/v1",
      apiKey: "rezdy-secret",
      productListPath: "/products",
      availabilityPath: "/availability",
      fetcher
    });

    await expect(adapter.getAvailability({ productId: "LWWVE", date: "2026-06-25", guests: 2 })).resolves.toMatchObject({
      timeOptions: [
        {
          label: "12:00 PM",
          startTimeLocal: "2026-06-25 12:00:00",
          remaining: 82,
          checkoutSessionId: "480938442"
        },
        {
          label: "3:00 PM",
          startTimeLocal: "2026-06-25 15:00:00",
          remaining: 82,
          checkoutItemKey: "item-431872-480938443"
        }
      ]
    });
  });

  it("creates a Rezdy booking request with product, session, quantity, and traveller contact", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          order: {
            orderNumber: "RZ-12345",
            status: "CONFIRMED"
          }
        }),
        { status: 200 }
      );
    });
    const adapter = new RezdyPmsAdapter({
      baseUrl: "https://rezdy.example.test/v1",
      apiKey: "rezdy-secret",
      productListPath: "/products",
      availabilityPath: "/availability",
      bookingPath: "/bookings",
      fetcher
    });

    await expect(
      adapter.createBooking({
        productId: "PGG8QT",
        date: "2026-06-23 09:00:00",
        guests: 2,
        travellerName: "Maya Chen",
        travellerEmail: "maya@example.com",
        travellerPhone: "+61 400 111 222"
      })
    ).resolves.toEqual({
      externalBookingId: "RZ-12345",
      provider: "REZDY",
      status: "CONFIRMED"
    });

    const [url, requestInit] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://rezdy.example.test/v1/bookings?apiKey=rezdy-secret");
    expect(requestInit.method).toBe("POST");
    expect(JSON.parse(requestInit.body as string)).toEqual({
      customer: {
        firstName: "Maya",
        lastName: "Chen",
        email: "maya@example.com",
        phone: "+61 400 111 222"
      },
      items: [
        {
          productCode: "PGG8QT",
          startTimeLocal: "2026-06-23 09:00:00",
          quantities: [
            {
              optionLabel: "Adult",
              value: 2
            }
          ]
        }
      ],
      resellerComments: "Created by Kai after traveller confirmation."
    });
  });

  it("resolves a natural Rezdy booking date into a real availability session before booking", async () => {
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes("/availability?")) {
        return new Response(
          JSON.stringify({
            sessions: [
              {
                productCode: "PGG8QT",
                startTimeLocal: "2026-06-23 09:00:00",
                seatsAvailable: 9,
                priceOptions: [{ label: "Adult", price: 249 }]
              }
            ]
          }),
          { status: 200 }
        );
      }

      return new Response(
        JSON.stringify({
          order: {
            orderNumber: "RZ-67890",
            status: "CONFIRMED"
          }
        }),
        { status: 200 }
      );
    });
    const adapter = new RezdyPmsAdapter({
      baseUrl: "https://rezdy.example.test/v1",
      apiKey: "rezdy-secret",
      productListPath: "/products",
      availabilityPath: "/availability",
      bookingPath: "/bookings",
      fetcher
    });

    await expect(
      adapter.createBooking({
        productId: "PGG8QT",
        date: "tomorrow",
        guests: 2,
        travellerName: "Kala Wijaya",
        travellerEmail: "kala@example.com",
        travellerPhone: "086554329278"
      })
    ).resolves.toEqual({
      externalBookingId: "RZ-67890",
      provider: "REZDY",
      status: "CONFIRMED"
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    const [availabilityUrl] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const [bookingUrl, bookingRequestInit] = fetcher.mock.calls[1] as unknown as [string, RequestInit];
    expect(availabilityUrl).toContain("https://rezdy.example.test/v1/availability?");
    expect(bookingUrl).toBe("https://rezdy.example.test/v1/bookings?apiKey=rezdy-secret");
    expect(JSON.parse(bookingRequestInit.body as string).items[0].startTimeLocal).toBe("2026-06-23 09:00:00");
  });

  it("uses the matching Rezdy adult price option when booking a product with package prices", async () => {
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes("/availability?")) {
        return new Response(
          JSON.stringify({
            sessions: [
              {
                productCode: "PGG8QT",
                startTimeLocal: "2026-06-25 09:00:00",
                seatsAvailable: 86,
                priceOptions: [
                  { label: "Family (2A +2C) 3-13", price: 249 },
                  { label: '"2 people for $149.00', price: 149 },
                  { label: "Child (3-13)", price: 79 },
                  { label: "Infant (under 3)", price: 0 },
                  { label: "Adult (Winter Special)", price: 99 }
                ]
              }
            ]
          }),
          { status: 200 }
        );
      }

      return new Response(
        JSON.stringify({
          order: {
            orderNumber: "RZ-ADULT-OPTION",
            status: "CONFIRMED"
          }
        }),
        { status: 200 }
      );
    });
    const adapter = new RezdyPmsAdapter({
      baseUrl: "https://rezdy.example.test/v1",
      apiKey: "rezdy-secret",
      productListPath: "/products",
      availabilityPath: "/availability",
      bookingPath: "/bookings",
      fetcher
    });

    await expect(
      adapter.getAvailability({ productId: "PGG8QT", date: "2026-06-25", guests: 3 })
    ).resolves.toEqual({
      productId: "PGG8QT",
      date: "2026-06-25 09:00:00",
      available: true,
      remaining: 86,
      currency: "AUD",
      unitPriceCents: 9900,
      timeOptions: [{ label: "9:00 AM", startTimeLocal: "2026-06-25 09:00:00", remaining: 86 }],
      ticketOptions: [
        { label: "Family (2A +2C) 3-13", unitPriceCents: 24900 },
        { label: '"2 people for $149.00', unitPriceCents: 14900 },
        { label: "Child (3-13)", unitPriceCents: 7900 },
        { label: "Infant (under 3)", unitPriceCents: 0 },
        { label: "Adult (Winter Special)", unitPriceCents: 9900 }
      ]
    });

    await expect(
      adapter.createBooking({
        productId: "PGG8QT",
        date: "2026-06-25",
        guests: 3,
        travellerName: "Jafar",
        travellerEmail: "jafar@example.com",
        travellerPhone: "0658786534230"
      })
    ).resolves.toEqual({
      externalBookingId: "RZ-ADULT-OPTION",
      provider: "REZDY",
      status: "CONFIRMED"
    });

    const [, bookingRequestInit] = fetcher.mock.calls[2] as unknown as [string, RequestInit];
    expect(JSON.parse(bookingRequestInit.body as string).items[0]).toEqual({
      productCode: "PGG8QT",
      startTimeLocal: "2026-06-25 09:00:00",
      quantities: [
        {
          optionLabel: "Adult (Winter Special)",
          value: 3
        }
      ]
    });
  });

  it("sends selected Rezdy ticket quantities instead of collapsing every guest into adult", async () => {
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes("/availability?")) {
        return new Response(
          JSON.stringify({
            sessions: [
              {
                productCode: "PGG8QT",
                startTimeLocal: "2026-06-25 09:00:00",
                seatsAvailable: 86,
                priceOptions: [
                  { label: "Child (3-13)", price: 59 },
                  { label: "Adult (Winter Special)", price: 79 }
                ]
              }
            ]
          }),
          { status: 200 }
        );
      }

      return new Response(
        JSON.stringify({
          order: {
            orderNumber: "RZ-TICKETS",
            status: "CONFIRMED"
          }
        }),
        { status: 200 }
      );
    });
    const adapter = new RezdyPmsAdapter({
      baseUrl: "https://rezdy.example.test/v1",
      apiKey: "rezdy-secret",
      productListPath: "/products",
      availabilityPath: "/availability",
      bookingPath: "/bookings",
      fetcher
    });

    await adapter.createBooking({
      productId: "PGG8QT",
      date: "2026-06-25",
      guests: 3,
      travellerName: "Jafar",
      travellerEmail: "jafar@example.com",
      travellerPhone: "0658786534230",
      ticketQuantities: [
        { optionLabel: "Adult (Winter Special)", quantity: 2 },
        { optionLabel: "Child (3-13)", quantity: 1 }
      ]
    });

    const [, bookingRequestInit] = fetcher.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(bookingRequestInit.body as string).items[0].quantities).toEqual([
      { optionLabel: "Adult (Winter Special)", value: 2 },
      { optionLabel: "Child (3-13)", value: 1 }
    ]);
  });

  it("sends a RezdyPay Stripe card token instead of raw card details when confirming paid bookings", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          order: {
            orderNumber: "RZ-PAID",
            status: "CONFIRMED"
          }
        }),
        { status: 200 }
      );
    });
    const adapter = new RezdyPmsAdapter({
      baseUrl: "https://rezdy.example.test/v1",
      apiKey: "rezdy-secret",
      productListPath: "/products",
      availabilityPath: "/availability",
      bookingPath: "/bookings",
      fetcher
    });

    await adapter.createBooking({
      productId: "LWWVE",
      date: "2026-06-26 13:30:00",
      guests: 1,
      travellerName: "Test Four",
      travellerEmail: "test4@example.com",
      travellerPhone: "087665234098",
      ticketQuantities: [{ optionLabel: "Adult (Winter Special)", quantity: 1 }],
      paymentCardToken: "tok_rezdy_123"
    });

    const [, bookingRequestInit] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(bookingRequestInit.body as string)).toMatchObject({
      creditCard: {
        cardToken: "tok_rezdy_123"
      }
    });
    expect(JSON.stringify(JSON.parse(bookingRequestInit.body as string))).not.toContain("cardNumber");
  });

  it("maps Inseanq availability responses into Kai availability when configured", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          productId: "IN-001",
          date: "2026-06-22",
          available: true,
          remaining: 4,
          currency: "IDR",
          unitPriceCents: 25000000
        }),
        { status: 200 }
      );
    });
    const adapter = new InseanqPmsAdapter({
      baseUrl: "https://inseanq.example.test",
      apiKey: "inseanq-secret",
      productListPath: "/products",
      availabilityPath: "/availability",
      fetcher
    });

    await expect(
      adapter.getAvailability({ productId: "IN-001", date: "2026-06-22", guests: 2 })
    ).resolves.toEqual({
      productId: "IN-001",
      date: "2026-06-22",
      available: true,
      remaining: 4,
      currency: "IDR",
      unitPriceCents: 25000000
    });
    const [, requestInit] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(requestInit.body as string)).toEqual({ productId: "IN-001", date: "2026-06-22", guests: 2 });
  });
});
