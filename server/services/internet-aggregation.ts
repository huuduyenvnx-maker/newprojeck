import { openaiService } from "./openai.js";
import { geminiService } from "./gemini.js";
import axios from "axios";
import * as cheerio from "cheerio";
// Using built-in retry logic instead of RetryManager

export interface InternetSourceResult {
  url: string;
  title: string;
  content: string;
  extractedAt: Date;
  contentHash: string;
  status: 'success' | 'failed' | 'partial';
  error?: string;
}

export interface CommodityPriceData {
  commodity: string;
  region: string;
  price: number;
  currency: string;
  unit: string;
  date: Date;
  confidence: number;
  sources: string[];
  evidence: {
    url: string;
    extractedText: string;
    methodology: string;
    pageHash?: string;
    extractedAt?: string;
    sourceTitle?: string;
  }[];
  metadata?: {
    sourceType: 'internet';
    fetchedAt: string;
    verificationLevel: string;
    provenanceComplete: boolean;
  };
}

export interface AggregationResult {
  success: boolean;
  commodities: CommodityPriceData[];
  sources: InternetSourceResult[];
  metadata: {
    totalSources: number;
    successfulSources: number;
    totalCommodities: number;
    averageConfidence: number;
    processingTime: number;
  };
  errors: string[];
  warnings: string[];
}

interface SourceDiscoveryPrompt {
  commodities: string[];
  region: string;
  maxSources: number;
  language: 'vietnamese' | 'english';
}

class InternetAggregationService {
  // Removed RetryManager dependency - using built-in retry logic
  private confidenceThreshold = 0.7; // Default, will be loaded from config
  private readonly allowedDomains = [
    'vietstock.vn',
    'vneconomy.vn', 
    'cafef.vn',
    'baodautu.vn',
    'tinnhanhchungkhoan.vn',
    'agrimoney.com',
    'reuters.com',
    'bloomberg.com',
    'marketwatch.com',
    'investing.com',
    'tradingview.com',
    'fao.org',
    'worldbank.org',
    'usda.gov',
    'agriculture.gov.vn',
    'agro.gov.vn',
    'mard.gov.vn'
  ];

  /**
   * Load configuration and set confidence threshold
   */
  private async loadConfig(): Promise<void> {
    try {
      const yaml = await import('js-yaml');
      const fs = await import('fs');
      const path = await import('path');
      
      const configPath = path.join(process.cwd(), 'config', 'sources.yaml');
      const configContent = fs.readFileSync(configPath, 'utf8');
      const config = yaml.load(configContent) as any;
      
      // Load confidence threshold from internet_aggregated source config
      const internetSource = config.sources?.internet_aggregated;
      if (internetSource?.confidence_threshold) {
        this.confidenceThreshold = internetSource.confidence_threshold;
        console.log(`📊 Loaded confidence threshold: ${this.confidenceThreshold}`);
      }
    } catch (error) {
      console.warn('⚠️ Failed to load config, using default confidence threshold:', this.confidenceThreshold);
    }
  }

  /**
   * Main aggregation method - discovers sources and extracts prices using OpenAI + Gemini
   */
  async aggregateCommodityPrices(
    commodities: string[],
    region: string = "Vietnam"
  ): Promise<AggregationResult> {
    const startTime = Date.now();
    console.log(`🌐 Starting Internet aggregation for ${commodities.length} commodities in ${region}`);
    
    // Load configuration first
    await this.loadConfig();

    try {
      // Step 1: Discover relevant sources using dual LLM approach
      const sources = await this.discoverSources({
        commodities,
        region,
        maxSources: 15,
        language: 'vietnamese'
      });

      console.log(`📍 Discovered ${sources.length} potential sources`);

      // Step 2: Fetch content from discovered sources
      const sourceResults = await this.fetchSourceContent(sources);
      const successfulSources = sourceResults.filter(s => s.status === 'success');

      console.log(`✅ Successfully fetched ${successfulSources.length}/${sourceResults.length} sources`);

      // Step 3: Extract and normalize commodity prices using dual LLM
      const extractedData = await this.extractCommodityPrices(
        successfulSources,
        commodities,
        region
      );

      // Step 4: Cross-validate and compute consensus
      const verifiedData = await this.crossValidateWithDualLLM(extractedData);
      
      // Step 5: ENFORCE VERIFIED-ONLY POLICY - Filter by confidence threshold
      const filteredData = this.enforceVerifiedOnlyPolicy(verifiedData);
      
      console.log(`🔒 Verified-only filter: ${filteredData.length}/${verifiedData.length} records above threshold ${this.confidenceThreshold}`);

      const endTime = Date.now();

      return {
        success: true,
        commodities: filteredData,
        sources: sourceResults,
        metadata: {
          totalSources: sourceResults.length,
          successfulSources: successfulSources.length,
          totalCommodities: filteredData.length,
          averageConfidence: filteredData.reduce((sum, c) => sum + c.confidence, 0) / filteredData.length || 0,
          processingTime: endTime - startTime
        },
        errors: sourceResults.filter(s => s.status === 'failed').map(s => s.error || 'Unknown error'),
        warnings: []
      };

    } catch (error: any) {
      console.error("❌ Internet aggregation failed:", error);
      
      return {
        success: false,
        commodities: [],
        sources: [],
        metadata: {
          totalSources: 0,
          successfulSources: 0,
          totalCommodities: 0,
          averageConfidence: 0,
          processingTime: Date.now() - startTime
        },
        errors: [error.message || "Unknown aggregation error"],
        warnings: []
      };
    }
  }

