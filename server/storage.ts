import { 
  users, commodities, regions, priceData, forecasts, llmVerifications, alerts, tradingRecommendations,
  sources, pricesRaw, pricesVerified, fxRates, forecastRuns, forecasts30d, evidence, roles,
  compositeConfidenceScores, qualityGates, agreementAnalysis, cooperatives, cooperativeMembers,
  profiles, exportAudit,
  type User, type InsertUser, type Commodity, type InsertCommodity, type Region, type InsertRegion,
  type PriceData, type InsertPriceData, type Forecast, type InsertForecast,
  type LlmVerification, type InsertLlmVerification, type Alert, type InsertAlert,
  type TradingRecommendation, type InsertTradingRecommendation,
  type Source, type InsertSource, type PricesRaw, type InsertPricesRaw,
  type PricesVerified, type InsertPricesVerified, type FxRate, type InsertFxRate,
  type ForecastRun, type InsertForecastRun, type Forecast30d, type InsertForecast30d,
  type Evidence, type InsertEvidence, type Role, type InsertRole,
  type CompositeConfidenceScore, type InsertCompositeConfidenceScore,
  type QualityGate, type InsertQualityGate, type AgreementAnalysis, type InsertAgreementAnalysis,
  type Cooperative, type InsertCooperative, type CooperativeMember, type InsertCooperativeMember,
  type Profile, type InsertProfile, type ExportAudit, type InsertExportAudit
} from "@shared/schema";
import { db, withRLS } from "./db";
import { eq, and, desc, gte, lte, or, inArray, sql } from "drizzle-orm";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";

const ConnectPgSimple = connectPgSimple(session);

// Cooperative Context for multi-tenant operations
export interface CooperativeContext {
  coopId: string;
  userId: string;
  role: 'admin' | 'analyst' | 'farmer';
}

export interface IStorage {
  // Session Store for authentication
  sessionStore: session.SessionStore;
  
  // Cooperative Management
  getCooperative(id: string): Promise<Cooperative | undefined>;
  getCooperatives(): Promise<Cooperative[]>;
  createCooperative(cooperative: InsertCooperative): Promise<Cooperative>;
  updateCooperative(id: string, updates: Partial<InsertCooperative>): Promise<Cooperative>;
  
  getCooperativeMembers(coopId: string): Promise<CooperativeMember[]>;
  getCooperativeMember(coopId: string, userId: string): Promise<CooperativeMember | undefined>;
  createCooperativeMember(member: InsertCooperativeMember): Promise<CooperativeMember>;
  updateCooperativeMember(coopId: string, userId: string, updates: Partial<InsertCooperativeMember>): Promise<CooperativeMember>;
  removeCooperativeMember(coopId: string, userId: string): Promise<void>;
  
  getUserProfile(userId: string): Promise<Profile | undefined>;
  createUserProfile(profile: InsertProfile): Promise<Profile>;
  updateUserProfile(userId: string, updates: Partial<InsertProfile>): Promise<Profile>;
  
  // Export Audit
  getExportAudits(context: CooperativeContext, startDate?: Date, endDate?: Date): Promise<ExportAudit[]>;
  createExportAudit(audit: InsertExportAudit): Promise<ExportAudit>;

  // Users (legacy - will be replaced by Supabase auth)
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Commodities
  getCommodities(): Promise<Commodity[]>;
  getCommodity(id: string): Promise<Commodity | undefined>;
  createCommodity(commodity: InsertCommodity): Promise<Commodity>;

  // Regions
  getRegions(): Promise<Region[]>;
  getRegion(id: string): Promise<Region | undefined>;
  createRegion(region: InsertRegion): Promise<Region>;

  // Price Data
  getPriceData(context: CooperativeContext, commodityId: string, regionId: string, startDate?: Date, endDate?: Date): Promise<PriceData[]>;
  createPriceData(context: CooperativeContext, priceData: InsertPriceData): Promise<PriceData>;

  // Forecasts
  getAllActiveForecasts(context: CooperativeContext): Promise<Forecast[]>;
  getActiveForecasts(context: CooperativeContext, commodityId: string, regionId: string): Promise<Forecast[]>;
  getForecast(context: CooperativeContext, id: string): Promise<Forecast | undefined>;
  createForecast(context: CooperativeContext, forecast: InsertForecast): Promise<Forecast>;
  deactivateOldForecasts(context: CooperativeContext, commodityId: string, regionId: string): Promise<void>;

  // LLM Verifications
  getVerifications(context: CooperativeContext, forecastId?: string, forecast30dId?: string): Promise<LlmVerification[]>;
  getVerificationsByForecast30d(context: CooperativeContext, forecast30dId: string): Promise<LlmVerification[]>;
  createVerification(context: CooperativeContext, verification: InsertLlmVerification): Promise<LlmVerification>;

  // Alerts
  getAllAlerts(context: CooperativeContext): Promise<Alert[]>;
  getActiveAlerts(context: CooperativeContext): Promise<Alert[]>;
  getAlert(context: CooperativeContext, id: string): Promise<Alert | undefined>;
  createAlert(context: CooperativeContext, alert: InsertAlert): Promise<Alert>;
  acknowledgeAlert(context: CooperativeContext, id: string): Promise<void>;

  // Trading Recommendations
  getRecommendations(context: CooperativeContext, forecastId: string): Promise<TradingRecommendation[]>;
  createRecommendation(context: CooperativeContext, recommendation: InsertTradingRecommendation): Promise<TradingRecommendation>;

  // Sources
  getSource(context: CooperativeContext, id: string): Promise<Source | undefined>;
  getSourceByName(context: CooperativeContext, name: string): Promise<Source | undefined>;
  getSources(context: CooperativeContext): Promise<Source[]>;
  getSourcesByType(context: CooperativeContext, type: string): Promise<Source[]>;
  getActiveSources(context: CooperativeContext): Promise<Source[]>;
  createSource(context: CooperativeContext, source: InsertSource): Promise<Source>;
  updateSource(context: CooperativeContext, id: string, updates: Partial<InsertSource>): Promise<Source>;
  upsertSource(context: CooperativeContext, source: InsertSource): Promise<Source>;
  updateSourceLastSync(context: CooperativeContext, id: string, lastSync: Date): Promise<void>;

  // Prices Raw
  getPricesRaw(context: CooperativeContext, commodityId: string, regionId: string, startDate?: Date, endDate?: Date): Promise<PricesRaw[]>;
  getPricesRawBySource(context: CooperativeContext, sourceId: string, startDate?: Date, endDate?: Date): Promise<PricesRaw[]>;
  getLatestPricesRaw(context: CooperativeContext, commodityId: string, regionId: string, limit?: number): Promise<PricesRaw[]>;
  getUnprocessedPricesRaw(context: CooperativeContext): Promise<PricesRaw[]>;
  createPricesRaw(context: CooperativeContext, pricesRaw: InsertPricesRaw): Promise<PricesRaw>;
  bulkInsertPricesRaw(context: CooperativeContext, pricesRaw: InsertPricesRaw[]): Promise<PricesRaw[]>;
  bulkUpsertPricesRaw(context: CooperativeContext, pricesRaw: InsertPricesRaw[]): Promise<PricesRaw[]>;
  upsertPricesRaw(context: CooperativeContext, pricesRaw: InsertPricesRaw): Promise<PricesRaw>;
  markPricesRawAsProcessed(context: CooperativeContext, ids: string[]): Promise<void>;
  
  // NEW: Provenance-aware methods for verified-only policy
  getAllPriceData(context: CooperativeContext, filters?: { sourceType?: string; limit?: number; verifiedOnly?: boolean }): Promise<(PriceData | PricesRaw | PricesVerified)[]>;
  getPricesRawBySourceType(context: CooperativeContext, sourceType: string, limit?: number): Promise<PricesRaw[]>;
  validateProvenanceFields(pricesRaw: InsertPricesRaw): { isValid: boolean; errors: string[] };

  // Prices Verified
  getPricesVerified(context: CooperativeContext, commodityId: string, regionId: string, startDate?: Date, endDate?: Date): Promise<PricesVerified[]>;
  getPricesVerifiedByQuality(context: CooperativeContext, commodityId: string, regionId: string, minQuality: number): Promise<PricesVerified[]>;
  getLatestPricesVerified(context: CooperativeContext, commodityId: string, regionId: string, limit?: number): Promise<PricesVerified[]>;
  createPricesVerified(context: CooperativeContext, pricesVerified: InsertPricesVerified): Promise<PricesVerified>;
  bulkInsertPricesVerified(context: CooperativeContext, pricesVerified: InsertPricesVerified[]): Promise<PricesVerified[]>;
  bulkUpsertPricesVerified(context: CooperativeContext, pricesVerified: InsertPricesVerified[]): Promise<PricesVerified[]>;
  upsertPricesVerified(context: CooperativeContext, pricesVerified: InsertPricesVerified): Promise<PricesVerified>;
  promoteRawToVerified(context: CooperativeContext, pricesRawId: string, verificationData: Partial<InsertPricesVerified>): Promise<PricesVerified>;
  
  // NEW: Dual-LLM verification methods for internet aggregation
  promoteRawToVerifiedWithLlmScores(context: CooperativeContext, pricesRawId: string, llmVerificationData: { openaiScore: number; geminiScore: number; consensusScore: number; agreementLevel: string; verificationEvidence?: any }): Promise<PricesVerified>;
  getPricesVerifiedByConsensusScore(context: CooperativeContext, minScore: number, limit?: number): Promise<PricesVerified[]>;
  validateLlmVerificationData(llmData: any): { isValid: boolean; errors: string[] };

  // FX Rates
  getFxRate(context: CooperativeContext, baseCurrency: string, targetCurrency: string, date: Date): Promise<FxRate | undefined>;
  getFxRatesByDateRange(context: CooperativeContext, baseCurrency: string, targetCurrency: string, startDate: Date, endDate: Date): Promise<FxRate[]>;
  getLatestFxRate(context: CooperativeContext, baseCurrency: string, targetCurrency: string): Promise<FxRate | undefined>;
  createFxRate(context: CooperativeContext, fxRate: InsertFxRate): Promise<FxRate>;
  bulkInsertFxRates(context: CooperativeContext, fxRates: InsertFxRate[]): Promise<FxRate[]>;
  bulkUpsertFxRates(context: CooperativeContext, fxRates: InsertFxRate[]): Promise<FxRate[]>;
  upsertFxRate(context: CooperativeContext, fxRate: InsertFxRate): Promise<FxRate>;

