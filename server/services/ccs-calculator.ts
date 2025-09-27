import { storage } from "../storage";
import { type InsertCompositeConfidenceScore, type CompositeConfidenceScore } from "@shared/schema";

// CCS Component Weights
interface CCSWeights {
  agreement: number;      // 30%
  evidence: number;       // 25%
  sourceCredibility: number; // 20%
  temporalConsistency: number; // 15%
  modelConfidence: number; // 10%
}

// Vietnamese Market Adjustments
interface MarketAdjustments {
  commodity: number;      // Rice: 1.05, Coffee: 1.0, Pepper: 0.95
  seasonal: number;       // Monsoon/harvest adjustments
  regional: number;       // Mekong Delta: 1.05, others: 1.0
  currencyVolatility: number; // VND volatility impact
}

// Component Score Data
interface ComponentScores {
  agreementScore: number;
  evidenceScore: number;
  sourceCredibilityScore: number;
  temporalConsistencyScore: number;
  modelConfidenceScore: number;
}

// CCS Calculation Result
interface CCSCalculationResult {
  compositeScore: number;
  componentScores: ComponentScores;
  weights: CCSWeights;
  marketAdjustments: MarketAdjustments;
  calculationDetails: any;
  version: string;
}

// Vietnamese Agricultural Market Configuration
const VIETNAMESE_MARKET_CONFIG = {
  commodityThresholds: {
    rice: 85,
    coffee: 80,
    pepper: 75,
    'black-pepper': 75,
    'white-pepper': 78,
    cassava: 70,
    'sweet-potato': 70,
    maize: 72,
    'rubber': 68
  },
  commodityAdjustments: {
    rice: 1.05,           // Higher confidence for rice (strategic crop)
    coffee: 1.0,          // Standard for coffee
    pepper: 0.95,         // Slightly lower for pepper (export volatility)
    'black-pepper': 0.95,
    'white-pepper': 0.98,
    cassava: 0.92,
    'sweet-potato': 0.92,
    maize: 0.94,
    'rubber': 0.88
  },
  regionalAdjustments: {
    'mekong-delta': 1.05,  // Higher confidence for Mekong Delta
    'red-river-delta': 1.02,
    'central-highlands': 1.0,
    'southeast': 0.98,
    'north-central': 0.95,
    'north-mountain': 0.92,
    'south-central': 0.94
  },
  seasonalFactors: {
    // Seasonal reliability based on Vietnamese agricultural cycles
    monsoonSeason: {
      months: [5, 6, 7, 8, 9], // May-September
      adjustment: 0.92  // Lower confidence during monsoon
    },
    harvestSeason: {
      rice: {
        summer: { months: [6, 7], adjustment: 1.08 },  // Summer rice harvest
        autumn: { months: [10, 11], adjustment: 1.12 }, // Main harvest
        winter: { months: [1, 2], adjustment: 1.05 }   // Winter rice
      },
      coffee: {
        months: [10, 11, 12, 1, 2], // Coffee harvest season
        adjustment: 1.06
      },
      pepper: {
        months: [2, 3, 4, 5], // Black pepper harvest
        adjustment: 1.04
      }
    }
  }
};

class CCSCalculator {
  private defaultWeights: CCSWeights = {
    agreement: 0.30,      // 30% - LLM agreement
    evidence: 0.25,       // 25% - Evidence quality
    sourceCredibility: 0.20, // 20% - Source reliability
    temporalConsistency: 0.15, // 15% - Historical consistency
    modelConfidence: 0.10  // 10% - Model statistical confidence
  };

  private version = "1.0";

