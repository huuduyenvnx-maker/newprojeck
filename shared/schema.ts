import { sql } from "drizzle-orm";
import { pgTable, text, varchar, decimal, timestamp, jsonb, integer, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

// Cooperative tables for multi-tenant agricultural cooperatives
export const cooperatives = pgTable("cooperatives", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  active: boolean("active").notNull().default(true),
  metadata: jsonb("metadata"), // Contact info, address, tax details
  createdAt: timestamp("created_at").defaultNow(),
});

export const cooperativeMembers = pgTable("cooperative_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  coopId: varchar("coop_id").notNull().references(() => cooperatives.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull(), // Will reference Supabase auth.users.id
  role: text("role").notNull(), // "admin", "analyst", "farmer"
  active: boolean("active").notNull().default(true),
  joinedAt: timestamp("joined_at").defaultNow(),
  invitedBy: varchar("invited_by"), // user_id who sent invitation
}, (table) => ({
  coopUserIdx: index("idx_coop_members_coop_user").on(table.coopId, table.userId),
  userIdx: index("idx_coop_members_user").on(table.userId),
  roleIdx: index("idx_coop_members_role").on(table.role),
  uniqueCoopUser: uniqueIndex("unique_coop_members_coop_user").on(table.coopId, table.userId),
}));

export const profiles = pgTable("profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(), // Supabase auth.users.id
  defaultCoopId: varchar("default_coop_id").references(() => cooperatives.id, { onDelete: "set null" }),
  fullName: text("full_name"),
  phoneNumber: text("phone_number"),
  preferredLanguage: text("preferred_language").notNull().default("vi"), // "vi" or "en"
  timezone: text("timezone").notNull().default("Asia/Ho_Chi_Minh"),
  metadata: jsonb("metadata"), // Additional profile data
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  userIdx: index("idx_profiles_user").on(table.userId),
  defaultCoopIdx: index("idx_profiles_default_coop").on(table.defaultCoopId),
}));

export const exportAudit = pgTable("export_audit", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  coopId: varchar("coop_id").notNull().references(() => cooperatives.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull(), // Supabase auth.users.id
  exportType: text("export_type").notNull(), // "market-data", "forecasts", "price-history"
  summary: text("summary").notNull(), // Human-readable description
  recordCounts: jsonb("record_counts").notNull(), // {forecasts: 150, prices: 500}
  filters: jsonb("filters").notNull(), // Export filter criteria
  fileFormat: text("file_format").notNull(), // "csv", "xlsx"
  fileSize: integer("file_size"), // bytes
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  coopIdx: index("idx_export_audit_coop").on(table.coopId),
  userIdx: index("idx_export_audit_user").on(table.userId),
  typeIdx: index("idx_export_audit_type").on(table.exportType),
  createdAtIdx: index("idx_export_audit_created_at").on(table.createdAt),
}));

export const commodities = pgTable("commodities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(), // For mapping with config/sources.yaml
  category: text("category").notNull(), // "agricultural" or "fertilizer"
  unit: text("unit").notNull().default("USD/ton"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  categoryIdx: index("idx_commodities_category").on(table.category),
  slugIdx: index("idx_commodities_slug").on(table.slug),
}));

export const regions = pgTable("regions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  country: text("country").notNull().default("Vietnam"),
  timezone: text("timezone").notNull().default("Asia/Ho_Chi_Minh"),
});

export const priceData = pgTable("price_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  coopId: varchar("coop_id").notNull().references(() => cooperatives.id, { onDelete: "cascade" }),
  commodityId: varchar("commodity_id").notNull().references(() => commodities.id, { onDelete: "cascade" }),
  regionId: varchar("region_id").notNull().references(() => regions.id, { onDelete: "cascade" }),
  date: timestamp("date").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  source: text("source").notNull(),
  quality: decimal("quality_score", { precision: 3, scale: 2 }).notNull().default("1.0"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  coopIdx: index("idx_price_data_coop").on(table.coopId),
  coopCommodityRegionDateIdx: index("idx_price_data_coop_commodity_region_date").on(table.coopId, table.commodityId, table.regionId, table.date),
}));

export const forecasts = pgTable("forecasts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  coopId: varchar("coop_id").notNull().references(() => cooperatives.id, { onDelete: "cascade" }),
  commodityId: varchar("commodity_id").notNull().references(() => commodities.id, { onDelete: "cascade" }),
  regionId: varchar("region_id").notNull().references(() => regions.id, { onDelete: "cascade" }),
  forecastDate: timestamp("forecast_date").notNull(),
  horizon: integer("horizon").notNull().default(30), // days
  method: text("method").notNull().default("ensemble"),
  predictions: jsonb("predictions").notNull(), // Array of {date, median, q10, q90, confidence}
  metrics: jsonb("metrics").notNull(), // {mase, smape, picp, coverage}
  modelVersion: text("model_version").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  coopIdx: index("idx_forecasts_coop").on(table.coopId),
  coopCommodityRegionIdx: index("idx_forecasts_coop_commodity_region").on(table.coopId, table.commodityId, table.regionId),
}));

export const llmVerifications = pgTable("llm_verifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  coopId: varchar("coop_id").notNull().references(() => cooperatives.id, { onDelete: "cascade" }),
  forecastId: varchar("forecast_id").references(() => forecasts.id, { onDelete: "cascade" }),
  forecast30dId: varchar("forecast_30d_id").references(() => forecasts30d.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(), // "openai" or "gemini"
  model: text("model").notNull(),
  prompt: text("prompt").notNull(),
  response: text("response").notNull(),
  confidence: decimal("confidence", { precision: 3, scale: 2 }).notNull(),
  metadata: jsonb("metadata"), // {temperature, tokens, etc}
  verified: boolean("verified").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  coopIdx: index("idx_llm_verifications_coop").on(table.coopId),
  coopProviderIdx: index("idx_llm_verifications_coop_provider").on(table.coopId, table.provider),
}));

export const alerts = pgTable("alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  coopId: varchar("coop_id").notNull().references(() => cooperatives.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // "price_anomaly", "quality_warning", "model_update"
  commodityId: varchar("commodity_id").references(() => commodities.id, { onDelete: "set null" }),
  regionId: varchar("region_id").references(() => regions.id, { onDelete: "set null" }),
  severity: text("severity").notNull().default("medium"), // "low", "medium", "high"
  title: text("title").notNull(),
  message: text("message").notNull(),
  data: jsonb("data"),
  acknowledged: boolean("acknowledged").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  coopIdx: index("idx_alerts_coop").on(table.coopId),
  coopSeverityIdx: index("idx_alerts_coop_severity").on(table.coopId, table.severity),
}));

export const tradingRecommendations = pgTable("trading_recommendations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  coopId: varchar("coop_id").notNull().references(() => cooperatives.id, { onDelete: "cascade" }),
  forecastId: varchar("forecast_id").notNull().references(() => forecasts.id, { onDelete: "cascade" }),
  action: text("action").notNull(), // "buy", "sell", "hold", "monitor"
  confidence: decimal("confidence", { precision: 3, scale: 2 }).notNull(),
  entryPrice: decimal("entry_price", { precision: 10, scale: 2 }),
  targetPrice: decimal("target_price", { precision: 10, scale: 2 }),
  stopLoss: decimal("stop_loss", { precision: 10, scale: 2 }),
  riskLevel: text("risk_level").notNull(), // "low", "medium", "high"
  reasoning: text("reasoning").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  coopIdx: index("idx_trading_recommendations_coop").on(table.coopId),
  coopActionIdx: index("idx_trading_recommendations_coop_action").on(table.coopId, table.action),
}));