  // Forecast Runs
  getForecastRun(context: CooperativeContext, id: string): Promise<ForecastRun | undefined>;
  getForecastRuns(context: CooperativeContext, commodityId: string, regionId: string): Promise<ForecastRun[]>;
  getForecastRunsByStatus(context: CooperativeContext, status: string): Promise<ForecastRun[]>;
  getForecastRunsInDateRange(context: CooperativeContext, startDate: Date, endDate: Date): Promise<ForecastRun[]>;
  getLatestForecastRun(context: CooperativeContext, commodityId: string, regionId: string): Promise<ForecastRun | undefined>;
  createForecastRun(context: CooperativeContext, forecastRun: InsertForecastRun): Promise<ForecastRun>;
  updateForecastRun(context: CooperativeContext, id: string, updates: Partial<InsertForecastRun>): Promise<ForecastRun>;
  completeForecastRun(context: CooperativeContext, id: string, metrics?: any): Promise<void>;
  failForecastRun(context: CooperativeContext, id: string, errorMessage: string): Promise<void>;

  // Forecasts 30d
  getForecast30d(context: CooperativeContext, id: string): Promise<Forecast30d | undefined>;
  getForecastsByRun(context: CooperativeContext, forecastRunId: string): Promise<Forecast30d[]>;
  getForecastsByTargetDate(context: CooperativeContext, commodityId: string, regionId: string, targetDate: Date): Promise<Forecast30d[]>;
  getActiveForecast30d(context: CooperativeContext, commodityId: string, regionId: string): Promise<Forecast30d[]>;
  createForecast30d(context: CooperativeContext, forecast: InsertForecast30d): Promise<Forecast30d>;
  upsertForecast30d(context: CooperativeContext, forecast: InsertForecast30d): Promise<Forecast30d>;
  bulkInsertForecasts30d(context: CooperativeContext, forecasts: InsertForecast30d[]): Promise<Forecast30d[]>;
  bulkUpsertForecasts30d(context: CooperativeContext, forecasts: InsertForecast30d[]): Promise<Forecast30d[]>;
  deactivateOldForecasts30d(context: CooperativeContext, commodityId: string, regionId: string): Promise<void>;

  // Evidence
  getEvidence(context: CooperativeContext, id: string): Promise<Evidence | undefined>;
  getEvidenceByForecast30d(context: CooperativeContext, forecast30dId: string): Promise<Evidence[]>;
  getEvidenceByForecast(context: CooperativeContext, forecastId: string): Promise<Evidence[]>;
  getEvidenceByConfidence(context: CooperativeContext, minConfidence: number): Promise<Evidence[]>;
  getEvidenceByType(context: CooperativeContext, type: string, commodityId?: string, regionId?: string): Promise<Evidence[]>;
  getActiveEvidence(context: CooperativeContext): Promise<Evidence[]>;
  createEvidence(context: CooperativeContext, evidence: InsertEvidence): Promise<Evidence>;
  updateEvidence(context: CooperativeContext, id: string, updates: Partial<InsertEvidence>): Promise<Evidence>;

  // Roles
  getRole(id: string): Promise<Role | undefined>;
  getRoleByName(name: string): Promise<Role | undefined>;
  getRoles(): Promise<Role[]>;
  getActiveRoles(): Promise<Role[]>;
  getRolesByPermissions(permissions: string[]): Promise<Role[]>;
  createRole(role: InsertRole): Promise<Role>;
  updateRole(id: string, updates: Partial<InsertRole>): Promise<Role>;

  // Quality Gates and CCS
  getCcs(context: CooperativeContext, id: string): Promise<CompositeConfidenceScore | undefined>;
  getCcsByForecastRun(context: CooperativeContext, forecastRunId: string): Promise<CompositeConfidenceScore | undefined>;
  getCcsByForecast30d(context: CooperativeContext, forecast30dId: string): Promise<CompositeConfidenceScore | undefined>;
  getCcsByCommodityRegion(context: CooperativeContext, commodityId: string, regionId: string, limit?: number): Promise<CompositeConfidenceScore[]>;
  getCCSInDateRange(context: CooperativeContext, startDate: Date, endDate: Date): Promise<CompositeConfidenceScore[]>;
  createCcs(context: CooperativeContext, ccs: InsertCompositeConfidenceScore): Promise<CompositeConfidenceScore>;
  updateCcs(context: CooperativeContext, id: string, updates: Partial<InsertCompositeConfidenceScore>): Promise<CompositeConfidenceScore>;

  getQualityGate(context: CooperativeContext, id: string): Promise<QualityGate | undefined>;
  getQualityGatesByCcs(context: CooperativeContext, ccsId: string): Promise<QualityGate[]>;
  getQualityGatesByForecastRun(context: CooperativeContext, forecastRunId: string): Promise<QualityGate[]>;
  getQualityGatesByStatus(context: CooperativeContext, gateStatus: string): Promise<QualityGate[]>;
  getQualityGatesInDateRange(context: CooperativeContext, startDate: Date, endDate: Date): Promise<QualityGate[]>;
  getPendingQualityGates(context: CooperativeContext): Promise<QualityGate[]>;
  createQualityGate(context: CooperativeContext, qualityGate: InsertQualityGate): Promise<QualityGate>;
  updateQualityGate(context: CooperativeContext, id: string, updates: Partial<InsertQualityGate>): Promise<QualityGate>;
  applyManualOverride(context: CooperativeContext, id: string, overrideReason: string, overrideBy: string): Promise<QualityGate>;

  getAgreementAnalysis(context: CooperativeContext, id: string): Promise<AgreementAnalysis | undefined>;
  getAgreementAnalysisByCcs(context: CooperativeContext, ccsId: string): Promise<AgreementAnalysis | undefined>;
  createAgreementAnalysis(context: CooperativeContext, agreementAnalysis: InsertAgreementAnalysis): Promise<AgreementAnalysis>;
  updateAgreementAnalysis(context: CooperativeContext, id: string, updates: Partial<InsertAgreementAnalysis>): Promise<AgreementAnalysis>;
}

export class DatabaseStorage implements IStorage {
  sessionStore: session.SessionStore;
  
  constructor() {
    // Setup session store with PostgreSQL using connection string
    // connect-pg-simple expects a connection string, not drizzle instance
    const PostgresSessionStore = connectPgSimple(session);
    
    if (process.env.DATABASE_URL) {
      this.sessionStore = new PostgresSessionStore({
        conString: process.env.DATABASE_URL,
        createTableIfMissing: true,
      });
    } else {
      // Development fallback to memory store with clear warning
      console.warn('⚠️  [SESSION] Using memory store - NOT for production!');
      const createMemoryStore = require('memorystore');
      const MemoryStore = createMemoryStore(session);
      this.sessionStore = new MemoryStore({
        checkPeriod: 86400000, // prune expired entries every 24h
      });
    }
  }
  
  // ============================================================================
  // COOPERATIVE MANAGEMENT METHODS
  // ============================================================================
  
  async getCooperative(id: string): Promise<Cooperative | undefined> {
    const [cooperative] = await db.select().from(cooperatives).where(eq(cooperatives.id, id));
    return cooperative || undefined;
  }

  async getCooperatives(): Promise<Cooperative[]> {
    return await db.select().from(cooperatives)
      .where(eq(cooperatives.active, true))
      .orderBy(desc(cooperatives.createdAt));
  }

  async createCooperative(cooperative: InsertCooperative): Promise<Cooperative> {
    const [created] = await db.insert(cooperatives).values(cooperative).returning();
    return created;
  }

  async updateCooperative(id: string, updates: Partial<InsertCooperative>): Promise<Cooperative> {
    const [updated] = await db.update(cooperatives)
      .set(updates)
      .where(eq(cooperatives.id, id))
      .returning();
    return updated;
  }

  async getCooperativeMembers(coopId: string): Promise<CooperativeMember[]> {
    return await db.select().from(cooperativeMembers)
      .where(and(
        eq(cooperativeMembers.coopId, coopId),
        eq(cooperativeMembers.active, true)
      ))
      .orderBy(desc(cooperativeMembers.joinedAt));
  }

  async getCooperativeMember(coopId: string, userId: string): Promise<CooperativeMember | undefined> {
    const [member] = await db.select().from(cooperativeMembers)
      .where(and(
        eq(cooperativeMembers.coopId, coopId),
        eq(cooperativeMembers.userId, userId),
        eq(cooperativeMembers.active, true)
      ));
    return member || undefined;
  }

  async createCooperativeMember(member: InsertCooperativeMember): Promise<CooperativeMember> {
    const [created] = await db.insert(cooperativeMembers).values(member).returning();
    return created;
  }

  async updateCooperativeMember(coopId: string, userId: string, updates: Partial<InsertCooperativeMember>): Promise<CooperativeMember> {
    const [updated] = await db.update(cooperativeMembers)
      .set(updates)
      .where(and(
        eq(cooperativeMembers.coopId, coopId),
        eq(cooperativeMembers.userId, userId)
      ))
      .returning();
    return updated;
  }

  async removeCooperativeMember(coopId: string, userId: string): Promise<void> {
    await db.update(cooperativeMembers)
      .set({ active: false })
      .where(and(
        eq(cooperativeMembers.coopId, coopId),
        eq(cooperativeMembers.userId, userId)
      ));
  }

  async getUserProfile(userId: string): Promise<Profile | undefined> {
    // User profiles should use RLS context for security
    const systemContext = { userId, coopId: 'system-profile-lookup', role: 'system' as const };
    return await withRLS(systemContext, async (dbTx) => {
      const [profile] = await dbTx.select().from(profiles).where(eq(profiles.userId, userId));
      return profile || undefined;
    });
  }

  async createUserProfile(profile: InsertProfile): Promise<Profile> {
    // User profiles should use RLS context for security
    const systemContext = { userId: profile.userId, coopId: 'system-profile-create', role: 'system' as const };
    return await withRLS(systemContext, async (dbTx) => {
      const [created] = await dbTx.insert(profiles).values(profile).returning();
      return created;
    });
  }

  async updateUserProfile(userId: string, updates: Partial<InsertProfile>): Promise<Profile> {
    // User profiles should use RLS context for security
    const systemContext = { userId, coopId: 'system-profile-update', role: 'system' as const };
    return await withRLS(systemContext, async (dbTx) => {
      const [updated] = await dbTx.update(profiles)
        .set(updates)
        .where(eq(profiles.userId, userId))
        .returning();
      return updated;
    });
  }

