import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Deliberately standalone and narrow, like seed-bluepass-au-tenant.mjs: this only ever writes
// TenantConfig.operatorKnowledgePack for the single "bluepass-au" tenant, so it cannot touch that
// tenant's other config (bookingMode, publicProductCatalog, etc.) or any other tenant's row.
//
// Why this exists: bluepass-app's web widget routes Australia-flavored conversations to this
// tenant's generic PMS/knowledge-pack engine, not to the BluePass marketplace engine - so this
// tenant never sees the marketplace engine's operator/partner commission copy (triage.ts) at all.
// Real commission questions on that path were getting an LLM-hallucinated "isn't publicly
// disclosed" answer. matchKnowledgeEntry (src/core/knowledge/knowledge-matcher.ts) is already wired
// into this tenant's engine (booking-orchestrator.ts) - this just gives it the real answer to find.
const knowledgePack = {
  version: 1,
  entries: [
    {
      id: "commission-structure",
      question: "What commission does BluePass take?",
      answer:
        "BluePass takes a capped 18% total: 5% funds reef conservation, 5% goes to partners who refer guests, 3% covers payment processing, and 5% is the platform fee. Operators keep 82% of their own rate, and guests never pay more than booking direct.",
      keywords: ["commission", "18%", "82%", "take rate", "platform fee", "fee structure", "cut"],
      category: "faq",
      isPolicy: true
    }
  ],
  escalation: { fallbackToHuman: true, handoffMessage: null, handoffKeywords: [] },
  interview: { completedFieldIds: [], lastQuestionId: null, status: "not_started" }
};

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: "bluepass-au" } });
  if (!tenant) {
    throw new Error('Tenant "bluepass-au" not found - run seed-bluepass-au-tenant.mjs first.');
  }

  const record = await prisma.tenantConfig.update({
    where: { tenantId: tenant.id },
    data: { operatorKnowledgePack: knowledgePack }
  });

  console.log(`Updated operatorKnowledgePack for tenant ${tenant.slug} (${record.id}): ${knowledgePack.entries.length} entr${knowledgePack.entries.length === 1 ? "y" : "ies"}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