// P0 Core MVP Tables
export const sources = pgTable("sources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  coopId: varchar("coop_id").notNull().references(() => cooperatives.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull(), // "api", "manual", "scraper", "partner"
  url: text("url"),
  frequency: text("frequency").notNull().default("daily"), // "realtime", "hourly", "daily", "weekly"
  reliability: decimal("reliability", { precision: 3, scale: 2 }).notNull().default("1.0"),
  apiKeyRef: text("api_key"), // Reference to secrets manager instead of plaintext
  isActive: boolean("is_active").notNull().default(true),
  metadata: jsonb("metadata"), // {headers, auth, rate_limits, etc}
  lastSync: timestamp("last_sync"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  coopIdx: index("idx_sources_coop").on(table.coopId),
  coopNameIdx: index("idx_sources_coop_name").on(table.coopId, table.name),
  uniqueCoopName: uniqueIndex("unique_sources_coop_name").on(table.coopId, table.name),
}));

export const pricesRaw = pgTable("prices_raw", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  coopId: varchar("coop_id").notNull().references(() => cooperatives.id, { onDelete: "cascade" }),
  sourceId: varchar("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
  commodityId: varchar("commodity_id").notNull().references(() => commodities.id, { onDelete: "cascade" }),
  regionId: varchar("region_id").notNull().references(() => regions.id, { onDelete: "cascade" }),
  date: timestamp("date").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  volume: decimal("volume", { precision: 12, scale: 2 }),
  unit: text("unit").notNull(),
  rawData: jsonb("raw_data"), // Original data from source
  // Provenance tracking fields for Internet aggregation
  evidenceUrls: jsonb("evidence_urls"), // Array of source URLs with metadata
  sourceType: text("source_type").notNull().default("api"), // "api", "internet", "manual"
  pageHashes: jsonb("page_hashes"), // Content hashes for deduplication
  aggregationMetadata: jsonb("aggregation_metadata"), // LLM extraction details
  isProcessed: boolean("is_processed").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  coopIdx: index("idx_prices_raw_coop").on(table.coopId),
  coopCommodityRegionDateIdx: index("idx_prices_raw_coop_commodity_region_date").on(table.coopId, table.commodityId, table.regionId, table.date),
  sourceIdx: index("idx_prices_raw_source").on(table.sourceId),
  dateIdx: index("idx_prices_raw_date").on(table.date),
  uniqueRawPrice: uniqueIndex("unique_prices_raw_coop_source_commodity_region_date_unit").on(table.coopId, table.sourceId, table.commodityId, table.regionId, table.date, table.unit),
}));

export const pricesVerified = pgTable("prices_verified", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  coopId: varchar("coop_id").notNull().references(() => cooperatives.id, { onDelete: "cascade" }),
  pricesRawId: varchar("prices_raw_id").notNull().references(() => pricesRaw.id, { onDelete: "cascade" }),
  sourceId: varchar("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
  commodityId: varchar("commodity_id").notNull().references(() => commodities.id, { onDelete: "cascade" }),
  regionId: varchar("region_id").notNull().references(() => regions.id, { onDelete: "cascade" }),
  date: timestamp("date").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  priceUsd: decimal("price_usd", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull(),
  volume: decimal("volume", { precision: 12, scale: 2 }),
  qualityScore: decimal("quality_score", { precision: 3, scale: 2 }).notNull().default("1.0"),
  verificationMethod: text("verification_method").notNull(), // "automatic", "manual", "ai_verified", "dual_llm"
  // Dual-LLM verification scoring for Internet aggregation
  openaiScore: decimal("openai_score", { precision: 3, scale: 2 }), // OpenAI verification confidence
  geminiScore: decimal("gemini_score", { precision: 3, scale: 2 }), // Gemini verification confidence
  consensusScore: decimal("consensus_score", { precision: 3, scale: 2 }), // Combined consensus score
  agreementLevel: text("agreement_level"), // "high", "medium", "low", "conflict"
  verificationEvidence: jsonb("verification_evidence"), // {openai_response, gemini_response, reasoning}
  outlierFlag: boolean("outlier_flag").notNull().default(false),
  adjustments: jsonb("adjustments"), // {original_price, adjustments_made, reasons}
  verifiedBy: varchar("verified_by"), // user_id or system
  verifiedAt: timestamp("verified_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  coopIdx: index("idx_prices_verified_coop").on(table.coopId),
  coopCommodityRegionDateIdx: index("idx_prices_verified_coop_commodity_region_date").on(table.coopId, table.commodityId, table.regionId, table.date),
  sourceIdx: index("idx_prices_verified_source").on(table.sourceId),
  dateIdx: index("idx_prices_verified_date").on(table.date),
  qualityIdx: index("idx_prices_verified_quality").on(table.qualityScore),
  uniqueVerifiedPrice: uniqueIndex("unique_prices_verified_coop_commodity_region_date").on(table.coopId, table.commodityId, table.regionId, table.date),
}));

// NEW TABLES FOR ENHANCED PIPELINE

export const qualityQueue = pgTable("quality_queue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  coopId: varchar("coop_id").notNull().references(() => cooperatives.id, { onDelete: "cascade" }),
  pricesRawId: varchar("prices_raw_id").notNull().references(() => pricesRaw.id, { onDelete: "cascade" }),
  sourceId: varchar("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
  commodityId: varchar("commodity_id").notNull().references(() => commodities.id, { onDelete: "cascade" }),
  regionId: varchar("region_id").notNull().references(() => regions.id, { onDelete: "cascade" }),
  date: timestamp("date").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  priceUsd: decimal("price_usd", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull(),
  unit: text("unit").notNull(),
  
  // Validation pipeline status
  ingestionStatus: text("ingestion_status").notNull().default("pending"), // "pending", "processing", "failed"
  validationL1L7Status: text("validation_l1_l7_status").notNull().default("pending"), // "passed", "failed", "warning"
  llmVerificationStatus: text("llm_verification_status").notNull().default("pending"), // "pending", "processing", "completed", "failed"
  qualityGateStatus: text("quality_gate_status").notNull().default("pending"), // "passed", "failed", "manual_review"
  
  // Scores and flags
  qualityScore: decimal("quality_score", { precision: 3, scale: 2 }),
  ccsScore: decimal("ccs_score", { precision: 3, scale: 2 }),
  outlierFlag: boolean("outlier_flag").notNull().default(false),
  
  // Processing metadata
  failureReason: text("failure_reason"),
  processingAttempts: integer("processing_attempts").notNull().default(0),
  lastProcessedAt: timestamp("last_processed_at"),
  
  // HITL (Human in the Loop)
  hitlRequired: boolean("hitl_required").notNull().default(false),
  hitlReviewed: boolean("hitl_reviewed").notNull().default(false),
  hitlReviewedBy: varchar("hitl_reviewed_by"),
  hitlReviewedAt: timestamp("hitl_reviewed_at"),
  hitlDecision: text("hitl_decision"), // "approve", "reject", "modify"
  hitlNotes: text("hitl_notes"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  coopIdx: index("idx_quality_queue_coop").on(table.coopId),
  statusIdx: index("idx_quality_queue_status").on(table.qualityGateStatus),
  coopCommodityRegionDateIdx: index("idx_quality_queue_coop_commodity_region_date").on(table.coopId, table.commodityId, table.regionId, table.date),
  ccsScoreIdx: index("idx_quality_queue_ccs_score").on(table.ccsScore),
  hitlIdx: index("idx_quality_queue_hitl").on(table.hitlRequired, table.hitlReviewed),
  lastProcessedIdx: index("idx_quality_queue_last_processed").on(table.lastProcessedAt),
}));

export const validationLogs = pgTable("validation_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  coopId: varchar("coop_id").notNull().references(() => cooperatives.id, { onDelete: "cascade" }),
  qualityQueueId: varchar("quality_queue_id").notNull().references(() => qualityQueue.id, { onDelete: "cascade" }),
  validationLevel: text("validation_level").notNull(), // "L1", "L2", "L3", "L4", "L5", "L6", "L7"
  validationName: text("validation_name").notNull(), // "statistical_check", "domain_rules", "evt_analysis", etc.
  status: text("status").notNull(), // "passed", "failed", "warning"
  score: decimal("score", { precision: 3, scale: 2 }),
  details: jsonb("details"), // Detailed validation results
  errorMessage: text("error_message"),
  duration_ms: decimal("duration_ms", { precision: 8, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  coopIdx: index("idx_validation_logs_coop").on(table.coopId),
  queueIdx: index("idx_validation_logs_queue").on(table.qualityQueueId),
  levelStatusIdx: index("idx_validation_logs_level_status").on(table.validationLevel, table.status),
  createdAtIdx: index("idx_validation_logs_created_at").on(table.createdAt),
}));

export const evidenceLogs = pgTable("evidence_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  coopId: varchar("coop_id").notNull().references(() => cooperatives.id, { onDelete: "cascade" }),
  qualityQueueId: varchar("quality_queue_id").references(() => qualityQueue.id, { onDelete: "cascade" }),
  pricesVerifiedId: varchar("prices_verified_id").references(() => pricesVerified.id, { onDelete: "cascade" }),
  
  // LLM Provider information
  provider: text("provider").notNull(), // "openai", "gemini"
  model: text("model").notNull(),
  modelVersion: text("model_version").notNull(),
  promptVersion: text("prompt_version").notNull(),
  
  // Request details
  prompt: text("prompt").notNull(),
  temperature: decimal("temperature", { precision: 3, scale: 2 }).notNull(),
  topP: decimal("top_p", { precision: 3, scale: 2 }),
  maxTokens: integer("max_tokens"),
  seed: integer("seed"),
  
  // Response details
  rawResponse: text("raw_response").notNull(),
  structuredResponse: jsonb("structured_response"), // Parsed JSON response
  
  // Evidence extracted
  evidence: jsonb("evidence"), // {sources: [], citations: [], urls: []}
  flags: jsonb("flags"), // Anomaly flags raised by LLM
  assessment: text("assessment"), // LLM's overall assessment
  confidence: decimal("confidence", { precision: 3, scale: 2 }).notNull(),
  
  // Token usage and performance
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  totalTokens: integer("total_tokens"),
  duration_ms: decimal("duration_ms", { precision: 8, scale: 2 }),
  
  // Status and error handling
  status: text("status").notNull(), // "success", "failed", "timeout", "quota_exceeded"
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").notNull().default(0),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  coopIdx: index("idx_evidence_logs_coop").on(table.coopId),
  queueIdx: index("idx_evidence_logs_queue").on(table.qualityQueueId),
  verifiedIdx: index("idx_evidence_logs_verified").on(table.pricesVerifiedId),
  providerIdx: index("idx_evidence_logs_provider").on(table.provider),
  statusIdx: index("idx_evidence_logs_status").on(table.status),
  confidenceIdx: index("idx_evidence_logs_confidence").on(table.confidence),
  createdAtIdx: index("idx_evidence_logs_created_at").on(table.createdAt),
}));

