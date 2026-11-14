export function shipBlockReason(
  product: {
    name: string;
    nsfCertified: boolean;
    nsfExpiresOn: string | null;
    nsfFormulaVersion: number | null;
  },
  lot: {
    lotNumber: string;
    qcStatus: string;
    nsfEligible: boolean;
    formulaVersion: number | null;
    expiresOn: string | null;
  },
  asOf: string,
): string | null {
  if (lot.qcStatus !== "APPROVED") {
    return `Lot ${lot.lotNumber} is not released. Quality has to release it before it can ship or be used.`;
  }
  if (lot.expiresOn && lot.expiresOn < asOf) {
    return `Lot ${lot.lotNumber} expired on ${lot.expiresOn}.`;
  }
  if (!product.nsfCertified) return null;
  if (product.nsfExpiresOn && product.nsfExpiresOn < asOf) {
    return `The NSF/ANSI 60 certificate for ${product.name} expired on ${product.nsfExpiresOn}. Renew it on the product before this lot can ship.`;
  }
  if (product.nsfFormulaVersion == null) {
    return `${product.name} is marked NSF/ANSI 60, but no certified formula version is on file.`;
  }
  if (lot.formulaVersion !== product.nsfFormulaVersion) {
    return `Lot ${lot.lotNumber} was made with formula version ${lot.formulaVersion ?? "unknown"}, but the certified formula is version ${product.nsfFormulaVersion}. This product always carries the NSF claim, so this lot cannot ship.`;
  }
  if (!lot.nsfEligible) {
    return `Lot ${lot.lotNumber} is not eligible for the NSF/ANSI 60 claim.`;
  }
  return null;
}

export function releaseEligibility(input: {
  nsfCertified: boolean;
  nsfExpiresOn: string | null;
  nsfFormulaVersion: number | null;
  formulaVersion: number | null;
  asOf: string;
  specsPassed: boolean;
}): { nsfEligible: boolean; note: string } {
  if (!input.nsfCertified) {
    return { nsfEligible: false, note: "This product does not carry an NSF/ANSI 60 claim." };
  }
  if (!input.specsPassed) {
    return { nsfEligible: false, note: "Quality results do not pass, so the lot cannot be released." };
  }
  if (input.nsfExpiresOn && input.nsfExpiresOn < input.asOf) {
    return {
      nsfEligible: false,
      note: "The NSF/ANSI 60 certificate is expired. The lot can be released only after the certificate is renewed, because this product always carries the claim.",
    };
  }
  if (input.nsfFormulaVersion == null || input.formulaVersion !== input.nsfFormulaVersion) {
    return {
      nsfEligible: false,
      note: "This batch did not use the certified formula version, so it cannot carry the NSF/ANSI 60 claim.",
    };
  }
  return { nsfEligible: true, note: "This lot can carry the NSF/ANSI 60 claim." };
}
