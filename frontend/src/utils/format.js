const rupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2
});

/** Format an amount in paise as rupees, for example 150000 -> "₹1,500.00". */
export function formatPaise(paise, emptyText = '₹0.00') {
  if (paise === null || paise === undefined) return emptyText;
  return rupees.format(Number(paise) / 100);
}
