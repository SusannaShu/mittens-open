/**
 * Standard serving sizes by USDA food group.
 * Used by candidateGenerator to assign realistic portions.
 * Values in grams, based on USDA standard reference portions.
 *
 * Reference: USDA Food and Nutrient Database for Dietary Studies (FNDDS)
 *            USDA Standard Reference Legacy (SR Legacy)
 */
export const SERVING_SIZES: Record<string, number> = {
  'Poultry Products': 120,
  'Finfish and Shellfish Products': 115,
  'Beef Products': 115,
  'Pork Products': 115,
  'Lamb, Veal, and Game Products': 115,
  'Legumes and Legume Products': 130,
  'Dairy and Egg Products': 175,
  'Cereal Grains and Pasta': 140,
  'Vegetables and Vegetable Products': 130,
  'Fruits and Fruit Juices': 150,
  'Nut and Seed Products': 30,
  'Fats and Oils': 15,
  'Soups, Sauces, and Gravies': 245,
  'Baked Products': 50,
  'Sweets': 30,
  'Beverages': 240,
  'Spices and Herbs': 5,
  'Baby Foods': 100,
  'Sausages and Luncheon Meats': 60,
  'Breakfast Cereals': 40,
  'Snacks': 30,
  'Meals, Entrees, and Side Dishes': 250,
  'Fast Foods': 200,
  'Restaurant Foods': 250,
};

export const DEFAULT_SERVING_G = 100;

export function getServingSize(group: string): number {
  return SERVING_SIZES[group] || DEFAULT_SERVING_G;
}
