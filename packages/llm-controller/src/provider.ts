import { EngineAction } from "@relay/protocol";
import { GoogleGenAI, Type, Schema, HarmCategory, HarmBlockThreshold } from "@google/genai";

export interface LLMProvider {
  generateActions(prompt: string): Promise<EngineAction[]>;
}

export class GeminiProvider implements LLMProvider {
  private ai: GoogleGenAI;

  constructor(apiKey?: string) {
    this.ai = new GoogleGenAI({ apiKey: apiKey || process.env.GEMINI_API_KEY });
  }

  async generateActions(prompt: string): Promise<EngineAction[]> {
    const actionSchema: Schema = {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          type: { 
            type: Type.STRING,
            enum: ["navigate", "click", "input", "extract"]
          },
          params: {
            type: Type.OBJECT,
            properties: {
              url: { type: Type.STRING },
              target: {
                type: Type.OBJECT,
                properties: {
                  role: { type: Type.STRING },
                  name: { type: Type.STRING },
                  text: { type: Type.STRING },
                  placeholder: { type: Type.STRING }
                }
              },
              value: { type: Type.STRING }
            }
          }
        },
        required: ["type", "params"]
      }
    };

    try {
      const response =
        await this.ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt,
          config: {
          responseMimeType: "application/json",
          responseSchema: actionSchema,
          temperature: 0.1,
          safetySettings: [
            {
              category: HarmCategory.HARM_CATEGORY_HARASSMENT,
              threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
              category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
              threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
              category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
              threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
              category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
              threshold: HarmBlockThreshold.BLOCK_NONE,
            },
          ]
        }
      });

      return JSON.parse(response.text || "[]") as EngineAction[];
    } catch (e) {
      console.error("Failed to parse LLM response", e);
      return [];
    }
  }
}