export const compositeCcsLogs = pgTable("composite_ccs_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  coopId: varchar("coop_id").notNull().references(() => cooperatives.id, { onDelete: "cascade" }),
  qualityQueueId: varchar("quality_queue_id").notNull().references(() => qualityQueue.id, { onDelete: "cascade" }),
  
  // Component scores
  agreementScore: decimal("agreement_score", { precision: 3, scale: 2 }).notNull(),
  evidenceScore: decimal("evidence_score", { precision: 3, scale: 2 }).notNull(),
  sourceCredibilityScore: decimal("source_credibility_score", { precision: 3, scale: 2 }).notNull(),
  temporalConsistencyScore: decimal("temporal_consistency_score", { precision: 3, scale: 2 }).notNull(),
  modelConfidenceScore: decimal("model_confidence_score", { precision: 3, scale: 2 }).notNull(),
  
  // Weights used
  weights: jsonb("weights").notNull(), // {agreement: 0.3, evidence: 0.25, etc.}
  
  // Market adjustments
  commodityAdjustment: decimal("commodity_adjustment", { precision: 3, scale: 2 }).notNull().default("1.0"),
  seasonalAdjustment: decimal("seasonal_adjustment", { precision: 3, scale: 2 }).notNull().default("1.0"),
  regionalAdjustment: decimal("regional_adjustment", { precision: 3, scale: 2 }).notNull().default("1.0"),
  currencyVolatilityAdjustment: decimal("currency_volatility_adjustment", { precision: 3, scale: 2 }).notNull().default("1.0"),
  
  // Final score
  rawCompositeScore: decimal("raw_composite_score", { precision: 3, scale: 2 }).notNull(),
  adjustedCompositeScore: decimal("adjusted_composite_score", { precision: 3, scale: 2 }).notNull(),
  finalCcsScore: decimal("final_ccs_score", { precision: 3, scale: 2 }).notNull(),
  
  // Calculation metadata
  calculationVersion: text("calculation_version").notNull().default("1.0.0"),
  calculationDetails: jsonb("calculation_details"),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  coopIdx: index("idx_composite_ccs_logs_coop").on(table.coopId),
  queueIdx: index("idx_composite_ccs_logs_queue").on(table.qualityQueueId),
  finalScoreIdx: index("idx_composite_ccs_logs_final_score").on(table.finalCcsScore),
  createdAtIdx: index("idx_composite_ccs_logs_created_at").on(table.createdAt),
}));

export const fxRates = pgTable("fx_rates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  coopId: varchar("coop_id").notNull().references(() => cooperatives.id, { onDelete: "cascade" }),
  baseCurrency: text("base_currency").notNull(),
  targetCurrency: text("target_currency").notNull(),
  date: timestamp("date").notNull(),
  rate: decimal("rate", { precision: 12, scale: 6 }).notNull(),
  sourceId: varchar("source_id").references(() => sources.id, { onDelete: "set null" }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  coopIdx: index("idx_fx_rates_coop").on(table.coopId),
  coopCurrencyPairDateIdx: index("idx_fx_rates_coop_currency_pair_date").on(table.coopId, table.baseCurrency, table.targetCurrency, table.date),
  dateIdx: index("idx_fx_rates_date").on(table.date),
  uniqueFxRate: uniqueIndex("unique_fx_rates_coop_base_target_date_source").on(table.coopId, table.baseCurrency, table.targetCurrency, table.date, table.sourceId),
}));

export const forecastRuns = pgTable("forecast_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  coopId: varchar("coop_id").notNull().references(() => cooperatives.id, { onDelete: "cascade" }),
  commodityId: varchar("commodity_id").notNull().references(() => commodities.id, { onDelete: "cascade" }),
  regionId: varchar("region_id").notNull().references(() => regions.id, { onDelete: "cascade" }),
  runDate: timestamp("run_date").notNull(),
  horizon: integer("horizon").notNull().default(30), // days
  model: text("model").notNull(), // "ensemble", "arima", "lstm", "prophet"
  modelVersion: text("model_version").notNull(),
  parameters: jsonb("parameters"), // Model hyperparameters
  status: text("status").notNull().default("running"), // "running", "completed", "failed"
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  errorMessage: text("error_message"),
  metrics: jsonb("metrics"), // {mase, smape, mae, rmse}
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  coopIdx: index("idx_forecast_runs_coop").on(table.coopId),
  coopCommodityRegionRunDateIdx: index("idx_forecast_runs_coop_commodity_region_run_date").on(table.coopId, table.commodityId, table.regionId, table.runDate),
  statusIdx: index("idx_forecast_runs_status").on(table.status),
  runDateIdx: index("idx_forecast_runs_run_date").on(table.runDate),
}));

