import { searchBluePassYachts, type BluePassCatalogSnapshotItem } from "./catalog";
import { findMentionedDestinations } from "./destination-notes";
import { BLUEPASS_REGIONS } from "./market";
import { buildBluePassLocalBoatsReply, isInPlace } from "./reply";

/**
 * Where each live Australian operator's trips run from.
 * shortcut: the tenant config has no service area, so it is named here; move it into the config when a second AU operator goes live.
 */
export const AU_OPERATOR_AREA: Record<string, string> = { boattime: "Gold Coast" };

/**
 * What an Australian traveller who names a place hears before the live operator's lineup: the catalogue
 * boats in that place (information only, they have no connected operator), or an honest line that the
 * lineup comes from somewhere else. Null when they named no place, or the lineup already is the place.
 */
export function buildAuLocalCatalogLead(input: {
  message: string;
  catalog?: BluePassCatalogSnapshotItem[];
  operatorName: string;
  operatorSlug: string;
}): string | null {
  const destination = findMentionedDestinations(input.message, [...BLUEPASS_REGIONS.AUSTRALIA])[0];
  if (!destination) return null;

  const area = AU_OPERATOR_AREA[input.operatorSlug];
  const local = searchBluePassYachts({ destination }, input.catalog, 3).filter((yacht) => isInPlace(yacht.region, destination));

  if (local.length > 0) {
    const runsFrom = area ? `, who runs from the ${area}` : "";
    return `${buildBluePassLocalBoatsReply(destination, local)}\n\nFor live availability and booking I can also check ${input.operatorName}${runsFrom}.`;
  }

  if (area && !isInPlace(area, destination)) {
    return `I don't have anything listed in ${destination} yet. ${input.operatorName} runs from the ${area}.`;
  }

  return null;
}
