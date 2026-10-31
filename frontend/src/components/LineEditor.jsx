import { useMoney } from '../ui';
import { Button } from '../ui';

export const defaultPrice = (product, variantId) => {
  if (!product) return 0;
  const v = (product.variants || []).find((x) => x.id === Number(variantId));
  return Math.round((product.sales_price + (v ? v.extra_price : 0)) * 100) / 100;
};
let keyCounter = 0;
export const newLine = (product) => ({
  k: `l${++keyCounter}`,
  product_id: product ? product.id : '',
  variant_id: product && product.variants && product.variants[0] ? product.variants[0].id : '',
  quantity: 1,
  unit_price: product ? defaultPrice(product, product.variants && product.variants[0] && product.variants[0].id) : '',
});

// Rows of "product / variant / quantity / unit price" - used by subscriptions and quotation templates.
export default function LineEditor({ lines, onChange, products, minQty = 1, priced = true }) {
  const m = useMoney();
  const update = (k, patch) => onChange(lines.map((l) => (l.k === k ? { ...l, ...patch } : l)));
  const byId = (id) => products.find((p) => p.id === Number(id));

  const pickProduct = (k, id) => {
    const p = byId(id);
    const variant = p && p.variants[0] ? p.variants[0].id : '';
    update(k, { product_id: p ? p.id : '', variant_id: variant, unit_price: p ? defaultPrice(p, variant) : '' });
  };
  const pickVariant = (k, line, vid) => update(k, { variant_id: vid, unit_price: defaultPrice(byId(line.product_id), vid) });

  return (
    <div className="table-wrap">
      <table className="table lines">
        <thead>
          <tr>
            <th style={{ width: '30%' }}>Product</th><th>Variant</th><th style={{ width: 90 }}>Qty</th>
            {priced && <><th style={{ width: 120 }}>Unit price</th><th className="right">Tax</th><th className="right">Amount</th></>}
            <th style={{ width: 40 }} />
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const p = byId(l.product_id);
            const amount = (Number(l.quantity) || 0) * (Number(l.unit_price) || 0);
            return (
              <tr key={l.k}>
                <td>
                  <select className="input" value={l.product_id} onChange={(e) => pickProduct(l.k, e.target.value)} aria-label="Product">
                    <option value="">Choose a product...</option>
                    {products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </td>
                <td>
                  {p && p.variants.length > 0 ? (
                    <select className="input" value={l.variant_id} onChange={(e) => pickVariant(l.k, l, e.target.value)} aria-label="Variant">
                      {p.variants.map((v) => <option key={v.id} value={v.id}>{v.attribute}: {v.value}{v.extra_price ? ` (${v.extra_price > 0 ? '+' : ''}${v.extra_price})` : ''}</option>)}
                    </select>
                  ) : <span className="muted">-</span>}
                </td>
                <td><input className="input" type="number" min={minQty} step="1" value={l.quantity} onChange={(e) => update(l.k, { quantity: e.target.value })} aria-label="Quantity" /></td>
                {priced && (
                  <>
                    <td><input className="input" type="number" min="0" step="0.01" value={l.unit_price} onChange={(e) => update(l.k, { unit_price: e.target.value })} aria-label="Unit price" /></td>
                    <td className="right muted">{p && p.tax_rate ? `${p.tax_rate}%` : '-'}</td>
                    <td className="right num">{m(amount)}</td>
                  </>
                )}
                <td><button type="button" className="icon-btn" onClick={() => onChange(lines.filter((x) => x.k !== l.k))} aria-label="Remove line">x</button></td>
              </tr>
            );
          })}
          {lines.length === 0 && <tr><td colSpan={priced ? 7 : 4} className="muted" style={{ textAlign: 'center' }}>No lines yet</td></tr>}
        </tbody>
      </table>
      <div style={{ padding: '10px 4px' }}><Button size="sm" type="button" onClick={() => onChange([...lines, newLine(products[0])])}>+ Add a line</Button></div>
    </div>
  );
}