export const forecasts30d = pgTable("forecasts_30d", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  coopId: varchar("coop_id").notNull().references(() => cooperatives.id, { onDelete: "cascade" }),
  forecastRunId: varchar("forecast_run_id").notNull().references(() => forecastRuns.id, { onDelete: "cascade" }),
  commodityId: varchar("commodity_id").notNull().references(() => commodities.id, { onDelete: "cascade" }),
  regionId: varchar("region_id").notNull().references(() => regions.id, { onDelete: "cascade" }),
  forecastDate: timestamp("forecast_date").notNull(),
  targetDate: timestamp("target_date").notNull(),
  daysAhead: integer("days_ahead").notNull(),
  median: decimal("median", { precision: 10, scale: 2 }).notNull(),
  q10: decimal("q10", { precision: 10, scale: 2 }).notNull(),
  q25: decimal("q25", { precision: 10, scale: 2 }).notNull(),
  q75: decimal("q75", { precision: 10, scale: 2 }).notNull(),
  q90: decimal("q90", { precision: 10, scale: 2 }).notNull(),
  confidence: decimal("confidence", { precision: 3, scale: 2 }).notNull(),
  trend: text("trend").notNull(), // "up", "down", "stable"
  volatility: decimal("volatility", { precision: 5, scale: 4 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  coopIdx: index("idx_forecasts_30d_coop").on(table.coopId),
  coopCommodityRegionForecastDateIdx: index("idx_forecasts_30d_coop_commodity_region_forecast_date").on(table.coopId, table.commodityId, table.regionId, table.forecastDate),
  targetDateIdx: index("idx_forecasts_30d_target_date").on(table.targetDate),
  forecastRunIdx: index("idx_forecasts_30d_forecast_run").on(table.forecastRunId),
  daysAheadIdx: index("idx_forecasts_30d_days_ahead").on(table.daysAhead),
  uniqueForecast: uniqueIndex("unique_forecasts_30d_run_target_date").on(table.forecastRunId, table.targetDate),
}));

export const evidence = pgTable("evidence", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  coopId: varchar("coop_id").notNull().references(() => cooperatives.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // "news", "weather", "policy", "market_event", "expert_opinion"
  sourceId: varchar("source_id").references(() => sources.id, { onDelete: "set null" }),
  commodityId: varchar("commodity_id").references(() => commodities.id, { onDelete: "set null" }),
  regionId: varchar("region_id").references(() => regions.id, { onDelete: "set null" }),
  forecastId: varchar("forecast_id").references(() => forecasts30d.id, { onDelete: "cascade" }),
  verificationId: varchar("verification_id").references(() => llmVerifications.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description").notNull(),
  impact: text("impact").notNull(), // "bullish", "bearish", "neutral"
  confidence: decimal("confidence", { precision: 3, scale: 2 }).notNull(),
  relevanceScore: decimal("relevance_score", { precision: 3, scale: 2 }).notNull(),
  url: text("url"),
  publishedAt: timestamp("published_at"),
  validFrom: timestamp("valid_from"),
  validTo: timestamp("valid_to"),
  tags: jsonb("tags"), // ["weather", "drought", "policy"]
  rawContent: jsonb("raw_content"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  coopIdx: index("idx_evidence_coop").on(table.coopId),
  coopCommodityRegionIdx: index("idx_evidence_coop_commodity_region").on(table.coopId, table.commodityId, table.regionId),
  typeIdx: index("idx_evidence_type").on(table.type),
  publishedAtIdx: index("idx_evidence_published_at").on(table.publishedAt),
  confidenceIdx: index("idx_evidence_confidence").on(table.confidence),
}));

export const roles = pgTable("roles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  permissions: jsonb("permissions").notNull(), // ["read:prices", "write:forecasts", "admin:users"]
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// Quality Gates and CCS Tables
export const compositeConfidenceScores = pgTable("composite_confidence_scores", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  coopId: varchar("coop_id").notNull().references(() => cooperatives.id, { onDelete: "cascade" }),
  forecastRunId: varchar("forecast_run_id").notNull().references(() => forecastRuns.id, { onDelete: "cascade" }),
  forecast30dId: varchar("forecast_30d_id").references(() => forecasts30d.id, { onDelete: "cascade" }),
  commodityId: varchar("commodity_id").notNull().references(() => commodities.id, { onDelete: "cascade" }),
  regionId: varchar("region_id").notNull().references(() => regions.id, { onDelete: "cascade" }),
  
  // Overall CCS and breakdown
  compositeScore: decimal("composite_score", { precision: 5, scale: 2 }).notNull(), // 0-100
  
  // Component scores (0-100 each)
  agreementScore: decimal("agreement_score", { precision: 5, scale: 2 }).notNull(),
  evidenceScore: decimal("evidence_score", { precision: 5, scale: 2 }).notNull(),
  sourceCredibilityScore: decimal("source_credibility_score", { precision: 5, scale: 2 }).notNull(),
  temporalConsistencyScore: decimal("temporal_consistency_score", { precision: 5, scale: 2 }).notNull(),
  modelConfidenceScore: decimal("model_confidence_score", { precision: 5, scale: 2 }).notNull(),
  
  // Component weights used
  weights: jsonb("weights").notNull(), // {agreement: 0.3, evidence: 0.25, source: 0.2, temporal: 0.15, model: 0.1}
  
  // Vietnamese market adjustments
  commodityAdjustment: decimal("commodity_adjustment", { precision: 4, scale: 3 }).notNull().default("1.0"),
  seasonalAdjustment: decimal("seasonal_adjustment", { precision: 4, scale: 3 }).notNull().default("1.0"),
  regionalAdjustment: decimal("regional_adjustment", { precision: 4, scale: 3 }).notNull().default("1.0"),
  currencyVolatilityAdjustment: decimal("currency_volatility_adjustment", { precision: 4, scale: 3 }).notNull().default("1.0"),
  
  // Detailed calculation metadata
  calculationDetails: jsonb("calculation_details").notNull(), // Detailed breakdown for audit
  version: text("version").notNull().default("1.0"), // CCS calculation version
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  coopIdx: index("idx_ccs_coop").on(table.coopId),
  coopForecastRunIdx: index("idx_ccs_coop_forecast_run").on(table.coopId, table.forecastRunId),
  forecast30dIdx: index("idx_ccs_forecast_30d").on(table.forecast30dId),
  commodityRegionIdx: index("idx_ccs_commodity_region").on(table.commodityId, table.regionId),
  compositeScoreIdx: index("idx_ccs_composite_score").on(table.compositeScore),
  createdAtIdx: index("idx_ccs_created_at").on(table.createdAt),
}));

export const qualityGates = pgTable("quality_gates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  coopId: varchar("coop_id").notNull().references(() => cooperatives.id, { onDelete: "cascade" }),
  ccsId: varchar("ccs_id").notNull().references(() => compositeConfidenceScores.id, { onDelete: "cascade" }),
  forecastRunId: varchar("forecast_run_id").notNull().references(() => forecastRuns.id, { onDelete: "cascade" }),
  
  // Gate decision
  gateStatus: text("gate_status").notNull(), // "auto_publish", "publish_warning", "publish_caution", "hold_review"
  confidenceLevel: text("confidence_level").notNull(), // "high", "medium", "low", "below_threshold"
  threshold: decimal("threshold", { precision: 5, scale: 2 }).notNull(), // Threshold applied
  
  // Publishing decision
  publishDecision: text("publish_decision").notNull(), // "published", "held", "manual_override"
  publishedAt: timestamp("published_at"),
  
  // Manual overrides
  manualOverride: boolean("manual_override").notNull().default(false),
  overrideReason: text("override_reason"),
  overrideBy: varchar("override_by"), // user_id
  overrideAt: timestamp("override_at"),
  
  // UI indicators
  uiIndicator: text("ui_indicator").notNull(), // "green", "yellow", "red", "blocked"
  warningMessage: text("warning_message"),
  
  // Quality metrics
  qualityMetrics: jsonb("quality_metrics").notNull(), // Additional quality data for reporting
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  coopIdx: index("idx_quality_gates_coop").on(table.coopId),
  coopCcsIdx: index("idx_quality_gates_coop_ccs").on(table.coopId, table.ccsId),
  forecastRunIdx: index("idx_quality_gates_forecast_run").on(table.forecastRunId),
  gateStatusIdx: index("idx_quality_gates_status").on(table.gateStatus),
  confidenceLevelIdx: index("idx_quality_gates_confidence").on(table.confidenceLevel),
  publishDecisionIdx: index("idx_quality_gates_publish_decision").on(table.publishDecision),
  manualOverrideIdx: index("idx_quality_gates_manual_override").on(table.manualOverride),
  createdAtIdx: index("idx_quality_gates_created_at").on(table.createdAt),
}));

