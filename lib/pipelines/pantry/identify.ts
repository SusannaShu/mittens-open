import { getBrain } from '../../brain/selector';
import { PipelineInput } from '../runner';
import { PantryItem } from '../types';
import { parseJsonResponse } from '../activity/detect';

const PANTRY_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          quantity: { type: 'string' },
          confidence: { type: 'number' },
          freshness: { type: 'string', enum: ['fresh', 'good', 'use_soon', 'questionable'] },
          storageLocation: { type: 'string', enum: ['fridge', 'freezer', 'pantry', 'counter'] },
          checkBy: { type: 'string' },
        },
        required: ['name', 'confidence', 'freshness', 'storageLocation'],
      },
    },
  },
  required: ['items'],
};

export function consolidatePantryItems(items: PantryItem[]): PantryItem[] {
  const consolidated: Record<string, {
    name: string;
    qty: number;
    unit: string;
    confidence: number;
    freshness: string;
    storageLocation: string;
    checkBy: string | null;
  }> = {};

  const parseQuantityAndUnit = (rawQty: string | number | undefined | null): { qty: number; unit: string } => {
    if (rawQty == null) return { qty: 1, unit: 'whole' };
    if (typeof rawQty === 'number') return { qty: rawQty, unit: 'units' };
    const clean = String(rawQty).trim().toLowerCase();
    if (!clean || clean === 'whole') return { qty: 1, unit: 'whole' };
    const match = clean.match(/^([0-9]+(?:\.[0-9]+)?)\s*(.*)$/);
    if (match) {
      const qty = parseFloat(match[1]) || 1;
      const unit = match[2].trim() || 'units';
      return { qty, unit };
    }
    return { qty: 1, unit: clean };
  };

  const singularize = (name: string): string => {
    const clean = name.trim().toLowerCase();
    
    const manualMap: Record<string, string> = {
      'strawberries': 'strawberry',
      'blueberries': 'blueberry',
      'raspberries': 'raspberry',
      'blackberries': 'blackberry',
      'potatoes': 'potato',
      'sweet potatoes': 'sweet potato',
      'tomatoes': 'tomato',
      'avocados': 'avocado',
      'oranges': 'orange',
      'apples': 'apple',
      'bananas': 'banana',
      'carrots': 'carrot',
      'onions': 'onion',
      'cucumbers': 'cucumber',
      'zucchinis': 'zucchini',
      'lemons': 'lemon',
      'limes': 'lime',
      'peaches': 'peach',
      'pears': 'pear',
      'plums': 'plum',
      'peppers': 'pepper',
      'bell peppers': 'bell pepper',
      'mushrooms': 'mushroom',
      'eggs': 'egg',
      'almonds': 'almond',
      'walnuts': 'walnut',
      'nuts': 'nut',
    };

    if (manualMap[clean]) {
      return manualMap[clean];
    }

    if (clean.endsWith('ies')) {
      return clean.slice(0, -3) + 'y';
    }
    if (clean.endsWith('oes')) {
      return clean.slice(0, -2);
    }
    if (clean.endsWith('s') && !clean.endsWith('ss') && !clean.endsWith('us') && !clean.endsWith('is') && !clean.endsWith('as')) {
      return clean.slice(0, -1);
    }
    return clean;
  };

  for (const item of items) {
    if (!item || !item.name) continue;
    
    const singularName = singularize(item.name);
    const { qty, unit } = parseQuantityAndUnit(item.quantity);
    const displayName = item.name.charAt(0).toUpperCase() + singularName.slice(1);
    
    const existing = consolidated[singularName];
    if (existing) {
      existing.qty += qty;
      if (unit !== 'units' && unit !== 'whole' && unit !== 'each' && (existing.unit === 'units' || existing.unit === 'whole' || existing.unit === 'each')) {
        existing.unit = unit;
      }
      existing.confidence = Math.max(existing.confidence, item.confidence ?? 0.8);
      if ((item as any).freshness && !existing.freshness) {
        existing.freshness = (item as any).freshness;
      }
      if ((item as any).storageLocation && !existing.storageLocation) {
        existing.storageLocation = (item as any).storageLocation;
      }
    } else {
      consolidated[singularName] = {
        name: displayName,
        qty,
        unit,
        confidence: item.confidence ?? 0.8,
        freshness: (item as any).freshness || 'good',
        storageLocation: (item as any).storageLocation || 'fridge',
        checkBy: (item as any).checkBy || null,
      };
    }
  }

  return Object.values(consolidated).map((c) => {
    const quantityStr = (c.unit === 'units' || c.unit === 'whole' || c.unit === 'each' || !c.unit)
      ? `${c.qty}`
      : `${c.qty} ${c.unit}`;

    return {
      name: c.name,
      quantity: quantityStr,
      confidence: c.confidence,
      freshness: c.freshness,
      storageLocation: c.storageLocation,
      checkBy: c.checkBy,
    } as any;
  });
}

