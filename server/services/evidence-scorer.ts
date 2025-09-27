import { storage } from "../storage";
import { type Evidence, type Source } from "@shared/schema";

// Source Credibility Matrix
interface SourceCredibilityMatrix {
  government: number;        // 0.9
  establishedMarkets: number; // 0.8
  news: number;             // 0.6
  international: number;    // 0.85
  academic: number;         // 0.8
  industry: number;         // 0.75
  social: number;           // 0.4
  unknown: number;          // 0.5
}

// Data Freshness Decay Function
interface FreshnessDecay {
  daily: number;     // 1.0
  weekly: number;    // 0.9
  monthly: number;   // 0.7
  quarterly: number; // 0.5
  yearly: number;    // 0.3
}

// Evidence Quality Metrics
interface EvidenceQualityMetrics {
  sourceCredibilityScore: number; // 0-100
  freshnessScore: number;         // 0-100
  diversityScore: number;         // 0-100
  volumeScore: number;            // 0-100
  relevanceScore: number;         // 0-100
  regionalExpertiseBonus: number; // 0-10 bonus points
  multiSourceBonus: number;       // 0-10 bonus points
}

// Evidence Scoring Result
interface EvidenceScoringResult {
  totalScore: number; // 0-100 final evidence score
  metrics: EvidenceQualityMetrics;
  evidenceCount: number;
  sourceBreakdown: Record<string, number>;
  calculations: any;
  recommendations: string[];
}

// Regional Expertise Mapping for Vietnamese Agriculture
const REGIONAL_EXPERTISE_MAP = {
  'mekong-delta': {
    specialties: ['rice', 'aquaculture', 'fruit'],
    bonus: 0.05 // 5% bonus for Mekong Delta expertise
  },
  'central-highlands': {
    specialties: ['coffee', 'pepper', 'rubber'],
    bonus: 0.04
  },
  'red-river-delta': {
    specialties: ['rice', 'vegetables'],
    bonus: 0.03
  },
  'southeast': {
    specialties: ['cassava', 'rubber', 'fruit'],
    bonus: 0.03
  },
  'north-central': {
    specialties: ['maize', 'cassava'],
    bonus: 0.02
  },
  'south-central': {
    specialties: ['rice', 'pepper'],
    bonus: 0.02
  }
};

class EvidenceScorer {
  private credibilityMatrix: SourceCredibilityMatrix = {
    government: 0.9,        // Government sources highest credibility
    establishedMarkets: 0.8, // Established markets (exchanges, etc.)
    news: 0.6,             // News media
    international: 0.85,    // International organizations (FAO, World Bank, etc.)
    academic: 0.8,         // Academic institutions and research
    industry: 0.75,        // Industry associations and reports
    social: 0.4,           // Social media and unofficial sources
    unknown: 0.5           // Unknown source type
  };

  private freshnessDecay: FreshnessDecay = {
    daily: 1.0,     // Full score for daily data
    weekly: 0.9,    // 90% score for weekly data
    monthly: 0.7,   // 70% score for monthly data
    quarterly: 0.5, // 50% score for quarterly data
    yearly: 0.3     // 30% score for yearly data
  };

  /**
   * Score evidence quality for a forecast
   * Supports both forecast30dId and forecastRunId with proper fallback logic
   */
  async scoreEvidence(
    forecast30dId: string | undefined,
    forecastRunId: string | undefined,
    commodityName: string,
    regionName: string
  ): Promise<EvidenceScoringResult> {
    try {
      // Get evidence records using proper ID linkage
      const evidenceRecords = await this.getEvidenceWithFallback(forecast30dId, forecastRunId);
      
      if (evidenceRecords.length === 0) {
        return this.getMinimalScore("No evidence found for forecast");
      }

      // Get source details for credibility assessment
      const sourceIds = [...new Set(evidenceRecords.map(e => e.sourceId).filter(Boolean))];
      const sources = await Promise.all(
        sourceIds.map(id => storage.getSource(id!))
      );
      const sourceMap = new Map(
        sources.filter(Boolean).map(source => [source!.id, source!])
      );

      // Calculate evidence quality metrics
      const metrics = await this.calculateEvidenceMetrics(
        evidenceRecords,
        sourceMap,
        commodityName,
        regionName
      );

      // Calculate final evidence score
      const totalScore = this.calculateTotalEvidenceScore(metrics);

      // Generate source breakdown
      const sourceBreakdown = this.generateSourceBreakdown(evidenceRecords, sourceMap);

      // Generate recommendations
      const recommendations = this.generateRecommendations(metrics, evidenceRecords.length);

      const calculations = {
        componentScores: {
          sourceCredibility: metrics.sourceCredibilityScore,
          freshness: metrics.freshnessScore,
          diversity: metrics.diversityScore,
          volume: metrics.volumeScore,
          relevance: metrics.relevanceScore
        },
        bonuses: {
          regionalExpertise: metrics.regionalExpertiseBonus,
          multiSource: metrics.multiSourceBonus
        },
        weights: {
          sourceCredibility: 0.25,
          freshness: 0.20,
          diversity: 0.20,
          volume: 0.15,
          relevance: 0.20
        },
        finalScore: totalScore,
        evidenceCount: evidenceRecords.length,
        timestamp: new Date().toISOString()
      };

      return {
        totalScore,
        metrics,
        evidenceCount: evidenceRecords.length,
        sourceBreakdown,
        calculations,
        recommendations
      };

    } catch (error) {
      console.error("Evidence scoring failed:", error);
      console.error("Parameters:", { forecast30dId, forecastRunId, commodityName, regionName });
      throw error;
    }
  }