export const agreementAnalysis = pgTable("agreement_analysis", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  coopId: varchar("coop_id").notNull().references(() => cooperatives.id, { onDelete: "cascade" }),
  ccsId: varchar("ccs_id").notNull().references(() => compositeConfidenceScores.id, { onDelete: "cascade" }),
  
  // LLM responses comparison
  openaiVerificationId: varchar("openai_verification_id").references(() => llmVerifications.id, { onDelete: "set null" }),
  geminiVerificationId: varchar("gemini_verification_id").references(() => llmVerifications.id, { onDelete: "set null" }),
  
  // Agreement metrics
  semanticSimilarity: decimal("semantic_similarity", { precision: 5, scale: 4 }).notNull(), // 0-1
  priceVariance: decimal("price_variance", { precision: 5, scale: 4 }).notNull(), // 0-1 (0 = identical)
  trendAlignment: decimal("trend_alignment", { precision: 5, scale: 4 }).notNull(), // 0-1
  confidenceOverlap: decimal("confidence_overlap", { precision: 5, scale: 4 }).notNull(), // 0-1
  
  // Analysis details
  analysisMethod: text("analysis_method").notNull().default("embedding_cosine"),
  embeddingModel: text("embedding_model").notNull().default("text-embedding-3-small"),
  analysisDetails: jsonb("analysis_details").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  coopIdx: index("idx_agreement_analysis_coop").on(table.coopId),
  coopCcsIdx: index("idx_agreement_analysis_coop_ccs").on(table.coopId, table.ccsId),
  openaiVerificationIdx: index("idx_agreement_analysis_openai").on(table.openaiVerificationId),
  geminiVerificationIdx: index("idx_agreement_analysis_gemini").on(table.geminiVerificationId),
  semanticSimilarityIdx: index("idx_agreement_analysis_semantic").on(table.semanticSimilarity),
}));

// Relations
export const cooperativesRelations = relations(cooperatives, ({ many }) => ({
  members: many(cooperativeMembers),
  profiles: many(profiles),
  priceData: many(priceData),
  forecasts: many(forecasts),
  llmVerifications: many(llmVerifications),
  alerts: many(alerts),
  tradingRecommendations: many(tradingRecommendations),
  sources: many(sources),
  pricesRaw: many(pricesRaw),
  pricesVerified: many(pricesVerified),
  fxRates: many(fxRates),
  forecastRuns: many(forecastRuns),
  forecasts30d: many(forecasts30d),
  evidence: many(evidence),
  compositeConfidenceScores: many(compositeConfidenceScores),
  qualityGates: many(qualityGates),
  agreementAnalysis: many(agreementAnalysis),
  exportAudit: many(exportAudit),
}));

export const cooperativeMembersRelations = relations(cooperativeMembers, ({ one }) => ({
  cooperative: one(cooperatives, {
    fields: [cooperativeMembers.coopId],
    references: [cooperatives.id],
  }),
}));

export const profilesRelations = relations(profiles, ({ one }) => ({
  defaultCooperative: one(cooperatives, {
    fields: [profiles.defaultCoopId],
    references: [cooperatives.id],
  }),
}));

export const exportAuditRelations = relations(exportAudit, ({ one }) => ({
  cooperative: one(cooperatives, {
    fields: [exportAudit.coopId],
    references: [cooperatives.id],
  }),
}));

export const commoditiesRelations = relations(commodities, ({ many }) => ({
  priceData: many(priceData),
  forecasts: many(forecasts),
  alerts: many(alerts),
  pricesRaw: many(pricesRaw),
  pricesVerified: many(pricesVerified),
  forecastRuns: many(forecastRuns),
  forecasts30d: many(forecasts30d),
  evidence: many(evidence),
}));

export const regionsRelations = relations(regions, ({ many }) => ({
  priceData: many(priceData),
  forecasts: many(forecasts),
  alerts: many(alerts),
  pricesRaw: many(pricesRaw),
  pricesVerified: many(pricesVerified),
  forecastRuns: many(forecastRuns),
  forecasts30d: many(forecasts30d),
  evidence: many(evidence),
}));

export const priceDataRelations = relations(priceData, ({ one }) => ({
  cooperative: one(cooperatives, {
    fields: [priceData.coopId],
    references: [cooperatives.id],
  }),
  commodity: one(commodities, {
    fields: [priceData.commodityId],
    references: [commodities.id],
  }),
  region: one(regions, {
    fields: [priceData.regionId],
    references: [regions.id],
  }),
}));

export const forecastsRelations = relations(forecasts, ({ one, many }) => ({
  cooperative: one(cooperatives, {
    fields: [forecasts.coopId],
    references: [cooperatives.id],
  }),
  commodity: one(commodities, {
    fields: [forecasts.commodityId],
    references: [commodities.id],
  }),
  region: one(regions, {
    fields: [forecasts.regionId],
    references: [regions.id],
  }),
  verifications: many(llmVerifications),
  recommendations: many(tradingRecommendations),
}));

export const llmVerificationsRelations = relations(llmVerifications, ({ one }) => ({
  cooperative: one(cooperatives, {
    fields: [llmVerifications.coopId],
    references: [cooperatives.id],
  }),
  forecast: one(forecasts, {
    fields: [llmVerifications.forecastId],
    references: [forecasts.id],
  }),
  forecast30d: one(forecasts30d, {
    fields: [llmVerifications.forecast30dId],
    references: [forecasts30d.id],
  }),
}));

export const alertsRelations = relations(alerts, ({ one }) => ({
  commodity: one(commodities, {
    fields: [alerts.commodityId],
    references: [commodities.id],
  }),
  region: one(regions, {
    fields: [alerts.regionId],
    references: [regions.id],
  }),
}));

export const tradingRecommendationsRelations = relations(tradingRecommendations, ({ one }) => ({
  forecast: one(forecasts, {
    fields: [tradingRecommendations.forecastId],
    references: [forecasts.id],
  }),
}));

// P0 Core MVP Relations
export const sourcesRelations = relations(sources, ({ many }) => ({
  pricesRaw: many(pricesRaw),
  pricesVerified: many(pricesVerified),
  fxRates: many(fxRates),
  evidence: many(evidence),
}));

export const pricesRawRelations = relations(pricesRaw, ({ one }) => ({
  source: one(sources, {
    fields: [pricesRaw.sourceId],
    references: [sources.id],
  }),
  commodity: one(commodities, {
    fields: [pricesRaw.commodityId],
    references: [commodities.id],
  }),
  region: one(regions, {
    fields: [pricesRaw.regionId],
    references: [regions.id],
  }),
}));

export const pricesVerifiedRelations = relations(pricesVerified, ({ one }) => ({
  pricesRaw: one(pricesRaw, {
    fields: [pricesVerified.pricesRawId],
    references: [pricesRaw.id],
  }),
  source: one(sources, {
    fields: [pricesVerified.sourceId],
    references: [sources.id],
  }),
  commodity: one(commodities, {
    fields: [pricesVerified.commodityId],
    references: [commodities.id],
  }),
  region: one(regions, {
    fields: [pricesVerified.regionId],
    references: [regions.id],
  }),
}));

export const fxRatesRelations = relations(fxRates, ({ one }) => ({
  source: one(sources, {
    fields: [fxRates.sourceId],
    references: [sources.id],
  }),
}));

export const forecastRunsRelations = relations(forecastRuns, ({ one, many }) => ({
  commodity: one(commodities, {
    fields: [forecastRuns.commodityId],
    references: [commodities.id],
  }),
  region: one(regions, {
    fields: [forecastRuns.regionId],
    references: [regions.id],
  }),
  forecasts30d: many(forecasts30d),
}));

