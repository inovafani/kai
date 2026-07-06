/**
 * Terminal chat harness for the BluePass marketplace flow — talk to Kai
 * without a database or the widget. Persona triage, operator/partner
 * onboarding trees, and all concierge replies work fully; only inquiry
 * submission needs the real database (the harness warns instead of
 * crashing).
 *
 *   npx tsx scripts/kai-chat.ts             interactive chat
 *   npx tsx scripts/kai-chat.ts --demo      scripted three-persona walkthrough
 */

// Dummy datasource values so the Prisma client constructor is satisfied —
// the paths this harness exercises never run a query.
process.env.DATABASE_URL ??= "postgresql://kai:kai@localhost:5432/kai";
process.env.DIRECT_URL ??= process.env.DATABASE_URL;

import { createInterface } from "node:readline/promises";
import { handleBluePassMarketplaceMessage } from "../src/server/bluepass/bluepass-message-flow";

const tenantId = "tenant_local_harness";
const conversationId = `conversation_${Date.now()}`;
const priorTravellerMessages: string[] = [];

async function send(content: string) {
  try {
    const result = await handleBluePassMarketplaceMessage({
      tenantId,
      conversationId,
      content,
      priorTravellerMessages: [...priorTravellerMessages]
    });
    priorTravellerMessages.push(content);

    console.log(`\nKai: ${result.assistantContent}`);
    for (const match of result.bluepassMatches) {
      console.log(`  [card] ${match.name} — ${match.tier}, ${match.region}, ${match.priceSignal}`);
    }
    console.log("");
  } catch (error) {
    priorTravellerMessages.push(content);
    console.log(
      `\nKai: (this step needs the database — inquiry creation is not available in the harness)\n  ${
        error instanceof Error ? error.message.split("\n")[0] : error
      }\n`
    );
  }
}

const DEMO: Array<{ label: string; messages: string[] }> = [
  {
    label: "Ambiguous first touch",
    messages: ["hello"]
  },
  {
    label: "Operator — silent inference, then down the tree",
    messages: [
      "Hi, I run a dive resort in Raja Ampat and want to list my boats",
      "How does the 18% break down?",
      "How does vetting work?",
      "We're in Indonesia — send me the claim link"
    ]
  },
  {
    label: "Partner — agency, then a client brief",
    messages: [
      "I'm a travel agent and I send divers to Indonesia",
      "How do commissions work?",
      "What's in the catalogue?",
      "Komodo for my clients"
    ]
  },
  {
    label: "Traveller — untouched booking flow",
    messages: ["My partner and I want to dive Komodo next month"]
  }
];

async function main() {
  if (process.argv.includes("--demo")) {
    for (const scene of DEMO) {
      priorTravellerMessages.length = 0;
      console.log(`\n══ ${scene.label} ══`);
      for (const message of scene.messages) {
        console.log(`\nYou: ${message}`);
        await send(message);
      }
    }
    return;
  }

  console.log("Kai triage harness — type a message, or 'quit'. Fresh persona per run.\n");
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  for (;;) {
    const line = (await rl.question("You: ")).trim();
    if (!line || /^(quit|exit)$/i.test(line)) break;
    await send(line);
  }

  rl.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
