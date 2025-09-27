import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ 
  apiKey: process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_ENV_VAR || "default_key"
});

interface VerificationResult {
  verified: boolean;
  confidence: number;
  analysis: string;
  tokens?: number;
}

class GeminiService {
  async verifyForecast(context: string): Promise<VerificationResult> {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-pro",
        config: {
          systemInstruction: `You are an expert agricultural economist specializing in commodity price forecasting. 
          Analyze the provided forecast data and methodology for agricultural commodities.
          
          Evaluate based on:
          - Statistical model appropriateness
          - Economic fundamentals alignment
          - Seasonal pattern consistency
          - Risk factor consideration
          - Forecast horizon reasonableness
          
          Provide verification in JSON format with verified (boolean), confidence (0.0-1.0), and analysis (string).`,
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              verified: { type: "boolean" },
              confidence: { type: "number" },
              analysis: { type: "string" },
              reasoning: { type: "string" }
            },
            required: ["verified", "confidence", "analysis"]
          }
        },
        contents: context
      });

      const rawJson = response.text;
      if (!rawJson) {
        throw new Error("Empty response from Gemini");
      }

      const result = JSON.parse(rawJson);
      
      return {
        verified: result.verified || false,
        confidence: Math.max(0, Math.min(1, result.confidence || 0)),
        analysis: result.analysis || "Analysis unavailable",
        tokens: 0 // Gemini doesn't provide token count in this API
      };
    } catch (error) {
      console.error("Gemini verification failed:", error);
      throw new Error(`Gemini verification failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async crossValidateData(sourceData: any[], targetMetrics: any): Promise<{
    isValid: boolean;
    qualityScore: number;
    issues: string[];
  }> {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              isValid: { type: "boolean" },
              qualityScore: { type: "number" },
              issues: { 
                type: "array",
                items: { type: "string" }
              }
            },
            required: ["isValid", "qualityScore", "issues"]
          }
        },
        contents: `Cross-validate this agricultural data quality:
        
        Source data points: ${sourceData.length}
        Target metrics: ${JSON.stringify(targetMetrics)}
        Sample data: ${JSON.stringify(sourceData.slice(0, 5))}
        
        Evaluate data consistency, completeness, and reliability for agricultural commodity forecasting.`
      });

      const result = JSON.parse(response.text || "{}");
      
      return {
        isValid: result.isValid || false,
        qualityScore: Math.max(0, Math.min(1, result.qualityScore || 0)),
        issues: result.issues || []
      };
    } catch (error) {
      console.error("Gemini data validation failed:", error);
      throw new Error(`Gemini data validation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async generateWeatherImpactAnalysis(weatherData: any, commodityType: string): Promise<{
    impactLevel: string;
    description: string;
    recommendations: string[];
  }> {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-pro",
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              impactLevel: { type: "string" },
              description: { type: "string" },
              recommendations: {
                type: "array",
                items: { type: "string" }
              }
            },
            required: ["impactLevel", "description", "recommendations"]
          }
        },
        contents: `Analyze weather impact on agricultural commodity: ${commodityType}
        
        Weather conditions: ${JSON.stringify(weatherData)}
        
        Assess the impact level (low/medium/high) and provide specific recommendations for farmers and traders.`
      });

      const result = JSON.parse(response.text || "{}");
      
      return {
        impactLevel: result.impactLevel || "low",
        description: result.description || "Weather impact analysis unavailable",
        recommendations: result.recommendations || []
      };
    } catch (error) {
      console.error("Weather impact analysis failed:", error);
      throw new Error(`Weather impact analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export const geminiService = new GeminiService();
