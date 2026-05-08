/**
 * Parse Orders -- brain extracts structured order data.
 * Processes one cleaned email at a time.
 */

import { getBrain } from '../../brain/selector';
import type { EmailCandidate, EmailOrderItem } from '../types';

/**
 * Extract order items from a single cleaned email.
 * Returns array (one order can have multiple items).
 */
export async function parseOrderEmail(email: EmailCandidate): Promise<EmailOrderItem[]> {
  if (!email.cleanedBody) return [];

  const brain = await getBrain();

  const prompt = `Extract order items from this email.
Email from: ${email.from}
Subject: ${email.subject}
Body: "${email.cleanedBody}"

Return JSON array: [{"n":"item name","b":"brand","p":{"a":price,"c":"USD"},"sz":"size","cl":"color","cat":"dress|top|bottom|shoes|bag|accessory|other","img":"url","on":"order#","d":"YYYY-MM-DD","r":"retailer","st":"ordered|shipped|delivered"}]

If no order items found, return []`;

  const raw = await brain.text(prompt, { temperature: 0.1 });

  return parseOrderResponse(raw, email);
}

/**
 * Parse order items from multiple emails.
 */
export async function parseOrderEmails(emails: EmailCandidate[]): Promise<EmailOrderItem[]> {
  const allItems: EmailOrderItem[] = [];

  for (const email of emails) {
    try {
      const items = await parseOrderEmail(email);
      allItems.push(...items);
    } catch {
      // Skip failed parses
    }
  }

  return allItems;
}

function parseOrderResponse(raw: string, email: EmailCandidate): EmailOrderItem[] {
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];

    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed.map((item: any) => ({
      itemName: item.n || item.itemName || 'Unknown Item',
      brand: item.b || item.brand,
      price: item.p ? { amount: item.p.a || item.p.amount || 0, currency: item.p.c || item.p.currency || 'USD' } : undefined,
      size: item.sz || item.size,
      color: item.cl || item.color,
      category: item.cat || item.category || 'other',
      imageUrl: item.img || item.imageUrl,
      orderNumber: item.on || item.orderNumber,
      orderDate: item.d || item.orderDate || email.date,
      retailer: item.r || item.retailer,
      status: item.st || item.status || 'ordered',
    }));
  } catch {
    return [];
  }
}
