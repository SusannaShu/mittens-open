import { getBrain } from '../../brain/selector';
import { ChatRespondResult } from '../types';

export async function generateChatResponse(userMessage: string, contextData: string): Promise<ChatRespondResult> {
  const brain = await getBrain();
  
  const prompt = `You are Mittens. Direct, concise, no emojis.
Use the provided data context (if any) to answer the user's message.
Do not use markdown formatting unless absolutely necessary. Be extremely concise.
If the user asks for meal recommendations (e.g., "what should I eat"), use their nutrition gaps, pantry items, or today's meal plan from the Context Data to suggest a specific, healthy meal.

Context Data:
${contextData || 'None'}

User Message: ${userMessage}
`;

  const responseText = await brain.text(prompt, { temperature: 0.7 });
  
  return { reply: responseText.trim() };
}