  /**
   * Get evidence records with proper fallback logic for forecast ID linkage
   * Handles both forecast30dId and forecastRunId properly
   */
  private async getEvidenceWithFallback(
    forecast30dId: string | undefined,
    forecastRunId: string | undefined
  ): Promise<Evidence[]> {
    let evidenceRecords: Evidence[] = [];

    // Option 1: Direct evidence via forecast30dId
    if (forecast30dId) {
      console.log(`Getting evidence for forecast30dId: ${forecast30dId}`);
      evidenceRecords = await storage.getEvidenceByForecast30d(forecast30dId);
      
      if (evidenceRecords.length > 0) {
        console.log(`Found ${evidenceRecords.length} evidence records via forecast30dId`);
        return evidenceRecords;
      }
    }

    // Option 2: Fallback via forecastRunId (get all forecast30d records for the run)
    if (forecastRunId && evidenceRecords.length === 0) {
      console.log(`No evidence found via forecast30dId, trying forecastRunId: ${forecastRunId}`);
      
      try {
        // Get all forecast30d records for this forecast run
        const forecast30dRecords = await storage.getForecastsByRun(forecastRunId);
        console.log(`Found ${forecast30dRecords.length} forecast30d records for forecastRunId`);
        
        if (forecast30dRecords.length === 0) {
          console.warn(`No forecast30d records found for forecastRunId: ${forecastRunId}`);
          return [];
        }

        // Collect evidence from all forecast30d records in this run
        const allEvidence: Evidence[] = [];
        for (const forecast30d of forecast30dRecords) {
          const evidence = await storage.getEvidenceByForecast30d(forecast30d.id);
          allEvidence.push(...evidence);
        }

        // Remove duplicates by evidence ID
        const uniqueEvidence = allEvidence.filter(
          (evidence, index, self) => self.findIndex(e => e.id === evidence.id) === index
        );

        console.log(`Found ${uniqueEvidence.length} unique evidence records via forecastRunId fallback`);
        return uniqueEvidence;
        
      } catch (error) {
        console.error(`Error getting evidence via forecastRunId fallback:`, error);
        return [];
      }
    }

    // Option 3: No valid forecast ID provided
    if (!forecast30dId && !forecastRunId) {
      console.warn("Neither forecast30dId nor forecastRunId provided for evidence scoring");
    } else if (evidenceRecords.length === 0) {
      console.warn("No evidence found for any provided forecast ID");
    }

    return evidenceRecords;
  }

  /**
   * Calculate comprehensive evidence quality metrics
   */
  private async calculateEvidenceMetrics(
    evidenceRecords: Evidence[],
    sourceMap: Map<string, Source>,
    commodityName: string,
    regionName: string
  ): Promise<EvidenceQualityMetrics> {
    // 1. Source Credibility Score
    const sourceCredibilityScore = this.calculateSourceCredibilityScore(evidenceRecords, sourceMap);

    // 2. Freshness Score
    const freshnessScore = this.calculateFreshnessScore(evidenceRecords);

    // 3. Diversity Score
    const diversityScore = this.calculateDiversityScore(evidenceRecords, sourceMap);

    // 4. Volume Score
    const volumeScore = this.calculateVolumeScore(evidenceRecords.length);

    // 5. Relevance Score
    const relevanceScore = this.calculateRelevanceScore(evidenceRecords);

    // 6. Regional Expertise Bonus
    const regionalExpertiseBonus = this.calculateRegionalExpertiseBonus(
      evidenceRecords,
      sourceMap,
      commodityName,
      regionName
    );

    // 7. Multi-Source Validation Bonus
    const multiSourceBonus = this.calculateMultiSourceBonus(evidenceRecords, sourceMap);

    return {
      sourceCredibilityScore,
      freshnessScore,
      diversityScore,
      volumeScore,
      relevanceScore,
      regionalExpertiseBonus,
      multiSourceBonus
    };
  }

