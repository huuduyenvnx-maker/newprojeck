import OpenAI from "openai";

// the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_ENV_VAR || "default_key"
});

interface VerificationResult {
  verified: boolean;
  confidence: number;
  analysis: string;
  tokens?: number;
}

class OpenAIService {
  async verifyForecast(context: string): Promise<VerificationResult> {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5",
        messages: [
          {
            role: "system",
            content: `You are an expert agricultural market analyst. Analyze the provided forecast methodology and results for agricultural commodity prices. 

            Provide your analysis in JSON format with the following structure:
            {
              "verified": boolean,
              "confidence": number (0.0 to 1.0),
              "analysis": "detailed explanation of your assessment",
              "reasoning": "key factors that influenced your decision"
            }

            Consider these factors:
            - Forecast methodology soundness
            - Price trajectory alignment with seasonal patterns
            - Market fundamentals consistency
            - Statistical metrics appropriateness
            - Confidence interval reasonableness`
          },
          {
            role: "user",
            content: context
          }
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 500
      });

      const result = JSON.parse(response.choices[0].message.content || "{}");
      
      return {
        verified: result.verified || false,
        confidence: Math.max(0, Math.min(1, result.confidence || 0)),
        analysis: result.analysis || "Analysis unavailable",
        tokens: response.usage?.total_tokens || 0
      };
    } catch (error) {
      console.error("OpenAI verification failed:", error);
      throw new Error(`OpenAI verification failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async analyzePriceAnomaly(priceData: any[], currentPrice: number): Promise<{
    isAnomaly: boolean;
    severity: string;
    explanation: string;
  }> {
    try {
      const recentPrices = priceData.slice(-30).map(d => d.price);
      const avgPrice = recentPrices.reduce((sum, price) => sum + parseFloat(price), 0) / recentPrices.length;
      const priceChange = ((currentPrice - avgPrice) / avgPrice) * 100;

      const response = await openai.chat.completions.create({
        model: "gpt-5",
        messages: [
          {
            role: "system",
            content: `You are an agricultural market analyst. Analyze price data for anomalies.
            
            Respond in JSON format:
            {
              "isAnomaly": boolean,
              "severity": "low" | "medium" | "high",
              "explanation": "detailed explanation"
            }`
          },
          {
            role: "user",
            content: `Current price: $${currentPrice}
            30-day average: $${avgPrice.toFixed(2)}
            Price change: ${priceChange.toFixed(1)}%
            Recent price history: ${recentPrices.slice(-10).join(', ')}`
          }
        ],
        response_format: { type: "json_object" }
      });

      const result = JSON.parse(response.choices[0].message.content || "{}");
      
      return {
        isAnomaly: result.isAnomaly || false,
        severity: result.severity || "low",
        explanation: result.explanation || "No anomaly detected"
      };
    } catch (error) {
      console.error("Price anomaly analysis failed:", error);
      throw new Error(`Price anomaly analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async generateMarketInsights(commodityData: any): Promise<{
    summary: string;
    keyFactors: string[];
    outlook: string;
  }> {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5",
        messages: [
          {
            role: "system",
            content: `You are an agricultural market expert. Generate market insights based on commodity data.
            
            Respond in JSON format:
            {
              "summary": "brief market summary",
              "keyFactors": ["factor1", "factor2", "factor3"],
              "outlook": "market outlook description"
            }`
          },
          {
            role: "user",
            content: `Commodity: ${commodityData.name}
            Region: ${commodityData.region}
            Current trends: ${JSON.stringify(commodityData.trends || {})}`
          }
        ],
        response_format: { type: "json_object" }
      });

      const result = JSON.parse(response.choices[0].message.content || "{}");
      
      return {
        summary: result.summary || "Market analysis unavailable",
        keyFactors: result.keyFactors || [],
        outlook: result.outlook || "Outlook unavailable"
      };
    } catch (error) {
      console.error("Market insights generation failed:", error);
      throw new Error(`Market insights generation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export const openaiService = new OpenAIService();
