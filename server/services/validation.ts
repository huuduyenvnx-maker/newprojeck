import { z } from 'zod';
import * as crypto from 'crypto';

// Types for validation results
export interface ValidationResult {
  isValid: boolean;
  score: number; // 0-1, overall quality score
  metrics: ValidationMetrics;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationMetrics {
  completeness: number;    // 0-1, percentage of non-null values
  uniqueness: number;      // 0-1, percentage of unique records
  accuracy: number;        // 0-1, percentage of records passing business rules
  consistency: number;     // 0-1, percentage of records with consistent formats
  timeliness: number;      // 0-1, how fresh the data is
  validity: number;        // 0-1, percentage of records with valid schema
  recordCount: number;
  nullCount: number;
  duplicateCount: number;
  outlierCount: number;
}

export interface ValidationError {
  type: 'schema' | 'business_rule' | 'data_quality' | 'timeliness';
  field?: string;
  value?: any;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  recordIndex?: number;
}

export interface ValidationWarning {
  type: 'outlier' | 'format' | 'completeness' | 'consistency';
  field?: string;
  value?: any;
  message: string;
  recordIndex?: number;
}

export interface ValidationRule {
  name: string;
  type: 'schema' | 'range' | 'format' | 'business' | 'quality';
  field?: string;
  constraint: any;
  severity: 'low' | 'medium' | 'high' | 'critical';
  enabled: boolean;
}

export interface ValidationConfig {
  source: string;
  rules: ValidationRule[];
  thresholds: {
    completeness: number;
    uniqueness: number;
    accuracy: number;
    timeliness_hours: number;
  };
  outlier_detection: {
    method: 'z_score' | 'iqr' | 'isolation_forest';
    threshold: number;
    enabled: boolean;
  };
}

// Schema definitions for different data types
const PriceDataSchema = z.object({
  date: z.string().or(z.date()).refine(
    (val) => !isNaN(Date.parse(val instanceof Date ? val.toISOString() : val)),
    { message: "Invalid date format" }
  ),
  price: z.number().positive("Price must be positive"),
  commodity_id: z.string().min(1, "Commodity ID is required"),
  region_id: z.string().min(1, "Region ID is required"),
  unit: z.string().min(1, "Unit is required"),
  currency: z.string().length(3, "Currency must be 3-letter code"),
  volume: z.number().positive().optional(),
  source: z.string().min(1, "Source is required").optional(),
});

const FxRateSchema = z.object({
  date: z.string().or(z.date()).refine(
    (val) => !isNaN(Date.parse(val instanceof Date ? val.toISOString() : val)),
    { message: "Invalid date format" }
  ),
  base_currency: z.string().length(3, "Base currency must be 3-letter code"),
  target_currency: z.string().length(3, "Target currency must be 3-letter code"),
  rate: z.number().positive("Exchange rate must be positive"),
});

// Great Expectations-style Validation Engine
export class DataValidator {
  private config: ValidationConfig;

  constructor(config: ValidationConfig) {
    this.config = config;
  }

