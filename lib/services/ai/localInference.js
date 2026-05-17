"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
exports.LocalInferenceService = void 0;
var FileSystem = __importStar(require("expo-file-system/legacy"));
var react_native_1 = require("react-native");
var MODELS_DIR = FileSystem.documentDirectory + 'models/';
// Gemma 4 E2B instruction-tuned, LiteRT-LM bundle (2.58 GB, multimodal: text+vision+audio).
// Public + ungated on HF; CloudFront-backed, supports range requests -> createDownloadResumable
// resumes cleanly on flaky mobile networks.
var GEMMA_MODEL_URL = 'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm';
var GEMMA_MODEL_BYTES = 2583085056;
// Lazy-load the native LiteRT-LM module -- available on Android and iOS after prebuild
var _nativeModule = null;
var _nativeAttempted = false;
function getNativeModule() {
    if (react_native_1.Platform.OS !== 'android' && react_native_1.Platform.OS !== 'ios')
        return null;
    if (_nativeAttempted)
        return _nativeModule;
    _nativeAttempted = true;
    try {
        var requireNativeModule = require('expo').requireNativeModule;
        _nativeModule = requireNativeModule('LiteRTLM');
    }
    catch (e) {
        console.warn('[LiteRTLM] Native module not available:', (e === null || e === void 0 ? void 0 : e.message) || e);
        _nativeModule = null;
    }
    return _nativeModule;
}
var LocalInferenceService = /** @class */ (function () {
    function LocalInferenceService() {
    }
    /** Check if the LiteRT-LM native module is linked (requires custom dev build, not Expo Go). */
    LocalInferenceService.isNativeAvailable = function () {
        return (react_native_1.Platform.OS === 'android' || react_native_1.Platform.OS === 'ios') && getNativeModule() !== null;
    };
    LocalInferenceService.isModelDownloaded = function () {
        return __awaiter(this, arguments, void 0, function (modelName) {
            var dirInfo, fileInfo, minSize;
            if (modelName === void 0) { modelName = 'gemma-local'; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, FileSystem.getInfoAsync(MODELS_DIR)];
                    case 1:
                        dirInfo = _a.sent();
                        if (!!dirInfo.exists) return [3 /*break*/, 3];
                        return [4 /*yield*/, FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true })];
                    case 2:
                        _a.sent();
                        return [2 /*return*/, false];
                    case 3: return [4 /*yield*/, FileSystem.getInfoAsync(MODELS_DIR + modelName + '.litertlm')];
                    case 4:
                        fileInfo = _a.sent();
                        if (!fileInfo.exists)
                            return [2 /*return*/, false];
                        minSize = GEMMA_MODEL_BYTES * 0.95;
                        if (!(fileInfo.size && fileInfo.size < minSize)) return [3 /*break*/, 6];
                        console.warn("[Gemma] Model file too small (".concat(fileInfo.size, " < ").concat(minSize, "), deleting partial download"));
                        return [4 /*yield*/, FileSystem.deleteAsync(MODELS_DIR + modelName + '.litertlm', { idempotent: true })];
                    case 5:
                        _a.sent();
                        return [2 /*return*/, false];
                    case 6: return [2 /*return*/, true];
                }
            });
        });
    };
    LocalInferenceService.getModelPath = function (modelName) {
        if (modelName === void 0) { modelName = 'gemma-local'; }
        return MODELS_DIR + modelName + '.litertlm';
    };
    /** Validate model file integrity. Deletes corrupt/partial files. Returns true if valid. */
    LocalInferenceService.validateAndCleanModel = function () {
        return __awaiter(this, arguments, void 0, function (modelName) {
            var path, fileInfo, fileSize, minSize;
            if (modelName === void 0) { modelName = 'gemma-local'; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        path = MODELS_DIR + modelName + '.litertlm';
                        return [4 /*yield*/, FileSystem.getInfoAsync(path)];
                    case 1:
                        fileInfo = _a.sent();
                        if (!fileInfo.exists)
                            return [2 /*return*/, false];
                        fileSize = fileInfo.size || 0;
                        minSize = GEMMA_MODEL_BYTES * 0.95;
                        if (!(fileSize > 0 && fileSize < minSize)) return [3 /*break*/, 3];
                        console.warn("[Gemma] Corrupt model: ".concat((fileSize / 1e6).toFixed(1), "MB (expected ~").concat((GEMMA_MODEL_BYTES / 1e9).toFixed(2), "GB). Deleting."));
                        return [4 /*yield*/, FileSystem.deleteAsync(path, { idempotent: true })];
                    case 2:
                        _a.sent();
                        return [2 /*return*/, false];
                    case 3: return [2 /*return*/, true];
                }
            });
        });
    };
    LocalInferenceService.downloadModel = function () {
        return __awaiter(this, arguments, void 0, function (modelName, onProgress) {
            var path, exists, directUrl, headRes, _a, downloadResumable, result, e_1, _b;
            if (modelName === void 0) { modelName = 'gemma-local'; }
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        path = MODELS_DIR + modelName + '.litertlm';
                        return [4 /*yield*/, this.isModelDownloaded(modelName)];
                    case 1:
                        exists = _c.sent();
                        if (exists)
                            return [2 /*return*/, path];
                        directUrl = GEMMA_MODEL_URL;
                        _c.label = 2;
                    case 2:
                        _c.trys.push([2, 4, , 5]);
                        return [4 /*yield*/, fetch(GEMMA_MODEL_URL, { method: 'HEAD', redirect: 'follow' })];
                    case 3:
                        headRes = _c.sent();
                        if (headRes.url && headRes.url !== GEMMA_MODEL_URL) {
                            directUrl = headRes.url;
                        }
                        return [3 /*break*/, 5];
                    case 4:
                        _a = _c.sent();
                        return [3 /*break*/, 5];
                    case 5:
                        downloadResumable = FileSystem.createDownloadResumable(directUrl, path, { headers: { 'User-Agent': 'Mittens/1.0' } }, function (downloadProgress) {
                            var expected = downloadProgress.totalBytesExpectedToWrite || GEMMA_MODEL_BYTES;
                            var progress = downloadProgress.totalBytesWritten / expected;
                            if (onProgress)
                                onProgress(progress);
                        });
                        _c.label = 6;
                    case 6:
                        _c.trys.push([6, 8, , 13]);
                        return [4 /*yield*/, downloadResumable.downloadAsync()];
                    case 7:
                        result = _c.sent();
                        return [2 /*return*/, (result === null || result === void 0 ? void 0 : result.uri) || path];
                    case 8:
                        e_1 = _c.sent();
                        _c.label = 9;
                    case 9:
                        _c.trys.push([9, 11, , 12]);
                        return [4 /*yield*/, FileSystem.deleteAsync(path, { idempotent: true })];
                    case 10:
                        _c.sent();
                        return [3 /*break*/, 12];
                    case 11:
                        _b = _c.sent();
                        return [3 /*break*/, 12];
                    case 12: throw e_1;
                    case 13: return [2 /*return*/];
                }
            });
        });
    };
    /** Load the model into the native LiteRT-LM engine. Must be called before generateLocalResponse. */
    LocalInferenceService.loadModel = function () {
        return __awaiter(this, arguments, void 0, function (modelName, backend) {
            var isValid, native, path, e_2, msg;
            if (modelName === void 0) { modelName = 'gemma-local'; }
            if (backend === void 0) { backend = 'cpu'; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.validateAndCleanModel(modelName)];
                    case 1:
                        isValid = _a.sent();
                        if (!isValid) {
                            throw new Error('Model file missing or corrupt. Please re-download.');
                        }
                        native = getNativeModule();
                        if (!native) {
                            throw new Error('LiteRT-LM native module not available (requires custom dev build)');
                        }
                        path = this.getModelPath(modelName);
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, 4, , 5]);
                        return [4 /*yield*/, native.loadModel(path, backend)];
                    case 3:
                        _a.sent();
                        return [3 /*break*/, 5];
                    case 4:
                        e_2 = _a.sent();
                        msg = (e_2 === null || e_2 === void 0 ? void 0 : e_2.message) || String(e_2);
                        // Don't delete the model file -- engine creation failures are usually
                        // backend config or memory issues, not file corruption.
                        console.error("[Gemma] Native loadModel failed: ".concat(msg));
                        throw new Error(msg);
                    case 5: return [2 /*return*/];
                }
            });
        });
    };
    /** Check if the native engine has a model loaded and ready. */
    LocalInferenceService.isModelLoaded = function () {
        var native = getNativeModule();
        if (!native)
            return false;
        return native.isModelLoaded();
    };
    /** Get the time it took to load the model (ms), for benchmarking. */
    LocalInferenceService.getLoadTimeMs = function () {
        var native = getNativeModule();
        if (!native)
            return 0;
        return native.getLoadTimeMs();
    };
    /** Release the model from memory. */
    LocalInferenceService.unloadModel = function () {
        var native = getNativeModule();
        if (!native)
            return;
        native.unloadModel();
    };
    /** Helper to unwrap JSON-encoded responses from the native C-API on iOS */
    LocalInferenceService.unwrapNativeResponse = function (raw) {
        if (!raw.trim().startsWith('{'))
            return raw;
        try {
            var parsed = JSON.parse(raw);
            if (parsed.content && Array.isArray(parsed.content)) {
                return parsed.content.map(function (c) { return c.text || ''; }).join('');
            }
            else if (parsed.parts && Array.isArray(parsed.parts)) {
                return parsed.parts.map(function (p) { return p.text || ''; }).join('');
            }
            else if (typeof parsed.text === 'string') {
                return parsed.text;
            }
        }
        catch ( /* not valid JSON, return raw */_a) { /* not valid JSON, return raw */ }
        return raw;
    };
    /** Generate a response from a text-only prompt using on-device Gemma. */
    LocalInferenceService.generateLocalResponse = function (prompt_1) {
        return __awaiter(this, arguments, void 0, function (prompt, _modelName) {
            var native, raw;
            if (_modelName === void 0) { _modelName = 'gemma-local'; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        native = getNativeModule();
                        if (!native) {
                            throw new Error('LiteRT-LM native module not available (requires custom dev build)');
                        }
                        if (!native.isModelLoaded()) {
                            throw new Error('Model not loaded. Call loadModel() first.');
                        }
                        return [4 /*yield*/, native.generateText(prompt)];
                    case 1:
                        raw = _a.sent();
                        return [2 /*return*/, this.unwrapNativeResponse(raw)];
                }
            });
        });
    };
    /** Generate a response from a text prompt + image using on-device Gemma vision. */
    LocalInferenceService.generateWithImage = function (prompt_1, imagePath_1) {
        return __awaiter(this, arguments, void 0, function (prompt, imagePath, _modelName) {
            var native, raw;
            if (_modelName === void 0) { _modelName = 'gemma-local'; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        native = getNativeModule();
                        if (!native) {
                            throw new Error('LiteRT-LM native module not available (requires custom dev build)');
                        }
                        if (!native.isModelLoaded()) {
                            throw new Error('Model not loaded. Call loadModel() first.');
                        }
                        return [4 /*yield*/, native.generateWithImage(prompt, imagePath)];
                    case 1:
                        raw = _a.sent();
                        return [2 /*return*/, this.unwrapNativeResponse(raw)];
                }
            });
        });
    };
    /** Generate a response from a text prompt + multiple images using Gemma vision. */
    LocalInferenceService.generateWithImages = function (prompt, imagePaths) {
        return __awaiter(this, void 0, void 0, function () {
            var native, raw_1, raw;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        native = getNativeModule();
                        if (!native) {
                            throw new Error('LiteRT-LM native module not available (requires custom dev build)');
                        }
                        if (!native.isModelLoaded()) {
                            throw new Error('Model not loaded. Call loadModel() first.');
                        }
                        if (!native.generateWithImages) return [3 /*break*/, 2];
                        return [4 /*yield*/, native.generateWithImages(prompt, imagePaths)];
                    case 1:
                        raw_1 = _a.sent();
                        return [2 /*return*/, this.unwrapNativeResponse(raw_1)];
                    case 2: return [4 /*yield*/, native.generateWithImage(prompt, imagePaths[0])];
                    case 3:
                        raw = _a.sent();
                        return [2 /*return*/, this.unwrapNativeResponse(raw)];
                }
            });
        });
    };
    /** Generate a response from a text prompt + audio file using on-device Gemma E2B/E4B native audio. */
    LocalInferenceService.generateWithAudio = function (prompt, audioPath) {
        return __awaiter(this, void 0, void 0, function () {
            var native, raw;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        native = getNativeModule();
                        if (!native) {
                            throw new Error('LiteRT-LM native module not available (requires custom dev build)');
                        }
                        if (!native.isModelLoaded()) {
                            throw new Error('Model not loaded. Call loadModel() first.');
                        }
                        if (!native.generateWithAudio) {
                            throw new Error('Audio input not supported in this build. Rebuild with audio-enabled LiteRT-LM.');
                        }
                        return [4 /*yield*/, native.generateWithAudio(prompt, audioPath)];
                    case 1:
                        raw = _a.sent();
                        return [2 /*return*/, this.unwrapNativeResponse(raw)];
                }
            });
        });
    };
    return LocalInferenceService;
}());
exports.LocalInferenceService = LocalInferenceService;
