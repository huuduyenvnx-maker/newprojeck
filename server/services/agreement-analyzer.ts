import { storage } from "../storage";
import { openaiService } from "./openai";
import { type InsertAgreementAnalysis, type AgreementAnalysis, type LlmVerification } from "@shared/schema";
import OpenAI from "openai";

// Agreement Analysis Metrics
interface AgreementMetrics {
  semanticSimilarity: number;    // 0-1: Cosine similarity of embeddings
  priceVariance: number;         // 0-1: Normalized price prediction variance (0 = identical)
  trendAlignment: number;        // 0-1: Trend direction consistency
  confidenceOverlap: number;    // 0-1: Confidence interval overlap
}

// Parsed LLM Response for comparison
interface ParsedLLMResponse {
  priceTarget: number | null;
  priceRange: { min: number; max: number } | null;
  trend: 'bullish' | 'bearish' | 'neutral' | 'unknown';
  confidence: number; // 0-100
  reasoning: string;
  timeframe: string;
  keyFactors: string[];
}

// Agreement Analysis Result
interface AgreementAnalysisResult {
  agreementScore: number; // 0-100 final score
  metrics: AgreementMetrics;
  analysisDetails: {
    openaiResponse: ParsedLLMResponse;
    geminiResponse: ParsedLLMResponse;
    comparisonAnalysis: any;
    calculations: any;
  };
  method: string;
  embeddingModel: string;
}

class AgreementAnalyzer {
  private openai: OpenAI;
  private embeddingModel = "text-embedding-3-small";
  private agreementThresholds = {
    high: 0.85,      // High agreement threshold
    medium: 0.70,    // Medium agreement threshold
    priceVariance: 0.05  // 5% price variance tolerance for high agreement
  };

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  /**
   * Analyze agreement between two LLM verifications with robust fallbacks
   * Never throws errors - returns conservative scores when APIs unavailable
   */
  async analyzeAgreement(
    openaiVerificationId: string,
    geminiVerificationId: string,
    ccsId: string
  ): Promise<AgreementAnalysisResult> {
    let method = "embedding_cosine";
    let embeddingModel = this.embeddingModel;
    let degradedMode = false;
    
    try {
      // Get verification records
      const [openaiVerifications, geminiVerifications] = await Promise.all([
        storage.getVerifications(undefined, undefined),
        storage.getVerifications(undefined, undefined)
      ]);

      const openaiVerification = openaiVerifications.find(v => v.id === openaiVerificationId);
      const geminiVerification = geminiVerifications.find(v => v.id === geminiVerificationId);

      if (!openaiVerification || !geminiVerification) {
        console.error("One or both verification records not found, using fallback analysis");
        return this.getFallbackAgreementAnalysis("Verification records not found");
      }

      // Parse LLM responses
      const openaiParsed = await this.parseLLMResponse(openaiVerification.response);
      const geminiParsed = await this.parseLLMResponse(geminiVerification.response);

      // Calculate agreement metrics with potential fallbacks
      const metrics = await this.calculateAgreementMetrics(
        openaiVerification.response,
        geminiVerification.response,
        openaiParsed,
        geminiParsed
      );

      // Check if we used fallback methods (semantic similarity < 0.8 suggests fallback was used)
      if (metrics.semanticSimilarity < 0.8 && !process.env.OPENAI_API_KEY) {
        degradedMode = true;
        method = "text_heuristic_fallback";
        embeddingModel = "none_fallback";
      }

      // Calculate final agreement score
      const agreementScore = this.calculateAgreementScore(metrics);

      // Prepare detailed analysis
      const analysisDetails = {
        openaiResponse: openaiParsed,
        geminiResponse: geminiParsed,
        comparisonAnalysis: {
          semanticSimilarityLevel: this.classifySimilarity(metrics.semanticSimilarity),
          priceAgreementLevel: this.classifyPriceAgreement(metrics.priceVariance),
          trendConsistency: metrics.trendAlignment > 0.8 ? 'high' : metrics.trendAlignment > 0.5 ? 'medium' : 'low',
          overallAgreement: agreementScore > 85 ? 'high' : agreementScore > 70 ? 'medium' : 'low',
          degradedMode,
          fallbackReason: degradedMode ? "OpenAI API unavailable" : null
        },
        calculations: {
          weightedComponents: {
            semantic: metrics.semanticSimilarity * 0.4,
            priceVariance: (1 - metrics.priceVariance) * 0.3,
            trendAlignment: metrics.trendAlignment * 0.2,
            confidenceOverlap: metrics.confidenceOverlap * 0.1
          },
          finalScore: agreementScore,
          timestamp: new Date().toISOString(),
          methodUsed: method,
          degradedMode
        }
      };

      return {
        agreementScore,
        metrics,
        analysisDetails,
        method,
        embeddingModel
      };

    } catch (error) {
      console.error("Agreement analysis failed completely, using fallback:", error);
      return this.getFallbackAgreementAnalysis(error.message);
    }
  }