  /**
   * Normalize commodity/region names to consistent slug format for adjustment key lookup
   * Ensures proper Vietnamese market adjustments are applied
   */
  private normalizeAdjustmentKey(name: string): string {
    if (!name) return '';
    
    return name
      .toLowerCase()
      .trim()
      // Replace Vietnamese diacritics with base characters
      .replace(/[àáạảãâầấậẩẫăằắặẳẵ]/g, 'a')
      .replace(/[èéẹẻẽêềếệểễ]/g, 'e')
      .replace(/[ìíịỉĩ]/g, 'i')
      .replace(/[òóọỏõôồốộổỗơờớợởỡ]/g, 'o')
      .replace(/[ùúụủũưừứựửữ]/g, 'u')
      .replace(/[ỳýỵỷỹ]/g, 'y')
      .replace(/[đ]/g, 'd')
      // Replace spaces and special characters with hyphens
      .replace(/[\s_\.,;:()\[\]{}]+/g, '-')
      // Remove multiple consecutive hyphens
      .replace(/-+/g, '-')
      // Remove leading/trailing hyphens
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Calculate Composite Confidence Score for a forecast run
   */
  async calculateCCS(
    forecastRunId: string,
    componentScores: ComponentScores,
    commodityName: string,
    regionName: string,
    forecast30dId?: string
  ): Promise<CCSCalculationResult> {
    try {
      // Get forecast run details
      const forecastRun = await storage.getForecastRun(forecastRunId);
      if (!forecastRun) {
        throw new Error(`Forecast run not found: ${forecastRunId}`);
      }

      // Calculate market adjustments for Vietnamese agricultural context
      const marketAdjustments = this.calculateMarketAdjustments(
        commodityName,
        regionName,
        new Date(forecastRun.runDate)
      );

      // Apply component score validation
      const validatedScores = this.validateComponentScores(componentScores);

      // Calculate weighted composite score
      const rawCompositeScore = this.calculateWeightedScore(validatedScores, this.defaultWeights);

      // Apply Vietnamese market adjustments
      const adjustedScore = this.applyMarketAdjustments(rawCompositeScore, marketAdjustments);

      // Ensure score is within bounds (0-100)
      const finalScore = Math.max(0, Math.min(100, adjustedScore));

      // Prepare detailed calculation metadata
      const calculationDetails = {
        rawComponentScores: componentScores,
        validatedComponentScores: validatedScores,
        rawCompositeScore,
        marketAdjustments,
        adjustedScore,
        finalScore,
        calculationTimestamp: new Date().toISOString(),
        forecastRunDetails: {
          id: forecastRun.id,
          runDate: forecastRun.runDate,
          model: forecastRun.model,
          modelVersion: forecastRun.modelVersion
        }
      };

      return {
        compositeScore: Number(finalScore.toFixed(2)),
        componentScores: validatedScores,
        weights: this.defaultWeights,
        marketAdjustments,
        calculationDetails,
        version: this.version
      };

    } catch (error) {
      console.error(`CCS calculation failed for forecast run ${forecastRunId}:`, error);
      throw error;
    }
  }

  /**
   * Store CCS calculation result in database
   */
  async storeCCSResult(
    forecastRunId: string,
    commodityId: string,
    regionId: string,
    ccsResult: CCSCalculationResult,
    forecast30dId?: string
  ): Promise<CompositeConfidenceScore> {
    const ccsData: InsertCompositeConfidenceScore = {
      forecastRunId,
      forecast30dId,
      commodityId,
      regionId,
      compositeScore: ccsResult.compositeScore.toString(),
      agreementScore: ccsResult.componentScores.agreementScore.toString(),
      evidenceScore: ccsResult.componentScores.evidenceScore.toString(),
      sourceCredibilityScore: ccsResult.componentScores.sourceCredibilityScore.toString(),
      temporalConsistencyScore: ccsResult.componentScores.temporalConsistencyScore.toString(),
      modelConfidenceScore: ccsResult.componentScores.modelConfidenceScore.toString(),
      weights: ccsResult.weights,
      commodityAdjustment: ccsResult.marketAdjustments.commodity.toString(),
      seasonalAdjustment: ccsResult.marketAdjustments.seasonal.toString(),
      regionalAdjustment: ccsResult.marketAdjustments.regional.toString(),
      currencyVolatilityAdjustment: ccsResult.marketAdjustments.currencyVolatility.toString(),
      calculationDetails: ccsResult.calculationDetails,
      version: ccsResult.version
    };

    return await storage.createCcs(ccsData);
  }

  /**
   * Validate component scores are within expected ranges
   */
  private validateComponentScores(scores: ComponentScores): ComponentScores {
    return {
      agreementScore: Math.max(0, Math.min(100, scores.agreementScore)),
      evidenceScore: Math.max(0, Math.min(100, scores.evidenceScore)),
      sourceCredibilityScore: Math.max(0, Math.min(100, scores.sourceCredibilityScore)),
      temporalConsistencyScore: Math.max(0, Math.min(100, scores.temporalConsistencyScore)),
      modelConfidenceScore: Math.max(0, Math.min(100, scores.modelConfidenceScore))
    };
  }

  /**
   * Calculate weighted composite score from component scores
   */
  private calculateWeightedScore(scores: ComponentScores, weights: CCSWeights): number {
    return (
      scores.agreementScore * weights.agreement +
      scores.evidenceScore * weights.evidence +
      scores.sourceCredibilityScore * weights.sourceCredibility +
      scores.temporalConsistencyScore * weights.temporalConsistency +
      scores.modelConfidenceScore * weights.modelConfidence
    );
  }

  /**
   * Calculate Vietnamese market-specific adjustments
   * Uses proper key normalization to ensure adjustments are applied correctly
   */
  private calculateMarketAdjustments(
    commodityName: string,
    regionName: string,
    forecastDate: Date
  ): MarketAdjustments {
    // Normalize commodity and region names using consistent method
    const normalizedCommodity = this.normalizeAdjustmentKey(commodityName);
    const normalizedRegion = this.normalizeAdjustmentKey(regionName);

    console.log(`Market adjustment normalization:`);
    console.log(`  Original commodity: "${commodityName}" -> normalized: "${normalizedCommodity}"`);
    console.log(`  Original region: "${regionName}" -> normalized: "${normalizedRegion}"`);

    // Commodity adjustment with logging
    const commodityAdjustment = VIETNAMESE_MARKET_CONFIG.commodityAdjustments[normalizedCommodity] || 1.0;
    if (VIETNAMESE_MARKET_CONFIG.commodityAdjustments[normalizedCommodity]) {
      console.log(`  Applied commodity adjustment: ${commodityAdjustment} for "${normalizedCommodity}"`);
    } else {
      console.log(`  Using default commodity adjustment: ${commodityAdjustment} (no match for "${normalizedCommodity}")`);
      console.log(`  Available commodity keys:`, Object.keys(VIETNAMESE_MARKET_CONFIG.commodityAdjustments));
    }

    // Regional adjustment with logging
    const regionalAdjustment = VIETNAMESE_MARKET_CONFIG.regionalAdjustments[normalizedRegion] || 0.98;
    if (VIETNAMESE_MARKET_CONFIG.regionalAdjustments[normalizedRegion]) {
      console.log(`  Applied regional adjustment: ${regionalAdjustment} for "${normalizedRegion}"`);
    } else {
      console.log(`  Using default regional adjustment: ${regionalAdjustment} (no match for "${normalizedRegion}")`);
      console.log(`  Available regional keys:`, Object.keys(VIETNAMESE_MARKET_CONFIG.regionalAdjustments));
    }

    // Seasonal adjustment
    const seasonalAdjustment = this.calculateSeasonalAdjustment(normalizedCommodity, forecastDate);

    // Currency volatility adjustment (simplified - could be enhanced with real VND volatility data)
    const currencyVolatilityAdjustment = this.calculateCurrencyVolatilityAdjustment(forecastDate);

    return {
      commodity: commodityAdjustment,
      seasonal: seasonalAdjustment,
      regional: regionalAdjustment,
      currencyVolatility: currencyVolatilityAdjustment
    };
  }

  /**
   * Calculate seasonal adjustment based on Vietnamese agricultural cycles
   */
  private calculateSeasonalAdjustment(commodityName: string, date: Date): number {
    const month = date.getMonth() + 1; // 1-12
    const config = VIETNAMESE_MARKET_CONFIG.seasonalFactors;

    // Check if it's monsoon season
    if (config.monsoonSeason.months.includes(month)) {
      return config.monsoonSeason.adjustment;
    }

    // Check commodity-specific harvest seasons
    switch (commodityName) {
      case 'rice':
        // Summer rice harvest
        if (config.harvestSeason.rice.summer.months.includes(month)) {
          return config.harvestSeason.rice.summer.adjustment;
        }
        // Autumn rice harvest (main harvest)
        if (config.harvestSeason.rice.autumn.months.includes(month)) {
          return config.harvestSeason.rice.autumn.adjustment;
        }
        // Winter rice harvest
        if (config.harvestSeason.rice.winter.months.includes(month)) {
          return config.harvestSeason.rice.winter.adjustment;
        }
        break;

      case 'coffee':
        if (config.harvestSeason.coffee.months.includes(month)) {
          return config.harvestSeason.coffee.adjustment;
        }
        break;

      case 'pepper':
      case 'black-pepper':
        if (config.harvestSeason.pepper.months.includes(month)) {
          return config.harvestSeason.pepper.adjustment;
        }
        break;
    }

    return 1.0; // Default - no seasonal adjustment
  }

  /**
   * Calculate currency volatility adjustment for VND
   */
  private calculateCurrencyVolatilityAdjustment(date: Date): number {
    // Simplified volatility calculation
    // In a real implementation, this would use actual VND/USD volatility data
    const currentYear = date.getFullYear();
    const currentMonth = date.getMonth() + 1;

    // Higher volatility during global economic uncertainty periods
    // This is a simplified model - should be enhanced with real data
    if (currentMonth >= 3 && currentMonth <= 5) {
      return 0.95; // Higher volatility in Q2 (traditional uncertainty period)
    }

    return 0.98; // Default slight adjustment for VND volatility
  }

  /**
   * Apply all market adjustments to raw composite score
   */
  private applyMarketAdjustments(rawScore: number, adjustments: MarketAdjustments): number {
    return rawScore * 
           adjustments.commodity * 
           adjustments.seasonal * 
           adjustments.regional * 
           adjustments.currencyVolatility;
  }

  /**
   * Get commodity-specific confidence threshold
   */
  getCommodityThreshold(commodityName: string): number {
    const normalizedCommodity = commodityName.toLowerCase().replace(/\s+/g, '-');
    return VIETNAMESE_MARKET_CONFIG.commodityThresholds[normalizedCommodity] || 75;
  }

  /**
   * Get current weights configuration
   */
  getWeights(): CCSWeights {
    return { ...this.defaultWeights };
  }

  /**
   * Update weights configuration (for testing or tuning)
   */
  updateWeights(newWeights: Partial<CCSWeights>): void {
    this.defaultWeights = { ...this.defaultWeights, ...newWeights };
    
    // Ensure weights sum to 1.0
    const total = Object.values(this.defaultWeights).reduce((sum, weight) => sum + weight, 0);
    if (Math.abs(total - 1.0) > 0.001) {
      console.warn(`CCS weights sum to ${total}, not 1.0. Please verify weight configuration.`);
    }
  }
}

export const ccsCalculator = new CCSCalculator();
export type { ComponentScores, CCSCalculationResult, MarketAdjustments, CCSWeights };