import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./route";

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/admin/native-tenants", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });

describe("POST /api/admin/native-tenants", () => {
  afterEach(() => {
    delete process.env.KAI_ADMIN_TOKEN;
  });

  it("requires the Kai admin token", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";
    expect((await POST(post({ externalOperatorId: "op_1", name: "Blue Water" }))).status).toBe(401);
    expect((await POST(post({ externalOperatorId: "op_1", name: "Blue Water" }, { authorization: "Bearer wrong" }))).status).toBe(401);
  });

  it("refuses everyone when no admin token is configured", async () => {
    expect((await POST(post({ externalOperatorId: "op_1", name: "Blue Water" }, { authorization: "Bearer anything" }))).status).toBe(401);
  });

  it("rejects a request without an operator id or a name", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";
    const headers = { authorization: "Bearer admin_secret" };
    expect((await POST(post({ name: "Blue Water" }, headers))).status).toBe(400);
    expect((await POST(post({ externalOperatorId: "op_1" }, headers))).status).toBe(400);
    expect((await POST(post({ externalOperatorId: "op_1", name: "x" }, headers))).status).toBe(400);
  });
});