  /**
   * Discover relevant sources using OpenAI + Gemini consensus
   */
  private async discoverSources(prompt: SourceDiscoveryPrompt): Promise<string[]> {
    const discoverPrompt = `
    Bạn là chuyên gia phân tích thị trường nông sản Việt Nam. Hãy đề xuất ${prompt.maxSources} trang web đáng tin cậy 
    để tìm giá cả mới nhất của các mặt hàng nông sản sau: ${prompt.commodities.join(', ')}.
    
    Khu vực: ${prompt.region}
    
    Trả về danh sách URL dưới dạng JSON:
    {
      "sources": [
        "https://example1.com/path",
        "https://example2.com/path"
      ],
      "reasoning": "Lý do chọn các nguồn này"
    }
    
    Ưu tiên các trang web Việt Nam có uy tín về nông nghiệp và kinh tế.
    `;

    try {
      // Get suggestions from both OpenAI and Gemini
      const [openaiResponse, geminiResponse] = await Promise.allSettled([
        this.getSourceSuggestionsFromOpenAI(discoverPrompt),
        this.getSourceSuggestionsFromGemini(discoverPrompt)
      ]);

      const sources = new Set<string>();

      // Process OpenAI response
      if (openaiResponse.status === 'fulfilled' && openaiResponse.value) {
        openaiResponse.value.forEach(url => {
          if (this.isAllowedDomain(url)) {
            sources.add(url);
          }
        });
      }

      // Process Gemini response
      if (geminiResponse.status === 'fulfilled' && geminiResponse.value) {
        geminiResponse.value.forEach(url => {
          if (this.isAllowedDomain(url)) {
            sources.add(url);
          }
        });
      }

      // Add fallback sources if not enough discovered
      if (sources.size < 5) {
        this.addFallbackSources(sources, prompt.commodities, prompt.region);
      }

      return Array.from(sources).slice(0, prompt.maxSources);

    } catch (error) {
      console.error("❌ Source discovery failed:", error);
      
      // Return fallback sources
      const fallbackSources = new Set<string>();
      this.addFallbackSources(fallbackSources, prompt.commodities, prompt.region);
      return Array.from(fallbackSources);
    }
  }

  /**
   * Get source suggestions from OpenAI
   */
  private async getSourceSuggestionsFromOpenAI(prompt: string): Promise<string[]> {
    try {
      const response = await openaiService.generateMarketInsights({
        prompt: prompt,
        context: "source_discovery"
      });

      // Extract URLs from response
      const urlRegex = /(https?:\/\/[^\s]+)/g;
      const urls = response.summary.match(urlRegex) || [];
      
      return urls.filter(url => this.isAllowedDomain(url));
    } catch (error) {
      console.error("OpenAI source discovery failed:", error);
      return [];
    }
  }

  /**
   * Get source suggestions from Gemini
   */
  private async getSourceSuggestionsFromGemini(prompt: string): Promise<string[]> {
    try {
      const response = await geminiService.generateWeatherImpactAnalysis(
        { prompt: prompt, context: "source_discovery" },
        "various"
      );

      // Extract URLs from response
      const urlRegex = /(https?:\/\/[^\s]+)/g;
      const urls = response.description.match(urlRegex) || [];
      
      return urls.filter(url => this.isAllowedDomain(url));
    } catch (error) {
      console.error("Gemini source discovery failed:", error);
      return [];
    }
  }

  /**
   * Check if domain is in allowed list
   */
  private isAllowedDomain(url: string): boolean {
    try {
      const domain = new URL(url).hostname.toLowerCase();
      return this.allowedDomains.some(allowed => domain.includes(allowed));
    } catch {
      return false;
    }
  }

