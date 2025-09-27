#!/usr/bin/env python3
"""
AgriIntel Data Collection Service
Automated collection of agricultural commodity and fertilizer price data using LLM providers
"""

import asyncio
import json
import logging
import random
import time
import hashlib
from typing import Dict, List, Optional, Tuple, Any, Set
from datetime import datetime, date, timedelta
from decimal import Decimal
from pathlib import Path
import aiohttp
import backoff
from collections import Counter

# Import our schemas
from models.data_collection_schemas import (
    DataCollectionResult, LLMResponse, LLMMetadata, ValidationResult,
    DeduplicationInfo, PriceDataPoint, SourceReference, BatchCollectionRequest,
    BatchCollectionResult, SourceType, DataQuality, CommodityCategory
)

# Environment and config
import os
from dotenv import load_dotenv
load_dotenv()

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class LLMDataCollector:
    """
    Core data collection service with dual-LLM support, validation, and quality control
    """
    
    def __init__(self):
        self.openai_api_key = os.getenv("OPENAI_API_KEY")
        self.gemini_api_key = os.getenv("GEMINI_API_KEY") 
        
        # Collection configuration
        self.config = {
            "temperature_range": (0.0, 0.4),  # Low temperature for accuracy
            "max_retries": 3,
            "retry_backoff_factor": 2.0,
            "request_timeout": 30,
            "self_consistency_n": 3,  # Multiple completions for voting
            "consensus_threshold": 0.6,
            "quality_threshold": 0.7,
            "enable_deduplication": True,
            "enable_quality_filters": True,
        }
        
        # Prompt versioning
        self.prompt_version = "v1.0.0"
        self.schema_version = "v1.2.0"
        
        # In-memory storage for deduplication (in production, use Redis/DB)
        self.seen_hashes: Set[str] = set()
        self.collection_cache: Dict[str, DataCollectionResult] = {}
        
        # Vietnamese agricultural references (reduce hallucination)
        self.reference_sources = [
            SourceReference(
                name="Vietnam Ministry of Agriculture", 
                url="https://www.mard.gov.vn",
                reliability_score=0.95,
                access_method="public"
            ),
            SourceReference(
                name="Vietnam Commodity Exchange",
                url="https://vnx.org.vn", 
                reliability_score=0.9,
                access_method="market_data"
            ),
            SourceReference(
                name="Vietnam Food Association",
                url="https://www.vfa.org.vn",
                reliability_score=0.85,
                access_method="industry_report"
            )
        ]

    async def collect_daily_prices(
        self,
        target_date: Optional[date] = None,
        commodities: Optional[List[str]] = None,
        regions: Optional[List[str]] = None,
        provider: SourceType = SourceType.LLM_GEMINI
    ) -> BatchCollectionResult:
        """
        Main method to collect daily agricultural price data
        """
        if target_date is None:
            target_date = date.today()
            
        batch_request = BatchCollectionRequest(
            collection_date=target_date,
            target_commodities=commodities or self._get_default_commodities(),
            target_regions=regions or self._get_default_regions(),
            collection_method=provider,
            n_completions=self.config["self_consistency_n"],
            consensus_threshold=self.config["consensus_threshold"],
            min_confidence=self.config["quality_threshold"],
            hitl_sample_rate=0.08
        )
        
        logger.info(f"Starting daily price collection for {target_date} with {provider.value}")
        start_time = datetime.utcnow()
        
        try:
            # Execute collection with self-consistency
            results = await self._execute_batch_collection(batch_request)
            
            # Apply quality control and deduplication
            filtered_results = await self._apply_quality_control(results)
            
            # Calculate batch metrics
            batch_result = self._calculate_batch_metrics(
                batch_request, filtered_results, start_time
            )
            
            logger.info(f"Batch collection completed: {batch_result.total_valid}/{batch_result.total_collected} valid")
            return batch_result
            
        except Exception as e:
            logger.error(f"Batch collection failed: {e}")
            return BatchCollectionResult(
                batch_id=f"batch_{int(time.time())}",
                request=batch_request,
                individual_results=[],
                total_collected=0,
                total_valid=0,
                total_duplicates=0,
                average_quality_score=0.0,
                average_confidence=0.0,
                started_at=start_time,
                errors=[str(e)],
                partial_success=False
            )

    async def _execute_batch_collection(
        self, request: BatchCollectionRequest
    ) -> List[DataCollectionResult]:
        """Execute collection with self-consistency and consensus"""
        
        all_results = []
        
        # Generate multiple completions for self-consistency
        for completion_idx in range(request.n_completions):
            logger.info(f"Executing completion {completion_idx + 1}/{request.n_completions}")
            
            # Collect from each provider if specified
            if request.collection_method == SourceType.LLM_GEMINI:
                result = await self._collect_from_gemini(request, completion_idx)
            elif request.collection_method == SourceType.LLM_OPENAI:
                result = await self._collect_from_openai(request, completion_idx)
            else:
                raise ValueError(f"Unsupported collection method: {request.collection_method}")
                
            if result:
                all_results.append(result)
                
        # Apply self-consistency filtering (majority voting)
        if len(all_results) > 1:
            return self._apply_self_consistency(all_results, request.consensus_threshold)
        
        return all_results

    @backoff.on_exception(
        backoff.expo,
        (aiohttp.ClientError, asyncio.TimeoutError),
        max_tries=3,
        factor=2.0
    )
    async def _collect_from_gemini(
        self, request: BatchCollectionRequest, completion_idx: int
    ) -> Optional[DataCollectionResult]:
        """Collect data from Google Gemini with comprehensive logging"""
        
        if not self.gemini_api_key:
            logger.error("Gemini API key not available")
            return None
            
        temperature = random.uniform(*self.config["temperature_range"])
        prompt = self._build_collection_prompt(request)
        
        # Metadata for logging
        metadata = LLMMetadata(
            provider="gemini",
            model="gemini-2.5-pro",
            version="2.5",
            temperature=temperature,
            top_p=0.95,
            max_tokens=8192,
            n_completions=1,
            seed=completion_idx,  # Use completion index as seed for reproducibility
            prompt_tokens=0,
            completion_tokens=0,
            total_tokens=0,
            request_timestamp=datetime.utcnow(),
            duration_ms=0.0,
            retry_count=0
        )
        
        try:
            async with aiohttp.ClientSession() as session:
                headers = {
                    "Content-Type": "application/json",
                    "x-goog-api-key": self.gemini_api_key
                }
                
                # Gemini API request
                payload = {
                    "contents": [{
                        "parts": [{"text": prompt}]
                    }],
                    "generationConfig": {
                        "temperature": temperature,
                        "topP": 0.95,
                        "maxOutputTokens": 8192,
                        "responseMimeType": "application/json"  # Force JSON output
                    },
                    "safetySettings": [
                        {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
                        {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
                        {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
                        {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"}
                    ]
                }
                
                start_time = time.time()
                
                async with session.post(
                    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent",
                    headers=headers,
                    json=payload,
                    timeout=self.config["request_timeout"]
                ) as response:
                    
                    response.raise_for_status()
                    response_data = await response.json()
                    
                    # Update metadata with response info
                    metadata.response_timestamp = datetime.utcnow()
                    metadata.duration_ms = (time.time() - start_time) * 1000
                    
                    # Extract content and usage stats
                    if "candidates" in response_data and response_data["candidates"]:
                        candidate = response_data["candidates"][0]
                        raw_text = candidate["content"]["parts"][0]["text"]
                        
                        # Extract token usage if available
                        if "usageMetadata" in response_data:
                            usage = response_data["usageMetadata"]
                            metadata.prompt_tokens = usage.get("promptTokenCount", 0)
                            metadata.completion_tokens = usage.get("candidatesTokenCount", 0)
                            metadata.total_tokens = usage.get("totalTokenCount", 0)
                            
                        metadata.finish_reason = candidate.get("finishReason", "STOP")
                        
                        # Parse and validate the response
                        return await self._process_llm_response(
                            raw_text, metadata, request, completion_idx
                        )
                    else:
                        logger.error(f"No candidates in Gemini response: {response_data}")
                        return None
                        
        except Exception as e:
            logger.error(f"Gemini collection failed: {e}")
            metadata.retry_count += 1
            return None

    @backoff.on_exception(
        backoff.expo,
        (aiohttp.ClientError, asyncio.TimeoutError),
        max_tries=3,
        factor=2.0
    )
    async def _collect_from_openai(
        self, request: BatchCollectionRequest, completion_idx: int
    ) -> Optional[DataCollectionResult]:
        """Collect data from OpenAI with comprehensive logging"""
        
        if not self.openai_api_key:
            logger.error("OpenAI API key not available")
            return None
            
        temperature = random.uniform(*self.config["temperature_range"])
        prompt = self._build_collection_prompt(request)
        
        # Metadata for logging
        metadata = LLMMetadata(
            provider="openai",
            model="gpt-4o",
            version="4o",
            temperature=temperature,
            top_p=1.0,
            max_tokens=8192,
            n_completions=1,
            seed=completion_idx,
            prompt_tokens=0,
            completion_tokens=0,
            total_tokens=0,
            request_timestamp=datetime.utcnow(),
            duration_ms=0.0,
            retry_count=0
        )
        
        try:
            async with aiohttp.ClientSession() as session:
                headers = {
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {self.openai_api_key}"
                }
                
                # OpenAI API request
                payload = {
                    "model": "gpt-4o",
                    "messages": [
                        {
                            "role": "system",
                            "content": "You are an expert agricultural market analyst for Vietnam. Provide accurate, current commodity price data in strict JSON format only."
                        },
                        {
                            "role": "user", 
                            "content": prompt
                        }
                    ],
                    "temperature": temperature,
                    "max_tokens": 8192,
                    "response_format": {"type": "json_object"},  # Force JSON
                    "seed": completion_idx
                }
                
                start_time = time.time()
                
                async with session.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers=headers,
                    json=payload,
                    timeout=self.config["request_timeout"]
                ) as response:
                    
                    response.raise_for_status()
                    response_data = await response.json()
                    
                    # Update metadata with response info
                    metadata.response_timestamp = datetime.utcnow()
                    metadata.duration_ms = (time.time() - start_time) * 1000
                    
                    # Extract content and usage stats
                    if "choices" in response_data and response_data["choices"]:
                        choice = response_data["choices"][0]
                        raw_text = choice["message"]["content"]
                        
                        # Extract token usage
                        if "usage" in response_data:
                            usage = response_data["usage"]
                            metadata.prompt_tokens = usage.get("prompt_tokens", 0)
                            metadata.completion_tokens = usage.get("completion_tokens", 0)
                            metadata.total_tokens = usage.get("total_tokens", 0)
                            
                        metadata.finish_reason = choice.get("finish_reason", "stop")
                        
                        # Parse and validate the response
                        return await self._process_llm_response(
                            raw_text, metadata, request, completion_idx
                        )
                    else:
                        logger.error(f"No choices in OpenAI response: {response_data}")
                        return None
                        
        except Exception as e:
            logger.error(f"OpenAI collection failed: {e}")
            metadata.retry_count += 1
            return None

    async def _process_llm_response(
        self,
        raw_response: str,
        metadata: LLMMetadata,
        request: BatchCollectionRequest,
        completion_idx: int
    ) -> Optional[DataCollectionResult]:
        """Process and validate LLM response with comprehensive error handling"""
        
        try:
            # Parse JSON response
            response_json = json.loads(raw_response.strip())
            
            # Validate against our schema
            structured_data = LLMResponse(**response_json)
            
            # Generate collection ID
            collection_id = f"{metadata.provider}_{request.collection_date.strftime('%Y%m%d')}_{completion_idx}_{int(time.time())}"
            
            # Validate data quality
            validation_result = await self._validate_data_quality(structured_data, raw_response)
            
            # Check for duplicates
            content_hash, normalized_json = self._generate_content_hash(structured_data)
            dedup_info = DeduplicationInfo(
                content_hash=content_hash,
                normalized_json=normalized_json,
                is_duplicate=content_hash in self.seen_hashes,
                similarity_score=0.0
            )
            
            if not dedup_info.is_duplicate:
                self.seen_hashes.add(content_hash)
            
            # Create comprehensive result
            result = DataCollectionResult(
                collection_id=collection_id,
                source_type=SourceType.LLM_GEMINI if metadata.provider == "gemini" else SourceType.LLM_OPENAI,
                llm_metadata=metadata,
                raw_response=raw_response,
                structured_data=structured_data,
                validation_result=validation_result,
                deduplication_info=dedup_info,
                collected_at=metadata.request_timestamp,
                processed_at=datetime.utcnow()
            )
            
            logger.info(f"Successfully processed {metadata.provider} response: {len(structured_data.data_points)} data points")
            return result
            
        except json.JSONDecodeError as e:
            logger.error(f"JSON parsing failed for {metadata.provider}: {e}")
            return None
        except Exception as e:
            logger.error(f"Response processing failed for {metadata.provider}: {e}")
            return None

    def _build_collection_prompt(self, request: BatchCollectionRequest) -> str:
        """Build comprehensive prompt with references to reduce hallucination"""
        
        # Base prompt template with Vietnamese agricultural context
        prompt_template = f"""
## TASK: Vietnamese Agricultural Commodity Price Collection
Date: {request.collection_date.strftime('%B %d, %Y')}
Schema Version: {self.schema_version}
Prompt Version: {self.prompt_version}

You are a Vietnamese agricultural market analyst. Provide current daily prices for agricultural commodities and fertilizers in Vietnam markets.

## REQUIRED JSON OUTPUT FORMAT:
```json
{{
    "data_points": [
        {{
            "commodity_name": "Gạo ST25",
            "category": "agricultural",
            "region": "Mekong Delta", 
            "date": "{request.collection_date.isoformat()}",
            "price": 850.00,
            "currency": "USD",
            "unit": "USD/ton",
            "volume": 1250.5,
            "market_conditions": "Stable demand, good weather",
            "confidence_score": 0.85
        }}
    ],
    "metadata": {{
        "collection_method": "market_analysis",
        "weather_impact": "minimal",
        "seasonal_factors": ["harvest_season"]
    }},
    "sources_referenced": [
        {{
            "name": "Vietnam Ministry of Agriculture",
            "url": "https://www.mard.gov.vn",
            "reliability_score": 0.95,
            "access_method": "public"
        }}
    ],
    "collection_timestamp": "{datetime.utcnow().isoformat()}Z",
    "language_detected": "vi",
    "confidence_overall": 0.82
}}
```

## TARGET COMMODITIES:
{self._format_commodity_list(request.target_commodities)}

## TARGET REGIONS:
{', '.join(request.target_regions)}

## REFERENCE SOURCES (Use these to ground your responses):
{self._format_reference_sources()}

## CONSTRAINTS:
1. Return ONLY valid JSON matching the exact schema above
2. All prices in USD per metric ton unless specified otherwise
3. Confidence scores between 0.0-1.0 based on data reliability
4. Include Vietnamese commodity names where appropriate
5. Date must be exactly: {request.collection_date.isoformat()}
6. Minimum 5 data points, maximum 30 data points
7. Include both agricultural products AND fertilizers
8. Regional focus: Vietnam provinces and economic zones

## QUALITY REQUIREMENTS:
- Current market prices (not historical)
- Realistic price ranges for Vietnamese markets
- Include market conditions context
- Reference credible Vietnamese agricultural sources
- Confidence scores reflect actual data availability

Respond with ONLY the JSON object, no additional text.
"""
        
        return prompt_template.strip()

    def _format_commodity_list(self, commodities: List[str]) -> str:
        """Format commodity list with Vietnamese names and categories"""
        if not commodities:
            return """
Agricultural Products:
- Gạo ST25 (Fragrant Rice ST25)
- Gạo Jasmine (Jasmine Rice) 
- Cà phê Robusta (Robusta Coffee)
- Cà phê Arabica (Arabica Coffee)
- Tiêu đen (Black Pepper)
- Tiêu trắng (White Pepper)
- Cao su (Natural Rubber)
- Điều (Cashew Nuts)
- Sắn dây (Cassava)

Fertilizers:
- Phân NPK 16-16-8
- Phân Đạm Urê (Urea)
- Phân Lân (Phosphate)
- Phân Kali (Potash)
- Phân hữu cơ (Organic Fertilizer)
"""
        else:
            return "\n".join(f"- {commodity}" for commodity in commodities)

    def _format_reference_sources(self) -> str:
        """Format reference sources for prompt"""
        return "\n".join([
            f"- {source.name}: {source.url} (Reliability: {source.reliability_score:.2f})"
            for source in self.reference_sources
        ])

    async def _validate_data_quality(
        self, data: LLMResponse, raw_response: str
    ) -> ValidationResult:
        """Comprehensive data quality validation"""
        
        errors = []
        quality_flags = []
        quality_score = 1.0
        
        # Basic structure validation
        if not data.data_points:
            errors.append("No data points provided")
            quality_score *= 0.0
        
        # Individual data point validation
        for i, dp in enumerate(data.data_points):
            # Price validation
            if dp.price <= 0:
                errors.append(f"Data point {i}: Invalid price {dp.price}")
                quality_score *= 0.8
                
            # Confidence validation
            if not (0.0 <= dp.confidence_score <= 1.0):
                errors.append(f"Data point {i}: Invalid confidence score {dp.confidence_score}")
                quality_score *= 0.9
                
            # Date validation
            if dp.date > date.today() + timedelta(days=1):
                errors.append(f"Data point {i}: Future date {dp.date}")
                quality_score *= 0.7
                
            # Vietnamese commodity validation
            if not self._is_valid_vietnamese_commodity(dp.commodity_name):
                quality_flags.append(f"Data point {i}: Non-Vietnamese commodity {dp.commodity_name}")
                quality_score *= 0.95

        # Content quality checks
        length_check = 100 <= len(raw_response) <= 10000
        if not length_check:
            quality_flags.append(f"Response length {len(raw_response)} outside optimal range")
            quality_score *= 0.9
            
        # Language detection (simplified)
        language_check = self._detect_vietnamese_content(raw_response)
        
        # PII detection (simplified)
        pii_check = not self._contains_pii(raw_response)
        if not pii_check:
            errors.append("PII detected in response")
            quality_score *= 0.5
            
        # Repetition analysis
        repetition_ratio = self._calculate_repetition_ratio(raw_response)
        if repetition_ratio > 0.3:
            quality_flags.append(f"High repetition ratio: {repetition_ratio:.2f}")
            quality_score *= 0.8
            
        # Blacklist check
        blacklist_violations = self._check_blacklist(raw_response)
        if blacklist_violations:
            errors.extend(blacklist_violations)
            quality_score *= 0.6

        is_valid = len(errors) == 0 and quality_score >= self.config["quality_threshold"]
        
        return ValidationResult(
            is_valid=is_valid,
            quality_score=max(0.0, min(1.0, quality_score)),
            validation_errors=errors,
            quality_flags=quality_flags,
            length_check=length_check,
            language_check=language_check,
            pii_check=pii_check,
            repetition_ratio=repetition_ratio,
            blacklist_violations=blacklist_violations
        )

    def _generate_content_hash(self, data: LLMResponse) -> Tuple[str, str]:
        """Generate SHA256 hash for deduplication"""
        # Normalize data for consistent hashing
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
                for dp in sorted(data.data_points, 
                               key=lambda x: (x.commodity_name, x.region, x.date))
            ]
        }
        
        normalized_json = json.dumps(normalized_data, sort_keys=True, separators=(',', ':'))
        content_hash = hashlib.sha256(normalized_json.encode('utf-8')).hexdigest()
        
        return content_hash, normalized_json

    def _apply_self_consistency(
        self, results: List[DataCollectionResult], threshold: float
    ) -> List[DataCollectionResult]:
        """Apply self-consistency filtering using majority voting"""
        
        if len(results) <= 1:
            return results
            
        # Group similar data points across results
        all_data_points = []
        for result in results:
            for dp in result.structured_data.data_points:
                all_data_points.append((dp, result))
                
        # Simple consensus: keep data points that appear in majority of results
        commodity_counter = Counter()
        for dp, _ in all_data_points:
            key = (dp.commodity_name.lower().strip(), dp.region.lower().strip(), dp.date)
            commodity_counter[key] += 1
            
        # Filter results based on consensus
        min_votes = max(1, int(len(results) * threshold))
        consensus_keys = {key for key, count in commodity_counter.items() if count >= min_votes}
        
        filtered_results = []
        for result in results:
            filtered_data_points = []
            for dp in result.structured_data.data_points:
                key = (dp.commodity_name.lower().strip(), dp.region.lower().strip(), dp.date)
                if key in consensus_keys:
                    filtered_data_points.append(dp)
                    
            if filtered_data_points:
                # Update the result with filtered data
                result.structured_data.data_points = filtered_data_points
                filtered_results.append(result)
                
        logger.info(f"Self-consistency filtering: {len(filtered_results)}/{len(results)} results passed consensus")
        return filtered_results

    async def _apply_quality_control(
        self, results: List[DataCollectionResult]
    ) -> List[DataCollectionResult]:
        """Apply comprehensive quality control filters"""
        
        if not self.config["enable_quality_filters"]:
            return results
            
        filtered_results = []
        
        for result in results:
            # Skip invalid results
            if not result.validation_result.is_valid:
                logger.warning(f"Skipping invalid result: {result.collection_id}")
                continue
                
            # Skip low quality results
            if result.validation_result.quality_score < self.config["quality_threshold"]:
                logger.warning(f"Skipping low quality result: {result.collection_id} (score: {result.validation_result.quality_score:.2f})")
                continue
                
            # Skip duplicates if enabled
            if self.config["enable_deduplication"] and result.deduplication_info.is_duplicate:
                logger.info(f"Skipping duplicate result: {result.collection_id}")
                continue
                
            filtered_results.append(result)
            
        logger.info(f"Quality control: {len(filtered_results)}/{len(results)} results passed filters")
        return filtered_results

    def _calculate_batch_metrics(
        self,
        request: BatchCollectionRequest,
        results: List[DataCollectionResult],
        start_time: datetime
    ) -> BatchCollectionResult:
        """Calculate comprehensive batch metrics"""
        
        total_collected = len(results)
        total_valid = sum(1 for r in results if r.validation_result.is_valid)
        total_duplicates = sum(1 for r in results if r.deduplication_info.is_duplicate)
        
        if results:
            avg_quality = sum(r.validation_result.quality_score for r in results) / len(results)
            avg_confidence = sum(r.structured_data.confidence_overall for r in results) / len(results)
        else:
            avg_quality = 0.0
            avg_confidence = 0.0
            
        completed_time = datetime.utcnow()
        duration = (completed_time - start_time).total_seconds()
        
        return BatchCollectionResult(
            batch_id=f"batch_{start_time.strftime('%Y%m%d_%H%M%S')}",
            request=request,
            individual_results=results,
            total_collected=total_collected,
            total_valid=total_valid,
            total_duplicates=total_duplicates,
            average_quality_score=avg_quality,
            average_confidence=avg_confidence,
            started_at=start_time,
            completed_at=completed_time,
            duration_seconds=duration,
            partial_success=total_valid > 0
        )

    # Helper methods for validation
    def _get_default_commodities(self) -> List[str]:
        """Get default Vietnamese commodity list"""
        return [
            "Gạo ST25", "Gạo Jasmine", "Cà phê Robusta", "Cà phê Arabica",
            "Tiêu đen", "Tiêu trắng", "Cao su", "Điều", "Sắn dây",
            "Phân NPK 16-16-8", "Phân Đạm Urê", "Phân Lân", "Phân Kali"
        ]

    def _get_default_regions(self) -> List[str]:
        """Get default Vietnamese regions"""
        return [
            "Mekong Delta", "Ho Chi Minh City", "Hanoi", "Central Highlands",
            "Red River Delta", "Southeast Region", "North Central Coast"
        ]

    def _is_valid_vietnamese_commodity(self, name: str) -> bool:
        """Validate Vietnamese commodity names"""
        vietnamese_keywords = [
            "gạo", "rice", "cà phê", "coffee", "tiêu", "pepper", "cao su", "rubber",
            "điều", "cashew", "sắn", "cassava", "phân", "fertilizer", "npk", "urê", "urea"
        ]
        name_lower = name.lower()
        return any(keyword in name_lower for keyword in vietnamese_keywords)

    def _detect_vietnamese_content(self, text: str) -> bool:
        """Simple Vietnamese content detection"""
        vietnamese_chars = "àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ"
        return any(char in text.lower() for char in vietnamese_chars)

    def _contains_pii(self, text: str) -> bool:
        """Simple PII detection"""
        import re
        # Simple regex patterns for common PII
        email_pattern = r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'
        phone_pattern = r'\b\d{3}[-.]?\d{3}[-.]?\d{4}\b'
        
        return bool(re.search(email_pattern, text) or re.search(phone_pattern, text))

    def _calculate_repetition_ratio(self, text: str) -> float:
        """Calculate repetition ratio in text"""
        words = text.split()
        if len(words) < 2:
            return 0.0
            
        word_counts = Counter(words)
        repeated_words = sum(count - 1 for count in word_counts.values() if count > 1)
        return repeated_words / len(words)

    def _check_blacklist(self, text: str) -> List[str]:
        """Check for blacklisted content"""
        blacklist = [
            "fake", "scam", "illegal", "bitcoin", "cryptocurrency",
            "personal information", "credit card", "password"
        ]
        
        violations = []
        text_lower = text.lower()
        for term in blacklist:
            if term in text_lower:
                violations.append(f"Blacklisted term: {term}")
                
        return violations


# Export the main collector class
__all__ = ["LLMDataCollector"]

if __name__ == "__main__":
    # Test the collector
    async def test_collector():
        collector = LLMDataCollector()
        result = await collector.collect_daily_prices(
            target_date=date.today(),
            provider=SourceType.LLM_GEMINI
        )
        print(f"Collection result: {result.total_valid} valid results")
        
    asyncio.run(test_collector())