  // Main validation entry point
  async validateDataset(data: any[]): Promise<ValidationResult> {
    console.log(`Starting validation for ${data.length} records from source: ${this.config.source}`);
    
    const startTime = Date.now();
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    
    // Initialize metrics
    const metrics: ValidationMetrics = {
      completeness: 0,
      uniqueness: 0,
      accuracy: 0,
      consistency: 0,
      timeliness: 0,
      validity: 0,
      recordCount: data.length,
      nullCount: 0,
      duplicateCount: 0,
      outlierCount: 0
    };

    // Run all validation checks
    try {
      // 1. Schema Validation
      const schemaResults = await this.validateSchema(data);
      errors.push(...schemaResults.errors);
      warnings.push(...schemaResults.warnings);
      metrics.validity = schemaResults.validity;

      // 2. Completeness Check
      const completenessResults = await this.checkCompleteness(data);
      metrics.completeness = completenessResults.completeness;
      metrics.nullCount = completenessResults.nullCount;
      errors.push(...completenessResults.errors);

      // 3. Uniqueness Check
      const uniquenessResults = await this.checkUniqueness(data);
      metrics.uniqueness = uniquenessResults.uniqueness;
      metrics.duplicateCount = uniquenessResults.duplicateCount;
      warnings.push(...uniquenessResults.warnings);

      // 4. Business Rules Validation
      const businessResults = await this.validateBusinessRules(data);
      metrics.accuracy = businessResults.accuracy;
      errors.push(...businessResults.errors);
      warnings.push(...businessResults.warnings);

      // 5. Data Consistency Check
      const consistencyResults = await this.checkConsistency(data);
      metrics.consistency = consistencyResults.consistency;
      warnings.push(...consistencyResults.warnings);

      // 6. Timeliness Check
      const timelinessResults = await this.checkTimeliness(data);
      metrics.timeliness = timelinessResults.timeliness;
      errors.push(...timelinessResults.errors);
      warnings.push(...timelinessResults.warnings);

      // 7. Outlier Detection
      if (this.config.outlier_detection.enabled) {
        const outlierResults = await this.detectOutliers(data);
        metrics.outlierCount = outlierResults.outlierCount;
        warnings.push(...outlierResults.warnings);
      }

      // Calculate overall quality score
      const score = this.calculateQualityScore(metrics);

      // Determine if validation passes
      const isValid = this.determineValidationStatus(metrics, errors);

      console.log(`Validation completed in ${Date.now() - startTime}ms. Score: ${score.toFixed(3)}, Valid: ${isValid}`);

      return {
        isValid,
        score,
        metrics,
        errors,
        warnings
      };

    } catch (error: any) {
      console.error('Validation failed:', error);
      errors.push({
        type: 'data_quality',
        message: `Validation process failed: ${error.message}`,
        severity: 'critical'
      });

      return {
        isValid: false,
        score: 0,
        metrics,
        errors,
        warnings
      };
    }
  }

  // Schema validation using Zod
  private async validateSchema(data: any[]): Promise<{
    validity: number;
    errors: ValidationError[];
    warnings: ValidationWarning[];
  }> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    let validCount = 0;

    // Determine schema type based on source configuration
    const schema = this.getSchemaForSource(this.config.source);

    for (let i = 0; i < data.length; i++) {
      const record = data[i];
      
      try {
        schema.parse(record);
        validCount++;
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          for (const issue of error.errors) {
            errors.push({
              type: 'schema',
              field: issue.path.join('.'),
              value: record[issue.path[0]],
              message: issue.message,
              severity: 'high',
              recordIndex: i
            });
          }
        }
      }
    }

