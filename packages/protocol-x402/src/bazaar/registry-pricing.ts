/** Projects a governed price onto runtime registry metadata without mutating
 * the frozen contract JSON object imported by the caller. */
export function withGovernedRegistryPrice<
  T extends {
    base_price: { amount: string; currency: string };
    maximum_price: { amount: string; currency: string };
  },
>(entry: T, amount: string): T {
  return {
    ...entry,
    base_price: { ...entry.base_price, amount },
    maximum_price: { ...entry.maximum_price, amount },
  };
}
