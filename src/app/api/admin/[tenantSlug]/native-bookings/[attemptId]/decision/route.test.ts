import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./route";

const call = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request("http://localhost/api/admin/some-operator/native-bookings/attempt_1/decision", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body)
    }),
    { params: Promise.resolve({ tenantSlug: "some-operator", attemptId: "attempt_1" }) }
  );

describe("POST /api/admin/[tenantSlug]/native-bookings/[attemptId]/decision", () => {
  afterEach(() => {
    delete process.env.KAI_ADMIN_TOKEN;
  });

  it("requires the Kai admin token", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";
    expect((await call({ decision: "ACCEPT" })).status).toBe(401);
    expect((await call({ decision: "ACCEPT" }, { authorization: "Bearer wrong" })).status).toBe(401);
  });

  it("refuses everyone when no admin token is configured", async () => {
    expect((await call({ decision: "ACCEPT" }, { authorization: "Bearer anything" })).status).toBe(401);
  });

  it("only takes ACCEPT or DECLINE, so a timeout can never be forged through the API", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";
    const headers = { authorization: "Bearer admin_secret" };
    expect((await call({ decision: "EXPIRE" }, headers)).status).toBe(400);
    expect((await call({ decision: "maybe" }, headers)).status).toBe(400);
    expect((await call({}, headers)).status).toBe(400);
  });
});
