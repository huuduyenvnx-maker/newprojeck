import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { storage } from "../../storage";
import { requireAuth, requireWriteAccess } from "../../middleware/session-auth";
import { llmVerificationService } from "../../services/llm-verification";
import { agreementAnalyzer } from "../../services/agreement-analyzer";
import { qualityGatesEngine } from "../../services/quality-gates";
import { 
  llmCrosscheckRequestSchema, 
  getVietnameseSeasonalContext,
  type LlmCrosscheckRequest
} from "../../schemas/v1-requests";
import { 
  createSuccessResponse, 
  createErrorResponse,
  type LlmCrosscheckResponse
} from "../../schemas/v1-responses";

const router = Router();

// Rate limiting tracking (simple in-memory for now)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_REQUESTS = 5; // Lower limit for LLM verification (more expensive)
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute

// Helper function to check rate limits
const checkRateLimit = (clientId: string): { allowed: boolean; remaining: number; resetAt: Date } => {
  const now = Date.now();
  const clientData = rateLimitMap.get(clientId) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW };
  
  if (now > clientData.resetTime) {
    clientData.count = 0;
    clientData.resetTime = now + RATE_LIMIT_WINDOW;
  }
  
  if (clientData.count >= RATE_LIMIT_REQUESTS) {
    return { 
      allowed: false, 
      remaining: 0, 
      resetAt: new Date(clientData.resetTime) 
    };
  }
  
  clientData.count++;
  rateLimitMap.set(clientId, clientData);
  
  return { 
    allowed: true, 
    remaining: RATE_LIMIT_REQUESTS - clientData.count, 
    resetAt: new Date(clientData.resetTime) 
  };
};

// Helper function to build Vietnamese market insights
const buildVietnameseMarketInsights = (
  commodity: string, 
  region: string, 
  openaiResponse: any, 
  geminiResponse: any
) => {
  const seasonalContext = getVietnameseSeasonalContext();
  
  // Extract market sentiment from LLM responses
  const extractSentiment = (response: any): "bullish" | "bearish" | "neutral" => {
    const trend = response.price_assessment?.trend || response.trend;
    if (trend === "bullish") return "bullish";
    if (trend === "bearish") return "bearish";
    return "neutral";
  };

  const openaiSentiment = extractSentiment(openaiResponse);
  const geminiSentiment = extractSentiment(geminiResponse);
  
  // Combine sentiments
  let overallSentiment: "bullish" | "bearish" | "neutral";
  if (openaiSentiment === geminiSentiment) {
    overallSentiment = openaiSentiment;
  } else if (openaiSentiment === "neutral" || geminiSentiment === "neutral") {
    overallSentiment = openaiSentiment === "neutral" ? geminiSentiment : openaiSentiment;
  } else {
    overallSentiment = "neutral"; // Conflicting sentiments
  }

  // Export impact assessment based on commodity and region
  const exportOriented = {
    'rice': ['mekong-delta', 'red-river-delta'],
    'coffee': ['central-highlands'],
    'pepper': ['central-highlands', 'south-central'],
    'rubber': ['southeast', 'south-central']
  };

  const hasExportImpact = exportOriented[commodity as keyof typeof exportOriented]?.includes(region);

  // Seasonal factors
  const seasonalFactors = [];
  if (seasonalContext.isMonsoonSeason) {
    seasonalFactors.push("Monsoon season may affect production and transportation");
  }
  
  if (seasonalContext.isHarvestSeason[commodity as keyof typeof seasonalContext.isHarvestSeason]) {
    seasonalFactors.push(`${commodity} harvest season - supply increase expected`);
  }

  // Risk assessment
  const riskFactors = [
    seasonalContext.isMonsoonSeason ? "weather" : null,
    hasExportImpact ? "export_volatility" : null,
    "currency_fluctuation"
  ].filter(Boolean);

  const riskLevel = riskFactors.length >= 2 ? "high" : riskFactors.length === 1 ? "medium" : "low";

  return {
    market_sentiment: overallSentiment,
    export_impact: hasExportImpact ? 
      `High export orientation for ${commodity} in ${region} - international price volatility expected` : 
      undefined,
    seasonal_factors: seasonalFactors,
    risk_assessment: riskLevel as "low" | "medium" | "high",
  };
};

