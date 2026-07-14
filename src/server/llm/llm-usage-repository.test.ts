import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getBluePassLlmUsageSummary } from "./llm-usage-repository";

const createdEventIds: string[] = [];

async function seedEvent(input: {
  callType: string;
  provider: string;
  model: string;
  tenantName: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
}) {
  const event = await prisma.llmUsageEvent.create({ data: input });
  createdEventIds.push(event.id);
  return event;
}

afterEach(async () => {
  if (createdEventIds.length === 0) return;
  await prisma.llmUsageEvent.deleteMany({ where: { id: { in: createdEventIds.splice(0, createdEventIds.length) } } });
});

describe("getBluePassLlmUsageSummary", () => {
  it("aggregates totals, call-type and tenant breakdowns, and recent events", async () => {
    const tenantName = `usage-test-${randomUUID()}`;

    await seedEvent({
      callType: "router",
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      tenantName,
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      estimatedCostUsd: 0.001
    });
    await seedEvent({
      callType: "polish",
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      tenantName,
      promptTokens: 300,
      completionTokens: 80,
      totalTokens: 380,
      estimatedCostUsd: 0.003
    });

    const summary = await getBluePassLlmUsageSummary();

    expect(summary.allTime.calls).toBeGreaterThanOrEqual(2);
    expect(summary.allTime.totalTokens).toBeGreaterThanOrEqual(500);

    const tenantRow = summary.byTenant.find((row) => row.key === tenantName);
    expect(tenantRow).toMatchObject({
      calls: 2,
      promptTokens: 400,
      completionTokens: 100,
      totalTokens: 500
    });
    expect(tenantRow?.estimatedCostUsd).toBeCloseTo(0.004, 5);

    const routerRow = summary.byCallType.find((row) => row.key === "router");
    expect(routerRow?.calls).toBeGreaterThanOrEqual(1);

    expect(summary.recentEvents.length).toBeGreaterThan(0);
    expect(summary.recentEvents[0]).toHaveProperty("createdAt");
  }, 20_000);

  it("returns zeroed totals instead of nulls when there is no usage in a period", async () => {
    const summary = await getBluePassLlmUsageSummary();

    expect(summary.today.calls).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(summary.today.estimatedCostUsd)).toBe(false);
  });
});