export const forecasts30dRelations = relations(forecasts30d, ({ one, many }) => ({
  forecastRun: one(forecastRuns, {
    fields: [forecasts30d.forecastRunId],
    references: [forecastRuns.id],
  }),
  commodity: one(commodities, {
    fields: [forecasts30d.commodityId],
    references: [commodities.id],
  }),
  region: one(regions, {
    fields: [forecasts30d.regionId],
    references: [regions.id],
  }),
  evidence: many(evidence),
}));

export const evidenceRelations = relations(evidence, ({ one }) => ({
  source: one(sources, {
    fields: [evidence.sourceId],
    references: [sources.id],
  }),
  commodity: one(commodities, {
    fields: [evidence.commodityId],
    references: [commodities.id],
  }),
  region: one(regions, {
    fields: [evidence.regionId],
    references: [regions.id],
  }),
  forecast: one(forecasts30d, {
    fields: [evidence.forecastId],
    references: [forecasts30d.id],
  }),
  verification: one(llmVerifications, {
    fields: [evidence.verificationId],
    references: [llmVerifications.id],
  }),
}));

// Quality Gates Relations
export const compositeConfidenceScoresRelations = relations(compositeConfidenceScores, ({ one, many }) => ({
  forecastRun: one(forecastRuns, {
    fields: [compositeConfidenceScores.forecastRunId],
    references: [forecastRuns.id],
  }),
  forecast30d: one(forecasts30d, {
    fields: [compositeConfidenceScores.forecast30dId],
    references: [forecasts30d.id],
  }),
  commodity: one(commodities, {
    fields: [compositeConfidenceScores.commodityId],
    references: [commodities.id],
  }),
  region: one(regions, {
    fields: [compositeConfidenceScores.regionId],
    references: [regions.id],
  }),
  qualityGates: many(qualityGates),
  agreementAnalysis: many(agreementAnalysis),
}));

export const qualityGatesRelations = relations(qualityGates, ({ one }) => ({
  ccs: one(compositeConfidenceScores, {
    fields: [qualityGates.ccsId],
    references: [compositeConfidenceScores.id],
  }),
  forecastRun: one(forecastRuns, {
    fields: [qualityGates.forecastRunId],
    references: [forecastRuns.id],
  }),
}));

export const agreementAnalysisRelations = relations(agreementAnalysis, ({ one }) => ({
  ccs: one(compositeConfidenceScores, {
    fields: [agreementAnalysis.ccsId],
    references: [compositeConfidenceScores.id],
  }),
  openaiVerification: one(llmVerifications, {
    fields: [agreementAnalysis.openaiVerificationId],
    references: [llmVerifications.id],
  }),
  geminiVerification: one(llmVerifications, {
    fields: [agreementAnalysis.geminiVerificationId],
    references: [llmVerifications.id],
  }),
}));

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export const insertCommoditySchema = createInsertSchema(commodities).omit({ id: true, createdAt: true });
export const insertRegionSchema = createInsertSchema(regions).omit({ id: true });

// Cooperative schemas
export const insertCooperativeSchema = createInsertSchema(cooperatives).omit({ id: true, createdAt: true });
export const insertCooperativeMemberSchema = createInsertSchema(cooperativeMembers).omit({ id: true, joinedAt: true });
export const insertProfileSchema = createInsertSchema(profiles).omit({ id: true, createdAt: true, updatedAt: true });
export const insertExportAuditSchema = createInsertSchema(exportAudit).omit({ id: true, createdAt: true });

export const insertPriceDataSchema = createInsertSchema(priceData).omit({ id: true, createdAt: true });
export const insertForecastSchema = createInsertSchema(forecasts).omit({ id: true, createdAt: true });
export const insertLlmVerificationSchema = createInsertSchema(llmVerifications).omit({ id: true, createdAt: true });
export const insertAlertSchema = createInsertSchema(alerts).omit({ id: true, createdAt: true });
export const insertTradingRecommendationSchema = createInsertSchema(tradingRecommendations).omit({ id: true, createdAt: true });

// P0 Core MVP Insert schemas
export const insertSourceSchema = createInsertSchema(sources).omit({ id: true, createdAt: true });
export const insertPricesRawSchema = createInsertSchema(pricesRaw).omit({ id: true, createdAt: true });
export const insertPricesVerifiedSchema = createInsertSchema(pricesVerified).omit({ id: true, createdAt: true, verifiedAt: true });
export const insertFxRateSchema = createInsertSchema(fxRates).omit({ id: true, createdAt: true });
export const insertForecastRunSchema = createInsertSchema(forecastRuns).omit({ id: true, createdAt: true, startedAt: true });
export const insertForecast30dSchema = createInsertSchema(forecasts30d).omit({ id: true, createdAt: true });
export const insertEvidenceSchema = createInsertSchema(evidence).omit({ id: true, createdAt: true });
export const insertRoleSchema = createInsertSchema(roles).omit({ id: true, createdAt: true });

// Quality Gates Insert schemas
export const insertCompositeConfidenceScoreSchema = createInsertSchema(compositeConfidenceScores).omit({ id: true, createdAt: true });
export const insertQualityGateSchema = createInsertSchema(qualityGates).omit({ id: true, createdAt: true });
export const insertAgreementAnalysisSchema = createInsertSchema(agreementAnalysis).omit({ id: true, createdAt: true });

// NEW PIPELINE SCHEMAS
export const insertQualityQueueSchema = createInsertSchema(qualityQueue).omit({ id: true, createdAt: true, updatedAt: true });
export const insertValidationLogSchema = createInsertSchema(validationLogs).omit({ id: true, createdAt: true });
export const insertEvidenceLogSchema = createInsertSchema(evidenceLogs).omit({ id: true, createdAt: true });
export const insertCompositeCcsLogSchema = createInsertSchema(compositeCcsLogs).omit({ id: true, createdAt: true });

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Commodity = typeof commodities.$inferSelect;
export type InsertCommodity = z.infer<typeof insertCommoditySchema>;

export type Region = typeof regions.$inferSelect;
export type InsertRegion = z.infer<typeof insertRegionSchema>;

// Cooperative types
export type Cooperative = typeof cooperatives.$inferSelect;
export type InsertCooperative = z.infer<typeof insertCooperativeSchema>;

export type CooperativeMember = typeof cooperativeMembers.$inferSelect;
export type InsertCooperativeMember = z.infer<typeof insertCooperativeMemberSchema>;

export type Profile = typeof profiles.$inferSelect;
export type InsertProfile = z.infer<typeof insertProfileSchema>;

export type ExportAudit = typeof exportAudit.$inferSelect;
export type InsertExportAudit = z.infer<typeof insertExportAuditSchema>;

export type PriceData = typeof priceData.$inferSelect;
export type InsertPriceData = z.infer<typeof insertPriceDataSchema>;

export type Forecast = typeof forecasts.$inferSelect;
export type InsertForecast = z.infer<typeof insertForecastSchema>;

export type LlmVerification = typeof llmVerifications.$inferSelect;
export type InsertLlmVerification = z.infer<typeof insertLlmVerificationSchema>;

export type Alert = typeof alerts.$inferSelect;
export type InsertAlert = z.infer<typeof insertAlertSchema>;

export type TradingRecommendation = typeof tradingRecommendations.$inferSelect;
export type InsertTradingRecommendation = z.infer<typeof insertTradingRecommendationSchema>;

// P0 Core MVP Types
export type Source = typeof sources.$inferSelect;
export type InsertSource = z.infer<typeof insertSourceSchema>;

export type PricesRaw = typeof pricesRaw.$inferSelect;
export type InsertPricesRaw = z.infer<typeof insertPricesRawSchema>;

export type PricesVerified = typeof pricesVerified.$inferSelect;
export type InsertPricesVerified = z.infer<typeof insertPricesVerifiedSchema>;

export type FxRate = typeof fxRates.$inferSelect;
export type InsertFxRate = z.infer<typeof insertFxRateSchema>;

export type ForecastRun = typeof forecastRuns.$inferSelect;
export type InsertForecastRun = z.infer<typeof insertForecastRunSchema>;

export type Forecast30d = typeof forecasts30d.$inferSelect;
export type InsertForecast30d = z.infer<typeof insertForecast30dSchema>;

