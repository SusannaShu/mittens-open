import { getBrain } from '../../brain/selector';
import { ChatRespondResult } from '../types';

export async function generateChatResponse(userMessage: string, contextData: string): Promise<ChatRespondResult> {
  const brain = await getBrain();
  
  const prompt = `You are Mittens. Direct, concise, no emojis.
Use the provided data context (if any) to answer the user's message.
Do not use markdown formatting unless absolutely necessary. Be extremely concise.

Context Data:
${contextData || 'None'}

User Message: ${userMessage}
`;

  const responseText = await brain.text(prompt, { temperature: 0.7 });
  
  return { reply: responseText.trim() };
}
