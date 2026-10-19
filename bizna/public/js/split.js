/**
 * Divides an amount across pots by percentage, in whole cents.
 *
 * This mirrors the server's rule so the sale form, the landing page example and
 * the demo all show exactly what the real wallet will do: shares are rounded
 * down, the leftover cent goes to the pot with the largest share when the
 * percentages add up to 100, and anything not covered by a percentage becomes
 * Unallocated (bucket_id null).
 */

export const UNALLOCATED = { id: null, name: 'Unallocated', color: '#94A3B8' };

/**
 * @param {number} cents
 * @param {{id:number|null,percent:number}[]} buckets
 * @returns {{bucket_id:number|null,cents:number}[]}
 */
export function splitCents(cents, buckets) {
  const shares = buckets.map((b) => ({ bucket_id: b.id, cents: Math.floor((cents * b.percent) / 100 + 1e-9) }));
  const rest = cents - shares.reduce((sum, s) => sum + s.cents, 0);
  const totalPercent = buckets.reduce((sum, b) => sum + b.percent, 0);

  if (rest > 0) {
    if (buckets.length > 0 && Math.abs(totalPercent - 100) < 0.005) {
      let top = 0;
      buckets.forEach((b, i) => { if (b.percent > buckets[top].percent) top = i; });
      shares[top].cents += rest;
    } else {
      shares.push({ bucket_id: null, cents: rest });
    }
  }
  return shares.filter((s) => s.cents !== 0);
}

/**
 * Splits an amount in KES and attaches pot names and colours for display.
 * @param {number} amount
 * @param {{id:number,name:string,color:string,percent:number}[]} buckets
 * @returns {{id:number|null,name:string,color:string,amount:number}[]}
 */
export function previewSplit(amount, buckets) {
  const cents = Math.round(Number(amount) * 100);
  if (!(cents > 0)) return [];
  return splitCents(cents, buckets).map((share) => {
    const pot = buckets.find((b) => b.id === share.bucket_id) || UNALLOCATED;
    return { id: share.bucket_id, name: pot.name, color: pot.color, amount: share.cents / 100 };
  });
}
