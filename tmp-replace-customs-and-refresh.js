const XLSX = require('xlsx');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Missing backend env');

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  Prefer: 'return=minimal',
};

const EU = new Set([
  'АВСТРІЯ','БЕЛЬГІЯ','БОЛГАРІЯ','ХОРВАТІЯ','КІПР','ЧЕХІЯ','ДАНІЯ','ЕСТОНІЯ','ФІНЛЯНДІЯ','ФРАНЦІЯ','НІМЕЧЧИНА','ГРЕЦІЯ','УГОРЩИНА','ІРЛАНДІЯ','ІТАЛІЯ','ЛАТВІЯ','ЛИТВА','ЛЮКСЕМБУРГ','МАЛЬТА','НІДЕРЛАНДИ','ПОЛЬЩА','ПОРТУГАЛІЯ','РУМУНІЯ','СЛОВАЧЧИНА','СЛОВЕНІЯ','ІСПАНІЯ','ШВЕЦІЯ',
]);
const ALIASES = {
  'інжирний персик': 'персик',
  'платерина нектарин': 'нектарин',
  'ківі (кош)': 'ківі',
};
const norm = (v) => String(v ?? '').trim();
const normKey = (v) => norm(v).toLowerCase();
const num = (v) => {
  if (v === null || v === undefined || String(v).trim() === '') return 0;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

async function req(path, init = {}) {
  const res = await fetch(`${url}/rest/v1${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} failed: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function computeOfferCost(input) {
  const fx = Number(input.fxRate ?? 0);
  const unitUsd = input.priceCurrency === 'USD' ? Number(input.pricePerKg || 0) : Number(input.pricePerKg || 0) * fx;
  const freightUsd = input.freightCurrency === 'USD' ? Number(input.freight || 0) : Number(input.freight || 0) * fx;
  const pw = Number(input.palletWeight || 0);
  let expectedPallets = 26;
  if (pw > 0) {
    expectedPallets = Math.min(26, Math.floor(21500 / pw));
    if (expectedPallets < 1) expectedPallets = 1;
  }
  const freightPerPallet = expectedPallets > 0 ? freightUsd / expectedPallets : 0;
  const transportPerKg = pw > 0 ? freightPerPallet / pw : 0;
  let indicativeDuty = 0;
  let invoiceDuty = 0;
  if (input.ref) {
    indicativeDuty = Number(input.ref.euro1_markup_usd || 0);
    if (unitUsd <= Number(input.ref.threshold_price_usd || 0)) {
      invoiceDuty = Number(input.ref.euro1_markup_usd || 0);
    } else {
      const pct = EU.has(norm(input.country).toUpperCase())
        ? Number(input.ref.euro1_percent || 0)
        : Number(input.ref.customs_fee_percent || 0);
      invoiceDuty = unitUsd * 1.20 * pct / 100 + unitUsd * 0.20 + 0.02;
    }
  }
  return {
    indicativeCost: unitUsd + transportPerKg + indicativeDuty,
    invoiceCost: unitUsd + transportPerKg + invoiceDuty,
  };
}

(async () => {
  const wb = XLSX.readFile('/tmp/customs_upload.xlsx');
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
  const payload = rows
    .filter((row) => norm(row['Товар']) && norm(row['Країна']))
    .map((row) => ({
      product_name: norm(row['Товар']),
      country: norm(row['Країна']),
      threshold_price_usd: num(row['Ціна']),
      customs_fee_percent: num(row['Митний збір, %']),
      euro1_percent: num(row['Euro1']),
      euro1_markup_usd: num(row['Націнка Euro1']),
      active: true,
    }));

  await req('/customs_reference?id=not.is.null', { method: 'DELETE' });
  for (let i = 0; i < payload.length; i += 200) {
    await req('/customs_reference', { method: 'POST', body: JSON.stringify(payload.slice(i, i + 200)) });
  }

  const refRows = await req('/customs_reference?select=id,product_name,country,threshold_price_usd,customs_fee_percent,euro1_percent,euro1_markup_usd&active=eq.true');
  const exactMap = new Map();
  const byProduct = new Map();
  for (const ref of refRows) {
    exactMap.set(`${normKey(ref.product_name)}__${normKey(ref.country)}`, ref);
    const key = normKey(ref.product_name);
    const arr = byProduct.get(key) || [];
    arr.push(ref);
    byProduct.set(key, arr);
  }
  for (const arr of byProduct.values()) {
    arr.sort((a, b) => (Number(b.euro1_markup_usd || 0) - Number(a.euro1_markup_usd || 0)) || (Number(b.threshold_price_usd || 0) - Number(a.threshold_price_usd || 0)));
  }
  const findRef = (productName, country) => {
    const resolved = ALIASES[normKey(productName)] || norm(productName);
    const exact = exactMap.get(`${normKey(resolved)}__${normKey(country)}`);
    if (exact) return exact;
    const list = byProduct.get(normKey(resolved)) || [];
    return list[0] || null;
  };

  const offers = await req('/manager_offers?select=id,product_name,origin_country,price_per_kg,price_currency,freight_amount,freight_currency,pallet_weight,fx_rate_snapshot');
  for (const offer of offers) {
    const ref = findRef(offer.product_name, offer.origin_country);
    const calc = computeOfferCost({
      pricePerKg: num(offer.price_per_kg),
      priceCurrency: offer.price_currency || 'EUR',
      freight: num(offer.freight_amount),
      freightCurrency: offer.freight_currency || 'EUR',
      palletWeight: num(offer.pallet_weight),
      fxRate: num(offer.fx_rate_snapshot),
      country: norm(offer.origin_country),
      ref,
    });
    await req(`/manager_offers?id=eq.${offer.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        indicative_cost_usd: Number(calc.indicativeCost.toFixed(4)),
        invoice_cost_usd: Number(calc.invoiceCost.toFixed(4)),
      }),
    });
  }

  const items = await req('/shipment_items?select=id,pallet_weight');
  for (const item of items) {
    await req(`/shipment_items?id=eq.${item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ pallet_weight: item.pallet_weight }),
    });
  }

  const kiwiOffer = await req("/manager_offers?select=id,product_name,origin_country,indicative_cost_usd,invoice_cost_usd&product_name=ilike.*Ківі*&order=created_at.desc&limit=5");
  const kiwiRefs = await req("/customs_reference?select=product_name,country,threshold_price_usd,euro1_markup_usd&product_name=ilike.*Ківі*&order=country.asc,product_name.asc");
  console.log(JSON.stringify({ importedRows: payload.length, refreshedOffers: offers.length, refreshedItems: items.length, kiwiOffer, kiwiRefs }, null, 2));
})();
