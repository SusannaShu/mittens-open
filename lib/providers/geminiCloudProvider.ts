/**
 * GeminiCloudProvider -- wraps existing Strapi API calls to conform
 * to the InferenceProvider interface.
 *
 * No behavior change from the current flow.  This is purely a structural
 * refactor to allow swapping in the local Gemma provider later.
 */

import {
  InferenceProvider,
  FoodIdentification,
  NutrientEstimate,
  EstimationContext,
  ChatContext,
  ChatResponse,
} from './inferenceProvider';
import { chatWithMittens, smartSnap } from '../api';

export class GeminiCloudProvider implements InferenceProvider {
  async identifyFoods(images: string[], caption?: string): Promise<FoodIdentification> {
    // Uses the existing smart-snap endpoint which routes through Strapi -> Gemini
    if (images.length === 0) {
      return { foods: [] };
    }
    const FileSystem = require('expo-file-system/legacy');
    let b64 = images[0];
    if (b64.startsWith('file://') || b64.startsWith('/')) {
      const { resizeForUpload } = require('../imageUtils');
      try {
        const resizedUri = await resizeForUpload(images[0]);
        b64 = await FileSystem.readAsStringAsync(resizedUri, { encoding: FileSystem.EncodingType.Base64 });
      } catch (err) {
        console.warn('Failed to resize image, falling back to original:', err);
        b64 = await FileSystem.readAsStringAsync(images[0], { encoding: FileSystem.EncodingType.Base64 });
      }
    }
    
    // Cloudinary / the Strapi backend expect properly data-prefixed base64 strings
    const prefixedB64 = b64.startsWith('data:') ? b64 : `data:image/jpeg;base64,${b64}`;
    const result = await smartSnap(prefixedB64);
    
    return {
      foods: result?.foods || [],
      mealType: result?.mealType,
      rawResponse: JSON.stringify(result),
    };
  }

  async estimateNutrients(
    food: { name: string; portion_g: number; cooking?: string },
    context: EstimationContext
  ): Promise<NutrientEstimate> {
    // Phase 2 estimation stays in cloud for now.
    // The Strapi backend already handles this in the nutrition-log controller.
    // This is a placeholder -- the actual per-food estimation pipeline
    // will be built in Phase 3 of the arch doc.
    return {
      nutrients: {},
      meta: {
        source: 'ai_estimate',
        allRefs: [],
        adjustments: [],
        justification: 'Cloud estimation via Strapi -> Gemini',
      },
    };
  }

  async chat(context: ChatContext): Promise<ChatResponse> {
    const result = await chatWithMittens(
      context.message,
      context.messageId,
      context.tzOffset
    );
    return {
      reply: result?.reply || result?.draftReply || '',
      memoryUpdates: result?.memoryUpdates || [],
      dataNeeded: result?.dataNeeded || [],
      actions: result?.actions || [],
    };
  }

  async generateRaw(prompt: string): Promise<string> {
    // Cloud raw generation goes through the chat endpoint with a raw flag.
    // For now, delegate to chatWithMittens.
    const result = await chatWithMittens(prompt);
    return result?.reply || result?.draftReply || '';
  }
}
