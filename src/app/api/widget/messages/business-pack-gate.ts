import type { BusinessPackDescriptor } from "@/core/business-pack/types";

type BusinessPackGateReply = {
  content: string;
  businessPack: {
    kind: BusinessPackDescriptor["kind"];
    paymentPolicy: BusinessPackDescriptor["paymentPolicy"];
    truthPolicy: BusinessPackDescriptor["truthPolicy"];
  };
};

export function shouldUseGenericBookingFlow(pack: BusinessPackDescriptor) {
  return pack.kind === "operator_direct";
}

export function buildBusinessPackGateReply(pack: BusinessPackDescriptor): BusinessPackGateReply | null {
  if (shouldUseGenericBookingFlow(pack)) {
    return null;
  }

  return {
    content:
      "I can help shape this BluePass request, but I will route marketplace availability, referral context, and operator follow-up through the BluePass inquiry flow instead of confirming a booking here.",
    businessPack: {
      kind: pack.kind,
      paymentPolicy: pack.paymentPolicy,
      truthPolicy: pack.truthPolicy
    }
  };
}