    return {
      validity: data.length > 0 ? validCount / data.length : 1,
      errors,
      warnings
    };
  }

  // Check data completeness
  private async checkCompleteness(data: any[]): Promise<{
    completeness: number;
    nullCount: number;
    errors: ValidationError[];
  }> {
    const errors: ValidationError[] = [];
    let totalFields = 0;
    let nonNullFields = 0;
    let nullCount = 0;

    const requiredFields = this.getRequiredFields();

    for (let i = 0; i < data.length; i++) {
      const record = data[i];

      for (const field of requiredFields) {
        totalFields++;
        
        if (record[field] == null || record[field] === '' || record[field] === undefined) {
          nullCount++;
          errors.push({
            type: 'data_quality',
            field: field,
            message: `Required field '${field}' is missing or empty`,
            severity: 'high',
            recordIndex: i
          });
        } else {
          nonNullFields++;
        }
      }
    }

    const completeness = totalFields > 0 ? nonNullFields / totalFields : 1;

    // Check if completeness meets threshold
    if (completeness < this.config.thresholds.completeness) {
      errors.push({
        type: 'data_quality',
        message: `Completeness ${(completeness * 100).toFixed(1)}% below threshold ${(this.config.thresholds.completeness * 100).toFixed(1)}%`,
        severity: 'critical'
      });
    }

    return { completeness, nullCount, errors };
  }

  // Check data uniqueness
  private async checkUniqueness(data: any[]): Promise<{
    uniqueness: number;
    duplicateCount: number;
    warnings: ValidationWarning[];
  }> {
    const warnings: ValidationWarning[] = [];
    const seen = new Set<string>();
    const duplicateIndices = new Set<number>();

    // Create hash for each record based on key fields
    const keyFields = this.getUniqueKeyFields();

    for (let i = 0; i < data.length; i++) {
      const record = data[i];
      const keyValues = keyFields.map(field => String(record[field] || '')).join('|');
      const hash = crypto.createHash('sha256').update(keyValues).digest('hex');

      if (seen.has(hash)) {
        duplicateIndices.add(i);
        warnings.push({
          type: 'completeness',
          message: `Duplicate record found (hash: ${hash.substring(0, 8)}...)`,
          recordIndex: i
        });
      } else {
        seen.add(hash);
      }
    }

    const uniqueCount = data.length - duplicateIndices.size;
    const uniqueness = data.length > 0 ? uniqueCount / data.length : 1;

    return {
      uniqueness,
      duplicateCount: duplicateIndices.size,
      warnings
    };
  }

  // Validate business rules
  private async validateBusinessRules(data: any[]): Promise<{
    accuracy: number;
    errors: ValidationError[];
    warnings: ValidationWarning[];
  }> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    let validCount = 0;

    const businessRules = this.config.rules.filter(rule => rule.type === 'business' && rule.enabled);

    for (let i = 0; i < data.length; i++) {
      const record = data[i];
      let recordValid = true;

      for (const rule of businessRules) {
        const isValid = await this.validateBusinessRule(record, rule);
        
        if (!isValid) {
          recordValid = false;
          
          const error: ValidationError = {
            type: 'business_rule',
            field: rule.field,
            value: rule.field ? record[rule.field] : record,
            message: `Business rule violation: ${rule.name}`,
            severity: rule.severity,
            recordIndex: i
          };

          if (rule.severity === 'critical' || rule.severity === 'high') {
            errors.push(error);
          } else {
            warnings.push({
              type: 'format',
              field: error.field,
              value: error.value,
              message: error.message,
              recordIndex: i
            });
          }
        }
      }

      if (recordValid) {
        validCount++;
      }
    }

    const accuracy = data.length > 0 ? validCount / data.length : 1;

    return { accuracy, errors, warnings };
  }

  // Check data consistency
  private async checkConsistency(data: any[]): Promise<{
    consistency: number;
    warnings: ValidationWarning[];
  }> {
    const warnings: ValidationWarning[] = [];
    let consistentCount = 0;

    for (let i = 0; i < data.length; i++) {
      const record = data[i];
      let recordConsistent = true;

      // Check date format consistency
      if (record.date) {
        const date = new Date(record.date);
        if (isNaN(date.getTime())) {
          recordConsistent = false;
          warnings.push({
            type: 'consistency',
            field: 'date',
            value: record.date,
            message: 'Inconsistent date format',
            recordIndex: i
          });
        }
      }

      // Check currency format consistency
      if (record.currency && !/^[A-Z]{3}$/.test(record.currency)) {
        recordConsistent = false;
        warnings.push({
          type: 'consistency',
          field: 'currency',
          value: record.currency,
          message: 'Currency should be 3-letter uppercase code',
          recordIndex: i
        });
      }

      // Check numeric field consistency
      if (record.price && (typeof record.price !== 'number' || record.price <= 0)) {
        recordConsistent = false;
        warnings.push({
          type: 'consistency',
          field: 'price',
          value: record.price,
          message: 'Price should be positive number',
          recordIndex: i
        });
      }

      if (recordConsistent) {
        consistentCount++;
      }
    }

    const consistency = data.length > 0 ? consistentCount / data.length : 1;

    return { consistency, warnings };
  }

  // Check data timeliness
  private async checkTimeliness(data: any[]): Promise<{
    timeliness: number;
    errors: ValidationError[];
    warnings: ValidationWarning[];
  }> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    let timelyCount = 0;

    const maxAgeMs = this.config.thresholds.timeliness_hours * 60 * 60 * 1000;
    const now = Date.now();

    for (let i = 0; i < data.length; i++) {
      const record = data[i];
      
      if (record.date) {
        const recordDate = new Date(record.date);
        const age = now - recordDate.getTime();

        if (age <= maxAgeMs) {
          timelyCount++;
        } else {
          const ageHours = Math.round(age / (60 * 60 * 1000));
          
          if (ageHours > this.config.thresholds.timeliness_hours * 2) {
            errors.push({
              type: 'timeliness',
              field: 'date',
              value: record.date,
              message: `Data is ${ageHours} hours old, exceeds threshold of ${this.config.thresholds.timeliness_hours} hours`,
              severity: 'medium',
              recordIndex: i
            });
          } else {
            warnings.push({
              type: 'format',
              field: 'date',
              value: record.date,
              message: `Data is ${ageHours} hours old`,
              recordIndex: i
            });
          }
        }
      }
    }

    const timeliness = data.length > 0 ? timelyCount / data.length : 1;

    return { timeliness, errors, warnings };
  }

  // Detect outliers using statistical methods
  private async detectOutliers(data: any[]): Promise<{
    outlierCount: number;
    warnings: ValidationWarning[];
  }> {
    const warnings: ValidationWarning[] = [];
    const outlierIndices = new Set<number>();

    // Extract numeric price values
    const prices = data
      .map((record, index) => ({ value: parseFloat(record.price), index }))
      .filter(item => !isNaN(item.value));

    if (prices.length < 3) {
      return { outlierCount: 0, warnings };
    }

    // Calculate statistics
    const values = prices.map(p => p.value);
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const stdDev = Math.sqrt(values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length);

    // Z-score outlier detection
    if (this.config.outlier_detection.method === 'z_score') {
      for (const price of prices) {
        const zScore = Math.abs((price.value - mean) / stdDev);
        
        if (zScore > this.config.outlier_detection.threshold) {
          outlierIndices.add(price.index);
          warnings.push({
            type: 'outlier',
            field: 'price',
            value: price.value,
            message: `Price outlier detected (z-score: ${zScore.toFixed(2)})`,
            recordIndex: price.index
          });
        }
      }
    }

    // IQR outlier detection
    else if (this.config.outlier_detection.method === 'iqr') {
      const sortedValues = [...values].sort((a, b) => a - b);
      const q1 = sortedValues[Math.floor(sortedValues.length * 0.25)];
      const q3 = sortedValues[Math.floor(sortedValues.length * 0.75)];
      const iqr = q3 - q1;
      const lowerBound = q1 - (1.5 * iqr);
      const upperBound = q3 + (1.5 * iqr);

      for (const price of prices) {
        if (price.value < lowerBound || price.value > upperBound) {
          outlierIndices.add(price.index);
          warnings.push({
            type: 'outlier',
            field: 'price',
            value: price.value,
            message: `Price outlier detected (outside IQR bounds: ${lowerBound.toFixed(2)} - ${upperBound.toFixed(2)})`,
            recordIndex: price.index
          });
        }
      }
    }

    return {
      outlierCount: outlierIndices.size,
      warnings
    };
  }

  // Helper methods
  private getSchemaForSource(source: string): z.ZodSchema {
    // Return appropriate schema based on source type
    if (source.includes('fx') || source.includes('exchange')) {
      return FxRateSchema;
    }
    return PriceDataSchema;
  }

  private getRequiredFields(): string[] {
    return ['date', 'price', 'commodity_id', 'region_id', 'unit'];
  }

  private getUniqueKeyFields(): string[] {
    return ['commodity_id', 'region_id', 'date', 'unit'];
  }

  private async validateBusinessRule(record: any, rule: ValidationRule): Promise<boolean> {
    try {
      switch (rule.name) {
        case 'price_range':
          const price = parseFloat(record.price);
          return price >= rule.constraint.min && price <= rule.constraint.max;
          
        case 'required_fields':
          return rule.constraint.every((field: string) => 
            record[field] != null && record[field] !== ''
          );
          
        case 'valid_currency':
          return /^[A-Z]{3}$/.test(record.currency);
          
        case 'positive_price':
          return parseFloat(record.price) > 0;
          
        case 'valid_date':
          return !isNaN(Date.parse(record.date));
          
        default:
          return true;
      }
    } catch {
      return false;
    }
  }

  private calculateQualityScore(metrics: ValidationMetrics): number {
    // Weighted average of all quality metrics
    const weights = {
      completeness: 0.25,
      uniqueness: 0.15,
      accuracy: 0.25,
      consistency: 0.15,
      timeliness: 0.10,
      validity: 0.10
    };

    return (
      metrics.completeness * weights.completeness +
      metrics.uniqueness * weights.uniqueness +
      metrics.accuracy * weights.accuracy +
      metrics.consistency * weights.consistency +
      metrics.timeliness * weights.timeliness +
      metrics.validity * weights.validity
    );
  }

  private determineValidationStatus(metrics: ValidationMetrics, errors: ValidationError[]): boolean {
    // Check if any critical errors exist
    const criticalErrors = errors.filter(e => e.severity === 'critical');
    if (criticalErrors.length > 0) {
      return false;
    }

    // Check if metrics meet thresholds
    return (
      metrics.completeness >= this.config.thresholds.completeness &&
      metrics.uniqueness >= this.config.thresholds.uniqueness &&
      metrics.accuracy >= this.config.thresholds.accuracy
    );
  }
}