// Helper function to parse LLM response for price assessment
const parseLLMResponseForPriceAssessment = (response: string, confidence: number) => {
  // Simple parsing logic - in production this would be more sophisticated
  const responseText = response.toLowerCase();
  
  // Extract price target if mentioned
  const priceMatches = responseText.match(/(\$?\d+(?:\.\d+)?)/g);
  const priceTarget = priceMatches ? parseFloat(priceMatches[0].replace('$', '')) : undefined;
  
  // Extract price range
  let priceRange;
  if (responseText.includes('range') && priceMatches && priceMatches.length >= 2) {
    priceRange = {
      min: Math.min(parseFloat(priceMatches[0].replace('$', '')), parseFloat(priceMatches[1].replace('$', ''))),
      max: Math.max(parseFloat(priceMatches[0].replace('$', '')), parseFloat(priceMatches[1].replace('$', ''))),
    };
  }
  
  // Determine trend
  let trend: "bullish" | "bearish" | "neutral" | "unknown" = "unknown";
  if (responseText.includes('bullish') || responseText.includes('increase') || responseText.includes('upward')) {
    trend = "bullish";
  } else if (responseText.includes('bearish') || responseText.includes('decrease') || responseText.includes('downward')) {
    trend = "bearish";
  } else if (responseText.includes('stable') || responseText.includes('neutral')) {
    trend = "neutral";
  }
  
  return {
    price_target: priceTarget,
    price_range: priceRange,
    trend,
    confidence,
  };
};

// Helper function to assess agreement level
const assessAgreementLevel = (agreementScore: number): "high_agreement" | "medium_agreement" | "low_agreement" | "conflicting" => {
  if (agreementScore >= 85) return "high_agreement";
  if (agreementScore >= 70) return "medium_agreement";
  if (agreementScore >= 50) return "low_agreement";
  return "conflicting";
};

// Helper function to extract key differences and consensus points
const extractKeyDifferencesAndConsensus = (
  openaiResponse: any, 
  geminiResponse: any, 
  agreementAnalysis: any
) => {
  const keyDifferences = [];
  const consensusPoints = [];
  
  // Compare trends
  if (openaiResponse.price_assessment.trend !== geminiResponse.price_assessment.trend) {
    keyDifferences.push(`Trend disagreement: OpenAI sees ${openaiResponse.price_assessment.trend}, Gemini sees ${geminiResponse.price_assessment.trend}`);
  } else {
    consensusPoints.push(`Both models agree on ${openaiResponse.price_assessment.trend} trend`);
  }
  
  // Compare confidence levels
  const confidenceDiff = Math.abs(openaiResponse.confidence - geminiResponse.confidence);
  if (confidenceDiff > 20) {
    keyDifferences.push(`Significant confidence difference: ${confidenceDiff}% gap between models`);
  } else {
    consensusPoints.push(`Similar confidence levels (${Math.round(confidenceDiff)}% difference)`);
  }
  
  // Price target comparison
  if (openaiResponse.price_assessment.price_target && geminiResponse.price_assessment.price_target) {
    const priceDiff = Math.abs(openaiResponse.price_assessment.price_target - geminiResponse.price_assessment.price_target);
    const priceAvg = (openaiResponse.price_assessment.price_target + geminiResponse.price_assessment.price_target) / 2;
    const percentDiff = (priceDiff / priceAvg) * 100;
    
    if (percentDiff > 10) {
      keyDifferences.push(`Price target disagreement: ${percentDiff.toFixed(1)}% difference`);
    } else {
      consensusPoints.push(`Similar price targets (${percentDiff.toFixed(1)}% difference)`);
    }
  }
  
  return { keyDifferences, consensusPoints };
};

// ===========================================
// POST /v1/llm-crosscheck - LLM Verification
// ===========================================

