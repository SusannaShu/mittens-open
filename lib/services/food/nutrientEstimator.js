"use strict";
/**
 * Nutrient Estimator Service
 *
 * USDA data = lab-measured reference fed INTO AI prompt as context.
 * AI generates estimates ANCHORED on real USDA data, explains adjustments.
 * User sees USDA refs, AI's reasoning, and can edit any value.
 *
 * Pipeline: lookupUSDAAll() -> feed refs into prompt -> AI estimates with reasoning
 */
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.lookupUSDAAll = lookupUSDAAll;
exports.lookupUSDA = lookupUSDA;
exports.scaleNutrients = scaleNutrients;
exports.estimateNutrients = estimateNutrients;
exports.reEstimateWithReference = reEstimateWithReference;
exports.applyUserEdits = applyUserEdits;
exports.flattenNutrients = flattenNutrients;
exports.flattenNutrientsNullable = flattenNutrientsNullable;
exports.averageConfidence = averageConfidence;
exports.estimateNutrientsBatch = estimateNutrientsBatch;
var commonFoods_1 = require("../../data/commonFoods");
var localInference_1 = require("../ai/localInference");
var COMPACT_TO_FULL = {
    cal: 'calories', pro: 'protein', carb: 'carbs', fat: 'fat',
    fib: 'fiber', water: 'water',
    vA: 'vitamin_a', vC: 'vitamin_c', vD: 'vitamin_d', vE: 'vitamin_e',
    vK: 'vitamin_k', vB6: 'vitamin_b6', vB12: 'vitamin_b12', fol: 'folate',
    ca: 'calcium', fe: 'iron', mg: 'magnesium', k: 'potassium',
    zn: 'zinc', o3: 'omega3',
};
var FULL_TO_COMPACT = {};
for (var _i = 0, _a = Object.entries(COMPACT_TO_FULL); _i < _a.length; _i++) {
    var _b = _a[_i], k = _b[0], v = _b[1];
    FULL_TO_COMPACT[v] = k;
}
var ALL_KEYS = [
    'calories', 'protein', 'carbs', 'fat', 'fiber', 'water',
    'vitamin_a', 'vitamin_c', 'vitamin_d', 'vitamin_e', 'vitamin_k',
    'vitamin_b6', 'vitamin_b12', 'folate',
    'calcium', 'iron', 'magnesium', 'potassium', 'zinc', 'omega3',
];
// ──────────── Fuzzy Matching ────────────
function normalizeName(name) {
    var n = name.toLowerCase().trim();
    // Strip parenthetical descriptors like "(Red/Orange)" or "(likely cooking oil)"
    n = n.replace(/\([^)]*\)/g, '').trim();
    // Strip cooking/prep prefixes
    n = n.replace(/^(fresh|raw|organic|dried|frozen|canned|cooked|roasted|grilled|steamed|baked|fried)\s+/g, '');
    n = n.replace(/\s+(sliced|diced|chopped|minced|whole|pieces|chunks)$/g, '');
    // Depluralize
    if (n.endsWith('ies') && n.length > 4)
        n = n.slice(0, -3) + 'y';
    else if (n.endsWith('es') && n.length > 4)
        n = n.slice(0, -2);
    else if (n.endsWith('s') && n.length > 3)
        n = n.slice(0, -1);
    return n;
}
// Words that shouldn't drive matching
var STOP_WORDS = new Set(['likely', 'dark', 'light', 'other', 'red', 'orange', 'green', 'yellow', 'white', 'brown', 'black', 'speck']);
function matchScore(query, entry) {
    var q = normalizeName(query);
    var qTokens = q.split(/[\s/,]+/).filter(function (t) { return t.length > 1 && !STOP_WORDS.has(t); });
    if (qTokens.length === 0)
        return 0;
    var bestScore = 0;
    var _loop_1 = function (alias) {
        var a = alias.toLowerCase();
        // Exact full match
        if (a === q)
            return { value: 1.0 };
        // Query starts the alias: "tofu" matches "tofu, firm" but NOT "mayonnaise, made with tofu"
        if (a.startsWith(q + ',') || a.startsWith(q + ' '))
            return { value: 0.95 };
        // Alias starts with query (single word primary match)
        if (a.startsWith(q))
            return { value: 0.9 };
        // Token overlap (handles multi-word and partial matches)
        var aTokens = a.split(/[\s,]+/).filter(function (t) { return t.length > 1; });
        var overlap = qTokens.filter(function (qt) { return aTokens.some(function (at) { return at === qt || (at.length > 3 && qt.length > 3 && (at.startsWith(qt) || qt.startsWith(at))); }); });
        var score = overlap.length / Math.max(qTokens.length, aTokens.length);
        if (score > bestScore)
            bestScore = score;
    };
    for (var _i = 0, _a = entry.aliases; _i < _a.length; _i++) {
        var alias = _a[_i];
        var state_1 = _loop_1(alias);
        if (typeof state_1 === "object")
            return state_1.value;
    }
    return bestScore;
}
function lookupUSDAAll(foodName, threshold, maxResults) {
    if (threshold === void 0) { threshold = 0.5; }
    if (maxResults === void 0) { maxResults = 8; }
    var matches = [];
    for (var _i = 0, COMMON_FOODS_1 = commonFoods_1.COMMON_FOODS; _i < COMMON_FOODS_1.length; _i++) {
        var entry = COMMON_FOODS_1[_i];
        var score = matchScore(foodName, entry);
        if (score >= threshold) {
            matches.push({
                fdcId: entry.fdcId, name: entry.name,
                category: entry.category,
                score: score,
                per100g: entry.per100g,
            });
        }
    }
    return matches.sort(function (a, b) { return b.score - a.score; }).slice(0, maxResults);
}
function lookupUSDA(foodName, threshold) {
    if (threshold === void 0) { threshold = 0.6; }
    var all = lookupUSDAAll(foodName, threshold, 1);
    return all.length > 0 ? all[0] : null;
}
// ──────────── Scaling ────────────
function scaleNutrients(per100g, portionGrams) {
    var factor = portionGrams / 100;
    var scaled = {};
    for (var _i = 0, _a = Object.entries(per100g); _i < _a.length; _i++) {
        var _b = _a[_i], key = _b[0], value = _b[1];
        scaled[key] = value === null ? null : Math.round(value * factor * 100) / 100;
    }
    return scaled;
}
// ──────────── AI Prompts ────────────
function buildRefDecisionPrompt(foodName, portionG, cooking, refs) {
    var refLines = refs.slice(0, 5).map(function (r) { return "\"".concat(r.name, "\" (score: ").concat(Math.round(r.score * 100), "%)"); }).join('\n');
    return "Food: \"".concat(foodName, "\" ").concat(portionG, "g, ").concat(cooking || 'preparation unknown', ".\n\nAvailable USDA references:\n").concat(refLines, "\n\nCRITICAL: If NONE of these references are a highly accurate match for the food, REJECT THEM and output \"none\".\nIf one IS a good match, output its exact name.\n\nJSON: {\"ref\":\"which USDA name, or 'none'\"}\n");
}
/** Full AI estimation for foods not in USDA */
function buildEstimatePrompt(foodName, portionG, cooking) {
    return "Estimate nutrients for: ".concat(foodName, ", ").concat(portionG, "g, ").concat(cooking || 'unknown preparation', "\n\nProvide detailed step-by-step reasoning for macros and key vitamins in the reason field.\nJSON: {\"nutrients\":{\"cal\":0,\"pro\":0,\"carb\":0,\"fat\":0,\"fib\":0,\"water\":0,\"vA\":0,\"vC\":0,\"vD\":0,\"vE\":0,\"vK\":0,\"vB6\":0,\"vB12\":0,\"fol\":0,\"ca\":0,\"fe\":0,\"mg\":0,\"k\":0,\"zn\":0,\"o3\":0},\"reason\":\"detailed step-by-step reasoning for estimates\"}\nValues for THAT portion. cal=kcal pro/carb/fat/fib/water=g vitamins standard units minerals=mg o3=g");
}
function parseCompactNutrients(compact) {
    var result = {};
    for (var _i = 0, _a = Object.entries(compact); _i < _a.length; _i++) {
        var _b = _a[_i], key = _b[0], value = _b[1];
        var fullKey = COMPACT_TO_FULL[key];
        if (fullKey && typeof value === 'number' && !isNaN(value)) {
            result[fullKey] = value;
        }
    }
    return result;
}
function extractJSON(raw) {
    try {
        var match = raw.match(/\{[\s\S]*\}/);
        if (match)
            return JSON.parse(match[0]);
    }
    catch ( /* invalid */_a) { /* invalid */ }
    return null;
}
// ──────────── Main Estimator ────────────
/**
 * Estimate nutrients for a single food item.
 *
 * Phase 1: AI decides whether to pick a USDA ref or reject them ("none")
 * Phase 2: If rejected, AI estimates nutrients from scratch
 */
