import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { listBluePassLedgerEntriesForTenantSlug } from "@/server/bluepass/bluepass-inquiry-repository";

vi.mock("@/server/bluepass/bluepass-inquiry-repository", () => ({
  listBluePassLedgerEntriesForTenantSlug: vi.fn()
}));

const listBluePassLedgerEntriesForTenantSlugMock = vi.mocked(listBluePassLedgerEntriesForTenantSlug);

describe("GET /api/admin/[tenantSlug]/bluepass-ledger", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.KAI_ADMIN_TOKEN;
  });

  it("requires the Kai admin token", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";

    const response = await GET(new Request("http://localhost/api/admin/bluepass/bluepass-ledger"), {
      params: Promise.resolve({ tenantSlug: "bluepass" })
    });

    expect(response.status).toBe(401);
    expect(listBluePassLedgerEntriesForTenantSlugMock).not.toHaveBeenCalled();
  });

  it("defaults to FINALIZED entries and forwards the take parameter", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";
    listBluePassLedgerEntriesForTenantSlugMock.mockResolvedValueOnce([]);

    const response = await GET(
      new Request("http://localhost/api/admin/bluepass/bluepass-ledger?take=25", {
        headers: { authorization: "Bearer admin_secret" }
      }),
      { params: Promise.resolve({ tenantSlug: "bluepass" }) }
    );

    expect(response.status).toBe(200);
    expect(listBluePassLedgerEntriesForTenantSlugMock).toHaveBeenCalledWith({
      tenantSlug: "bluepass",
      status: undefined,
      take: 25
    });
  });

  it("forwards an explicit status filter", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";
    listBluePassLedgerEntriesForTenantSlugMock.mockResolvedValueOnce([]);

    await GET(
      new Request("http://localhost/api/admin/bluepass/bluepass-ledger?status=VOIDED", {
        headers: { authorization: "Bearer admin_secret" }
      }),
      { params: Promise.resolve({ tenantSlug: "bluepass" }) }
    );

    expect(listBluePassLedgerEntriesForTenantSlugMock).toHaveBeenCalledWith({
      tenantSlug: "bluepass",
      status: "VOIDED",
      take: 100
    });
  });
});
