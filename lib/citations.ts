/**
 * Science Citations Database (Frontend)
 * Peer-reviewed sources backing every health pillar score.
 * Referenced by citationKey in impact ledgers.
 */

export interface Citation {
  claim: string;
  source: string;
  journal: string;
  doi: string | null;
}

export const CITATIONS: Record<string, Citation> = {
  // Touch Grass / Nature
  touch_grass_120min: {
    claim: '120 min/week in nature = significant health + wellbeing improvement.',
    source: 'White et al. 2019',
    journal: 'Scientific Reports 9(1):7730',
    doi: '10.1038/s41598-019-44097-3',
  },
  cortisol_20min: {
    claim: '20-30 min in nature = max cortisol reduction efficiency.',
    source: 'Hunter et al. 2019',
    journal: 'Frontiers in Psychology',
    doi: '10.3389/fpsyg.2019.00722',
  },
  nature_peak_300min: {
    claim: 'Peak benefits at 200-300 min/week in nature.',
    source: 'White et al. 2019',
    journal: 'Scientific Reports 9(1):7730',
    doi: '10.1038/s41598-019-44097-3',
  },
  forest_nk_cells: {
    claim: 'Forest bathing increases NK cell count/activity for 30+ days.',
    source: 'Li et al.',
    journal: 'Environmental Health and Preventive Medicine',
    doi: '10.1007/s12199-008-0068-3',
  },
  biodiversity_hypothesis: {
    claim: 'Contact with biodiverse environments enriches gut microbiome diversity.',
    source: 'Biodiversity hypothesis review',
    journal: 'MDPI Int. J. Environ. Res. Public Health',
    doi: '10.3390/ijerph17186568',
  },
  nature_crp_inflammation: {
    claim: 'Nature exposure reduces CRP (systemic inflammation marker).',
    source: 'University of Wisconsin',
    journal: 'Environmental Research',
    doi: '10.1016/j.envres.2019.108968',
  },
  nature_parasympathetic: {
    claim: 'Nature shifts nervous system to parasympathetic (rest-and-digest).',
    source: 'Multiple NIH studies',
    journal: 'Various',
    doi: null,
  },

  // Circadian / Light
  morning_sun_circadian: {
    claim: 'Morning light anchors circadian clock, optimizing cortisol and melatonin.',
    source: 'NIH / Huberman synthesis',
    journal: 'Cell Reports Medicine',
    doi: null,
  },
  vitamin_d_sun: {
    claim: 'Vitamin D synthesis: 5-30 min UVB several times/week.',
    source: 'NIH / Harvard',
    journal: 'J. Clin. Endocrinol. & Metab.',
    doi: '10.1210/jc.2007-0587',
  },
  screen_melatonin: {
    claim: 'Blue light from screens suppresses melatonin, delaying sleep onset.',
    source: 'UC Davis / Harvard',
    journal: 'J. Biological Rhythms',
    doi: '10.1177/0748730419881619',
  },

  // Sleep
  glymphatic_sleep: {
    claim: 'Sleep cleanses beta-amyloid via the glymphatic system.',
    source: 'Xie et al. 2013',
    journal: 'Science 342(6156):373-377',
    doi: '10.1126/science.1241224',
  },
  cool_room_sleep: {
    claim: 'Cool rooms (65-68F) promote deeper sleep.',
    source: 'Harvard / NIH',
    journal: 'Sleep Medicine Reviews',
    doi: '10.1016/j.smrv.2018.10.003',
  },

  // Gut Health
  upf_gut_inflammation: {
    claim: 'Ultra-processed foods reduce gut diversity and increase inflammation.',
    source: 'NIH 2024 / Hedayat Centre',
    journal: 'BMJ / Nutrients',
    doi: '10.1136/bmj-2023-077310',
  },
  gut_serotonin: {
    claim: '90% of serotonin is produced in the gut, not the brain.',
    source: 'NIH / Stanford Medicine',
    journal: 'Cell 2015',
    doi: '10.1016/j.cell.2015.02.047',
  },
  fermented_diversity: {
    claim: 'Fermented foods increase microbiome diversity + decrease 19 inflammation markers.',
    source: 'Stanford 2021',
    journal: 'Cell 184(16):4137-4153',
    doi: '10.1016/j.cell.2021.06.019',
  },
  prebiotic_fiber_scfa: {
    claim: 'Prebiotics (fiber) fuel beneficial bacteria, producing SCFAs.',
    source: 'Harvard / NIH',
    journal: 'Gastroenterology',
    doi: '10.1053/j.gastro.2017.01.005',
  },
  stress_gut_function: {
    claim: 'Stress + cortisol reduces gut function. Fight-or-flight diverts blood from digestion.',
    source: 'Cleveland Clinic / NIH',
    journal: 'Expert Rev. Gastroenterol. Hepatol.',
    doi: '10.1080/17474124.2017.1343143',
  },

  // Movement
  zone2_mitochondria: {
    claim: 'Zone 2 cardio builds mitochondrial density and VO2 Max.',
    source: 'WHO / AHA guidelines',
    journal: 'Br. J. Sports Medicine',
    doi: '10.1136/bjsports-2020-102955',
  },
  strength_glucose: {
    claim: 'Strength training preserves muscle mass, the primary glucose disposal site.',
    source: 'ADA / NIH',
    journal: 'Diabetes Care',
    doi: '10.2337/dc16-1728',
  },

  // Brain Hygiene
  dopamine_scrolling: {
    claim: 'Endless scrolling dysregulates dopamine, impacting baseline motivation.',
    source: 'Lembke 2021',
    journal: 'Dopamine Nation',
    doi: null,
  },
  journaling_mental_health: {
    claim: 'Expressive journaling for 15-20 min reduces anxiety and stress.',
    source: 'Pennebaker & Smyth',
    journal: 'Advances in Psychiatric Treatment',
    doi: '10.1192/apt.11.5.338',
  },

  // Nutrient Depletion
  exercise_electrolyte_loss: {
    claim: 'Exercise depletes magnesium, potassium, sodium, zinc via sweat.',
    source: 'Nielsen & Lukaski 2006',
    journal: 'J. Am. Coll. Nutrition',
    doi: '10.1080/07315724.2006.10719573',
  },
  cortisol_b_vitamin: {
    claim: 'Sustained cortisol from desk work depletes B vitamins and magnesium.',
    source: 'Kennedy et al.',
    journal: 'Nutrients',
    doi: '10.3390/nu8020068',
  },
  social_cortisol_reset: {
    claim: 'Positive social interactions lower cortisol and improve nutrient absorption.',
    source: 'Heinrichs et al.',
    journal: 'Biological Psychiatry',
    doi: '10.1016/S0006-3223(03)00465-7',
  },
  multitasking_attention: {
    claim: 'Media multitasking reduces cognitive control; task-switching costs up to 40% of productive time.',
    source: 'Ophir, Nass & Wagner 2009',
    journal: 'Proc. Natl. Acad. Sci. 106(37):15583-15587',
    doi: '10.1073/pnas.0903620106',
  },
  attention_residue: {
    claim: 'Switching tasks leaves attention residue, reducing performance on the next task.',
    source: 'Leroy 2009',
    journal: 'Organizational Behavior and Human Decision Processes 109(2):168-181',
    doi: '10.1016/j.obhdp.2009.04.002',
  },
};

export function getCitation(key: string | null | undefined): Citation | null {
  if (!key) return null;
  return CITATIONS[key] || null;
}

export function getCitationDOIUrl(doi: string | null): string | null {
  if (!doi) return null;
  return `https://doi.org/${doi}`;
}
