export const SDS_TITLES = [
  "Identification",
  "Hazard identification",
  "Composition / information on ingredients",
  "First-aid measures",
  "Fire-fighting measures",
  "Accidental release measures",
  "Handling and storage",
  "Exposure controls / personal protection",
  "Physical and chemical properties",
  "Stability and reactivity",
  "Toxicological information",
  "Ecological information",
  "Disposal considerations",
  "Transport information",
  "Regulatory information",
  "Other information",
] as const;

export type SdsIngredient = {
  name: string;
  cas: string;
  percent: number;
  classification: string;
  signal: string;
  pictograms: string;
  hazardStatements: string;
  precautionary: string;
};

export type SdsInput = {
  productName: string;
  sku: string;
  company: string;
  address: string;
  phone: string;
  revision: string;
  version: number;
  form: string;
  appearance: string;
  specificGravity: string;
  ph: string;
  flashPoint: string;
  solubility: string;
  signal: string;
  classification: string;
  pictograms: string;
  hazardStatements: string;
  precautionary: string;
  unNumber: string;
  shippingName: string;
  transportClass: string;
  packingGroup: string;
  ingredients: SdsIngredient[];
  nsf: { tradeName: string; maxUseMgL: string; function: string } | null;
};

export type SdsSection = { number: number; title: string; body: string };

const GAP = "Not on file. A qualified reviewer has to complete this before the SDS is published.";

function filled(value: string, fallback = GAP): string {
  return value.trim() ? value.trim() : fallback;
}