  /**
   * Conservative fallback agreement analysis when all else fails
   * Ensures the system never throws 500 errors due to LLM API issues
   */
  private getFallbackAgreementAnalysis(reason: string): AgreementAnalysisResult {
    console.log("Using conservative fallback agreement analysis due to:", reason);
    
    // Conservative metrics assuming moderate agreement
    const fallbackMetrics: AgreementMetrics = {
      semanticSimilarity: 0.45,      // Moderate similarity
      priceVariance: 0.3,           // Moderate price variance
      trendAlignment: 0.6,          // Moderate trend alignment
      confidenceOverlap: 0.5        // Moderate confidence overlap
    };

    const conservativeScore = this.calculateAgreementScore(fallbackMetrics);

    return {
      agreementScore: conservativeScore,
      metrics: fallbackMetrics,
      analysisDetails: {
        openaiResponse: {
          priceTarget: null,
          priceRange: null,
          trend: 'unknown',
          confidence: 50,
          reasoning: "Fallback analysis - original response unavailable",
          timeframe: "unknown",
          keyFactors: []
        },
        geminiResponse: {
          priceTarget: null,
          priceRange: null,
          trend: 'unknown',
          confidence: 50,
          reasoning: "Fallback analysis - original response unavailable",
          timeframe: "unknown",
          keyFactors: []
        },
        comparisonAnalysis: {
          semanticSimilarityLevel: 'medium',
          priceAgreementLevel: 'medium',
          trendConsistency: 'medium',
          overallAgreement: 'medium',
          degradedMode: true,
          fallbackReason: reason
        },
        calculations: {
          weightedComponents: {
            semantic: fallbackMetrics.semanticSimilarity * 0.4,
            priceVariance: (1 - fallbackMetrics.priceVariance) * 0.3,
            trendAlignment: fallbackMetrics.trendAlignment * 0.2,
            confidenceOverlap: fallbackMetrics.confidenceOverlap * 0.1
          },
          finalScore: conservativeScore,
          timestamp: new Date().toISOString(),
          methodUsed: "conservative_fallback",
          degradedMode: true
        }
      },
      method: "conservative_fallback",
      embeddingModel: "none_fallback"
    };
  }

  /**
   * Store agreement analysis result in database
   */
  async storeAgreementAnalysis(
    ccsId: string,
    openaiVerificationId: string,
    geminiVerificationId: string,
    analysisResult: AgreementAnalysisResult
  ): Promise<AgreementAnalysis> {
    const agreementData: InsertAgreementAnalysis = {
      ccsId,
      openaiVerificationId,
      geminiVerificationId,
      semanticSimilarity: analysisResult.metrics.semanticSimilarity.toString(),
      priceVariance: analysisResult.metrics.priceVariance.toString(),
      trendAlignment: analysisResult.metrics.trendAlignment.toString(),
      confidenceOverlap: analysisResult.metrics.confidenceOverlap.toString(),
      analysisMethod: analysisResult.method,
      embeddingModel: analysisResult.embeddingModel,
      analysisDetails: analysisResult.analysisDetails
    };

    return await storage.createAgreementAnalysis(agreementData);
  }

  /**
   * Calculate semantic similarity using embeddings with robust fallbacks
   * Returns conservative fallback scores when OpenAI API is unavailable
   */
  private async calculateSemanticSimilarity(text1: string, text2: string): Promise<number> {
    try {
      // Validate API key availability
      if (!process.env.OPENAI_API_KEY) {
        console.warn("OpenAI API key not available, using fallback semantic similarity");
        return this.getFallbackSemanticSimilarity(text1, text2);
      }

      // Get embeddings for both texts
      const [embedding1Response, embedding2Response] = await Promise.all([
        this.openai.embeddings.create({
          model: this.embeddingModel,
          input: text1
        }),
        this.openai.embeddings.create({
          model: this.embeddingModel,
          input: text2
        })
      ]);

      const embedding1 = embedding1Response.data[0].embedding;
      const embedding2 = embedding2Response.data[0].embedding;

      // Calculate cosine similarity
      const similarity = this.cosineSimilarity(embedding1, embedding2);
      console.log(`Semantic similarity calculated via embeddings: ${similarity.toFixed(4)}`);
      return similarity;

    } catch (error) {
      console.error("Semantic similarity calculation failed:", error);
      console.log("Falling back to text-based similarity analysis");
      return this.getFallbackSemanticSimilarity(text1, text2);
    }
  }