export type Evidence = typeof evidence.$inferSelect;
export type InsertEvidence = z.infer<typeof insertEvidenceSchema>;

export type Role = typeof roles.$inferSelect;
export type InsertRole = z.infer<typeof insertRoleSchema>;

// Quality Gates Types
export type CompositeConfidenceScore = typeof compositeConfidenceScores.$inferSelect;
export type InsertCompositeConfidenceScore = z.infer<typeof insertCompositeConfidenceScoreSchema>;

export type QualityGate = typeof qualityGates.$inferSelect;
export type InsertQualityGate = z.infer<typeof insertQualityGateSchema>;

export type AgreementAnalysis = typeof agreementAnalysis.$inferSelect;
export type InsertAgreementAnalysis = z.infer<typeof insertAgreementAnalysisSchema>;

// NEW PIPELINE TYPES
export type QualityQueue = typeof qualityQueue.$inferSelect;
export type InsertQualityQueue = z.infer<typeof insertQualityQueueSchema>;

export type ValidationLog = typeof validationLogs.$inferSelect;
export type InsertValidationLog = z.infer<typeof insertValidationLogSchema>;

export type EvidenceLog = typeof evidenceLogs.$inferSelect;
export type InsertEvidenceLog = z.infer<typeof insertEvidenceLogSchema>;

export type CompositeCcsLog = typeof compositeCcsLogs.$inferSelect;
export type InsertCompositeCcsLog = z.infer<typeof insertCompositeCcsLogSchema>;

// VIETNAMESE MARKET COMMODITIES & FERTILIZERS SEED DATA
export const VIETNAMESE_COMMODITIES = [
  // 10 AGRICULTURAL PRODUCTS
  {
    slug: "rice_5pct",
    displayName: "Gạo trắng 5% tấm",
    name: "Rice 5% broken",
    category: "agricultural",
    specGrade: "5% broken, 25% moisture max",
    marketBasis: "FOB Ho Chi Minh City",
    unit: "USD/ton",
    unitDisplay: "USD/t",
    currency: "USD",
    frequency: "daily",
    timezone: "Asia/Ho_Chi_Minh",
    decimals: 2,
    historyMinMonths: 12,
    seasonalityFlags: {
      month: true,
      week_of_year: true,
      crop_calendar: true,
      holiday: true
    },
    exogenousCovariates: [
      "fx_usd_vnd",
      "freight_bdi",
      "enso_nino34",
      "rainfall_mekong_mm",
      "thai_vn_spread_usd_t",
      "diesel_usd_l"
    ],
    imputationRule: { method: "forward_fill", max_days: 3 },
    outlierRule: { method: "evt_zscore", threshold: 3.5 },
    logTransform: false,
    horizonDays: 30,
    retrainPolicy: "drift"
  },
  {
    slug: "coffee_robusta",
    displayName: "Cà phê Robusta FAQ",
    name: "Coffee Robusta FAQ",
    category: "agricultural",
    specGrade: "Robusta FAQ Grade 2, Screen 16+",
    marketBasis: "ICE Europe (futures front) / VN nội địa quy đổi",
    unit: "USD/ton",
    unitDisplay: "USD/t",
    currency: "USD",
    frequency: "daily",
    timezone: "Asia/Ho_Chi_Minh",
    decimals: 2,
    historyMinMonths: 12,
    seasonalityFlags: { month: true, week_of_year: true, crop_calendar: true },
    exogenousCovariates: [
      "ice_robusta_front",
      "rainfall_tay_nguyen",
      "fx_usd_vnd",
      "urea_cfr_sea",
      "freight_rates"
    ],
    imputationRule: { method: "forward_fill", max_days: 3 },
    outlierRule: { method: "evt_zscore", threshold: 3.5 },
    logTransform: false,
    horizonDays: 30,
    retrainPolicy: "drift"
  },
  {
    slug: "rubber_tsr20",
    displayName: "Cao su TSR20",
    name: "Rubber TSR20",
    category: "agricultural",
    specGrade: "TSR20 Grade",
    marketBasis: "SGX TSR20 (near month)",
    unit: "USD/ton",
    unitDisplay: "USD/t",
    currency: "USD",
    frequency: "daily",
    timezone: "Asia/Ho_Chi_Minh",
    decimals: 2,
    historyMinMonths: 12,
    seasonalityFlags: { month: true, week_of_year: true, crop_calendar: true },
    exogenousCovariates: [
      "brent_crude",
      "rainfall_thailand_malaysia",
      "auto_demand_proxy",
      "fx_thb_usd"
    ],
    imputationRule: { method: "forward_fill", max_days: 3 },
    outlierRule: { method: "evt_zscore", threshold: 3.5 },
    logTransform: false,
    horizonDays: 30,
    retrainPolicy: "drift"
  },
  {
    slug: "pepper_black",
    displayName: "Tiêu đen FAQ",
    name: "Black Pepper FAQ",
    category: "agricultural",
    specGrade: "Black Pepper FAQ",
    marketBasis: "Ex-warehouse Dak Lak (quy chuẩn)",
    unit: "USD/ton",
    unitDisplay: "USD/t",
    currency: "USD",
    frequency: "daily",
    timezone: "Asia/Ho_Chi_Minh",
    decimals: 2,
    historyMinMonths: 12,
    seasonalityFlags: { month: true, week_of_year: true, crop_calendar: true },
    exogenousCovariates: [
      "harvest_vn_india",
      "rainfall_local",
      "freight_rates",
      "inventory_local"
    ],
    imputationRule: { method: "forward_fill", max_days: 3 },
    outlierRule: { method: "evt_zscore", threshold: 3.5 },
    logTransform: false,
    horizonDays: 30,
    retrainPolicy: "drift"
  },
  {
    slug: "corn_maize",
    displayName: "Ngô vàng",
    name: "Corn Maize",
    category: "agricultural",
    specGrade: "Yellow Corn #2",
    marketBasis: "CBOT Corn (front) + basis VN",
    unit: "USD/ton",
    unitDisplay: "USD/t",
    currency: "USD",
    frequency: "daily",
    timezone: "Asia/Ho_Chi_Minh",
    decimals: 2,
    historyMinMonths: 12,
    seasonalityFlags: { month: true, week_of_year: true, crop_calendar: true },
    exogenousCovariates: [
      "cbot_corn_front",
      "ethanol_margin",
      "rainfall_us_arg",
      "fx_rates"
    ],
    imputationRule: { method: "forward_fill", max_days: 3 },
    outlierRule: { method: "evt_zscore", threshold: 3.5 },
    logTransform: false,
    horizonDays: 30,
    retrainPolicy: "drift"
  },
  {
    slug: "soybean",
    displayName: "Đậu tương",
    name: "Soybean",
    category: "agricultural",
    specGrade: "Soybean #1 Yellow",
    marketBasis: "CBOT Soy (front)",
    unit: "USD/ton",
    unitDisplay: "USD/t",
    currency: "USD",
    frequency: "daily",
    timezone: "Asia/Ho_Chi_Minh",
    decimals: 2,
    historyMinMonths: 12,
    seasonalityFlags: { month: true, week_of_year: true, crop_calendar: true },
    exogenousCovariates: [
      "cbot_soy_front",
      "crush_margin_meal_oil",
      "cpo_substitute",
      "fx_rates"
    ],
    imputationRule: { method: "forward_fill", max_days: 3 },
    outlierRule: { method: "evt_zscore", threshold: 3.5 },
    logTransform: false,
    horizonDays: 30,
    retrainPolicy: "drift"
  },
  {
    slug: "wheat",
    displayName: "Lúa mì",
    name: "Wheat",
    category: "agricultural",
    specGrade: "Wheat #2 SRW",
    marketBasis: "CBOT/Matif (front)",
    unit: "USD/ton",
    unitDisplay: "USD/t",
    currency: "USD",
    frequency: "daily",
    timezone: "Asia/Ho_Chi_Minh",
    decimals: 2,
    historyMinMonths: 12,
    seasonalityFlags: { month: true, week_of_year: true, crop_calendar: true },
    exogenousCovariates: [
      "futures_front",
      "black_sea_freight",
      "drought_index",
      "fx_rates"
    ],
    imputationRule: { method: "forward_fill", max_days: 3 },
    outlierRule: { method: "evt_zscore", threshold: 3.5 },
    logTransform: false,
    horizonDays: 30,
    retrainPolicy: "drift"
  },
  {
    slug: "sugar_raw11",
    displayName: "Đường thô #11",
    name: "Sugar Raw #11",
    category: "agricultural",
    specGrade: "Raw Sugar #11",
    marketBasis: "ICE #11 (cents/lb) → USD/t",
    unit: "USD/ton",
    unitDisplay: "USD/t",
    currency: "USD",
    frequency: "daily",
    timezone: "Asia/Ho_Chi_Minh",
    decimals: 2,
    historyMinMonths: 12,
    seasonalityFlags: { month: true, week_of_year: true, crop_calendar: true },
    exogenousCovariates: [
      "ice_sugar_11",
      "ethanol_brazil",
      "rainfall_india_brazil",
      "el_nino_index"
    ],
    imputationRule: { method: "forward_fill", max_days: 3 },
    outlierRule: { method: "evt_zscore", threshold: 3.5 },
    logTransform: false,
    horizonDays: 30,
    retrainPolicy: "drift"
  },
  {
    slug: "palm_oil_cpo",
    displayName: "Dầu cọ CPO",
    name: "Palm Oil CPO",
    category: "agricultural",
    specGrade: "Crude Palm Oil",
    marketBasis: "Bursa Malaysia CPO (front)",
    unit: "USD/ton",
    unitDisplay: "USD/t",
    currency: "USD",
    frequency: "daily",
    timezone: "Asia/Ho_Chi_Minh",
    decimals: 2,
    historyMinMonths: 12,
    seasonalityFlags: { month: true, week_of_year: true, crop_calendar: true },
    exogenousCovariates: [
      "brent_crude",
      "fx_usd_myr",
      "rainfall_my_idn",
      "soyoil_spread"
    ],
    imputationRule: { method: "forward_fill", max_days: 3 },
    outlierRule: { method: "evt_zscore", threshold: 3.5 },
    logTransform: false,
    horizonDays: 30,
    retrainPolicy: "drift"
  },
  {
    slug: "cassava_chips",
    displayName: "Sắn lát",
    name: "Cassava Chips",
    category: "agricultural",
    specGrade: "Cassava Chips Grade A",
    marketBasis: "FOB VN → China",
    unit: "USD/ton",
    unitDisplay: "USD/t",
    currency: "USD",
    frequency: "daily",
    timezone: "Asia/Ho_Chi_Minh",
    decimals: 2,
    historyMinMonths: 12,
    seasonalityFlags: { month: true, week_of_year: true, crop_calendar: true },
    exogenousCovariates: [
      "china_demand_proxy",
      "freight_vn_cn",
      "fx_usd_cny"
    ],
    imputationRule: { method: "forward_fill", max_days: 3 },
    outlierRule: { method: "evt_zscore", threshold: 3.5 },
    logTransform: false,
    horizonDays: 30,
    retrainPolicy: "drift"
  }
] as const;

