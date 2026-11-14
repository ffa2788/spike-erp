export type CostKind = "RAW" | "FINISHED" | "UTILITY";

export type CostProduct = {
  id: string;
  sku: string;
  name: string;
  kind: CostKind;
  standardCost: number;
};

export type CostFormula = {
  productId: string;
  isDefault: boolean;
  lines: { ingredientId: string; percent: number }[];
};

export type CostBreakdownLine = {
  ingredientId: string;
  percent: number;
  costPerUnit: number | null;
  contribution: number | null;
};

export type RollUp = {
  status: "OK" | "INCOMPLETE" | "NO_FORMULA";
  costPerUnit: number | null;
  problems: string[];
  breakdown: CostBreakdownLine[];
};

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

/**
 * Recipe cost rolls through sub-recipes.
 * If any ingredient is missing a real cost, the parent cost is unusable.
 * A partial sum is never returned — that is how a blend can look cheaper than it is.
 */
export function rollUpCost(productId: string, products: CostProduct[], formulas: CostFormula[]): RollUp {
  const visiting = new Set<string>();

  function walk(id: string): RollUp {
    const product = products.find((item) => item.id === id);
    if (!product) {
      return {
        status: "INCOMPLETE",
        costPerUnit: null,
        problems: ["An ingredient on this formula is missing."],
        breakdown: [],
      };
    }
    if (visiting.has(id)) {
      return {
        status: "INCOMPLETE",
        costPerUnit: null,
        problems: [`${product.name} (${product.sku}) loops back to itself. Remove the loop before using this cost.`],
        breakdown: [],
      };
    }
    if (product.kind !== "FINISHED") {
      if (!(product.standardCost > 0)) {
        return {
          status: "INCOMPLETE",
          costPerUnit: null,
          problems: [`${product.name} (${product.sku}) has no real cost.`],
          breakdown: [],
        };
      }
      return { status: "OK", costPerUnit: product.standardCost, problems: [], breakdown: [] };
    }

    const formula = formulas.find((item) => item.productId === id && item.isDefault);
    if (!formula) {
      return {
        status: "NO_FORMULA",
        costPerUnit: null,
        problems: [`${product.name} (${product.sku}) has no default formula, so its recipe cost cannot be used.`],
        breakdown: [],
      };
    }

    const percentTotal = formula.lines.reduce((sum, line) => sum + line.percent, 0);
    const problems: string[] = [];
    if (Math.abs(percentTotal - 100) >= 0.001) {
      problems.push(
        `${product.name} formula adds up to ${percentTotal.toFixed(2)}% instead of 100%.`,
      );
    }
    if (formula.lines.length === 0) {
      problems.push(`${product.name} formula has no ingredients.`);
    }

    visiting.add(id);
    const breakdown: CostBreakdownLine[] = [];
    let cost = 0;
    let blocked = problems.length > 0;
    for (const line of formula.lines) {
      const child = walk(line.ingredientId);
      const usable = child.status === "OK" && child.costPerUnit != null;
      const contribution = usable ? (child.costPerUnit! * line.percent) / 100 : null;
      if (!usable) {
        blocked = true;
        problems.push(...child.problems);
      } else if (contribution != null) {
        cost += contribution;
      }
      breakdown.push({
        ingredientId: line.ingredientId,
        percent: line.percent,
        costPerUnit: usable ? child.costPerUnit : null,
        contribution: usable ? contribution : null,
      });
    }
    visiting.delete(id);

    if (blocked) {
      return { status: "INCOMPLETE", costPerUnit: null, problems: unique(problems), breakdown };
    }
    return {
      status: "OK",
      costPerUnit: Math.round(cost * 1e6) / 1e6,
      problems: [],
      breakdown,
    };
  }

  return walk(productId);
}

export function percentsBalance(percents: number[]): boolean {
  const sum = percents.reduce((total, value) => total + value, 0);
  return Math.abs(sum - 100) < 0.001;
}