export function buildSds(input: SdsInput): { sections: SdsSection[]; gaps: string[] } {
  const gaps: string[] = [];
  const need = (label: string, value: string) => {
    if (!value.trim()) gaps.push(label);
    return filled(value);
  };
  const composition = input.ingredients.length
    ? input.ingredients
        .map(
          (item) =>
            `${item.name}: ${item.percent.toFixed(2)}% by weight. CAS ${item.cas || "not on file"}. ${item.classification || "Classification not on file."} ${item.hazardStatements || ""}`.trim(),
        )
        .join("\n")
    : GAP;
  if (!input.ingredients.length) gaps.push("Composition");
  const nsf = input.nsf
    ? `This product is on the NSF public listing as ${input.nsf.tradeName} (${input.nsf.function}). Maximum use level ${input.nsf.maxUseMgL} mg/L under NSF/ANSI/CAN 60. Confirm the current listing at info.nsf.org before printing the mark.`
    : "This product is not on SPER Chemical's NSF/ANSI/CAN 60 public listing. Do not show the NSF mark.";
  const sections: SdsSection[] = [
    {
      number: 1,
      title: SDS_TITLES[0],
      body: `${input.productName} (${input.sku}). ${input.form}.\nSupplier: ${input.company}, ${input.address}. Phone ${input.phone}.\nRecommended use: water treatment. Revision ${input.revision}, version ${input.version}.\n${nsf}`,
    },
    {
      number: 2,
      title: SDS_TITLES[1],
      body: `Signal word: ${need("Signal word", input.signal)}\nClassification: ${need("GHS classification", input.classification)}\nPictograms: ${filled(input.pictograms, "None on file.")}\nHazard statements: ${need("Hazard statements", input.hazardStatements)}\nPrecautionary statements: ${need("Precautionary statements", input.precautionary)}`,
    },
    { number: 3, title: SDS_TITLES[2], body: composition },
    {
      number: 4,
      title: SDS_TITLES[3],
      body: "Move the person to fresh air. Rinse skin and eyes with water for several minutes. Get medical help if irritation continues. Do not give anything by mouth to an unconscious person. This is general first-aid text and must be reviewed by a qualified person.",
    },
    {
      number: 5,
      title: SDS_TITLES[4],
      body: `Flash point: ${filled(input.flashPoint, "Not on file.")}\nUse water fog, foam, dry chemical, or carbon dioxide for a surrounding fire. Firefighters should wear self-contained breathing apparatus.`,
    },
    {
      number: 6,
      title: SDS_TITLES[5],
      body: "Keep unnecessary people away. Soak up a liquid spill with inert material. Sweep a powder spill without making dust. Do not let a large spill into a storm drain. Put the waste in a labeled container.",
    },
    {
      number: 7,
      title: SDS_TITLES[6],
      body: "Wash after handling. Keep the container closed. Store in a dry place away from incompatible materials named by the reviewer.",
    },
    {
      number: 8,
      title: SDS_TITLES[7],
      body: `Wear eye protection and chemical-resistant gloves. ${filled(input.precautionary, "Add exposure limits if any ingredient has one.")}`,
    },
    {
      number: 9,
      title: SDS_TITLES[8],
      body: `Appearance: ${filled(input.appearance, "Not on file.")}\nSpecific gravity: ${input.specificGravity || "Not on file."}\npH: ${filled(input.ph, "Not on file.")}\nFlash point: ${filled(input.flashPoint, "Not on file.")}\nSolubility: ${filled(input.solubility, "Not on file.")}`,
    },
    {
      number: 10,
      title: SDS_TITLES[9],
      body: "Stable in normal storage. Avoid strong oxidizers and acids unless the reviewer names a different set. Hazardous polymerization is not expected.",
    },
    {
      number: 11,
      title: SDS_TITLES[10],
      body: "Toxicology numbers are not invented by SPIKE. The reviewer must enter the relevant data for this blend before the SDS is published.",
    },
    {
      number: 12,
      title: SDS_TITLES[11],
      body: "Ecological data is not invented by SPIKE. Keep the product out of waterways until the reviewer completes this section.",
    },
    {
      number: 13,
      title: SDS_TITLES[12],
      body: "Dispose of contents and the container in line with local, state, and federal rules. Do not dump unused product into a drain.",
    },
    {
      number: 14,
      title: SDS_TITLES[13],
      body: `UN number: ${filled(input.unNumber, "Not regulated on the data we have, pending review.")}\nProper shipping name: ${filled(input.shippingName, "Not on file.")}\nClass: ${filled(input.transportClass, "Not on file.")}\nPacking group: ${filled(input.packingGroup, "Not on file.")}`,
    },
    {
      number: 15,
      title: SDS_TITLES[14],
      body: `OSHA Hazard Communication Standard, 29 CFR 1910.1200 (HazCom 2012).\n${nsf}`,
    },
    {
      number: 16,
      title: SDS_TITLES[15],
      body: `Prepared by SPIKE from the product, formula, and ingredient records on ${input.revision}. Version ${input.version}. This file is a draft until a qualified person reviews it and it is published. SPIKE does not replace that review.`,
    },
  ];
  if (sections.length !== 16) gaps.push("Section count");
  return { sections, gaps };
}

export function buildTds(input: SdsInput & { description: string }): { title: string; lines: { label: string; value: string }[] } {
  return {
    title: `Technical data sheet — ${input.productName}`,
    lines: [
      { label: "Product", value: `${input.productName} (${input.sku})` },
      { label: "Description", value: input.description || "Water-treatment chemical." },
      { label: "Form", value: input.form },
      { label: "Appearance", value: filled(input.appearance, "See the product record.") },
      { label: "Specific gravity", value: input.specificGravity || "Not set" },
      { label: "pH", value: filled(input.ph, "Not set") },
      { label: "Solubility", value: filled(input.solubility, "Not set") },
      {
        label: "NSF/ANSI/CAN 60",
        value: input.nsf
          ? `Listed as ${input.nsf.tradeName}. Max use ${input.nsf.maxUseMgL} mg/L.`
          : "Not on the NSF public listing. No NSF mark.",
      },
      { label: "Revision", value: `${input.revision}, version ${input.version}` },
      { label: "Safety", value: "Read the current Safety Data Sheet before use." },
    ],
  };
}