  /**
   * Add fallback sources for Vietnamese agricultural data
   */
  private addFallbackSources(sources: Set<string>, commodities: string[], region: string): void {
    const fallbacks = [
      'https://vietstock.vn/gia-nong-san',
      'https://vneconomy.vn/nong-nghiep',
      'https://cafef.vn/hang-hoa.chn',
      'https://baodautu.vn/nong-nghiep',
      'https://agrimoney.com/markets/',
      'https://www.investing.com/commodities/',
      'https://www.agriculture.gov.vn/gia-ca',
      'https://www.agro.gov.vn/thong-tin-thi-truong'
    ];

    fallbacks.forEach(url => sources.add(url));
  }

  /**
   * Fetch content from source URLs
   */
  private async fetchSourceContent(urls: string[]): Promise<InternetSourceResult[]> {
    const results: InternetSourceResult[] = [];

    for (const url of urls) {
      try {
        console.log(`📡 Fetching: ${url}`);
        
        const response = await axios.get(url, {
            timeout: 10000,
            headers: {
              'User-Agent': 'AgriIntel-Bot/1.0 (Agricultural Data Aggregator)',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
              'Accept-Encoding': 'gzip, deflate',
              'Connection': 'keep-alive'
            }
        });

        const $ = cheerio.load(response.data);
        
        // Remove scripts and styles for cleaner text extraction
        $('script, style, nav, footer, .ad, .advertisement').remove();
        
        const title = $('title').text().trim();
        const content = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 10000); // Limit content size
        
        const contentHash = this.generateContentHash(content);

        results.push({
          url,
          title,
          content,
          extractedAt: new Date(),
          contentHash,
          status: 'success'
        });

        console.log(`✅ Successfully fetched: ${url} (${content.length} chars)`);

      } catch (error: any) {
        console.error(`❌ Failed to fetch ${url}:`, error.message);
        
        results.push({
          url,
          title: '',
          content: '',
          extractedAt: new Date(),
          contentHash: '',
          status: 'failed',
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Extract commodity prices using dual LLM approach
   */
  private async extractCommodityPrices(
    sources: InternetSourceResult[],
    commodities: string[],
    region: string
  ): Promise<CommodityPriceData[]> {
    const extractedData: CommodityPriceData[] = [];

    for (const source of sources) {
      if (source.status !== 'success') continue;

      const extractionPrompt = `
      Phân tích nội dung web sau để trích xuất giá cả nông sản mới nhất:
      
      URL: ${source.url}
      Nội dung: ${source.content.substring(0, 5000)}
      
      Tìm giá của các mặt hàng: ${commodities.join(', ')}
      Khu vực: ${region}
      
      Trả về JSON với format:
      {
        "prices": [
          {
            "commodity": "tên mặt hàng",
            "price": số_giá,
            "currency": "VND" hoặc "USD",
            "unit": "kg" hoặc "tấn",
            "date": "YYYY-MM-DD",
            "confidence": 0.0-1.0,
            "extractedText": "đoạn text chứa thông tin giá"
          }
        ]
      }
      
      Chỉ trả về giá có tin cậy cao (confidence >= 0.7).
      `;

      try {
        // Extract using both OpenAI and Gemini
        const [openaiResult, geminiResult] = await Promise.allSettled([
          this.extractWithOpenAI(extractionPrompt, source),
          this.extractWithGemini(extractionPrompt, source)
        ]);

        // Process successful extractions
        if (openaiResult.status === 'fulfilled') {
          extractedData.push(...openaiResult.value);
        }

        if (geminiResult.status === 'fulfilled') {
          extractedData.push(...geminiResult.value);
        }

      } catch (error) {
        console.error(`❌ Extraction failed for ${source.url}:`, error);
      }
    }

    return extractedData;
  }

  /**
   * Extract prices using OpenAI
   */
  private async extractWithOpenAI(prompt: string, source: InternetSourceResult): Promise<CommodityPriceData[]> {
    try {
      const insights = await openaiService.generateMarketInsights({
        prompt: prompt,
        source: source.url,
        content: source.content.substring(0, 3000)
      });

      // Parse extraction results (simplified - in real implementation would parse JSON)
      return this.parseExtractionResponse(insights.summary, source, 'openai');
    } catch (error) {
      console.error("OpenAI extraction failed:", error);
      return [];
    }
  }

  /**
   * Extract prices using Gemini
   */
  private async extractWithGemini(prompt: string, source: InternetSourceResult): Promise<CommodityPriceData[]> {
    try {
      const validation = await geminiService.crossValidateData([source.content], {
        extraction: true,
        context: prompt
      });

      // Parse extraction results (simplified - in real implementation would parse JSON)
      return this.parseExtractionResponse(JSON.stringify(validation), source, 'gemini');
    } catch (error) {
      console.error("Gemini extraction failed:", error);
      return [];
    }
  }

  /**
   * Parse extraction response into structured data
   */
  private parseExtractionResponse(response: string, source: InternetSourceResult, provider: string): CommodityPriceData[] {
    // This is a simplified parser - in real implementation would use proper JSON parsing
    // and more sophisticated price extraction logic
    
    const results: CommodityPriceData[] = [];
    
    // Basic pattern matching for demonstration
    const pricePattern = /(\d+(?:,\d{3})*(?:\.\d{2})?)\s*(VND|USD|đ).*?(gạo|cà phê|tiêu|cao su)/gi;
    let match;

    while ((match = pricePattern.exec(response)) !== null) {
      const price = parseFloat(match[1].replace(/,/g, ''));
      const currency = match[2] === 'đ' ? 'VND' : match[2];
      const commodity = match[3];

      if (price > 0) {
        results.push({
          commodity: commodity,
          region: "Vietnam",
          price: price,
          currency: currency,
          unit: "kg",
          date: new Date(),
          confidence: 0.8,
          sources: [source.url],
          evidence: [{
            url: source.url,
            extractedText: match[0],
            methodology: `${provider}_extraction`
          }]
        });
      }
    }

    return results;
  }

  /**
   * Cross-validate extracted data using dual LLM consensus
   */
  private async crossValidateWithDualLLM(data: CommodityPriceData[]): Promise<CommodityPriceData[]> {
    const verifiedData: CommodityPriceData[] = [];

    for (const item of data) {
      try {
        // Cross-validate with both LLMs
        const [openaiVerification, geminiVerification] = await Promise.allSettled([
          openaiService.verifyForecast(`Price: ${item.price} ${item.currency} for ${item.commodity}`),
          geminiService.verifyForecast(`Price: ${item.price} ${item.currency} for ${item.commodity}`)
        ]);

        let finalConfidence = item.confidence;
        let verified = false;

        // Calculate consensus confidence
        if (openaiVerification.status === 'fulfilled' && geminiVerification.status === 'fulfilled') {
          const avgConfidence = (openaiVerification.value.confidence + geminiVerification.value.confidence) / 2;
          finalConfidence = Math.min(finalConfidence, avgConfidence);
          verified = openaiVerification.value.verified && geminiVerification.value.verified;
        }

        // Only include high-confidence, verified data
        if (verified && finalConfidence >= 0.7) {
          verifiedData.push({
            ...item,
            confidence: finalConfidence
          });
        }

      } catch (error) {
        console.error("❌ Cross-validation failed for item:", item, error);
      }
    }

    return verifiedData;
  }

  /**
   * CRITICAL: Enforce verified-only policy with confidence threshold and provenance requirements
   */
  private enforceVerifiedOnlyPolicy(data: CommodityPriceData[]): CommodityPriceData[] {
    const filtered = data.filter(item => {
      // 1. Confidence must meet or exceed threshold
      if (item.confidence < this.confidenceThreshold) {
        console.log(`❌ Rejected low confidence: ${item.commodity} (${item.confidence} < ${this.confidenceThreshold})`);
        return false;
      }
      
      // 2. Must have evidence URLs (provenance requirement)
      if (!item.evidence || item.evidence.length === 0) {
        console.log(`❌ Rejected missing evidence: ${item.commodity}`);
        return false;
      }
      
      // 3. All evidence must have valid URLs
      const hasValidEvidence = item.evidence.every(evidence => {
        return evidence.url && 
               evidence.extractedText && 
               evidence.methodology &&
               this.isAllowedDomain(evidence.url);
      });
      
      if (!hasValidEvidence) {
        console.log(`❌ Rejected invalid evidence: ${item.commodity}`);
        return false;
      }
      
      // 4. Must have valid sources
      if (!item.sources || item.sources.length === 0) {
        console.log(`❌ Rejected missing sources: ${item.commodity}`);
        return false;
      }
      
      console.log(`✅ Verified item: ${item.commodity} (confidence: ${item.confidence}, evidence: ${item.evidence.length})`);
      return true;
    });
    
    return filtered;
  }
  
  /**
   * Add page hash for provenance tracking
   */
  private addProvenanceFields(item: CommodityPriceData, sourceResult: InternetSourceResult): CommodityPriceData {
    return {
      ...item,
      evidence: item.evidence.map(evidence => ({
        ...evidence,
        pageHash: sourceResult.contentHash,
        extractedAt: sourceResult.extractedAt.toISOString(),
        sourceTitle: sourceResult.title
      })),
      metadata: {
        sourceType: 'internet' as const,
        fetchedAt: new Date().toISOString(),
        verificationLevel: 'dual_llm',
        provenanceComplete: true
      }
    };
  }

  /**
   * Generate content hash for deduplication
   */
  private generateContentHash(content: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(content).digest('hex');
  }
}

export const internetAggregationService = new InternetAggregationService();