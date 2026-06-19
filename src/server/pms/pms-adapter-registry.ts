import { InseanqPmsAdapter } from "@/core/pms/inseanq-pms-adapter";
import { MockPmsAdapter } from "@/core/pms/mock-pms-adapter";
import { RezdyPmsAdapter } from "@/core/pms/rezdy-pms-adapter";
import type { PmsAdapter } from "@/core/pms/types";
import type { PmsProvider } from "@/core/tenant/types";

export function getPmsAdapter(provider: PmsProvider): PmsAdapter {
  if (provider === "MOCK") {
    return new MockPmsAdapter();
  }

  if (provider === "REZDY") {
    return new RezdyPmsAdapter();
  }

  if (provider === "INSEANQ") {
    return new InseanqPmsAdapter();
  }

  throw new Error(`PMS provider ${provider} is configured but no adapter shell exists yet.`);
}