export const VIETNAMESE_FERTILIZERS = [
  // 5 FERTILIZERS
  {
    slug: "urea_46n",
    displayName: "Phân Urea 46%N",
    name: "Urea 46%N",
    category: "fertilizer",
    specGrade: "Urea 46%N (gran/prilled)",
    marketBasis: "CFR SEA / FOB Middle East",
    unit: "USD/ton",
    unitDisplay: "USD/t",
    currency: "USD",
    frequency: "daily",
    timezone: "Asia/Ho_Chi_Minh",
    decimals: 2,
    historyMinMonths: 12,
    seasonalityFlags: { month: true, quarter: true, planting_season: true },
    exogenousCovariates: [
      "ttf_gas",
      "henry_hub_gas",
      "ammonia_cfr",
      "freight_rates",
      "fx_rates"
    ],
    imputationRule: { method: "forward_fill", max_days: 3 },
    outlierRule: { method: "evt_zscore", threshold: 3.5 },
    logTransform: false,
    horizonDays: 30,
    retrainPolicy: "drift"
  },
  {
    slug: "dap_18_46_0",
    displayName: "Phân DAP 18-46-0",
    name: "DAP 18-46-0",
    category: "fertilizer",
    specGrade: "DAP 18-46-0",
    marketBasis: "CFR SEA",
    unit: "USD/ton",
    unitDisplay: "USD/t",
    currency: "USD",
    frequency: "daily",
    timezone: "Asia/Ho_Chi_Minh",
    decimals: 2,
    historyMinMonths: 12,
    seasonalityFlags: { month: true, quarter: true, planting_season: true },
    exogenousCovariates: [
      "ammonia_cfr",
      "rock_phosphate",
      "sulfur_prices",
      "freight_rates"
    ],
    imputationRule: { method: "forward_fill", max_days: 3 },
    outlierRule: { method: "evt_zscore", threshold: 3.5 },
    logTransform: false,
    horizonDays: 30,
    retrainPolicy: "drift"
  },
  {
    slug: "npk_16_16_8",
    displayName: "Phân NPK 16-16-8",
    name: "NPK 16-16-8",
    category: "fertilizer",
    specGrade: "NPK 16-16-8",
    marketBasis: "Ex-factory VN (quy chuẩn)",
    unit: "USD/ton",
    unitDisplay: "USD/t",
    currency: "USD",
    frequency: "weekly",
    timezone: "Asia/Ho_Chi_Minh",
    decimals: 2,
    historyMinMonths: 12,
    seasonalityFlags: { month: true, quarter: true, planting_season: true },
    exogenousCovariates: [
      "urea_prices",
      "dap_prices",
      "kcl_prices",
      "electricity_fuel_costs",
      "fx_rates"
    ],
    imputationRule: { method: "forward_fill", max_days: 7 },
    outlierRule: { method: "evt_zscore", threshold: 3.5 },
    logTransform: false,
    horizonDays: 30,
    retrainPolicy: "drift"
  },
  {
    slug: "mop_kcl_60",
    displayName: "Phân Kali MOP KCl 60%",
    name: "Potash MOP KCl 60%",
    category: "fertilizer",
    specGrade: "MOP KCl 60%",
    marketBasis: "CFR SEA",
    unit: "USD/ton",
    unitDisplay: "USD/t",
    currency: "USD",
    frequency: "weekly",
    timezone: "Asia/Ho_Chi_Minh",
    decimals: 2,
    historyMinMonths: 12,
    seasonalityFlags: { month: true, quarter: true, planting_season: true },
    exogenousCovariates: [
      "supply_belarus_canada",
      "freight_rates",
      "fx_rates"
    ],
    imputationRule: { method: "forward_fill", max_days: 7 },
    outlierRule: { method: "evt_zscore", threshold: 3.5 },
    logTransform: false,
    horizonDays: 30,
    retrainPolicy: "drift"
  },
  {
    slug: "tsp_46",
    displayName: "Phân TSP 46% P2O5",
    name: "TSP 46% P2O5",
    category: "fertilizer",
    specGrade: "TSP 46% P2O5",
    marketBasis: "CFR SEA",
    unit: "USD/ton",
    unitDisplay: "USD/t",
    currency: "USD",
    frequency: "weekly",
    timezone: "Asia/Ho_Chi_Minh",
    decimals: 2,
    historyMinMonths: 12,
    seasonalityFlags: { month: true, quarter: true, planting_season: true },
    exogenousCovariates: [
      "ammonia_prices",
      "rock_phosphate",
      "sulfur_prices",
      "freight_rates"
    ],
    imputationRule: { method: "forward_fill", max_days: 7 },
    outlierRule: { method: "evt_zscore", threshold: 3.5 },
    logTransform: false,
    horizonDays: 30,
    retrainPolicy: "drift"
  }
] as const;