  /**
   * Fallback semantic similarity calculation when OpenAI API unavailable
   * Uses text-based heuristics for conservative similarity scoring
   */
  private getFallbackSemanticSimilarity(text1: string, text2: string): Promise<number> {
    try {
      // Simple text similarity heuristics
      const text1Lower = text1.toLowerCase();
      const text2Lower = text2.toLowerCase();
      
      // Jaccard similarity on words
      const words1 = new Set(text1Lower.split(/\s+/));
      const words2 = new Set(text2Lower.split(/\s+/));
      
      const intersection = new Set([...words1].filter(x => words2.has(x)));
      const union = new Set([...words1, ...words2]);
      
      const jaccardSimilarity = intersection.size / union.size;
      
      // Conservative scoring: cap at 0.7 for fallback method
      const conservativeSimilarity = Math.min(0.7, jaccardSimilarity);
      
      console.log(`Fallback semantic similarity (Jaccard): ${conservativeSimilarity.toFixed(4)}`);
      return Promise.resolve(conservativeSimilarity);
      
    } catch (error) {
      console.error("Fallback semantic similarity failed:", error);
      // Ultra-conservative fallback
      return Promise.resolve(0.4); // Moderate similarity assumption
    }
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(vectorA: number[], vectorB: number[]): number {
    const dotProduct = vectorA.reduce((sum, a, i) => sum + a * vectorB[i], 0);
    const magnitudeA = Math.sqrt(vectorA.reduce((sum, a) => sum + a * a, 0));
    const magnitudeB = Math.sqrt(vectorB.reduce((sum, b) => sum + b * b, 0));
    
    if (magnitudeA === 0 || magnitudeB === 0) return 0;
    return dotProduct / (magnitudeA * magnitudeB);
  }

  /**
   * Calculate all agreement metrics
   */
  private async calculateAgreementMetrics(
    openaiText: string,
    geminiText: string,
    openaiParsed: ParsedLLMResponse,
    geminiParsed: ParsedLLMResponse
  ): Promise<AgreementMetrics> {
    // 1. Semantic similarity using embeddings
    const semanticSimilarity = await this.calculateSemanticSimilarity(openaiText, geminiText);

    // 2. Price variance (normalized)
    const priceVariance = this.calculatePriceVariance(openaiParsed, geminiParsed);

    // 3. Trend alignment
    const trendAlignment = this.calculateTrendAlignment(openaiParsed.trend, geminiParsed.trend);

    // 4. Confidence overlap
    const confidenceOverlap = this.calculateConfidenceOverlap(
      openaiParsed.confidence,
      geminiParsed.confidence
    );

    return {
      semanticSimilarity,
      priceVariance,
      trendAlignment,
      confidenceOverlap
    };
  }

  /**
   * Calculate price prediction variance (0 = identical, 1 = maximum difference)
   */
  private calculatePriceVariance(response1: ParsedLLMResponse, response2: ParsedLLMResponse): number {
    if (!response1.priceTarget || !response2.priceTarget) {
      return 1.0; // Maximum variance if prices not found
    }

    const price1 = response1.priceTarget;
    const price2 = response2.priceTarget;
    const averagePrice = (price1 + price2) / 2;

    if (averagePrice === 0) return 1.0;

    const variance = Math.abs(price1 - price2) / averagePrice;
    return Math.min(1.0, variance); // Cap at 1.0
  }

  /**
   * Calculate trend direction alignment (0-1)
   */
  private calculateTrendAlignment(trend1: string, trend2: string): number {
    if (trend1 === trend2) return 1.0;
    
    // Partial alignment for similar trends
    const trendSimilarity: Record<string, Record<string, number>> = {
      'bullish': { 'neutral': 0.5, 'bearish': 0.0, 'unknown': 0.3 },
      'bearish': { 'neutral': 0.5, 'bullish': 0.0, 'unknown': 0.3 },
      'neutral': { 'bullish': 0.5, 'bearish': 0.5, 'unknown': 0.4 },
      'unknown': { 'bullish': 0.3, 'bearish': 0.3, 'neutral': 0.4 }
    };

    return trendSimilarity[trend1]?.[trend2] || 0.0;
  }

  /**
   * Calculate confidence interval overlap (0-1)
   */
  private calculateConfidenceOverlap(confidence1: number, confidence2: number): number {
    // Simplified confidence overlap calculation
    // In a more sophisticated version, this could use actual confidence intervals
    const diff = Math.abs(confidence1 - confidence2);
    const maxDiff = 100; // Maximum possible difference
    return 1.0 - (diff / maxDiff);
  }

  /**
   * Calculate final agreement score from metrics
   */
  private calculateAgreementScore(metrics: AgreementMetrics): number {
    // Weighted combination of metrics
    const weights = {
      semantic: 0.4,      // 40% weight to semantic similarity
      priceVariance: 0.3, // 30% weight to price agreement (inverted)
      trendAlignment: 0.2, // 20% weight to trend alignment
      confidenceOverlap: 0.1 // 10% weight to confidence overlap
    };

    const score = (
      metrics.semanticSimilarity * weights.semantic +
      (1 - metrics.priceVariance) * weights.priceVariance + // Invert price variance
      metrics.trendAlignment * weights.trendAlignment +
      metrics.confidenceOverlap * weights.confidenceOverlap
    ) * 100;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Parse LLM response to extract structured information
   */
  private async parseLLMResponse(response: string): Promise<ParsedLLMResponse> {
    try {
      // Use a more sophisticated parsing approach with LLM assistance
      const parsePrompt = `
        Parse the following agricultural forecast analysis and extract structured information:
        
        "${response}"
        
        Extract and return JSON with:
        - priceTarget: single price prediction (number or null)
        - priceRange: {min: number, max: number} or null
        - trend: "bullish", "bearish", "neutral", or "unknown"
        - confidence: confidence level 0-100
        - timeframe: time period mentioned
        - keyFactors: array of key factors mentioned
        
        Return only valid JSON.
      `;

      const parseResponse = await openaiService.chat({
        messages: [{ role: "user", content: parsePrompt }],
        temperature: 0.1,
        max_tokens: 500
      });

      const parsedContent = parseResponse.choices[0]?.message?.content;
      if (!parsedContent) {
        throw new Error("No parsing response received");
      }

      // Try to parse JSON response
      try {
        const parsed = JSON.parse(parsedContent);
        return {
          priceTarget: parsed.priceTarget,
          priceRange: parsed.priceRange,
          trend: parsed.trend || 'unknown',
          confidence: parsed.confidence || 50,
          reasoning: response, // Keep original for context
          timeframe: parsed.timeframe || 'unknown',
          keyFactors: parsed.keyFactors || []
        };
      } catch (jsonError) {
        // Fallback to simple text parsing
        return this.simpleParseLLMResponse(response);
      }

    } catch (error) {
      console.error("LLM response parsing failed:", error);
      return this.simpleParseLLMResponse(response);
    }
  }

  /**
   * Simple fallback parsing using regex patterns
   */
  private simpleParseLLMResponse(response: string): ParsedLLMResponse {
    const text = response.toLowerCase();
    
    // Extract price target using regex
    const priceMatches = text.match(/\$?(\d+(?:,\d{3})*(?:\.\d{2})?)/g);
    const priceTarget = priceMatches ? parseFloat(priceMatches[0].replace(/[$,]/g, '')) : null;

    // Determine trend
    let trend: 'bullish' | 'bearish' | 'neutral' | 'unknown' = 'unknown';
    if (text.includes('bullish') || text.includes('increase') || text.includes('rise')) {
      trend = 'bullish';
    } else if (text.includes('bearish') || text.includes('decrease') || text.includes('fall')) {
      trend = 'bearish';
    } else if (text.includes('stable') || text.includes('neutral') || text.includes('steady')) {
      trend = 'neutral';
    }

    // Extract confidence (simple pattern matching)
    const confidenceMatches = text.match(/(\d+)%?\s*confident?/);
    const confidence = confidenceMatches ? parseInt(confidenceMatches[1]) : 50;

    return {
      priceTarget,
      priceRange: null,
      trend,
      confidence: Math.max(0, Math.min(100, confidence)),
      reasoning: response,
      timeframe: 'unknown',
      keyFactors: []
    };
  }

  /**
   * Classify semantic similarity level
   */
  private classifySimilarity(similarity: number): string {
    if (similarity >= this.agreementThresholds.high) return 'high';
    if (similarity >= this.agreementThresholds.medium) return 'medium';
    return 'low';
  }

  /**
   * Classify price agreement level
   */
  private classifyPriceAgreement(variance: number): string {
    if (variance <= this.agreementThresholds.priceVariance) return 'high';
    if (variance <= this.agreementThresholds.priceVariance * 2) return 'medium';
    return 'low';
  }

  /**
   * Get agreement thresholds configuration
   */
  getThresholds() {
    return { ...this.agreementThresholds };
  }

  /**
   * Update agreement thresholds for tuning
   */
  updateThresholds(newThresholds: Partial<typeof this.agreementThresholds>): void {
    this.agreementThresholds = { ...this.agreementThresholds, ...newThresholds };
  }
}

export const agreementAnalyzer = new AgreementAnalyzer();
export type { AgreementAnalysisResult, AgreementMetrics, ParsedLLMResponse };