  /**
   * Calculate source credibility score based on source types
   */
  private calculateSourceCredibilityScore(
    evidenceRecords: Evidence[],
    sourceMap: Map<string, Source>
  ): number {
    if (evidenceRecords.length === 0) return 0;

    let totalCredibility = 0;
    let recordsWithSources = 0;

    evidenceRecords.forEach(evidence => {
      if (evidence.sourceId) {
        const source = sourceMap.get(evidence.sourceId);
        if (source) {
          const sourceType = this.classifySourceType(source);
          const credibility = this.credibilityMatrix[sourceType];
          totalCredibility += credibility * 100; // Convert to 0-100 scale
          recordsWithSources++;
        }
      }
    });

    if (recordsWithSources === 0) {
      return this.credibilityMatrix.unknown * 100; // Default to unknown source credibility
    }

    return totalCredibility / recordsWithSources;
  }

  /**
   * Calculate freshness score using exponential decay
   */
  private calculateFreshnessScore(evidenceRecords: Evidence[]): number {
    if (evidenceRecords.length === 0) return 0;

    const now = new Date();
    let totalFreshness = 0;

    evidenceRecords.forEach(evidence => {
      const publishedAt = evidence.publishedAt ? new Date(evidence.publishedAt) : new Date(evidence.createdAt);
      const ageInDays = (now.getTime() - publishedAt.getTime()) / (1000 * 60 * 60 * 24);
      
      const freshnessMultiplier = this.calculateFreshnessMultiplier(ageInDays);
      totalFreshness += freshnessMultiplier * 100; // Convert to 0-100 scale
    });

    return totalFreshness / evidenceRecords.length;
  }

  /**
   * Calculate diversity score based on source type variety
   */
  private calculateDiversityScore(
    evidenceRecords: Evidence[],
    sourceMap: Map<string, Source>
  ): number {
    const sourceTypes = new Set<string>();
    const evidenceTypes = new Set<string>();

    evidenceRecords.forEach(evidence => {
      // Count source type diversity
      if (evidence.sourceId) {
        const source = sourceMap.get(evidence.sourceId);
        if (source) {
          const sourceType = this.classifySourceType(source);
          sourceTypes.add(sourceType);
        }
      }

      // Count evidence type diversity
      evidenceTypes.add(evidence.type);
    });

    // Diversity score based on variety of sources and evidence types
    const maxSourceTypes = Object.keys(this.credibilityMatrix).length;
    const maxEvidenceTypes = 5; // news, weather, policy, market_event, expert_opinion

    const sourceTypeScore = (sourceTypes.size / maxSourceTypes) * 50;
    const evidenceTypeScore = (evidenceTypes.size / maxEvidenceTypes) * 50;

    return Math.min(100, sourceTypeScore + evidenceTypeScore);
  }

  /**
   * Calculate volume score based on evidence quantity
   */
  private calculateVolumeScore(evidenceCount: number): number {
    // Logarithmic scale for evidence volume (diminishing returns)
    if (evidenceCount === 0) return 0;
    if (evidenceCount >= 20) return 100; // Cap at 100 for 20+ evidence pieces

    // Score increases logarithmically
    return Math.min(100, (Math.log(evidenceCount + 1) / Math.log(21)) * 100);
  }

  /**
   * Calculate relevance score based on evidence confidence and relevance
   */
  private calculateRelevanceScore(evidenceRecords: Evidence[]): number {
    if (evidenceRecords.length === 0) return 0;

    let totalRelevance = 0;
    evidenceRecords.forEach(evidence => {
      const confidence = parseFloat(evidence.confidence.toString());
      const relevance = parseFloat(evidence.relevanceScore.toString());
      
      // Combine confidence and relevance scores
      const combinedScore = (confidence + relevance) / 2;
      totalRelevance += combinedScore;
    });

    return totalRelevance / evidenceRecords.length;
  }

