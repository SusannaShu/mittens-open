/**
 * ambient/receiptScanner.ts -- VLM-based receipt OCR.
 *
 * Extracts line items from a receipt photo, cross-references
 * against visually detected items from the grocery session,
 * and returns a merged high-confidence item list for pantry update.
 */

import type { GroceryItem } from './types';

// --- Types ---

export interface ReceiptLineItem {
  name: string;
  qty: number;
  unit: string;
  price?: number;
  confidence: number;
}

export interface ReceiptResult {
  items: ReceiptLineItem[];
  totalPrice?: number;
  storeName?: string;
}

// --- Public API ---

/**
 * Scan a receipt photo and extract line items.
 * Cross-references against visually detected grocery items
 * to boost confidence and fill in missing quantities.
 */
export async function scanReceipt(
  framePath: string,
  visualItems?: GroceryItem[],
): Promise<ReceiptResult> {
  try {
    const { getBrain } = require('../../brain/selector');
    const brain = await getBrain();

    const prompt = buildReceiptPrompt(visualItems);

    const raw = brain.supportsVision
      ? await brain.vision(prompt, [framePath])
      : await brain.text(prompt);

    const parsed = parseReceiptResponse(raw);
    return mergeWithVisualItems(parsed, visualItems);
  } catch (err: any) {
    console.warn('[ReceiptScanner] Scan failed:', err?.message);
    return { items: [] };
  }
}

// --- Prompt ---

function buildReceiptPrompt(visualItems?: GroceryItem[]): string {
  const parts = [
    'Extract all line items from this grocery receipt photo.',
    'For each item, return: name, quantity, unit, and price.',
    '',
    'Respond JSON only:',
    '{',
    '  "items": [{"name": "avocados", "qty": 3, "unit": "whole", "price": 4.50}],',
    '  "totalPrice": 45.67,',
    '  "storeName": "Trader Joe\'s"',
    '}',
    '',
    'Rules:',
    '- Normalize item names to common food names (not store abbreviations)',
    '- If quantity is unclear, default to 1',
    '- Use sensible units: "whole", "lbs", "oz", "pack", "bag", "bunch"',
    '- Include ALL items, even non-food (cleaning supplies, etc.)',
  ];

  if (visualItems && visualItems.length > 0) {
    const seen = visualItems.map(i => `${i.name} (x${i.qty})`).join(', ');
    parts.push('');
    parts.push(`Items the camera saw during shopping: ${seen}`);
    parts.push('Use these to help interpret abbreviated receipt text.');
  }

  return parts.join('\n');
}

// --- Parse ---

function parseReceiptResponse(raw: string): ReceiptResult {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { items: [] };

    const parsed = JSON.parse(jsonMatch[0]);

    const items: ReceiptLineItem[] = Array.isArray(parsed.items)
      ? parsed.items.map((item: any) => ({
          name: String(item.name || '').toLowerCase().trim(),
          qty: Number(item.qty || 1),
          unit: String(item.unit || 'whole'),
          price: item.price ? Number(item.price) : undefined,
          confidence: 0.9, // Receipt text is high confidence
        })).filter((item: ReceiptLineItem) => item.name.length > 0)
      : [];

    return {
      items,
      totalPrice: parsed.totalPrice ? Number(parsed.totalPrice) : undefined,
      storeName: parsed.storeName || undefined,
    };
  } catch {
    return { items: [] };
  }
}

// --- Cross-Reference ---

/**
 * Merge receipt items with visually detected items.
 * Receipt takes priority for names (more precise from text).
 * Visual items fill gaps and boost confidence.
 */
function mergeWithVisualItems(
  receipt: ReceiptResult,
  visualItems?: GroceryItem[],
): ReceiptResult {
  if (!visualItems || visualItems.length === 0) return receipt;

  const mergedMap = new Map<string, ReceiptLineItem>();

  // Start with receipt items
  for (const item of receipt.items) {
    mergedMap.set(item.name, item);
  }

  // Add visual items not on receipt (they might have missed a scan)
  for (const visual of visualItems) {
    const key = visual.name.toLowerCase().trim();
    if (!mergedMap.has(key)) {
      // Check for partial name matches
      const receiptMatch = receipt.items.find(r =>
        r.name.includes(key) || key.includes(r.name),
      );

      if (receiptMatch) {
        // Boost confidence of the receipt match
        receiptMatch.confidence = Math.min(1, receiptMatch.confidence + 0.05);
      } else {
        // Visual-only item -- lower confidence
        mergedMap.set(key, {
          name: key,
          qty: visual.qty,
          unit: visual.unit,
          confidence: visual.confidence * 0.7, // Discount visual-only
        });
      }
    }
  }

  return {
    ...receipt,
    items: Array.from(mergedMap.values()),
  };
}
