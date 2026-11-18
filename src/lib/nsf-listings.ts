/** Trade names copied from the NSF public listing on 14 November 2026. */
export const NSF_LISTING_SOURCE = "https://info.nsf.org/Certified/PwsChemicals/Listings.asp?Company=42880";
export const NSF_LISTED_AS_OF = "2026-11-14";

export const NSF_PUBLIC_LISTING: { tradeName: string; category: string; function: string; maxUseMgL: number }[] = [
  { tradeName: "Protect-All", category: "Blended Phosphates", function: "Corrosion & Scale Control Sequestering", maxUseMgL: 12 },
  { tradeName: "Protect-All Liquid WSF-20", category: "Blended Phosphates", function: "Corrosion & Scale Control Sequestering", maxUseMgL: 45 },
  { tradeName: "Protect-All Liquid WSF-36", category: "Blended Phosphates", function: "Corrosion & Scale Control Sequestering", maxUseMgL: 30 },
  { tradeName: "Sequest-All", category: "Blended Phosphates", function: "Corrosion & Scale Control Sequestering", maxUseMgL: 11 },
  { tradeName: "Sequest-All EMC", category: "Blended Phosphates", function: "Corrosion & Scale Control Sequestering", maxUseMgL: 16 },
  { tradeName: "Sequest-All EMC WSF-20", category: "Blended Phosphates", function: "Corrosion & Scale Control Sequestering", maxUseMgL: 70 },
  { tradeName: "Sequest-All EMC WSF-36", category: "Blended Phosphates", function: "Corrosion & Scale Control Sequestering", maxUseMgL: 40 },
  { tradeName: "Sequest-All Liquid WSF-20", category: "Blended Phosphates", function: "Corrosion & Scale Control Sequestering", maxUseMgL: 50 },
  { tradeName: "Sequest-All Liquid WSF-36", category: "Blended Phosphates", function: "Corrosion & Scale Control Sequestering", maxUseMgL: 29 },
  { tradeName: "SPER HydroPlex-500", category: "Miscellaneous Treatment Chemical", function: "Reverse Osmosis Antiscalant", maxUseMgL: 20 },
  { tradeName: "Linear 2", category: "Sodium Polyphosphates, Glassy", function: "Corrosion & Scale Control Sequestering", maxUseMgL: 12 },
  { tradeName: "Linear 2 Liquid WSF-20", category: "Sodium Polyphosphates, Glassy", function: "Corrosion & Scale Control Sequestering", maxUseMgL: 45 },
  { tradeName: "Linear 2 Liquid WSF-36", category: "Sodium Polyphosphates, Glassy", function: "Corrosion & Scale Control Sequestering", maxUseMgL: 30 },
  { tradeName: "PolyPhos Beads", category: "Sodium Polyphosphates, Glassy", function: "Corrosion & Scale Control Sequestering", maxUseMgL: 13 },
];

export function mayShowNsfMark(listing: { active: boolean; tradeName: string } | null | undefined): boolean {
  return Boolean(listing?.active && listing.tradeName.trim());
}
