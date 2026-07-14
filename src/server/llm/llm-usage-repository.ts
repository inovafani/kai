import { prisma } from "@/lib/prisma";

export interface LlmUsagePeriodTotals {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface LlmUsageGroupTotals extends LlmUsagePeriodTotals {
  key: string;
}

export interface LlmUsageRecentEvent {
  id: string;
  callType: string;
  provider: string;
  model: string;
  tenantName: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
  createdAt: Date;
}

export interface LlmUsageSummary {
  today: LlmUsagePeriodTotals;
  last7Days: LlmUsagePeriodTotals;
  last30Days: LlmUsagePeriodTotals;
  allTime: LlmUsagePeriodTotals;
  byCallType: LlmUsageGroupTotals[];
  byTenant: LlmUsageGroupTotals[];
  recentEvents: LlmUsageRecentEvent[];
}

function toPeriodTotals(input: {
  _count: number;
  _sum: {
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    estimatedCostUsd: number | null;
  };
}): LlmUsagePeriodTotals {
  return {
    calls: input._count,
    promptTokens: input._sum.promptTokens ?? 0,
    completionTokens: input._sum.completionTokens ?? 0,
    totalTokens: input._sum.totalTokens ?? 0,
    estimatedCostUsd: input._sum.estimatedCostUsd ?? 0
  };
}

async function aggregateSince(since: Date | null): Promise<LlmUsagePeriodTotals> {
  const where = since ? { createdAt: { gte: since } } : {};
  const result = await prisma.llmUsageEvent.aggregate({
    where,
    _count: true,
    _sum: {
      promptTokens: true,
      completionTokens: true,
      totalTokens: true,
      estimatedCostUsd: true
    }
  });

  return toPeriodTotals(result);
}

export async function getBluePassLlmUsageSummary(): Promise<LlmUsageSummary> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOf7Days = new Date(startOfToday.getTime() - 7 * 24 * 60 * 60 * 1000);
  const startOf30Days = new Date(startOfToday.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [today, last7Days, last30Days, allTime, byCallTypeRaw, byTenantRaw, recentEvents] = await Promise.all([
    aggregateSince(startOfToday),
    aggregateSince(startOf7Days),
    aggregateSince(startOf30Days),
    aggregateSince(null),
    prisma.llmUsageEvent.groupBy({
      by: ["callType"],
      _count: true,
      _sum: { promptTokens: true, completionTokens: true, totalTokens: true, estimatedCostUsd: true }
    }),
    prisma.llmUsageEvent.groupBy({
      by: ["tenantName"],
      _count: true,
      _sum: { promptTokens: true, completionTokens: true, totalTokens: true, estimatedCostUsd: true }
    }),
    prisma.llmUsageEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 50
    })
  ]);

  return {
    today,
    last7Days,
    last30Days,
    allTime,
    byCallType: byCallTypeRaw
      .map((row) => ({ key: row.callType, ...toPeriodTotals(row) }))
      .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd),
    byTenant: byTenantRaw
      .map((row) => ({ key: row.tenantName ?? "unknown", ...toPeriodTotals(row) }))
      .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd),
    recentEvents
  };
}