// Validation Configuration Factory
export class ValidationConfigFactory {
  static createConfigForSource(sourceName: string, sourceType: string): ValidationConfig {
    const baseConfig: ValidationConfig = {
      source: sourceName,
      rules: [],
      thresholds: {
        completeness: 0.98,
        uniqueness: 0.999,
        accuracy: 0.95,
        timeliness_hours: 24
      },
      outlier_detection: {
        method: 'z_score',
        threshold: 3.0,
        enabled: true
      }
    };

    // Add source-specific rules
    if (sourceType === 'price_data') {
      baseConfig.rules.push(
        {
          name: 'price_range',
          type: 'business',
          field: 'price',
          constraint: { min: 0.01, max: 1000000 },
          severity: 'high',
          enabled: true
        },
        {
          name: 'required_fields',
          type: 'business',
          constraint: ['date', 'price', 'commodity_id', 'region_id', 'unit'],
          severity: 'critical',
          enabled: true
        },
        {
          name: 'valid_currency',
          type: 'format',
          field: 'currency',
          constraint: /^[A-Z]{3}$/,
          severity: 'medium',
          enabled: true
        },
        {
          name: 'positive_price',
          type: 'business',
          field: 'price',
          constraint: { min: 0 },
          severity: 'high',
          enabled: true
        }
      );
    }

    // Source-specific adjustments
    if (sourceName.includes('hcmx') || sourceName.includes('exchange')) {
      baseConfig.thresholds.accuracy = 0.97; // Higher accuracy for exchange data
      baseConfig.thresholds.timeliness_hours = 4; // More recent data expected
    }

    if (sourceName.includes('mard') || sourceName.includes('ministry')) {
      baseConfig.thresholds.timeliness_hours = 168; // Weekly data acceptable
    }

    return baseConfig;
  }