  async getExportAudits(context: CooperativeContext, startDate?: Date, endDate?: Date): Promise<ExportAudit[]> {
    return await withRLS({ ...context, role: context.role || 'farmer' }, async (rlsDb) => {
      let conditions = [];
      if (startDate && endDate) {
        conditions.push(
          gte(exportAudit.createdAt, startDate),
          lte(exportAudit.createdAt, endDate)
        );
      }
      
      return await rlsDb.select().from(exportAudit)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(exportAudit.createdAt));
    });
  }

  async createExportAudit(audit: InsertExportAudit): Promise<ExportAudit> {
    // Note: createExportAudit needs context for RLS but interface doesn't provide it
    // This method should be updated to accept CooperativeContext in the interface
    const [created] = await db.insert(exportAudit).values(audit).returning();
    return created;
  }

  // ============================================================================
  // UPDATED METHODS WITH COOPERATIVE CONTEXT
  // ============================================================================
  // Users
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  // Commodities
  async getCommodities(): Promise<Commodity[]> {
    return await db.select().from(commodities);
  }

  async getCommodity(id: string): Promise<Commodity | undefined> {
    const [commodity] = await db.select().from(commodities).where(eq(commodities.id, id));
    return commodity || undefined;
  }

  async createCommodity(commodity: InsertCommodity): Promise<Commodity> {
    const [created] = await db.insert(commodities).values(commodity).returning();
    return created;
  }

  // Regions
  async getRegions(): Promise<Region[]> {
    return await db.select().from(regions);
  }

  async getRegion(id: string): Promise<Region | undefined> {
    const [region] = await db.select().from(regions).where(eq(regions.id, id));
    return region || undefined;
  }

  async createRegion(region: InsertRegion): Promise<Region> {
    const [created] = await db.insert(regions).values(region).returning();
    return created;
  }

  // Price Data
  async getPriceData(context: CooperativeContext, commodityId: string, regionId: string, startDate?: Date, endDate?: Date): Promise<PriceData[]> {
    return await withRLS(context, async (rlsDb) => {
      let conditions = [
        eq(priceData.commodityId, commodityId),
        eq(priceData.regionId, regionId)
      ];
      
      if (startDate && endDate) {
        conditions.push(
          gte(priceData.date, startDate),
          lte(priceData.date, endDate)
        );
      }
      
      return await rlsDb.select().from(priceData)
        .where(and(...conditions))
        .orderBy(desc(priceData.date));
    });
  }

  async createPriceData(context: CooperativeContext, data: InsertPriceData): Promise<PriceData> {
    return await withRLS(context, async (rlsDb) => {
      // Ensure coop_id is set from context
      const dataWithCoop = { ...data, coopId: context.coopId };
      const [created] = await rlsDb.insert(priceData).values(dataWithCoop).returning();
      return created;
    });
  }

  // Forecasts
  async getAllActiveForecasts(context: CooperativeContext): Promise<Forecast[]> {
    return await withRLS(context, async (rlsDb) => {
      return await rlsDb.select().from(forecasts)
        .where(eq(forecasts.isActive, true))
        .orderBy(desc(forecasts.createdAt));
    });
  }

  async getActiveForecasts(context: CooperativeContext, commodityId: string, regionId: string): Promise<Forecast[]> {
    return await withRLS(context, async (rlsDb) => {
      return await rlsDb.select().from(forecasts)
        .where(and(
          eq(forecasts.commodityId, commodityId),
          eq(forecasts.regionId, regionId),
          eq(forecasts.isActive, true)
        ))
        .orderBy(desc(forecasts.createdAt));
    });
  }

  async getForecast(context: CooperativeContext, id: string): Promise<Forecast | undefined> {
    return await withRLS(context, async (rlsDb) => {
      const [forecast] = await rlsDb.select().from(forecasts)
        .where(eq(forecasts.id, id));
      return forecast || undefined;
    });
  }

  async createForecast(context: CooperativeContext, forecast: InsertForecast): Promise<Forecast> {
    return await withRLS(context, async (rlsDb) => {
      // Ensure coop_id is set from context
      const forecastWithCoop = { ...forecast, coopId: context.coopId };
      const [created] = await rlsDb.insert(forecasts).values(forecastWithCoop).returning();
      return created;
    });
  }

  async deactivateOldForecasts(context: CooperativeContext, commodityId: string, regionId: string): Promise<void> {
    await withRLS(context, async (rlsDb) => {
      await rlsDb.update(forecasts)
        .set({ isActive: false })
        .where(and(
          eq(forecasts.commodityId, commodityId),
          eq(forecasts.regionId, regionId),
          eq(forecasts.isActive, true)
        ));
    });
  }

  // LLM Verifications
  async getVerifications(context: CooperativeContext, forecastId?: string, forecast30dId?: string): Promise<LlmVerification[]> {
    if (!forecastId && !forecast30dId) {
      throw new Error('Either forecastId or forecast30dId must be provided');
    }
    
    return await withRLS(context, async (rlsDb) => {
      const conditions = [];
      if (forecastId) {
        conditions.push(eq(llmVerifications.forecastId, forecastId));
      }
      if (forecast30dId) {
        conditions.push(eq(llmVerifications.forecast30dId, forecast30dId));
      }
      
      return await rlsDb.select().from(llmVerifications)
        .where(and(...conditions))
        .orderBy(desc(llmVerifications.createdAt));
    });
  }

  async getVerificationsByForecast30d(context: CooperativeContext, forecast30dId: string): Promise<LlmVerification[]> {
    return await withRLS(context, async (rlsDb) => {
      return await rlsDb.select().from(llmVerifications)
        .where(eq(llmVerifications.forecast30dId, forecast30dId))
        .orderBy(desc(llmVerifications.createdAt));
    });
  }

  async createVerification(context: CooperativeContext, verification: InsertLlmVerification): Promise<LlmVerification> {
    return await withRLS(context, async (rlsDb) => {
      // Ensure coop_id is set from context
      const verificationWithCoop = { ...verification, coopId: context.coopId };
      const [created] = await rlsDb.insert(llmVerifications).values(verificationWithCoop).returning();
      return created;
    });
  }

  // Alerts
  async getAllAlerts(context: CooperativeContext): Promise<Alert[]> {
    return await withRLS(context, async (rlsDb) => {
      return await rlsDb.select().from(alerts)
        .orderBy(desc(alerts.createdAt));
    });
  }

  async getActiveAlerts(context: CooperativeContext): Promise<Alert[]> {
    return await withRLS(context, async (rlsDb) => {
      return await rlsDb.select().from(alerts)
        .where(eq(alerts.acknowledged, false))
        .orderBy(desc(alerts.createdAt));
    });
  }

  async getAlert(context: CooperativeContext, id: string): Promise<Alert | undefined> {
    return await withRLS(context, async (rlsDb) => {
      const [alert] = await rlsDb.select().from(alerts)
        .where(eq(alerts.id, id));
      return alert || undefined;
    });
  }

  async createAlert(context: CooperativeContext, alert: InsertAlert): Promise<Alert> {
    return await withRLS(context, async (rlsDb) => {
      // Ensure coop_id is set from context
      const alertWithCoop = { ...alert, coopId: context.coopId };
      const [created] = await rlsDb.insert(alerts).values(alertWithCoop).returning();
      return created;
    });
  }

  async acknowledgeAlert(context: CooperativeContext, id: string): Promise<void> {
    await withRLS(context, async (rlsDb) => {
      await rlsDb.update(alerts)
        .set({ acknowledged: true })
        .where(eq(alerts.id, id));
    });
  }

  // Trading Recommendations
  async getRecommendations(context: CooperativeContext, forecastId: string): Promise<TradingRecommendation[]> {
    return await withRLS(context, async (rlsDb) => {
      return await rlsDb.select().from(tradingRecommendations)
        .where(eq(tradingRecommendations.forecastId, forecastId))
        .orderBy(desc(tradingRecommendations.createdAt));
    });
  }

  async createRecommendation(context: CooperativeContext, recommendation: InsertTradingRecommendation): Promise<TradingRecommendation> {
    return await withRLS(context, async (rlsDb) => {
      // Ensure coop_id is set from context
      const recommendationWithCoop = { ...recommendation, coopId: context.coopId };
      const [created] = await rlsDb.insert(tradingRecommendations).values(recommendationWithCoop).returning();
      return created;
    });
  }

  // Sources
  async getSource(context: CooperativeContext, id: string): Promise<Source | undefined> {
    return await withRLS(context, async (rlsDb) => {
      const [source] = await rlsDb.select().from(sources)
        .where(eq(sources.id, id));
      return source || undefined;
    });
  }

  async getSourceByName(context: CooperativeContext, name: string): Promise<Source | undefined> {
    return await withRLS(context, async (rlsDb) => {
      const [source] = await rlsDb.select().from(sources)
        .where(eq(sources.name, name));
      return source || undefined;
    });
  }

  async getSources(context: CooperativeContext): Promise<Source[]> {
    return await withRLS(context, async (rlsDb) => {
      return await rlsDb.select().from(sources)
        .orderBy(desc(sources.createdAt));
    });
  }

  async getSourcesByType(context: CooperativeContext, type: string): Promise<Source[]> {
    return await withRLS(context, async (rlsDb) => {
      return await rlsDb.select().from(sources)
        .where(eq(sources.type, type))
        .orderBy(desc(sources.createdAt));
    });
  }

  async getActiveSources(context: CooperativeContext): Promise<Source[]> {
    return await withRLS(context, async (rlsDb) => {
      return await rlsDb.select().from(sources)
        .where(eq(sources.isActive, true))
        .orderBy(desc(sources.createdAt));
    });
  }

  async createSource(context: CooperativeContext, source: InsertSource): Promise<Source> {
    return await withRLS(context, async (rlsDb) => {
      // Ensure coop_id is set from context
      const sourceWithCoop = { ...source, coopId: context.coopId };
      const [created] = await rlsDb.insert(sources).values(sourceWithCoop).returning();
      return created;
    });
  }

  async updateSource(context: CooperativeContext, id: string, updates: Partial<InsertSource>): Promise<Source> {
    return await withRLS(context, async (rlsDb) => {
      const [updated] = await rlsDb.update(sources)
        .set(updates)
        .where(eq(sources.id, id))
        .returning();
      return updated;
    });
  }

  async upsertSource(context: CooperativeContext, source: InsertSource): Promise<Source> {
    return await withRLS(context, async (rlsDb) => {
      // Ensure coop_id is set from context
      const sourceWithCoop = { ...source, coopId: context.coopId };
      const [upserted] = await rlsDb.insert(sources)
        .values(sourceWithCoop)
        .onConflictDoUpdate({
          target: [sources.name, sources.coopId],
          set: {
            type: sourceWithCoop.type,
            url: sourceWithCoop.url,
            frequency: sourceWithCoop.frequency,
            reliability: sourceWithCoop.reliability,
            apiKeyRef: sourceWithCoop.apiKeyRef,
            isActive: sourceWithCoop.isActive,
            metadata: sourceWithCoop.metadata,
          }
        })
        .returning();
      return upserted;
    });
  }

  async updateSourceLastSync(context: CooperativeContext, id: string, lastSync: Date): Promise<void> {
    await withRLS(context, async (rlsDb) => {
      await rlsDb.update(sources)
        .set({ lastSync })
        .where(eq(sources.id, id));
    });
  }

  // Prices Raw
  async getPricesRaw(context: CooperativeContext, commodityId: string, regionId: string, startDate?: Date, endDate?: Date): Promise<PricesRaw[]> {
    return await withRLS(context, async (rlsDb) => {
      let conditions = [
        eq(pricesRaw.commodityId, commodityId),
        eq(pricesRaw.regionId, regionId)
      ];
      
      if (startDate && endDate) {
        conditions.push(
          gte(pricesRaw.date, startDate),
          lte(pricesRaw.date, endDate)
        );
      }
      
      return await rlsDb.select().from(pricesRaw)
        .where(and(...conditions))
        .orderBy(desc(pricesRaw.date));
    });
  }

  async getPricesRawBySource(context: CooperativeContext, sourceId: string, startDate?: Date, endDate?: Date): Promise<PricesRaw[]> {
    return await withRLS(context, async (rlsDb) => {
      let conditions = [eq(pricesRaw.sourceId, sourceId)];
      
      if (startDate && endDate) {
        conditions.push(
          gte(pricesRaw.date, startDate),
          lte(pricesRaw.date, endDate)
        );
      }
      
      return await rlsDb.select().from(pricesRaw)
        .where(and(...conditions))
        .orderBy(desc(pricesRaw.date));
    });
  }

  async getLatestPricesRaw(context: CooperativeContext, commodityId: string, regionId: string, limit: number = 50): Promise<PricesRaw[]> {
    return await withRLS(context, async (rlsDb) => {
      return await rlsDb.select().from(pricesRaw)
        .where(and(
          eq(pricesRaw.commodityId, commodityId),
          eq(pricesRaw.regionId, regionId)
        ))
        .orderBy(desc(pricesRaw.date))
        .limit(limit);
    });
  }

  async getUnprocessedPricesRaw(context: CooperativeContext): Promise<PricesRaw[]> {
    return await withRLS(context, async (rlsDb) => {
      return await rlsDb.select().from(pricesRaw)
        .where(eq(pricesRaw.isProcessed, false))
        .orderBy(desc(pricesRaw.createdAt));
    });
  }

  async createPricesRaw(context: CooperativeContext, pricesRawData: InsertPricesRaw): Promise<PricesRaw> {
    return await withRLS(context, async (rlsDb) => {
      // CRITICAL: Validate provenance fields for internet sources
      const validation = this.validateProvenanceFields(pricesRawData);
      if (!validation.isValid) {
        throw new Error(`Provenance validation failed: ${validation.errors.join(', ')}`);
      }
      
      // Ensure coop_id is set from context
      const dataWithCoop = { ...pricesRawData, coopId: context.coopId };
      const [created] = await rlsDb.insert(pricesRaw).values(dataWithCoop).returning();
      return created;
    });
  }

  async bulkInsertPricesRaw(context: CooperativeContext, pricesRawData: InsertPricesRaw[]): Promise<PricesRaw[]> {
    if (pricesRawData.length === 0) return [];
    // Use bulk upsert for idempotency
    return await this.bulkUpsertPricesRaw(context, pricesRawData);
  }

  async bulkUpsertPricesRaw(context: CooperativeContext, pricesRawData: InsertPricesRaw[]): Promise<PricesRaw[]> {
    if (pricesRawData.length === 0) return [];
    return await withRLS(context, async (rlsDb) => {
      // Ensure coop_id is set from context for all data
      const dataWithCoop = pricesRawData.map(data => ({ ...data, coopId: context.coopId }));
      return await rlsDb.insert(pricesRaw)
        .values(dataWithCoop)
        .onConflictDoUpdate({
          target: [pricesRaw.sourceId, pricesRaw.commodityId, pricesRaw.regionId, pricesRaw.date, pricesRaw.unit],
          set: {
            price: sql.raw(`excluded.price`),
            currency: sql.raw(`excluded.currency`),
            volume: sql.raw(`excluded.volume`),
            rawData: sql.raw(`excluded.raw_data`),
            isProcessed: sql.raw(`excluded.is_processed`),
          }
        })
        .returning();
    });
  }

  async upsertPricesRaw(context: CooperativeContext, pricesRawData: InsertPricesRaw): Promise<PricesRaw> {
    return await withRLS(context, async (rlsDb) => {
      // Ensure coop_id is set from context
      const dataWithCoop = { ...pricesRawData, coopId: context.coopId };
      const [upserted] = await rlsDb.insert(pricesRaw)
        .values(dataWithCoop)
        .onConflictDoUpdate({
          target: [pricesRaw.sourceId, pricesRaw.commodityId, pricesRaw.regionId, pricesRaw.date, pricesRaw.unit],
          set: {
            price: dataWithCoop.price,
            currency: dataWithCoop.currency,
            volume: dataWithCoop.volume,
            rawData: dataWithCoop.rawData,
            isProcessed: dataWithCoop.isProcessed,
          }
        })
        .returning();
      return upserted;
    });
  }

  async markPricesRawAsProcessed(context: CooperativeContext, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await withRLS(context, async (rlsDb) => {
      await rlsDb.update(pricesRaw)
        .set({ isProcessed: true })
        .where(inArray(pricesRaw.id, ids));
    });
  }
  
  // NEW: Provenance-aware methods for verified-only policy
  async getAllPriceData(context: CooperativeContext, filters: { sourceType?: string; limit?: number; verifiedOnly?: boolean } = {}): Promise<(PriceData | PricesRaw | PricesVerified)[]> {
    return await withRLS(context, async (rlsDb) => {
      const { sourceType, limit = 100, verifiedOnly = false } = filters;
      
      if (verifiedOnly) {
        // CRITICAL: Return only verified data with consensusScore >= 0.7
        let conditions = [
          gte(pricesVerified.consensusScore, sql`0.7`) // Enforce verified-only policy with proper numeric comparison
        ];
        
        if (sourceType) {
          // Join with pricesRaw to filter by sourceType AND enforce provenance for internet sources
          let additionalConditions = [eq(pricesRaw.sourceType, sourceType)];
          
          // CRITICAL: For internet sources, ensure complete provenance tracking with non-empty arrays
          if (sourceType === 'internet') {
            additionalConditions.push(
              sql`${pricesRaw.evidenceUrls} IS NOT NULL`,
              sql`jsonb_array_length(${pricesRaw.evidenceUrls}) > 0`,
              sql`${pricesRaw.pageHashes} IS NOT NULL`, 
              sql`jsonb_array_length(${pricesRaw.pageHashes}) > 0`,
              sql`${pricesRaw.aggregationMetadata} IS NOT NULL`,
              sql`${pricesRaw.aggregationMetadata} ? 'confidenceScore'`, // Ensure confidenceScore key exists
              sql`(${pricesRaw.aggregationMetadata}->>'confidenceScore')::numeric >= 0.7` // Enforce threshold in metadata
            );
          }
          
          return await rlsDb.select({
            id: pricesVerified.id,
            coopId: pricesVerified.coopId,
            pricesRawId: pricesVerified.pricesRawId,
            sourceId: pricesVerified.sourceId,
            commodityId: pricesVerified.commodityId,
            regionId: pricesVerified.regionId,
            date: pricesVerified.date,
            price: pricesVerified.price,
            priceUsd: pricesVerified.priceUsd,
            currency: pricesVerified.currency,
            volume: pricesVerified.volume,
            qualityScore: pricesVerified.qualityScore,
            verificationMethod: pricesVerified.verificationMethod,
            openaiScore: pricesVerified.openaiScore,
            geminiScore: pricesVerified.geminiScore,
            consensusScore: pricesVerified.consensusScore,
            agreementLevel: pricesVerified.agreementLevel,
            verificationEvidence: pricesVerified.verificationEvidence,
            evidenceUrls: pricesRaw.evidenceUrls,
            sourceType: pricesRaw.sourceType,
            pageHashes: pricesRaw.pageHashes,
            aggregationMetadata: pricesRaw.aggregationMetadata
          })
          .from(pricesVerified)
          .innerJoin(pricesRaw, eq(pricesVerified.pricesRawId, pricesRaw.id))
          .where(and(...conditions, ...additionalConditions))
          .orderBy(desc(pricesVerified.verifiedAt))
          .limit(limit);
        }
        
        return await rlsDb.select().from(pricesVerified)
          .where(and(...conditions))
          .orderBy(desc(pricesVerified.verifiedAt))
          .limit(limit);
      } else {
        // Return raw data
        let conditions = [];
        if (sourceType) {
          conditions.push(eq(pricesRaw.sourceType, sourceType));
        }
        
        return await rlsDb.select().from(pricesRaw)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(pricesRaw.createdAt))
          .limit(limit);
      }
    });
  }
  
  async getPricesRawBySourceType(context: CooperativeContext, sourceType: string, limit: number = 100): Promise<PricesRaw[]> {
    return await withRLS(context, async (rlsDb) => {
      return await rlsDb.select().from(pricesRaw)
        .where(eq(pricesRaw.sourceType, sourceType))
        .orderBy(desc(pricesRaw.createdAt))
        .limit(limit);
    });
  }
  
  validateProvenanceFields(pricesRaw: InsertPricesRaw): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    // For internet sources, require complete provenance
    if (pricesRaw.sourceType === 'internet') {
      if (!pricesRaw.evidenceUrls || !Array.isArray(pricesRaw.evidenceUrls) || pricesRaw.evidenceUrls.length === 0) {
        errors.push('Internet sources must have evidenceUrls array with at least one entry');
      }
      
      if (!pricesRaw.pageHashes || !Array.isArray(pricesRaw.pageHashes) || pricesRaw.pageHashes.length === 0) {
        errors.push('Internet sources must have pageHashes array for content verification');
      }
      
      if (!pricesRaw.aggregationMetadata) {
        errors.push('Internet sources must have aggregationMetadata for verification tracking');
      } else {
        const metadata = pricesRaw.aggregationMetadata as any;
        if (!metadata.confidenceScore || metadata.confidenceScore < 0.7) {
          errors.push('Internet sources must have confidenceScore >= 0.7 for verified-only policy');
        }
        if (!metadata.evidenceCount || metadata.evidenceCount < 1) {
          errors.push('Internet sources must have evidence for verification');
        }
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // Prices Verified
  async getPricesVerified(context: CooperativeContext, commodityId: string, regionId: string, startDate?: Date, endDate?: Date): Promise<PricesVerified[]> {
    return await withRLS(context, async (rlsDb) => {
      let conditions = [
        eq(pricesVerified.commodityId, commodityId),
        eq(pricesVerified.regionId, regionId)
      ];
      
      if (startDate && endDate) {
        conditions.push(
          gte(pricesVerified.date, startDate),
          lte(pricesVerified.date, endDate)
        );
      }
      
      return await rlsDb.select().from(pricesVerified)
        .where(and(...conditions))
        .orderBy(desc(pricesVerified.date));
    });
  }

  async getPricesVerifiedByQuality(context: CooperativeContext, commodityId: string, regionId: string, minQuality: number): Promise<PricesVerified[]> {
    return await withRLS(context, async (rlsDb) => {
      return await rlsDb.select().from(pricesVerified)
        .where(and(
          eq(pricesVerified.commodityId, commodityId),
          eq(pricesVerified.regionId, regionId),
          gte(pricesVerified.qualityScore, minQuality.toString())
        ))
        .orderBy(desc(pricesVerified.date));
    });
  }

  async getLatestPricesVerified(context: CooperativeContext, commodityId: string, regionId: string, limit: number = 50): Promise<PricesVerified[]> {
    return await withRLS(context, async (rlsDb) => {
      return await rlsDb.select().from(pricesVerified)
        .where(and(
          eq(pricesVerified.commodityId, commodityId),
          eq(pricesVerified.regionId, regionId)
        ))
        .orderBy(desc(pricesVerified.date))
        .limit(limit);
    });
  }

  async createPricesVerified(context: CooperativeContext, pricesVerifiedData: InsertPricesVerified): Promise<PricesVerified> {
    return await withRLS(context, async (rlsDb) => {
      // CRITICAL: Enforce verified-only policy at storage level
      if (pricesVerifiedData.consensusScore && parseFloat(pricesVerifiedData.consensusScore) < 0.7) {
        throw new Error(`Verified-only policy violation: consensusScore ${pricesVerifiedData.consensusScore} < 0.7`);
      }
      
      // Validate LLM verification data if present
      if (pricesVerifiedData.openaiScore || pricesVerifiedData.geminiScore || pricesVerifiedData.consensusScore) {
        const llmData = {
          openaiScore: parseFloat(pricesVerifiedData.openaiScore || '0'),
          geminiScore: parseFloat(pricesVerifiedData.geminiScore || '0'),
          consensusScore: parseFloat(pricesVerifiedData.consensusScore || '0'),
          agreementLevel: pricesVerifiedData.agreementLevel || 'unknown'
        };
        const validation = this.validateLlmVerificationData(llmData);
        if (!validation.isValid) {
          throw new Error(`LLM verification validation failed: ${validation.errors.join(', ')}`);
        }
      }
      
      // Ensure coop_id is set from context
      const dataWithCoop = { ...pricesVerifiedData, coopId: context.coopId };
      const [created] = await rlsDb.insert(pricesVerified).values(dataWithCoop).returning();
      return created;
    });
  }

  async bulkInsertPricesVerified(context: CooperativeContext, pricesVerifiedData: InsertPricesVerified[]): Promise<PricesVerified[]> {
    if (pricesVerifiedData.length === 0) return [];
    // Use bulk upsert for idempotency
    return await this.bulkUpsertPricesVerified(context, pricesVerifiedData);
  }

  async bulkUpsertPricesVerified(context: CooperativeContext, pricesVerifiedData: InsertPricesVerified[]): Promise<PricesVerified[]> {
    if (pricesVerifiedData.length === 0) return [];
    return await withRLS(context, async (rlsDb) => {
      // CRITICAL: Enforce verified-only policy for all records in bulk
      for (const data of pricesVerifiedData) {
        if (data.consensusScore && parseFloat(data.consensusScore) < 0.7) {
          throw new Error(`Verified-only policy violation in bulk operation: consensusScore ${data.consensusScore} < 0.7`);
        }
        
        // Validate LLM verification data if present
        if (data.openaiScore || data.geminiScore || data.consensusScore) {
          const llmData = {
            openaiScore: parseFloat(data.openaiScore || '0'),
            geminiScore: parseFloat(data.geminiScore || '0'),
            consensusScore: parseFloat(data.consensusScore || '0'),
            agreementLevel: data.agreementLevel || 'unknown'
          };
          const validation = this.validateLlmVerificationData(llmData);
          if (!validation.isValid) {
            throw new Error(`LLM verification validation failed in bulk operation: ${validation.errors.join(', ')}`);
          }
        }
      }
      
      // Ensure coop_id is set from context for all data
      const dataWithCoop = pricesVerifiedData.map(data => ({ ...data, coopId: context.coopId }));
      return await rlsDb.insert(pricesVerified)
        .values(dataWithCoop)
        .onConflictDoUpdate({
          target: [pricesVerified.commodityId, pricesVerified.regionId, pricesVerified.date],
          set: {
            price: sql.raw(`excluded.price`),
            priceUsd: sql.raw(`excluded.price_usd`),
            currency: sql.raw(`excluded.currency`),
            volume: sql.raw(`excluded.volume`),
            qualityScore: sql.raw(`excluded.quality_score`),
            verificationMethod: sql.raw(`excluded.verification_method`),
            outlierFlag: sql.raw(`excluded.outlier_flag`),
            adjustments: sql.raw(`excluded.adjustments`),
            verifiedBy: sql.raw(`excluded.verified_by`),
            // CRITICAL: Include LLM verification fields
            openaiScore: sql.raw(`excluded.openai_score`),
            geminiScore: sql.raw(`excluded.gemini_score`),
            consensusScore: sql.raw(`excluded.consensus_score`),
            agreementLevel: sql.raw(`excluded.agreement_level`),
            verificationEvidence: sql.raw(`excluded.verification_evidence`)
          }
        })
        .returning();
    });
  }

  async upsertPricesVerified(context: CooperativeContext, pricesVerifiedData: InsertPricesVerified): Promise<PricesVerified> {
    return await withRLS(context, async (rlsDb) => {
      // CRITICAL: Enforce verified-only policy at storage level
      if (pricesVerifiedData.consensusScore && parseFloat(pricesVerifiedData.consensusScore) < 0.7) {
        throw new Error(`Verified-only policy violation: consensusScore ${pricesVerifiedData.consensusScore} < 0.7`);
      }
      
      // Validate LLM verification data if present  
      if (pricesVerifiedData.openaiScore || pricesVerifiedData.geminiScore || pricesVerifiedData.consensusScore) {
        const llmData = {
          openaiScore: parseFloat(pricesVerifiedData.openaiScore || '0'),
          geminiScore: parseFloat(pricesVerifiedData.geminiScore || '0'),
          consensusScore: parseFloat(pricesVerifiedData.consensusScore || '0'),
          agreementLevel: pricesVerifiedData.agreementLevel || 'unknown'
        };
        const validation = this.validateLlmVerificationData(llmData);
        if (!validation.isValid) {
          throw new Error(`LLM verification validation failed: ${validation.errors.join(', ')}`);
        }
      }
      
      // Ensure coop_id is set from context
      const dataWithCoop = { ...pricesVerifiedData, coopId: context.coopId };
      const [upserted] = await rlsDb.insert(pricesVerified)
        .values(dataWithCoop)
        .onConflictDoUpdate({
          target: [pricesVerified.commodityId, pricesVerified.regionId, pricesVerified.date],
          set: {
            price: dataWithCoop.price,
            priceUsd: dataWithCoop.priceUsd,
            currency: dataWithCoop.currency,
            volume: dataWithCoop.volume,
            qualityScore: dataWithCoop.qualityScore,
            verificationMethod: dataWithCoop.verificationMethod,
            outlierFlag: dataWithCoop.outlierFlag,
            adjustments: dataWithCoop.adjustments,
            verifiedBy: dataWithCoop.verifiedBy,
            // CRITICAL: Include LLM verification fields in conflict resolution
            openaiScore: dataWithCoop.openaiScore,
            geminiScore: dataWithCoop.geminiScore,
            consensusScore: dataWithCoop.consensusScore,
            agreementLevel: dataWithCoop.agreementLevel,
            verificationEvidence: dataWithCoop.verificationEvidence
          }
        })
        .returning();
      return upserted;
    });
  }

  async promoteRawToVerified(context: CooperativeContext, pricesRawId: string, verificationData: Partial<InsertPricesVerified>): Promise<PricesVerified> {
    return await withRLS(context, async (rlsDb) => {
      return await rlsDb.transaction(async (tx) => {
      // Step 1: Read raw price data
      const [rawPrice] = await tx.select().from(pricesRaw).where(eq(pricesRaw.id, pricesRawId));
      if (!rawPrice) {
        throw new Error(`PricesRaw with id ${pricesRawId} not found`);
      }

      // Step 2: Derive and validate target verified data
      const pricesVerifiedData: InsertPricesVerified = {
        pricesRawId: rawPrice.id,
        sourceId: rawPrice.sourceId,
        commodityId: rawPrice.commodityId,
        regionId: rawPrice.regionId,
        coopId: context.coopId,
        date: rawPrice.date,
        price: rawPrice.price,
        priceUsd: verificationData.priceUsd || rawPrice.price,
        currency: rawPrice.currency,
        volume: rawPrice.volume,
        qualityScore: verificationData.qualityScore || "1.0",
        verificationMethod: verificationData.verificationMethod || "automatic",
        outlierFlag: verificationData.outlierFlag || false,
        adjustments: verificationData.adjustments,
        verifiedBy: verificationData.verifiedBy,
        ...verificationData
      };

      // Step 3: Upsert verified row (idempotent)
      const [verifiedPrice] = await tx.insert(pricesVerified)
        .values(pricesVerifiedData)
        .onConflictDoUpdate({
          target: [pricesVerified.commodityId, pricesVerified.regionId, pricesVerified.date],
          set: {
            price: pricesVerifiedData.price,
            priceUsd: pricesVerifiedData.priceUsd,
            currency: pricesVerifiedData.currency,
            volume: pricesVerifiedData.volume,
            qualityScore: pricesVerifiedData.qualityScore,
            verificationMethod: pricesVerifiedData.verificationMethod,
            outlierFlag: pricesVerifiedData.outlierFlag,
            adjustments: pricesVerifiedData.adjustments,
            verifiedBy: pricesVerifiedData.verifiedBy,
          }
        })
        .returning();

      // Step 4: Only mark raw as processed if verified row upsert succeeds
      await tx.update(pricesRaw)
        .set({ isProcessed: true })
        .where(eq(pricesRaw.id, pricesRawId));

        return verifiedPrice;
      });
    });
  }
  
  // NEW: Dual-LLM verification methods for internet aggregation
  async promoteRawToVerifiedWithLlmScores(context: CooperativeContext, pricesRawId: string, llmVerificationData: { openaiScore: number; geminiScore: number; consensusScore: number; agreementLevel: string; verificationEvidence?: any }): Promise<PricesVerified> {
    return await withRLS(context, async (rlsDb) => {
      return await rlsDb.transaction(async (tx) => {
        // Step 1: Validate LLM verification data first
        const validation = this.validateLlmVerificationData(llmVerificationData);
        if (!validation.isValid) {
          throw new Error(`Invalid LLM verification data: ${validation.errors.join(', ')}`);
        }
        
        // Step 2: Read raw price data
        const [rawPrice] = await tx.select().from(pricesRaw).where(eq(pricesRaw.id, pricesRawId));
        if (!rawPrice) {
          throw new Error(`PricesRaw with id ${pricesRawId} not found`);
        }
        
        // Step 3: Validate provenance for internet sources
        if (rawPrice.sourceType === 'internet') {
          const provenanceValidation = this.validateProvenanceFields(rawPrice);
          if (!provenanceValidation.isValid) {
            throw new Error(`Internet source missing provenance: ${provenanceValidation.errors.join(', ')}`);
          }
        }
        
        // Step 4: Create verified record with LLM scores
        const pricesVerifiedData: InsertPricesVerified = {
          pricesRawId: rawPrice.id,
          sourceId: rawPrice.sourceId,
          commodityId: rawPrice.commodityId,
          regionId: rawPrice.regionId,
          coopId: context.coopId,
          date: rawPrice.date,
          price: rawPrice.price,
          priceUsd: rawPrice.price, // Simplified - could use FX rates
          currency: rawPrice.currency,
          volume: rawPrice.volume,
          qualityScore: llmVerificationData.consensusScore.toString(),
          verificationMethod: 'dual_llm',
          
          // CRITICAL: Dual-LLM verification fields
          openaiScore: llmVerificationData.openaiScore.toString(),
          geminiScore: llmVerificationData.geminiScore.toString(),
          consensusScore: llmVerificationData.consensusScore.toString(),
          agreementLevel: llmVerificationData.agreementLevel,
          verificationEvidence: llmVerificationData.verificationEvidence || {
            methodology: 'dual_llm_consensus',
            verifiedAt: new Date().toISOString(),
            provenanceComplete: rawPrice.sourceType === 'internet'
          }
        };
        
        // Step 5: Insert verified record
        const [verifiedPrice] = await tx.insert(pricesVerified)
          .values(pricesVerifiedData)
          .onConflictDoUpdate({
            target: [pricesVerified.pricesRawId], // Use pricesRawId as unique identifier
            set: {
              price: pricesVerifiedData.price,
              priceUsd: pricesVerifiedData.priceUsd,
              qualityScore: pricesVerifiedData.qualityScore,
              verificationMethod: pricesVerifiedData.verificationMethod,
              openaiScore: pricesVerifiedData.openaiScore,
              geminiScore: pricesVerifiedData.geminiScore,
              consensusScore: pricesVerifiedData.consensusScore,
              agreementLevel: pricesVerifiedData.agreementLevel,
              verificationEvidence: pricesVerifiedData.verificationEvidence
            }
          })
          .returning();
          
        // Step 6: Mark raw as processed
        await tx.update(pricesRaw)
          .set({ isProcessed: true })
          .where(eq(pricesRaw.id, pricesRawId));
          
        return verifiedPrice;
      });
    });
  }
  
  async getPricesVerifiedByConsensusScore(context: CooperativeContext, minScore: number, limit: number = 100): Promise<PricesVerified[]> {
    return await withRLS(context, async (rlsDb) => {
      return await rlsDb.select().from(pricesVerified)
        .where(gte(pricesVerified.consensusScore, sql`${minScore}`))
        .orderBy(desc(pricesVerified.consensusScore), desc(pricesVerified.verifiedAt))
        .limit(limit);
    });
  }
  
  validateLlmVerificationData(llmData: any): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    // Validate required fields
    if (typeof llmData.openaiScore !== 'number' || llmData.openaiScore < 0 || llmData.openaiScore > 1) {
      errors.push('openaiScore must be a number between 0 and 1');
    }
    
    if (typeof llmData.geminiScore !== 'number' || llmData.geminiScore < 0 || llmData.geminiScore > 1) {
      errors.push('geminiScore must be a number between 0 and 1');
    }
    
    if (typeof llmData.consensusScore !== 'number' || llmData.consensusScore < 0 || llmData.consensusScore > 1) {
      errors.push('consensusScore must be a number between 0 and 1');
    }
    
    // Enforce verified-only policy: consensusScore must be >= 0.7
    if (llmData.consensusScore < 0.7) {
      errors.push('consensusScore must be >= 0.7 for verified-only policy compliance');
    }
    
    const validAgreementLevels = ['high', 'medium', 'low', 'conflict'];
    if (!llmData.agreementLevel || !validAgreementLevels.includes(llmData.agreementLevel)) {
      errors.push(`agreementLevel must be one of: ${validAgreementLevels.join(', ')}`);
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // FX Rates
  async getFxRate(context: CooperativeContext, baseCurrency: string, targetCurrency: string, date: Date): Promise<FxRate | undefined> {
    // Validate date parameter to prevent undefined toISOString errors
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
      console.warn(`Invalid date parameter in getFxRate: ${date}. Using current date as fallback.`);
      date = new Date();
    }
    
    return await withRLS(context, async (rlsDb) => {
      const [rate] = await rlsDb.select().from(fxRates)
        .where(and(
          eq(fxRates.baseCurrency, baseCurrency),
          eq(fxRates.targetCurrency, targetCurrency),
          eq(fxRates.date, date)
        ));
      return rate || undefined;
    });
  }

  async getFxRatesByDateRange(context: CooperativeContext, baseCurrency: string, targetCurrency: string, startDate: Date, endDate: Date): Promise<FxRate[]> {
    // Validate date parameters to prevent undefined toISOString errors
    if (!startDate || !(startDate instanceof Date) || isNaN(startDate.getTime())) {
      console.warn(`Invalid startDate parameter in getFxRatesByDateRange: ${startDate}. Using 30 days ago as fallback.`);
      startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    }
    
    if (!endDate || !(endDate instanceof Date) || isNaN(endDate.getTime())) {
      console.warn(`Invalid endDate parameter in getFxRatesByDateRange: ${endDate}. Using current date as fallback.`);
      endDate = new Date();
    }
    
    return await withRLS(context, async (rlsDb) => {
      return await rlsDb.select().from(fxRates)
        .where(and(
          eq(fxRates.baseCurrency, baseCurrency),
          eq(fxRates.targetCurrency, targetCurrency),
          gte(fxRates.date, startDate),
          lte(fxRates.date, endDate)
        ))
        .orderBy(desc(fxRates.date));
    });
  }

  async getLatestFxRate(context: CooperativeContext, baseCurrency: string, targetCurrency: string): Promise<FxRate | undefined> {
    return await withRLS(context, async (rlsDb) => {
      const [rate] = await rlsDb.select().from(fxRates)
        .where(and(
          eq(fxRates.baseCurrency, baseCurrency),
          eq(fxRates.targetCurrency, targetCurrency),
          eq(fxRates.isActive, true)
        ))
        .orderBy(desc(fxRates.date))
        .limit(1);
      return rate || undefined;
    });
  }

  async createFxRate(context: CooperativeContext, fxRate: InsertFxRate): Promise<FxRate> {
    return await withRLS(context, async (rlsDb) => {
      // Ensure coop_id is set from context
      const dataWithCoop = { ...fxRate, coopId: context.coopId };
      const [created] = await rlsDb.insert(fxRates).values(dataWithCoop).returning();
      return created;
    });
  }

  async bulkInsertFxRates(context: CooperativeContext, fxRatesData: InsertFxRate[]): Promise<FxRate[]> {
    if (fxRatesData.length === 0) return [];
    // Use bulk upsert for idempotency
    return await this.bulkUpsertFxRates(context, fxRatesData);
  }

  async bulkUpsertFxRates(context: CooperativeContext, fxRatesData: InsertFxRate[]): Promise<FxRate[]> {
    if (fxRatesData.length === 0) return [];
    return await withRLS(context, async (rlsDb) => {
      // Ensure coop_id is set from context for all items
      const dataWithCoop = fxRatesData.map(item => ({ ...item, coopId: context.coopId }));
      return await rlsDb.insert(fxRates)
        .values(dataWithCoop)
        .onConflictDoUpdate({
          target: [fxRates.baseCurrency, fxRates.targetCurrency, fxRates.date, fxRates.sourceId],
          set: {
            rate: sql.raw(`excluded.rate`),
            isActive: sql.raw(`excluded.is_active`),
          }
        })
        .returning();
    });
  }

  async upsertFxRate(context: CooperativeContext, fxRate: InsertFxRate): Promise<FxRate> {
    return await withRLS(context, async (rlsDb) => {
      // Ensure coop_id is set from context
      const dataWithCoop = { ...fxRate, coopId: context.coopId };
      const [upserted] = await rlsDb.insert(fxRates)
        .values(dataWithCoop)
        .onConflictDoUpdate({
          target: [fxRates.baseCurrency, fxRates.targetCurrency, fxRates.date, fxRates.sourceId],
          set: {
            rate: dataWithCoop.rate,
            isActive: dataWithCoop.isActive,
          }
        })
        .returning();
      return upserted;
    });
  }

  // Forecast Runs
  async getForecastRun(context: CooperativeContext, id: string): Promise<ForecastRun | undefined> {
    return await withRLS(context, async (rlsDb) => {
      const [run] = await rlsDb.select().from(forecastRuns).where(eq(forecastRuns.id, id));
      return run || undefined;
    });
  }

  async getForecastRuns(context: CooperativeContext, commodityId: string, regionId: string): Promise<ForecastRun[]> {
    return await withRLS(context, async (rlsDb) => {
      return await rlsDb.select().from(forecastRuns)
        .where(and(
          eq(forecastRuns.commodityId, commodityId),
          eq(forecastRuns.regionId, regionId)
        ))
        .orderBy(desc(forecastRuns.runDate));
    });
  }

  async getForecastRunsByStatus(context: CooperativeContext, status: string): Promise<ForecastRun[]> {
    return await withRLS(context, async (rlsDb) => {
      return await rlsDb.select().from(forecastRuns)
        .where(eq(forecastRuns.status, status))
        .orderBy(desc(forecastRuns.createdAt));
    });
  }

  async getForecastRunsInDateRange(context: CooperativeContext, startDate: Date, endDate: Date): Promise<ForecastRun[]> {
    return await withRLS(context, async (rlsDb) => {
      // Validate date parameters to prevent undefined toISOString errors
      if (!startDate || !(startDate instanceof Date) || isNaN(startDate.getTime())) {
        console.warn(`Invalid startDate parameter in getForecastRunsInDateRange: ${startDate}. Using 30 days ago as fallback.`);
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      }
      
      if (!endDate || !(endDate instanceof Date) || isNaN(endDate.getTime())) {
        console.warn(`Invalid endDate parameter in getForecastRunsInDateRange: ${endDate}. Using current date as fallback.`);
        endDate = new Date();
      }
      
      return await rlsDb.select().from(forecastRuns)
        .where(and(
          gte(forecastRuns.runDate, startDate),
          lte(forecastRuns.runDate, endDate)
        ))
        .orderBy(desc(forecastRuns.runDate));
    });
  }

  async getLatestForecastRun(context: CooperativeContext, commodityId: string, regionId: string): Promise<ForecastRun | undefined> {
    return await withRLS(context, async (rlsDb) => {
      const [run] = await rlsDb.select().from(forecastRuns)
        .where(and(
          eq(forecastRuns.commodityId, commodityId),
          eq(forecastRuns.regionId, regionId)
        ))
        .orderBy(desc(forecastRuns.runDate))
        .limit(1);
      return run || undefined;
    });
  }

  async createForecastRun(context: CooperativeContext, forecastRun: InsertForecastRun): Promise<ForecastRun> {
    return await withRLS(context, async (rlsDb) => {
      // Ensure coop_id is set from context
      const dataWithCoop = { ...forecastRun, coopId: context.coopId };
      const [created] = await rlsDb.insert(forecastRuns).values(dataWithCoop).returning();
      return created;
    });
  }

  async updateForecastRun(context: CooperativeContext, id: string, updates: Partial<InsertForecastRun>): Promise<ForecastRun> {
    return await withRLS(context, async (rlsDb) => {
      const [updated] = await rlsDb.update(forecastRuns)
        .set(updates)
        .where(eq(forecastRuns.id, id))
        .returning();
      return updated;
    });
  }

  async completeForecastRun(context: CooperativeContext, id: string, metrics?: any): Promise<void> {
    await withRLS(context, async (rlsDb) => {
      await rlsDb.update(forecastRuns)
        .set({ 
          status: "completed",
          completedAt: new Date(),
          metrics: metrics
        })
        .where(eq(forecastRuns.id, id));
    });
  }

  async failForecastRun(context: CooperativeContext, id: string, errorMessage: string): Promise<void> {
    await withRLS(context, async (rlsDb) => {
      await rlsDb.update(forecastRuns)
        .set({ 
          status: "failed",
          completedAt: new Date(),
          errorMessage
        })
        .where(eq(forecastRuns.id, id));
    });
  }

  // Forecasts 30d
  async getForecast30d(context: CooperativeContext, id: string): Promise<Forecast30d | undefined> {
    return await withRLS(context, async (rlsDb) => {
      const [forecast] = await rlsDb.select().from(forecasts30d).where(eq(forecasts30d.id, id));
      return forecast || undefined;
    });
  }

  async getForecastsByRun(context: CooperativeContext, forecastRunId: string): Promise<Forecast30d[]> {
    return await withRLS(context, async (rlsDb) => {
      return await rlsDb.select().from(forecasts30d)
        .where(eq(forecasts30d.forecastRunId, forecastRunId))
        .orderBy(forecasts30d.targetDate);
    });
  }

  async getForecastsByTargetDate(context: CooperativeContext, commodityId: string, regionId: string, targetDate: Date): Promise<Forecast30d[]> {
    return await withRLS(context, async (rlsDb) => {
      return await rlsDb.select().from(forecasts30d)
        .where(and(
          eq(forecasts30d.commodityId, commodityId),
          eq(forecasts30d.regionId, regionId),
          eq(forecasts30d.targetDate, targetDate)
        ))
        .orderBy(desc(forecasts30d.forecastDate));
    });
  }

  async getActiveForecast30d(context: CooperativeContext, commodityId: string, regionId: string): Promise<Forecast30d[]> {
    return await withRLS(context, async (rlsDb) => {
      return await rlsDb.select().from(forecasts30d)
        .where(and(
          eq(forecasts30d.commodityId, commodityId),
          eq(forecasts30d.regionId, regionId),
          eq(forecasts30d.isActive, true)
        ))
        .orderBy(forecasts30d.targetDate);
    });
  }

  async createForecast30d(context: CooperativeContext, forecast: InsertForecast30d): Promise<Forecast30d> {
    return await withRLS(context, async (rlsDb) => {
      // Ensure coop_id is set from context
      const dataWithCoop = { ...forecast, coopId: context.coopId };
      const [created] = await rlsDb.insert(forecasts30d).values(dataWithCoop).returning();
      return created;
    });
  }

  async upsertForecast30d(context: CooperativeContext, forecast: InsertForecast30d): Promise<Forecast30d> {
    return await withRLS(context, async (rlsDb) => {
      // Ensure coop_id is set from context
      const dataWithCoop = { ...forecast, coopId: context.coopId };
      const [upserted] = await rlsDb.insert(forecasts30d)
        .values(dataWithCoop)
        .onConflictDoUpdate({
          target: [forecasts30d.forecastRunId, forecasts30d.targetDate],
          set: {
            commodityId: dataWithCoop.commodityId,
            regionId: dataWithCoop.regionId,
            forecastDate: dataWithCoop.forecastDate,
            daysAhead: dataWithCoop.daysAhead,
            median: dataWithCoop.median,
            q10: dataWithCoop.q10,
            q25: dataWithCoop.q25,
            q75: dataWithCoop.q75,
            q90: dataWithCoop.q90,
            confidence: dataWithCoop.confidence,
            trend: dataWithCoop.trend,
            volatility: dataWithCoop.volatility,
            isActive: dataWithCoop.isActive,
          }
        })
        .returning();
      return upserted;
    });
  }

  async bulkInsertForecasts30d(context: CooperativeContext, forecastsData: InsertForecast30d[]): Promise<Forecast30d[]> {
    if (forecastsData.length === 0) return [];
    // Use bulk upsert for idempotency
    return await this.bulkUpsertForecasts30d(context, forecastsData);
  }

  async bulkUpsertForecasts30d(context: CooperativeContext, forecastsData: InsertForecast30d[]): Promise<Forecast30d[]> {
    if (forecastsData.length === 0) return [];
    return await withRLS(context, async (rlsDb) => {
      // Ensure coop_id is set from context for all items
      const dataWithCoop = forecastsData.map(item => ({ ...item, coopId: context.coopId }));
      return await rlsDb.insert(forecasts30d)
        .values(dataWithCoop)
        .onConflictDoUpdate({
          target: [forecasts30d.forecastRunId, forecasts30d.targetDate],
          set: {
            commodityId: sql.raw(`excluded.commodity_id`),
            regionId: sql.raw(`excluded.region_id`),
            forecastDate: sql.raw(`excluded.forecast_date`),
            daysAhead: sql.raw(`excluded.days_ahead`),
            median: sql.raw(`excluded.median`),
            q10: sql.raw(`excluded.q10`),
            q25: sql.raw(`excluded.q25`),
            q75: sql.raw(`excluded.q75`),
            q90: sql.raw(`excluded.q90`),
            confidence: sql.raw(`excluded.confidence`),
            trend: sql.raw(`excluded.trend`),
            volatility: sql.raw(`excluded.volatility`),
            isActive: sql.raw(`excluded.is_active`),
          }
        })
        .returning();
    });
  }

  async deactivateOldForecasts30d(context: CooperativeContext, commodityId: string, regionId: string): Promise<void> {
    await withRLS(context, async (rlsDb) => {
      await rlsDb.update(forecasts30d)
        .set({ isActive: false })
        .where(and(
          eq(forecasts30d.commodityId, commodityId),
          eq(forecasts30d.regionId, regionId),
          eq(forecasts30d.isActive, true)
        ));
    });
  }

  // Evidence
  async getEvidence(context: CooperativeContext, id: string): Promise<Evidence | undefined> {
    return await withRLS(context, async (rlsDb) => {
      const [evidenceItem] = await rlsDb.select().from(evidence).where(eq(evidence.id, id));
      return evidenceItem || undefined;
    });
  }

  async getEvidenceByForecast30d(context: CooperativeContext, forecast30dId: string): Promise<Evidence[]> {
    return await withRLS(context, async (rlsDb) => {
      return await rlsDb.select().from(evidence)
        .where(eq(evidence.forecastId, forecast30dId))
        .orderBy(desc(evidence.confidence));
    });
  }

  async getEvidenceByForecast(context: CooperativeContext, forecastId: string): Promise<Evidence[]> {
    return await withRLS(context, async (rlsDb) => {
      return await rlsDb.select().from(evidence)
        .where(eq(evidence.forecastId, forecastId))
        .orderBy(desc(evidence.confidence));
    });
  }

  async getEvidenceByConfidence(context: CooperativeContext, minConfidence: number): Promise<Evidence[]> {
    return await withRLS(context, async (rlsDb) => {
      return await rlsDb.select().from(evidence)
        .where(gte(evidence.confidence, minConfidence.toString()))
        .orderBy(desc(evidence.confidence));
    });
  }

  async getEvidenceByType(context: CooperativeContext, type: string, commodityId?: string, regionId?: string): Promise<Evidence[]> {
    return await withRLS(context, async (rlsDb) => {
      let whereConditions = [eq(evidence.type, type)];
      
      if (commodityId) {
        whereConditions.push(eq(evidence.commodityId, commodityId));
      }
      if (regionId) {
        whereConditions.push(eq(evidence.regionId, regionId));
      }

      return await rlsDb.select().from(evidence)
        .where(and(...whereConditions))
        .orderBy(desc(evidence.publishedAt));
    });
  }

  async getActiveEvidence(context: CooperativeContext): Promise<Evidence[]> {
    return await withRLS(context, async (rlsDb) => {
      return await rlsDb.select().from(evidence)
        .where(eq(evidence.isActive, true))
        .orderBy(desc(evidence.publishedAt));
    });
  }

  async createEvidence(context: CooperativeContext, evidenceData: InsertEvidence): Promise<Evidence> {
    return await withRLS(context, async (rlsDb) => {
      // Ensure coop_id is set from context
      const dataWithCoop = { ...evidenceData, coopId: context.coopId };
      const [created] = await rlsDb.insert(evidence).values(dataWithCoop).returning();
      return created;
    });
  }

  async updateEvidence(context: CooperativeContext, id: string, updates: Partial<InsertEvidence>): Promise<Evidence> {
    return await withRLS(context, async (rlsDb) => {
      const [updated] = await rlsDb.update(evidence)
        .set(updates)
        .where(eq(evidence.id, id))
        .returning();
      return updated;
    });
  }

  // Roles
  async getRole(id: string): Promise<Role | undefined> {
    const [role] = await db.select().from(roles).where(eq(roles.id, id));
    return role || undefined;
  }

  async getRoleByName(name: string): Promise<Role | undefined> {
    const [role] = await db.select().from(roles).where(eq(roles.name, name));
    return role || undefined;
  }

  async getRoles(): Promise<Role[]> {
    return await db.select().from(roles).orderBy(desc(roles.createdAt));
  }

  async getActiveRoles(): Promise<Role[]> {
    return await db.select().from(roles)
      .where(eq(roles.isActive, true))
      .orderBy(desc(roles.createdAt));
  }

  async getRolesByPermissions(permissions: string[]): Promise<Role[]> {
    if (permissions.length === 0) return [];
    
    return await db.select().from(roles)
      .where(and(
        eq(roles.isActive, true),
        sql`${roles.permissions} ?& ${permissions}`
      ))
      .orderBy(desc(roles.createdAt));
  }

  async createRole(role: InsertRole): Promise<Role> {
    const [created] = await db.insert(roles).values(role).returning();
    return created;
  }

  async updateRole(id: string, updates: Partial<InsertRole>): Promise<Role> {
    const [updated] = await db.update(roles)
      .set(updates)
      .where(eq(roles.id, id))
      .returning();
    return updated;
  }

  // Quality Gates and CCS Implementation
  async getCcs(context: CooperativeContext, id: string): Promise<CompositeConfidenceScore | undefined> {
    return await withRLS(context, async (rlsDb) => {
      const [ccs] = await rlsDb.select().from(compositeConfidenceScores).where(eq(compositeConfidenceScores.id, id));
      return ccs || undefined;
    });
  }

  async getCcsByForecastRun(context: CooperativeContext, forecastRunId: string): Promise<CompositeConfidenceScore | undefined> {
    return await withRLS(context, async (rlsDb) => {
      const [ccs] = await rlsDb.select().from(compositeConfidenceScores)
        .where(eq(compositeConfidenceScores.forecastRunId, forecastRunId))
        .orderBy(desc(compositeConfidenceScores.createdAt));
      return ccs || undefined;
    });
  }

  async getCcsByForecast30d(context: CooperativeContext, forecast30dId: string): Promise<CompositeConfidenceScore | undefined> {
    return await withRLS(context, async (rlsDb) => {
      const [ccs] = await rlsDb.select().from(compositeConfidenceScores)
        .where(eq(compositeConfidenceScores.forecast30dId, forecast30dId))
        .orderBy(desc(compositeConfidenceScores.createdAt));
      return ccs || undefined;
    });
  }

  async getCcsByCommodityRegion(context: CooperativeContext, commodityId: string, regionId: string, limit: number = 10): Promise<CompositeConfidenceScore[]> {
    return await withRLS(context, async (rlsDb) => {
      return await rlsDb.select().from(compositeConfidenceScores)
        .where(and(
          eq(compositeConfidenceScores.commodityId, commodityId),
          eq(compositeConfidenceScores.regionId, regionId)
        ))
        .orderBy(desc(compositeConfidenceScores.createdAt))
        .limit(limit);
    });
  }

  async getCCSInDateRange(context: CooperativeContext, startDate: Date, endDate: Date): Promise<CompositeConfidenceScore[]> {
    return await withRLS(context, async (rlsDb) => {
      return await rlsDb.select().from(compositeConfidenceScores)
        .where(and(
          gte(compositeConfidenceScores.createdAt, startDate),
          lte(compositeConfidenceScores.createdAt, endDate)
        ))
        .orderBy(desc(compositeConfidenceScores.createdAt));
    });
  }

  async createCcs(context: CooperativeContext, ccs: InsertCompositeConfidenceScore): Promise<CompositeConfidenceScore> {
    return await withRLS(context, async (rlsDb) => {
      // Ensure coop_id is set from context
      const dataWithCoop = { ...ccs, coopId: context.coopId };
      const [created] = await rlsDb.insert(compositeConfidenceScores).values(dataWithCoop).returning();
      return created;
    });
  }

  async updateCcs(context: CooperativeContext, id: string, updates: Partial<InsertCompositeConfidenceScore>): Promise<CompositeConfidenceScore> {
    return await withRLS(context, async (rlsDb) => {
      const [updated] = await rlsDb.update(compositeConfidenceScores)
        .set(updates)
        .where(eq(compositeConfidenceScores.id, id))
        .returning();
      return updated;
    });
  }

  async getQualityGate(context: CooperativeContext, id: string): Promise<QualityGate | undefined> {
    return await withRLS(context, async (rlsDb) => {
      const [gate] = await rlsDb.select().from(qualityGates).where(eq(qualityGates.id, id));
      return gate || undefined;
    });
  }

  async getQualityGatesByCcs(context: CooperativeContext, ccsId: string): Promise<QualityGate[]> {
    return await withRLS(context, async (rlsDb) => {
      return await rlsDb.select().from(qualityGates)
        .where(eq(qualityGates.ccsId, ccsId))
        .orderBy(desc(qualityGates.createdAt));
    });
  }

  async getQualityGatesByForecastRun(context: CooperativeContext, forecastRunId: string): Promise<QualityGate[]> {
    return await withRLS(context, async (rlsDb) => {
      return await rlsDb.select().from(qualityGates)
        .where(eq(qualityGates.forecastRunId, forecastRunId))
        .orderBy(desc(qualityGates.createdAt));
    });
  }

  async getQualityGatesByStatus(context: CooperativeContext, gateStatus: string): Promise<QualityGate[]> {
    return await withRLS(context, async (rlsDb) => {
      return await rlsDb.select().from(qualityGates)
        .where(eq(qualityGates.gateStatus, gateStatus))
        .orderBy(desc(qualityGates.createdAt));
    });
  }

  async getQualityGatesInDateRange(context: CooperativeContext, startDate: Date, endDate: Date): Promise<QualityGate[]> {
    return await withRLS(context, async (rlsDb) => {
      return await rlsDb.select().from(qualityGates)
        .where(and(
          gte(qualityGates.createdAt, startDate),
          lte(qualityGates.createdAt, endDate)
        ))
        .orderBy(desc(qualityGates.createdAt));
    });
  }

  async getPendingQualityGates(context: CooperativeContext): Promise<QualityGate[]> {
    return await withRLS(context, async (rlsDb) => {
      return await rlsDb.select().from(qualityGates)
        .where(eq(qualityGates.gateStatus, 'hold_review'))
        .orderBy(desc(qualityGates.createdAt));
    });
  }

  async createQualityGate(context: CooperativeContext, qualityGate: InsertQualityGate): Promise<QualityGate> {
    return await withRLS(context, async (rlsDb) => {
      // Ensure coop_id is set from context
      const dataWithCoop = { ...qualityGate, coopId: context.coopId };
      const [created] = await rlsDb.insert(qualityGates).values(dataWithCoop).returning();
      return created;
    });
  }

  async updateQualityGate(context: CooperativeContext, id: string, updates: Partial<InsertQualityGate>): Promise<QualityGate> {
    return await withRLS(context, async (rlsDb) => {
      const [updated] = await rlsDb.update(qualityGates)
        .set(updates)
        .where(eq(qualityGates.id, id))
        .returning();
      return updated;
    });
  }

  async applyManualOverride(context: CooperativeContext, id: string, overrideReason: string, overrideBy: string): Promise<QualityGate> {
    return await withRLS(context, async (rlsDb) => {
      const [updated] = await rlsDb.update(qualityGates)
        .set({
          manualOverride: true,
          overrideReason,
          overrideBy,
          overrideAt: new Date(),
          publishDecision: 'manual_override'
        })
        .where(eq(qualityGates.id, id))
        .returning();
      return updated;
    });
  }

  async getAgreementAnalysis(context: CooperativeContext, id: string): Promise<AgreementAnalysis | undefined> {
    return await withRLS(context, async (rlsDb) => {
      const [analysis] = await rlsDb.select().from(agreementAnalysis).where(eq(agreementAnalysis.id, id));
      return analysis || undefined;
    });
  }

  async getAgreementAnalysisByCcs(context: CooperativeContext, ccsId: string): Promise<AgreementAnalysis | undefined> {
    return await withRLS(context, async (rlsDb) => {
      const [analysis] = await rlsDb.select().from(agreementAnalysis)
        .where(eq(agreementAnalysis.ccsId, ccsId))
        .orderBy(desc(agreementAnalysis.createdAt));
      return analysis || undefined;
    });
  }

  async createAgreementAnalysis(context: CooperativeContext, agreementAnalysisData: InsertAgreementAnalysis): Promise<AgreementAnalysis> {
    return await withRLS(context, async (rlsDb) => {
      // Ensure coop_id is set from context
      const dataWithCoop = { ...agreementAnalysisData, coopId: context.coopId };
      const [created] = await rlsDb.insert(agreementAnalysis).values(dataWithCoop).returning();
      return created;
    });
  }

  async updateAgreementAnalysis(context: CooperativeContext, id: string, updates: Partial<InsertAgreementAnalysis>): Promise<AgreementAnalysis> {
    return await withRLS(context, async (rlsDb) => {
      const [updated] = await rlsDb.update(agreementAnalysis)
        .set(updates)
        .where(eq(agreementAnalysis.id, id))
        .returning();
      return updated;
    });
  }
}

export const storage = new DatabaseStorage();
