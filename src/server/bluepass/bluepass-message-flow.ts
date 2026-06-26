import { bluePassPreviewCatalog, searchBluePassYachts } from "@/core/bluepass/catalog";
import {
  extractBluePassInquiryIntent,
  getMissingBluePassInquiryFields,
  mergeBluePassInquiryIntent
} from "@/core/bluepass/intent";
import {
  buildBluePassInquiryReadyReply,
  buildBluePassMissingFieldsReply
} from "@/core/bluepass/reply";
import type { BluePassReferralInput } from "./bluepass-inquiry-repository";
import {
  createOrReuseBluePassInquiry,
  dispatchBluePassOperatorWhatsApp,
  getActiveBluePassInquiryStatus,
  syncBluePassReferralLedgerEstimate
} from "./bluepass-inquiry-repository";

export type BluePassMarketplaceMessageInput = {
  tenantId: string;
  conversationId: string;
  content: string;
  priorTravellerMessages: string[];
  referral?: BluePassReferralInput | null;
};

export async function handleBluePassMarketplaceMessage(input: BluePassMarketplaceMessageInput) {
  const historyIntent = extractBluePassInquiryIntent(input.priorTravellerMessages);
  const messageIntent = extractBluePassInquiryIntent([input.content]);
  const selectedYacht = resolveSelectedYacht(input.content);
  const intent = mergeBluePassInquiryIntent(historyIntent, {
    ...messageIntent,
    selectedYachtSlug: selectedYacht?.slug ?? messageIntent.selectedYachtSlug
  });
  const bluepassMatches = searchBluePassYachts(intent);
  const missingFields = getMissingBluePassInquiryFields(intent);

  if (missingFields.length > 0) {
    return {
      assistantContent: buildBluePassMissingFieldsReply({
        destination: intent.destination,
        missingFields
      }),
      bluepassMatches,
      bluepassInquiry: null,
      bluepassLedger: [],
      bluepassDispatch: null,
      paymentRequest: null
    };
  }

  const created = await createOrReuseBluePassInquiry({
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    travellerMessage: input.content,
    intent,
    selectedYacht: selectedYacht ?? bluepassMatches[0] ?? null,
    referral: input.referral ?? null
  });
  const bluepassLedger = await syncBluePassReferralLedgerEstimate(created.inquiry);
  const bluepassDispatch = created.inquiry.operatorPhone
    ? await dispatchBluePassOperatorWhatsApp({ inquiryId: created.inquiry.id })
    : null;
  const status = await getActiveBluePassInquiryStatus({
    tenantId: input.tenantId,
    conversationId: input.conversationId
  });
  const bluepassInquiry = status?.inquiry ?? created.inquiry;

  return {
    assistantContent: buildBluePassInquiryReadyReply({
      inquiryId: bluepassInquiry.id,
      selectedYachtName: bluepassInquiry.selectedYachtName,
      dispatchQueued: Boolean(bluepassDispatch)
    }),
    bluepassMatches,
    bluepassInquiry,
    bluepassLedger,
    bluepassDispatch,
    paymentRequest: null
  };
}

function resolveSelectedYacht(content: string) {
  const lowerContent = content.toLowerCase();
  return (
    bluePassPreviewCatalog.find(
      (yacht) => lowerContent.includes(yacht.name.toLowerCase()) || lowerContent.includes(yacht.slug)
    ) ?? null
  );
}
