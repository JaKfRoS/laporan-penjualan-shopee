
import { GoogleGenAI } from "@google/genai";

// Standard initialization using process.env.API_KEY
const apiKey = process.env.API_KEY;

export const getSalesInsights = async (data: any) => {
  if (!apiKey) {
    console.warn('Gemini API_KEY is missing. AI insights will be disabled.');
    return "AI insights are currently under maintenance.";
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Analyze this Shopee sales data and provide 3 actionable insights for the seller. Data: ${JSON.stringify(data)}`,
      config: {
        systemInstruction: "You are a professional Shopee e-commerce analyst. Provide concise, data-driven advice in bullet points.",
      }
    });
    
    return response.text || "No insights could be generated.";
  } catch (error: any) {
    console.error('Gemini error:', error);
    if (error.message?.includes('fetch')) {
      return "Network error: Unable to reach the AI service.";
    }
    return "An error occurred while generating insights.";
  }
};
