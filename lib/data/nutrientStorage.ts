/**
 * Nutrient body storage parameters for rolling window gap computation.
 *
 * For 'stored' nutrients, gap computation averages intake over rollingDays
 * instead of just today. This prevents false alarms for fat-soluble vitamins
 * and minerals with significant body reserves.
 *
 * All values based on NIH Office of Dietary Supplements fact sheets,
 * IOM Dietary Reference Intakes, and peer-reviewed literature.
 *
 * Key references:
 *  - IOM DRI series (1997–2019)
 *  - NIH ODS Fact Sheets: https://ods.od.nih.gov/factsheets/
 *  - Levine M et al. (1996) PNAS 93:3704-9 — vitamin C pharmacokinetics
 *  - Herbert V (1987) Am J Clin Nutr 45:661-70 — folate stores
 *  - Herbert V (1988) Am J Clin Nutr 48:852-8 — B12 stores
 *  - Olson JA (1987) J Nutr 117:1820-4 — vitamin A liver stores
 *  - Jones G (2008) Am J Clin Nutr 88:582S-6S — vitamin D half-life
 *  - Traber MG (2007) Free Radic Biol Med 43:4-15 — vitamin E kinetics
 *  - Shearer MJ et al. (2012) Adv Nutr 3:182-95 — vitamin K turnover
 *  - King JC et al. (2000) J Nutr 130:1360S-6S — zinc metabolism
 *  - Lands WEM (1992) FASEB J 6:2530-6 — omega-3 tissue half-life
 *  - Harris WS et al. (2004) Am J Clin Nutr 79:765-73 — omega-3 index
 */
export const NUTRIENT_STORAGE: Record<string, {
  period: 'daily' | 'stored';
  rollingDays: number;
  citation: string;
}> = {
  calories:    { period: 'daily',  rollingDays: 1,  citation: 'IOM DRI 2005' },
  protein:     { period: 'daily',  rollingDays: 1,  citation: 'IOM DRI 2005' },
  carbs:       { period: 'daily',  rollingDays: 1,  citation: 'IOM DRI 2005' },
  fat:         { period: 'daily',  rollingDays: 1,  citation: 'IOM DRI 2005' },
  fiber:       { period: 'daily',  rollingDays: 1,  citation: 'IOM DRI 2005' },
  vitamin_c:   { period: 'daily',  rollingDays: 1,  citation: 'Levine 1996, NIH ODS' },
  vitamin_b6:  { period: 'stored', rollingDays: 3,  citation: 'IOM 1998, t½ ~25d' },
  vitamin_k:   { period: 'stored', rollingDays: 3,  citation: 'Shearer 2012' },
  folate:      { period: 'stored', rollingDays: 7,  citation: 'Herbert 1987, NIH ODS' },
  vitamin_b12: { period: 'stored', rollingDays: 7,  citation: 'IOM 1998, Herbert 1988' },
  vitamin_a:   { period: 'stored', rollingDays: 7,  citation: 'Olson 1987, NIH ODS' },
  vitamin_d:   { period: 'stored', rollingDays: 7,  citation: 'Jones 2008, t½ ~15d' },
  vitamin_e:   { period: 'stored', rollingDays: 7,  citation: 'Traber 2007' },
  iron:        { period: 'stored', rollingDays: 7,  citation: 'IOM 2001' },
  calcium:     { period: 'daily',  rollingDays: 1,  citation: 'IOM 2011 (absorption-limited)' },
  magnesium:   { period: 'stored', rollingDays: 3,  citation: 'IOM 1997' },
  potassium:   { period: 'daily',  rollingDays: 1,  citation: 'IOM 2019 (renal clearance)' },
  zinc:        { period: 'stored', rollingDays: 3,  citation: 'King 2000' },
  omega3:      { period: 'stored', rollingDays: 7,  citation: 'Lands 1992, Harris 2004' },
};