  /**
   * Calculate regional expertise bonus
   */
  private calculateRegionalExpertiseBonus(
    evidenceRecords: Evidence[],
    sourceMap: Map<string, Source>,
    commodityName: string,
    regionName: string
  ): number {
    const normalizedRegion = regionName.toLowerCase().replace(/\s+/g, '-');
    const normalizedCommodity = commodityName.toLowerCase().replace(/\s+/g, '-');
    
    const regionalConfig = REGIONAL_EXPERTISE_MAP[normalizedRegion];
    if (!regionalConfig) return 0;

    // Check if commodity matches regional specialty
    const isSpecialtyMatch = regionalConfig.specialties.includes(normalizedCommodity);
    if (!isSpecialtyMatch) return 0;

    // Count sources with regional expertise
    let expertSources = 0;
    evidenceRecords.forEach(evidence => {
      if (evidence.sourceId) {
        const source = sourceMap.get(evidence.sourceId);
        if (source && this.hasRegionalExpertise(source, normalizedRegion)) {
          expertSources++;
        }
      }
    });

    if (expertSources === 0) return 0;

    // Bonus based on proportion of expert sources
    const expertRatio = expertSources / evidenceRecords.length;
    return expertRatio * regionalConfig.bonus * 100; // Convert to 0-10 scale
  }

  /**
   * Calculate multi-source validation bonus
   */
  private calculateMultiSourceBonus(
    evidenceRecords: Evidence[],
    sourceMap: Map<string, Source>
  ): number {
    const uniqueSources = new Set(
      evidenceRecords.map(e => e.sourceId).filter(Boolean)
    ).size;

    // Bonus for 3+ corroborating sources
    if (uniqueSources >= 3) {
      // 10% bonus for 3+ sources, diminishing returns
      const bonusPercentage = Math.min(0.10, 0.03 + (uniqueSources - 3) * 0.01);
      return bonusPercentage * 100; // Convert to 0-10 scale
    }

    return 0;
  }

  /**
   * Calculate total evidence score with bonuses
   */
  private calculateTotalEvidenceScore(metrics: EvidenceQualityMetrics): number {
    // Weighted combination of core metrics
    const weights = {
      sourceCredibility: 0.25,
      freshness: 0.20,
      diversity: 0.20,
      volume: 0.15,
      relevance: 0.20
    };

    const coreScore = (
      metrics.sourceCredibilityScore * weights.sourceCredibility +
      metrics.freshnessScore * weights.freshness +
      metrics.diversityScore * weights.diversity +
      metrics.volumeScore * weights.volume +
      metrics.relevanceScore * weights.relevance
    );

    // Add bonuses
    const totalScore = coreScore + metrics.regionalExpertiseBonus + metrics.multiSourceBonus;

    return Math.max(0, Math.min(100, totalScore));
  }

  /**
   * Classify source type for credibility matrix lookup
   */
  private classifySourceType(source: Source): keyof SourceCredibilityMatrix {
    const name = source.name.toLowerCase();
    const type = source.type.toLowerCase();
    const url = source.url?.toLowerCase() || '';

    // Government sources
    if (name.includes('government') || name.includes('ministry') || 
        name.includes('gso') || name.includes('mard') || 
        url.includes('.gov.') || url.includes('.vn')) {
      return 'government';
    }

    // International organizations
    if (name.includes('fao') || name.includes('world bank') || 
        name.includes('imf') || name.includes('oecd') ||
        name.includes('asian development bank')) {
      return 'international';
    }

    // Established markets
    if (name.includes('exchange') || name.includes('market') ||
        name.includes('commodity') || name.includes('trading')) {
      return 'establishedMarkets';
    }

    // Academic institutions
    if (name.includes('university') || name.includes('research') ||
        name.includes('institute') || name.includes('academic')) {
      return 'academic';
    }

    // Industry associations
    if (name.includes('association') || name.includes('federation') ||
        name.includes('chamber') || name.includes('industry')) {
      return 'industry';
    }

    // News media
    if (type === 'news' || name.includes('news') || name.includes('media') ||
        url.includes('news') || url.includes('vnexpress') || url.includes('vietnamnet')) {
      return 'news';
    }

    // Social media
    if (name.includes('social') || name.includes('facebook') ||
        name.includes('twitter') || name.includes('linkedin')) {
      return 'social';
    }

    return 'unknown';
  }

