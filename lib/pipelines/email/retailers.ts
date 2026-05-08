/**
 * Known retailer domains and order-indicator patterns.
 * Used by filterOrders.ts for deterministic email scoring.
 */

/** Map of sender domain -> retailer display name */
export const RETAILER_DOMAINS: Record<string, string> = {
  // Fashion marketplaces
  'depop.com': 'Depop',
  'poshmark.com': 'Poshmark',
  'thredup.com': 'ThredUp',
  'grailed.com': 'Grailed',
  'vestiairecollective.com': 'Vestiaire Collective',
  'therealreal.com': 'The RealReal',
  'mercari.com': 'Mercari',

  // Fast fashion / retail
  'asos.com': 'ASOS',
  'zara.com': 'Zara',
  'hm.com': 'H&M',
  'uniqlo.com': 'Uniqlo',
  'urbanoutfitters.com': 'Urban Outfitters',
  'freepeople.com': 'Free People',
  'anthropologie.com': 'Anthropologie',
  'forever21.com': 'Forever 21',
  'gap.com': 'Gap',
  'oldnavy.com': 'Old Navy',
  'abercrombie.com': 'Abercrombie & Fitch',

  // Sportswear
  'nike.com': 'Nike',
  'adidas.com': 'Adidas',
  'lululemon.com': 'Lululemon',
  'newbalance.com': 'New Balance',
  'puma.com': 'Puma',
  'reebok.com': 'Reebok',

  // Department / luxury
  'nordstrom.com': 'Nordstrom',
  'macys.com': "Macy's",
  'bloomingdales.com': "Bloomingdale's",
  'net-a-porter.com': 'Net-a-Porter',
  'ssense.com': 'SSENSE',
  'farfetch.com': 'Farfetch',
  'mytheresa.com': 'Mytheresa',
  'saks.com': 'Saks Fifth Avenue',
  'neimanmarcus.com': 'Neiman Marcus',

  // General marketplaces
  'amazon.com': 'Amazon',
  'ebay.com': 'eBay',
  'etsy.com': 'Etsy',
  'walmart.com': 'Walmart',
  'target.com': 'Target',
  'shopify.com': 'Shopify',

  // Shoes
  'goat.com': 'GOAT',
  'stockx.com': 'StockX',
  'dsw.com': 'DSW',
  'zappos.com': 'Zappos',

  // Accessories / beauty
  'glossier.com': 'Glossier',
  'sephora.com': 'Sephora',
  'ulta.com': 'Ulta',
  'warbyparker.com': 'Warby Parker',
};

/** Subject line keywords that indicate order/shipping emails */
export const ORDER_SUBJECT_KEYWORDS = [
  'order confirmation',
  'order confirmed',
  'your order',
  'order receipt',
  'order #',
  'receipt for',
  'shipping confirmation',
  'has shipped',
  'order shipped',
  'your shipment',
  'delivery confirmation',
  'out for delivery',
  'delivered',
  'purchase confirmation',
  'payment receipt',
  'invoice',
  'thank you for your order',
  'thank you for your purchase',
];

/** Body patterns that indicate order content */
export const ORDER_BODY_PATTERNS = {
  /** Price patterns: $XX.XX, USD XX.XX, etc. */
  price: /(?:\$|USD|EUR|GBP|£|€)\s*\d+(?:\.\d{2})?|\d+(?:\.\d{2})?\s*(?:USD|EUR|GBP)/gi,
  /** Order number patterns */
  orderNumber: /(?:order\s*(?:#|number|no\.?)?|confirmation\s*(?:#|number)?|ref(?:erence)?)\s*[:#]?\s*([A-Z0-9\-]{4,20})/gi,
  /** Tracking number patterns */
  tracking: /(?:tracking|track)\s*(?:#|number|no\.?)?\s*[:#]?\s*([A-Z0-9]{10,30})/gi,
  /** Quantity patterns */
  quantity: /(?:qty|quantity|x)\s*[:#]?\s*(\d+)/gi,
  /** Size patterns */
  size: /(?:size)\s*[:#]?\s*(XXS|XS|S|M|L|XL|XXL|XXXL|\d{1,2}(?:\.\d)?)/gi,
};

/**
 * Check if a sender email matches a known retailer.
 * Returns retailer name or null.
 */
export function matchRetailer(senderEmail: string): string | null {
  const emailLower = senderEmail.toLowerCase();
  for (const [domain, name] of Object.entries(RETAILER_DOMAINS)) {
    if (emailLower.includes(domain)) return name;
  }
  return null;
}