router.post("/llm-crosscheck", requireWriteAccess, async (req: Request, res: Response) => {
  const startTime = Date.now();
  const requestId = uuidv4();
  
  // Set security headers
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  });

  try {
    // Rate limiting check (stricter for LLM endpoints)
    const clientId = req.ip || 'unknown';
    const rateLimit = checkRateLimit(clientId);
    
    if (!rateLimit.allowed) {
      return res.status(429).json(createErrorResponse(
        "RATE_LIMIT_EXCEEDED",
        "Too many LLM verification requests. Please try again later.",
        "Quá nhiều yêu cầu xác minh LLM. Vui lòng thử lại sau.",
        "rate_limit_exceeded",
        { 
          rate_limit: {
            remaining: rateLimit.remaining,
            reset_at: rateLimit.resetAt.toISOString(),
          }
        },
        requestId
      ));
    }

    // Validate request body
    let validatedRequest: LlmCrosscheckRequest;
    try {
      validatedRequest = llmCrosscheckRequestSchema.parse({
        ...req.body,
        request_id: requestId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(createErrorResponse(
          "VALIDATION_ERROR",
          "Invalid request parameters",
          "Tham số yêu cầu không hợp lệ",
          "validation_error",
          { validation_errors: error.errors },
          requestId
        ));
      }
      throw error;
    }

    const { forecast_data, verification_type, context_overrides, force_reverification } = validatedRequest;
    const { commodity, region, predictions, metrics } = forecast_data;

    // Get commodity and region details for validation
    const [commodityRecord, regionRecord] = await Promise.all([
      storage.getCommodities().then(commodities => commodities.find(c => c.name === commodity)),
      storage.getRegions().then(regions => regions.find(r => r.name === region))
    ]);

    if (!commodityRecord || !regionRecord) {
      return res.status(400).json(createErrorResponse(
        "INVALID_COMMODITY_REGION",
        "Commodity or region not found in database",
        "Không tìm thấy hàng hóa hoặc khu vực trong cơ sở dữ liệu",
        "validation_error",
        { commodity, region },
        requestId
      ));
    }

    // Check if we have existing verifications and should reuse them
    let openaiVerification, geminiVerification;
    let shouldRunNewVerification = force_reverification;

    if (!shouldRunNewVerification && (forecast_data.forecast_run_id || forecast_data.forecast_30d_id)) {
      // Check for existing verifications
      const targetId = forecast_data.forecast_30d_id || forecast_data.forecast_run_id;
      let existingVerifications;
      
      if (forecast_data.forecast_30d_id) {
        existingVerifications = await storage.getVerificationsByForecast30d(forecast_data.forecast_30d_id);
      } else if (forecast_data.forecast_run_id) {
        existingVerifications = await storage.getVerifications(forecast_data.forecast_run_id);
      }

      if (existingVerifications && existingVerifications.length >= 2) {
        openaiVerification = existingVerifications.find(v => v.provider === 'openai');
        geminiVerification = existingVerifications.find(v => v.provider === 'gemini');
        
        if (openaiVerification && geminiVerification) {
          console.log(`Reusing existing verifications for ${targetId}`);
        } else {
          shouldRunNewVerification = true;
        }
      } else {
        shouldRunNewVerification = true;
      }
    } else {
      shouldRunNewVerification = true;
    }

    // Run new LLM verification if needed
    if (shouldRunNewVerification) {
      try {
        console.log(`Running new LLM verification for ${commodity} in ${region}`);
        
        // Prepare forecast context for LLM verification
        const mockForecast = {
          id: forecast_data.forecast_run_id || uuidv4(),
          commodityId: commodity,
          regionId: region,
          method: "api_crosscheck",
          horizon: predictions.length,
          modelVersion: "v1.0",
          predictions: predictions.map(p => ({
            date: p.date,
            median: p.median,
            q10: p.q10,
            q25: p.q25,
            q75: p.q75,
            q90: p.q90,
            confidence: p.confidence,
            trend: p.trend,
          })),
          metrics: metrics || {},
        };

        // Run LLM verification
        const verificationResults = await llmVerificationService.verifyForecast(mockForecast.id);
        
        if (Array.isArray(verificationResults)) {
          openaiVerification = verificationResults.find(v => v.provider === 'openai');
          geminiVerification = verificationResults.find(v => v.provider === 'gemini');
        }

      } catch (error) {
        console.error("LLM verification failed:", error);
        
        // Check if this is a service unavailable error
        const errorMessage = (error as Error).message;
        if (errorMessage?.includes('API') || errorMessage?.includes('service')) {
          return res.status(503).json(createErrorResponse(
            "LLM_SERVICE_UNAVAILABLE",
            "LLM verification services temporarily unavailable",
            "Dịch vụ xác minh LLM tạm thời không khả dụng",
            "service_unavailable",
            { 
              details: "One or both LLM providers (OpenAI/Gemini) are currently unavailable",
              fallback_available: false 
            },
            requestId
          ));
        }
        
        throw error;
      }
    }

    // Verify we have both verifications
    if (!openaiVerification || !geminiVerification) {
      return res.status(503).json(createErrorResponse(
        "INCOMPLETE_VERIFICATION",
        "Could not obtain verifications from both LLM providers",
        "Không thể nhận được xác minh từ cả hai nhà cung cấp LLM",
        "service_unavailable",
        { 
          openai_available: !!openaiVerification,
          gemini_available: !!geminiVerification 
        },
        requestId
      ));
    }

    // Run agreement analysis
    let agreementResult;
    try {
      agreementResult = await agreementAnalyzer.analyzeAgreement(
        openaiVerification.id,
        geminiVerification.id,
        uuidv4() // CCS ID placeholder for standalone verification
      );
    } catch (error) {
      console.error("Agreement analysis failed:", error);
      
      // Provide fallback agreement analysis
      agreementResult = {
        agreementScore: 50, // Conservative fallback
        metrics: {
          semanticSimilarity: 0.5,
          priceVariance: 0.3,
          trendAlignment: 0.6,
          confidenceOverlap: 0.5,
        },
        analysisDetails: {
          openaiResponse: { trend: 'unknown', confidence: 50, reasoning: 'Analysis unavailable' },
          geminiResponse: { trend: 'unknown', confidence: 50, reasoning: 'Analysis unavailable' },
          comparisonAnalysis: { degradedMode: true, fallbackReason: (error as Error).message },
          calculations: { methodUsed: 'fallback' }
        },
        method: "fallback",
        embeddingModel: "none",
      };
    }

    // Parse LLM responses for price assessments
    const openaiPriceAssessment = parseLLMResponseForPriceAssessment(
      openaiVerification.response, 
      parseFloat(openaiVerification.confidence)
    );
    
    const geminiPriceAssessment = parseLLMResponseForPriceAssessment(
      geminiVerification.response, 
      parseFloat(geminiVerification.confidence)
    );

    // Build response objects for the verifications
    const openaiResponseObj = {
      verification_id: openaiVerification.id,
      model: openaiVerification.model,
      confidence: parseFloat(openaiVerification.confidence),
      response: openaiVerification.response,
      price_assessment: openaiPriceAssessment,
      verified: openaiVerification.verified,
    };

    const geminiResponseObj = {
      verification_id: geminiVerification.id,
      model: geminiVerification.model,
      confidence: parseFloat(geminiVerification.confidence),
      response: geminiVerification.response,
      price_assessment: geminiPriceAssessment,
      verified: geminiVerification.verified,
    };

    // Extract key differences and consensus points
    const { keyDifferences, consensusPoints } = extractKeyDifferencesAndConsensus(
      openaiResponseObj, 
      geminiResponseObj, 
      agreementResult
    );

    // Build Vietnamese market insights
    const vietnameseMarketInsights = buildVietnameseMarketInsights(
      commodity, 
      region, 
      openaiResponseObj, 
      geminiResponseObj
    );

    // Determine confidence metrics
    const averageConfidence = (openaiResponseObj.confidence + geminiResponseObj.confidence) / 2;
    const confidenceSpread = Math.abs(openaiResponseObj.confidence - geminiResponseObj.confidence);
    
    let verificationReliability: "high" | "medium" | "low" | "degraded";
    if (agreementResult.method === "fallback") {
      verificationReliability = "degraded";
    } else if (agreementResult.agreementScore >= 80 && confidenceSpread <= 15) {
      verificationReliability = "high";
    } else if (agreementResult.agreementScore >= 60 && confidenceSpread <= 25) {
      verificationReliability = "medium";
    } else {
      verificationReliability = "low";
    }

    const processingNotes = [];
    if (agreementResult.method === "fallback") {
      processingNotes.push("Agreement analysis used fallback method due to API limitations");
    }
    if (!shouldRunNewVerification) {
      processingNotes.push("Reused existing LLM verifications");
    }
    if (context_overrides?.vietnamese_market_specifics) {
      processingNotes.push("Vietnamese market context applied to verification");
    }

    // Build final response
    const processingTime = Date.now() - startTime;
    const response: LlmCrosscheckResponse = createSuccessResponse({
      crosscheck_id: uuidv4(),
      verification_type,
      openai_verification: openaiResponseObj,
      gemini_verification: geminiResponseObj,
      agreement_analysis: {
        agreement_score: agreementResult.agreementScore,
        semantic_similarity: agreementResult.metrics.semanticSimilarity,
        price_variance: agreementResult.metrics.priceVariance,
        trend_alignment: agreementResult.metrics.trendAlignment,
        confidence_overlap: agreementResult.metrics.confidenceOverlap,
        analysis_method: agreementResult.method,
        overall_assessment: assessAgreementLevel(agreementResult.agreementScore),
        key_differences: keyDifferences,
        consensus_points: consensusPoints,
      },
      confidence_metrics: {
        composite_confidence: Math.min(averageConfidence, agreementResult.agreementScore),
        verification_reliability: verificationReliability,
        fallback_mode: agreementResult.method === "fallback",
        processing_notes: processingNotes,
      },
      vietnamese_market_insights: vietnameseMarketInsights,
    }, {
      request_id: requestId,
      processing_time_ms: processingTime,
      service_version: "1.0.0",
    });

    // Add rate limit info
    response.metadata.rate_limit = {
      remaining: rateLimit.remaining,
      reset_at: rateLimit.resetAt.toISOString(),
    };

    res.status(200).json(response);

  } catch (error) {
    console.error(`Internal error in POST /v1/llm-crosscheck:`, error);
    const processingTime = Date.now() - startTime;
    
    return res.status(500).json(createErrorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred during LLM verification",
      "Đã xảy ra lỗi không mong đợi trong quá trình xác minh LLM",
      "internal_error",
      null,
      requestId
    ));
  }
});

export default router;