  /**
   * Calculate freshness multiplier based on data age
   */
  private calculateFreshnessMultiplier(ageInDays: number): number {
    if (ageInDays <= 1) return this.freshnessDecay.daily;
    if (ageInDays <= 7) return this.freshnessDecay.weekly;
    if (ageInDays <= 30) return this.freshnessDecay.monthly;
    if (ageInDays <= 90) return this.freshnessDecay.quarterly;
    if (ageInDays <= 365) return this.freshnessDecay.yearly;
    
    // Exponential decay for very old data
    return Math.max(0.1, this.freshnessDecay.yearly * Math.exp(-(ageInDays - 365) / 365));
  }

  /**
   * Check if source has regional expertise
   */
  private hasRegionalExpertise(source: Source, regionName: string): boolean {
    const metadata = source.metadata as any;
    const name = source.name.toLowerCase();
    const url = source.url?.toLowerCase() || '';

    // Check if source is locally based or specialized in the region
    return (
      name.includes(regionName) ||
      url.includes(regionName) ||
      (metadata?.region && metadata.region.toLowerCase().includes(regionName)) ||
      (metadata?.expertise && metadata.expertise.includes(regionName))
    );
  }

  /**
   * Generate source breakdown for analysis
   */
  private generateSourceBreakdown(
    evidenceRecords: Evidence[],
    sourceMap: Map<string, Source>
  ): Record<string, number> {
    const breakdown: Record<string, number> = {};

    evidenceRecords.forEach(evidence => {
      if (evidence.sourceId) {
        const source = sourceMap.get(evidence.sourceId);
        if (source) {
          const sourceType = this.classifySourceType(source);
          breakdown[sourceType] = (breakdown[sourceType] || 0) + 1;
        }
      } else {
        breakdown['unknown'] = (breakdown['unknown'] || 0) + 1;
      }
    });

    return breakdown;
  }

  /**
   * Generate recommendations for improving evidence quality
   */
  private generateRecommendations(
    metrics: EvidenceQualityMetrics,
    evidenceCount: number
  ): string[] {
    const recommendations: string[] = [];

    if (metrics.sourceCredibilityScore < 70) {
      recommendations.push("Consider adding more credible sources (government, international organizations)");
    }

    if (metrics.freshnessScore < 70) {
      recommendations.push("Include more recent data sources and evidence");
    }

    if (metrics.diversityScore < 60) {
      recommendations.push("Diversify evidence types and source categories");
    }

    if (evidenceCount < 5) {
      recommendations.push("Increase evidence volume for more robust analysis");
    }

    if (metrics.multiSourceBonus === 0) {
      recommendations.push("Add corroborating sources for validation (3+ sources recommended)");
    }

    if (metrics.regionalExpertiseBonus === 0) {
      recommendations.push("Include sources with regional expertise for better context");
    }

    return recommendations;
  }

  /**
   * Get minimal score for cases with no evidence
   */
  private getMinimalScore(reason: string): EvidenceScoringResult {
    const metrics: EvidenceQualityMetrics = {
      sourceCredibilityScore: 0,
      freshnessScore: 0,
      diversityScore: 0,
      volumeScore: 0,
      relevanceScore: 0,
      regionalExpertiseBonus: 0,
      multiSourceBonus: 0
    };

    return {
      totalScore: 0,
      metrics,
      evidenceCount: 0,
      sourceBreakdown: {},
      calculations: { reason },
      recommendations: ["Add evidence sources to improve forecast reliability"]
    };
  }

  /**
   * Get credibility matrix configuration
   */
  getCredibilityMatrix(): SourceCredibilityMatrix {
    return { ...this.credibilityMatrix };
  }

  /**
   * Update credibility matrix for tuning
   */
  updateCredibilityMatrix(newMatrix: Partial<SourceCredibilityMatrix>): void {
    this.credibilityMatrix = { ...this.credibilityMatrix, ...newMatrix };
  }

  /**
   * Get freshness decay configuration
   */
  getFreshnessDecay(): FreshnessDecay {
    return { ...this.freshnessDecay };
  }

  /**
   * Update freshness decay for tuning
   */
  updateFreshnessDecay(newDecay: Partial<FreshnessDecay>): void {
    this.freshnessDecay = { ...this.freshnessDecay, ...newDecay };
  }
}

export const evidenceScorer = new EvidenceScorer();
export type { EvidenceScoringResult, EvidenceQualityMetrics, SourceCredibilityMatrix, FreshnessDecay };