export async function identifyPantryItem(input: PipelineInput): Promise<{ items: PantryItem[] }> {
  const brain = await getBrain();
  
  const prompt = `Identify ALL food and grocery items in this photo.

The photo could be:
- Physical food items (fridge, counter, shelf, grocery bags)
- A grocery receipt or store receipt (read the text to extract items + quantities)
- A grocery list or note
- Food packaging with labels

CRITICAL INSTRUCTIONS FOR ITEM NAMES:
- ALWAYS use the singular form of the item name (e.g. "orange" instead of "oranges", "tomato" instead of "tomatoes", "egg" instead of "eggs", "apple" instead of "apples").
- Be as specific and concrete as possible (e.g. "orange", "broccoli", "carrot", "cheddar cheese", "tomato", "cucumber", "zucchini", "red bell pepper").
- NEVER use combined/broad categories, slash-separated names, or "or" (e.g., do NOT output "broccoli/cauliflower", "oranges/citrus fruits", "yellow cheese or firm vegetable", or "green vegetables (cucumbers/zucchini)"). Choose the exact, specific item visible in the photo.
- For receipts: extract the food item name from each line item. Skip non-food items (bags, tax, etc).

CRITICAL INSTRUCTIONS FOR QUANTITIES AND DUPLICATES:
- ALWAYS provide a specific numeric count or clear, measurable unit (e.g., "3", "1 bunch", "1 head", "2 lbs").
- For receipts: use the quantity from the receipt line item.
- NEVER output vague or abstract quantifiers like "several", "multiple", "some", "few", or "many". If a count is approximate, estimate a specific number (e.g., "5" instead of "several", "3" instead of "multiple").
- CONSOLIDATE DUPLICATES: Do NOT list the same food item multiple times in separate array entries. If there are multiple separate instances of the same food item in the image (e.g. three separate oranges or two separate heads of broccoli), combine them into a single consolidated JSON entry with their quantities summed together.

For EACH item, return:
- name: specific singular item name
- quantity: estimated concrete total amount (e.g. "3", "1 bunch", "1 head")
- confidence: how certain you are, 0.0 to 1.0
- freshness: 'fresh', 'good', 'use_soon', or 'questionable' (assume 'fresh' for receipts/new purchases)
- storageLocation: 'fridge', 'freezer', 'pantry', or 'counter'
- checkBy: ISO date or null

Return JSON only, no explanation:
{"items":[{"name":"red bell pepper","quantity":"2","confidence":0.95,"freshness":"good","storageLocation":"fridge","checkBy":null}]}

Context text: ${input.text || 'None'}`;


  // Vision: use brain.vision() then parse (grammar can't constrain vision output)
  if (input.photos && input.photos.length > 0 && brain.supportsVision) {
    console.log('[Pantry] identify START, brain:', brain.name, 'photos:', input.photos.length);
    const raw = await brain.vision(prompt, input.photos, { temperature: 0.1 });
    console.log('[Pantry] identify raw response:', raw?.slice(0, 300));
    const result = parseJsonResponse<{ items: PantryItem[] }>(raw, { items: [] });
    result.items = consolidatePantryItems(result.items);
    console.log('[Pantry] identify parsed items:', result.items.length);
    if (result.items.length === 0 && raw && raw.length > 10) {
      console.warn('[Pantry] identify returned 0 items but model DID respond. Full response:', raw);
    }
    return result;
  }

  // Text-only: grammar-constrained JSON
  const res = await brain.json<{ items: PantryItem[] }>(prompt, PANTRY_SCHEMA, { items: [] }, { temperature: 0.1 });
  res.items = consolidatePantryItems(res.items);
  return res;
}
