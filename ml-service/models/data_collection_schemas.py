#!/usr/bin/env python3
"""
AgriIntel Data Collection Schemas
Pydantic models for standardized agricultural commodity and fertilizer price data collection
"""
from typing import Dict, List, Optional, Union, Any, Literal
from pydantic import BaseModel, Field, field_validator, model_validator
from datetime import datetime, date as date_type
from enum import Enum
import hashlib
import json
from decimal import Decimal


# =====================================
# ENUMS AND CONSTANTS
# =====================================

class CommodityCategory(str, Enum):
    AGRICULTURAL = "agricultural"
    FERTILIZER = "fertilizer"

class Currency(str, Enum):
    USD = "USD"
    VND = "VND"
    EUR = "EUR"

class SourceType(str, Enum):
    LLM_OPENAI = "llm_openai"
    LLM_GEMINI = "llm_gemini"
    API_EXTERNAL = "api_external"
    SCRAPER = "scraper"
    MANUAL = "manual"

class DataQuality(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INVALID = "invalid"

class Language(str, Enum):
    VIETNAMESE = "vi"
    ENGLISH = "en"

# Schema versioning
SCHEMA_VERSION = "v1.2.0"
PROMPT_VERSION = "v1.0.0"


# =====================================
# CORE DATA MODELS
# =====================================

class PriceDataPoint(BaseModel):
    """Single price data point with validation"""
    commodity_name: str = Field(..., min_length=1, max_length=100)
    category: CommodityCategory
    region: str = Field(..., min_length=1, max_length=50)
    date: date_type = Field(...)
    price: Decimal = Field(..., gt=0, decimal_places=2)
    currency: Currency
    unit: str = Field("USD/ton", max_length=20)
    volume: Optional[Decimal] = Field(None, ge=0)
    market_conditions: Optional[str] = Field(None, max_length=500)
    confidence_score: float = Field(..., ge=0.0, le=1.0)
    
    class Config:
        json_encoders = {
            Decimal: float,
            date_type: lambda v: v.isoformat()
        }

class SourceReference(BaseModel):
    """Reference to data source for hallucination reduction"""
    name: str = Field(..., min_length=1, max_length=100)
    url: Optional[str] = Field(None, max_length=500)
    reliability_score: float = Field(..., ge=0.0, le=1.0)
    last_updated: Optional[datetime] = None
    access_method: str = Field("public", max_length=50)

class LLMResponse(BaseModel):
    """Standardized LLM response structure"""
    data_points: List[PriceDataPoint] = Field(..., min_length=1, max_length=50)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    sources_referenced: List[SourceReference] = Field(default_factory=list)
    collection_timestamp: datetime = Field(default_factory=datetime.utcnow)
    language_detected: Language = Language.VIETNAMESE
    confidence_overall: float = Field(..., ge=0.0, le=1.0)
    
    @field_validator('data_points')
    @classmethod
    def validate_data_points(cls, v):
        if not v:
            raise ValueError("At least one data point required")
        return v

    @model_validator(mode='before')
    @classmethod
    def validate_consistency(cls, values):
        """Ensure data consistency"""
        if isinstance(values, dict):
            data_points = values.get('data_points', [])
            confidence = values.get('confidence_overall', 0)
            
            if data_points:
                avg_confidence = sum(dp.confidence_score for dp in data_points) / len(data_points)
                if abs(avg_confidence - confidence) > 0.2:
                    raise ValueError("Overall confidence must align with individual data point confidences")
        
        return values


# =====================================
# COLLECTION METADATA
# =====================================

class LLMMetadata(BaseModel):
    """Comprehensive LLM interaction metadata"""
    provider: Literal["openai", "gemini"]
    model: str = Field(..., min_length=1)
    version: str = Field(..., min_length=1)
    prompt_version: str = PROMPT_VERSION
    schema_version: str = SCHEMA_VERSION
    
    # Request parameters
    temperature: float = Field(..., ge=0.0, le=2.0)
    top_p: Optional[float] = Field(None, ge=0.0, le=1.0)
    max_tokens: Optional[int] = Field(None, gt=0)
    seed: Optional[int] = None
    n_completions: int = Field(1, ge=1, le=5)
    
    # Response metrics
    prompt_tokens: Optional[int] = Field(None, ge=0)
    completion_tokens: Optional[int] = Field(None, ge=0)
    total_tokens: Optional[int] = Field(None, ge=0)
    
    # Timing
    request_timestamp: datetime = Field(default_factory=datetime.utcnow)
    response_timestamp: Optional[datetime] = None
    duration_ms: Optional[float] = Field(None, ge=0)
    
    # Quality control
    retry_count: int = Field(0, ge=0)
    tool_calls: List[Dict[str, Any]] = Field(default_factory=list)
    finish_reason: Optional[str] = None

class ValidationResult(BaseModel):
    """Data validation and quality assessment"""
    is_valid: bool
    quality_score: float = Field(..., ge=0.0, le=1.0)
    validation_errors: List[str] = Field(default_factory=list)
    quality_flags: List[str] = Field(default_factory=list)
    
    # Quality metrics
    length_check: bool = True
    language_check: bool = True
    pii_check: bool = True
    repetition_ratio: float = Field(0.0, ge=0.0, le=1.0)
    blacklist_violations: List[str] = Field(default_factory=list)

class DeduplicationInfo(BaseModel):
    """Deduplication metadata"""
    content_hash: str = Field(..., min_length=64, max_length=64)  # SHA256
    normalized_json: str
    is_duplicate: bool = False
    duplicate_of: Optional[str] = None  # Hash of original
    similarity_score: Optional[float] = Field(None, ge=0.0, le=1.0)  # For near-duplicate detection
    minhash_signature: Optional[List[int]] = None


# =====================================
# COLLECTION RESULT
# =====================================

class DataCollectionResult(BaseModel):
    """Complete data collection result with all metadata"""
    collection_id: str = Field(..., min_length=1)
    source_type: SourceType
    llm_metadata: Optional[LLMMetadata] = None
    
    # Raw and processed data
    raw_response: str = Field(..., min_length=1)
    structured_data: LLMResponse
    
    # Quality control
    validation_result: ValidationResult
    deduplication_info: DeduplicationInfo
    
    # Processing metadata
    processing_version: str = "1.0.0"
    collected_at: datetime = Field(default_factory=datetime.utcnow)
    processed_at: Optional[datetime] = None
    
    # Human in the loop
    hitl_reviewed: bool = False
    hitl_reviewer: Optional[str] = None
    hitl_notes: Optional[str] = None
    
    @field_validator('collection_id')
    @classmethod
    def generate_collection_id(cls, v):
        if not v:
            timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
            return f"coll_{timestamp}_{hash(timestamp) % 10000:04d}"
        return v

    def generate_content_hash(self) -> tuple[str, str]:
        """Generate SHA256 hash of normalized content for deduplication"""
        # Normalize the data for consistent hashing
        normalized_data = {
            "data_points": [
                {
                    "commodity_name": dp.commodity_name.lower().strip(),
                    "category": dp.category.value,
                    "region": dp.region.lower().strip(),
                    "date": dp.date.isoformat(),
                    "price": float(dp.price),
                    "currency": dp.currency.value,
                    "unit": dp.unit.lower().strip()
                }
                for dp in sorted(self.structured_data.data_points, 
                               key=lambda x: (x.commodity_name, x.region, x.date))
            ]
        }
        
        normalized_json = json.dumps(normalized_data, sort_keys=True, separators=(',', ':'))
        content_hash = hashlib.sha256(normalized_json.encode('utf-8')).hexdigest()
        
        return content_hash, normalized_json


# =====================================
# BATCH PROCESSING
# =====================================

class BatchCollectionRequest(BaseModel):
    """Request for batch data collection"""
    collection_date: date_type = Field(default_factory=lambda: datetime.now().date())
    target_commodities: List[str] = Field(default_factory=list)
    target_regions: List[str] = Field(default_factory=list)
    collection_method: SourceType = SourceType.LLM_GEMINI
    
    # Self-consistency parameters
    n_completions: int = Field(3, ge=1, le=5)
    consensus_threshold: float = Field(0.6, ge=0.5, le=1.0)
    
    # Quality control parameters
    min_confidence: float = Field(0.7, ge=0.0, le=1.0)
    enable_hitl_sampling: bool = True
    hitl_sample_rate: float = Field(0.08, ge=0.0, le=1.0)  # 8% sampling

class BatchCollectionResult(BaseModel):
    """Result of batch data collection"""
    batch_id: str
    request: BatchCollectionRequest
    individual_results: List[DataCollectionResult]
    
    # Aggregated metrics
    total_collected: int
    total_valid: int
    total_duplicates: int
    average_quality_score: float
    average_confidence: float
    
    # Processing metadata
    started_at: datetime
    completed_at: Optional[datetime] = None
    duration_seconds: Optional[float] = None
    
    # Error handling
    errors: List[str] = Field(default_factory=list)
    partial_success: bool = False


# =====================================
# EXPORT SCHEMAS
# =====================================

class DataExportSchema(BaseModel):
    """Standardized export format for collected data"""
    schema_version: str = SCHEMA_VERSION
    export_timestamp: datetime = Field(default_factory=datetime.utcnow)
    data_points: List[PriceDataPoint]
    metadata: Dict[str, Any] = Field(default_factory=dict)
    
    class Config:
        json_encoders = {
            Decimal: float,
            datetime: lambda v: v.isoformat(),
            date_type: lambda v: v.isoformat()
        }


# =====================================
# UTILITY FUNCTIONS
# =====================================

def create_sample_data() -> LLMResponse:
    """Create sample data for testing"""
    return LLMResponse(
        data_points=[
            PriceDataPoint(
                commodity_name="Fragrant Rice ST25",
                category=CommodityCategory.AGRICULTURAL,
                region="Mekong Delta",
                date=date_type.today(),
                price=Decimal("850.00"),
                currency=Currency.USD,
                unit="USD/ton",
                volume=None,
                market_conditions=None,
                confidence_score=0.85
            ),
            PriceDataPoint(
                commodity_name="NPK Fertilizer 16-16-8",
                category=CommodityCategory.FERTILIZER,
                region="Ho Chi Minh City",
                date=date_type.today(),
                price=Decimal("425.50"),
                currency=Currency.USD,
                unit="USD/ton",
                volume=None,
                market_conditions=None,
                confidence_score=0.78
            )
        ],
        confidence_overall=0.82
    )

def validate_vietnamese_commodity_name(name: str) -> bool:
    """Validate Vietnamese commodity names"""
    vietnamese_commodities = {
        # Rice varieties
        "gạo st25", "gạo fragrant", "gạo jasmine", "gạo tám xoan",
        "gạo nàng hương", "gạo thiên long", "gạo nàng nương",
        
        # Coffee
        "cà phê robusta", "cà phê arabica", "cà phê chồn",
        
        # Pepper
        "tiêu đen", "tiêu trắng", "tiêu xanh",
        
        # Other commodities
        "cao su", "điều", "sắn dây", "ngô", "đường mía",
        
        # Fertilizers
        "phân npk", "phân đạm", "phân lân", "phân kali",
        "phân hữu cơ", "phân bón lá"
    }
    
    return name.lower().strip() in vietnamese_commodities

if __name__ == "__main__":
    # Test schema validation
    sample = create_sample_data()
    print(f"Sample validation: {sample.dict()}")