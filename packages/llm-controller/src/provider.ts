import { EngineAction } from "@relay/protocol";

export interface LLMResponse {
  actions: EngineAction[];
  isComplete: boolean;
}

export interface LLMProvider {
  generateActions(prompt: string): Promise<LLMResponse>;
}

export class GeminiProvider implements LLMProvider {
  // @google/genai is ESM-only; keep a lazy dynamic import under CJS emit.
  private ai: any = null;
  private genai: any = null;
  private readonly apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY;
  }

  private async getClient(): Promise<{ ai: any; mod: any }> {
    if (!this.genai) {
      this.genai = await import("@google/genai");
    }
    if (!this.ai) {
      this.ai = new this.genai.GoogleGenAI({ apiKey: this.apiKey });
    }
    return { ai: this.ai, mod: this.genai };
  }

  async generateActions(prompt: string): Promise<LLMResponse> {
    const { ai, mod } = await this.getClient();
    const { Type, HarmCategory, HarmBlockThreshold } = mod;

    const actionSchema = {
      type: Type.OBJECT,
      properties: {
        actions: {
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
        },
        isComplete: {
          type: Type.BOOLEAN,
          description: "Set to true if the goal description has been fully accomplished."
        }
      },
      required: ["actions", "isComplete"]
    };

    try {
      const response =
        await ai.models.generateContent({
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

      return JSON.parse(response.text || `{"actions":[], "isComplete":false}`) as LLMResponse;
    } catch (e) {
      console.error("Failed to parse LLM response", e);
      return { actions: [], isComplete: false };
    }
  }
}