  // Create validation config from sources.yaml configuration
  static createConfigFromYaml(sourceConfig: any): ValidationConfig {
    const config: ValidationConfig = {
      source: sourceConfig.name,
      rules: [],
      thresholds: {
        completeness: sourceConfig.validation_rules?.completeness_threshold || 0.98,
        uniqueness: sourceConfig.validation_rules?.uniqueness_threshold || 0.999,
        accuracy: sourceConfig.validation_rules?.accuracy_threshold || 0.95,
        timeliness_hours: sourceConfig.validation_rules?.data_freshness_hours || 24
      },
      outlier_detection: {
        method: sourceConfig.validation_rules?.outlier_detection?.method || 'z_score',
        threshold: sourceConfig.validation_rules?.outlier_detection?.threshold || 3.0,
        enabled: sourceConfig.validation_rules?.outlier_detection?.enabled ?? true
      }
    };

    // Add price range rule if configured
    if (sourceConfig.validation_rules?.price_range) {
      config.rules.push({
        name: 'price_range',
        type: 'business',
        field: 'price',
        constraint: sourceConfig.validation_rules.price_range,
        severity: 'high',
        enabled: true
      });
    }

    // Add required fields rule
    if (sourceConfig.validation_rules?.required_fields) {
      config.rules.push({
        name: 'required_fields',
        type: 'business',
        constraint: sourceConfig.validation_rules.required_fields,
        severity: 'critical',
        enabled: true
      });
    }

    return config;
  }
}

export default DataValidator;