function estimateNutrients(foodName_1, portionG_1) {
    return __awaiter(this, arguments, void 0, function (foodName, portionG, cooking, useAI) {
        var allRefs, usedRef, prompt_1, raw, parsed, refName_1, _a, scaled, nutrients_1, measured, unknown, _i, ALL_KEYS_1, key, val, prompt_2, raw, parsed, aiValues, nutrients_2, estimated, unknown, _b, ALL_KEYS_2, key, val, _c, nutrients, _d, ALL_KEYS_3, key;
        if (cooking === void 0) { cooking = ''; }
        if (useAI === void 0) { useAI = true; }
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    allRefs = lookupUSDAAll(foodName);
                    if (!(allRefs.length > 0 && useAI)) return [3 /*break*/, 5];
                    _e.label = 1;
                case 1:
                    _e.trys.push([1, 3, , 4]);
                    prompt_1 = buildRefDecisionPrompt(foodName, portionG, cooking, allRefs);
                    return [4 /*yield*/, localInference_1.LocalInferenceService.generateLocalResponse(prompt_1)];
                case 2:
                    raw = _e.sent();
                    parsed = extractJSON(raw);
                    refName_1 = String((parsed === null || parsed === void 0 ? void 0 : parsed.ref) || '').toLowerCase().trim();
                    if (refName_1 && refName_1 !== 'none') {
                        usedRef = allRefs.find(function (r) { return r.name.toLowerCase().includes(refName_1); }) || allRefs[0];
                    }
                    return [3 /*break*/, 4];
                case 3:
                    _a = _e.sent();
                    // If AI fails to decide, fall back to the top match if it's very strong
                    if (allRefs[0].score >= 0.75)
                        usedRef = allRefs[0];
                    return [3 /*break*/, 4];
                case 4: return [3 /*break*/, 6];
                case 5:
                    if (!useAI && allRefs.length > 0 && allRefs[0].score >= 0.75) {
                        usedRef = allRefs[0];
                    }
                    _e.label = 6;
                case 6:
                    // ── Phase 2A: Use the Chosen Reference ──
                    if (usedRef) {
                        scaled = scaleNutrients(usedRef.per100g, portionG);
                        nutrients_1 = {};
                        measured = 0;
                        unknown = 0;
                        for (_i = 0, ALL_KEYS_1 = ALL_KEYS; _i < ALL_KEYS_1.length; _i++) {
                            key = ALL_KEYS_1[_i];
                            val = scaled[key];
                            if (val !== null) {
                                nutrients_1[key] = { value: val, source: 'usda', confidence: usedRef.score };
                                measured++;
                            }
                            else {
                                nutrients_1[key] = { value: null, source: null, confidence: 0 };
                                unknown++;
                            }
                        }
                        return [2 /*return*/, {
                                nutrients: nutrients_1,
                                meta: {
                                    primarySource: 'usda',
                                    usedReference: usedRef,
                                    allReferences: allRefs,
                                    adjustments: [], // Bioavailability pass runs later
                                    breakdown: { measured: measured, estimated: 0, unknown: unknown },
                                },
                            }];
                    }
                    if (!useAI) return [3 /*break*/, 10];
                    _e.label = 7;
                case 7:
                    _e.trys.push([7, 9, , 10]);
                    prompt_2 = buildEstimatePrompt(foodName, portionG, cooking);
                    return [4 /*yield*/, localInference_1.LocalInferenceService.generateLocalResponse(prompt_2)];
                case 8:
                    raw = _e.sent();
                    parsed = extractJSON(raw);
                    if (parsed === null || parsed === void 0 ? void 0 : parsed.nutrients) {
                        aiValues = parseCompactNutrients(parsed.nutrients);
                        nutrients_2 = {};
                        estimated = 0;
                        unknown = 0;
                        for (_b = 0, ALL_KEYS_2 = ALL_KEYS; _b < ALL_KEYS_2.length; _b++) {
                            key = ALL_KEYS_2[_b];
                            val = aiValues[key];
                            if (val !== undefined) {
                                nutrients_2[key] = { value: val, source: 'ai', confidence: 0.5 };
                                estimated++;
                            }
                            else {
                                nutrients_2[key] = { value: null, source: null, confidence: 0 };
                                unknown++;
                            }
                        }
                        return [2 /*return*/, {
                                nutrients: nutrients_2,
                                meta: {
                                    primarySource: 'ai',
                                    usedReference: undefined,
                                    allReferences: allRefs,
                                    adjustments: [],
                                    reasoning: parsed.reason || '',
                                    breakdown: { measured: 0, estimated: estimated, unknown: unknown },
                                },
                            }];
                    }
                    return [3 /*break*/, 10];
                case 9:
                    _c = _e.sent();
                    return [3 /*break*/, 10];
                case 10:
                    nutrients = {};
                    for (_d = 0, ALL_KEYS_3 = ALL_KEYS; _d < ALL_KEYS_3.length; _d++) {
                        key = ALL_KEYS_3[_d];
                        nutrients[key] = { value: null, source: null, confidence: 0 };
                    }
                    return [2 /*return*/, {
                            nutrients: nutrients,
                            meta: { primarySource: null, allReferences: allRefs, adjustments: [], breakdown: { measured: 0, estimated: 0, unknown: 20 } },
                        }];
            }
        });
    });
}
// ──────────── Re-estimate ────────────
function reEstimateWithReference(ref, portionG, allRefs) {
    var scaled = scaleNutrients(ref.per100g, portionG);
    var nutrients = {};
    var measured = 0, unknown = 0;
    for (var _i = 0, ALL_KEYS_4 = ALL_KEYS; _i < ALL_KEYS_4.length; _i++) {
        var key = ALL_KEYS_4[_i];
        var val = scaled[key];
        if (val !== null) {
            nutrients[key] = { value: val, source: 'usda', confidence: ref.score };
            measured++;
        }
        else {
            nutrients[key] = { value: null, source: null, confidence: 0 };
            unknown++;
        }
    }
    return {
        nutrients: nutrients,
        meta: {
            primarySource: 'usda', usedReference: ref, allReferences: allRefs,
            adjustments: [], breakdown: { measured: measured, estimated: 0, unknown: unknown },
        },
    };
}
// ──────────── User Edits ────────────
function applyUserEdits(result, edits) {
    var _a, _b, _c, _d;
    var updated = __assign(__assign({}, result), { nutrients: __assign({}, result.nutrients) });
    for (var _i = 0, _e = Object.entries(edits); _i < _e.length; _i++) {
        var _f = _e[_i], key = _f[0], val = _f[1];
        var k = key;
        if (ALL_KEYS.includes(k)) {
            updated.nutrients[k] = {
                value: val !== null && val !== void 0 ? val : null,
                source: (_b = (_a = updated.nutrients[k]) === null || _a === void 0 ? void 0 : _a.source) !== null && _b !== void 0 ? _b : null,
                confidence: (_d = (_c = updated.nutrients[k]) === null || _c === void 0 ? void 0 : _c.confidence) !== null && _d !== void 0 ? _d : 0,
                userEdited: true,
            };
        }
    }
    return updated;
}
// ──────────── Helpers ────────────
function flattenNutrients(nutrients) {
    var _a, _b;
    var flat = {};
    for (var _i = 0, ALL_KEYS_5 = ALL_KEYS; _i < ALL_KEYS_5.length; _i++) {
        var key = ALL_KEYS_5[_i];
        flat[key] = (_b = (_a = nutrients[key]) === null || _a === void 0 ? void 0 : _a.value) !== null && _b !== void 0 ? _b : 0;
    }
    return flat;
}
function flattenNutrientsNullable(nutrients) {
    var _a, _b;
    var flat = {};
    for (var _i = 0, ALL_KEYS_6 = ALL_KEYS; _i < ALL_KEYS_6.length; _i++) {
        var key = ALL_KEYS_6[_i];
        flat[key] = (_b = (_a = nutrients[key]) === null || _a === void 0 ? void 0 : _a.value) !== null && _b !== void 0 ? _b : null;
    }
    return flat;
}
function averageConfidence(nutrients) {
    var _a, _b;
    var sum = 0, count = 0;
    for (var _i = 0, ALL_KEYS_7 = ALL_KEYS; _i < ALL_KEYS_7.length; _i++) {
        var key = ALL_KEYS_7[_i];
        var conf = (_b = (_a = nutrients[key]) === null || _a === void 0 ? void 0 : _a.confidence) !== null && _b !== void 0 ? _b : 0;
        if (conf > 0) {
            sum += conf;
            count++;
        }
    }
    return count > 0 ? Math.round((sum / count) * 100) / 100 : 0;
}
function estimateNutrientsBatch(foods_1) {
    return __awaiter(this, arguments, void 0, function (foods, useAI) {
        var results, _i, foods_2, food, _a, _b;
        if (useAI === void 0) { useAI = true; }
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    results = [];
                    _i = 0, foods_2 = foods;
                    _c.label = 1;
                case 1:
                    if (!(_i < foods_2.length)) return [3 /*break*/, 4];
                    food = foods_2[_i];
                    _b = (_a = results).push;
                    return [4 /*yield*/, estimateNutrients(food.name, food.portion_g, food.cooking || '', useAI)];
                case 2:
                    _b.apply(_a, [_c.sent()]);
                    _c.label = 3;
                case 3:
                    _i++;
                    return [3 /*break*/, 1];
                case 4: return [2 /*return*/, results];
            }
        });
    });
}
