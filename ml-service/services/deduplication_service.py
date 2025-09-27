#!/usr/bin/env python3
"""
AgriIntel Advanced Deduplication Service
SHA256 exact matching + MinHash/LSH for near-duplicate detection
"""

import hashlib
import json
import time
from typing import Dict, List, Optional, Set, Tuple, Any
from datetime import datetime, timedelta
from dataclasses import dataclass
from collections import defaultdict
import re

# MinHash/LSH imports
from datasketch import MinHash, MinHashLSH

from models.data_collection_schemas import (
    LLMResponse, PriceDataPoint, DeduplicationInfo
)

@dataclass
class DuplicateCluster:
    """Group of similar/duplicate items"""
    representative_hash: str
    items: List[str]  # List of content hashes
    similarity_scores: List[float]
    created_at: datetime
    category: str  # "exact", "near_duplicate", "similar"

class AdvancedDeduplicationService:
    """
    Advanced deduplication with exact matching (SHA256) and fuzzy matching (MinHash/LSH)
    """
    
    def __init__(self,
                 similarity_threshold: float = 0.85,
                 lsh_num_perm: int = 256,
                 lsh_threshold: float = 0.8,
                 max_cache_size: int = 100000,
                 cleanup_interval_hours: int = 24):
        
        self.similarity_threshold = similarity_threshold
        self.lsh_num_perm = lsh_num_perm
        self.lsh_threshold = lsh_threshold
        self.max_cache_size = max_cache_size
        self.cleanup_interval = timedelta(hours=cleanup_interval_hours)
        
        # Storage for exact matches (SHA256)
        self.exact_hashes: Set[str] = set()
        self.hash_to_content: Dict[str, str] = {}  # Hash -> normalized JSON
        self.hash_to_timestamp: Dict[str, datetime] = {}
        
        # MinHashLSH for approximate matches
        self.lsh = MinHashLSH(threshold=lsh_threshold, num_perm=lsh_num_perm)
        self.minhash_cache: Dict[str, MinHash] = {}
        
        # Clustering storage
        self.duplicate_clusters: Dict[str, DuplicateCluster] = {}
        
        # Performance tracking
        self.stats = {
            "exact_matches": 0,
            "near_duplicates": 0,
            "unique_items": 0,
            "total_processed": 0,
            "last_cleanup": datetime.utcnow()
        }
        
    def check_duplicate(self, data: LLMResponse, enable_near_duplicate: bool = True) -> DeduplicationInfo:
        """
        Comprehensive duplicate checking with exact and fuzzy matching
        """
        start_time = time.time()
        
        try:
            # Step 1: Generate normalized content and exact hash
            content_hash, normalized_json = self._generate_content_hash(data)
            
            # Step 2: Check for exact duplicates
            is_exact_duplicate = content_hash in self.exact_hashes
            duplicate_of = content_hash if is_exact_duplicate else None
            
            # Step 3: Near-duplicate detection using MinHash/LSH
            similarity_score = 0.0
            near_duplicate_hash = None
            
            if enable_near_duplicate and not is_exact_duplicate:
                minhash = self._generate_minhash(normalized_json)
                similarity_score, near_duplicate_hash = self._check_near_duplicate(content_hash, minhash)
                
                # If we found a near-duplicate above threshold, consider it a duplicate
                if similarity_score >= self.similarity_threshold:
                    duplicate_of = near_duplicate_hash
                    
            # Step 4: Store new content if not duplicate
            if not is_exact_duplicate and similarity_score < self.similarity_threshold:
                self._store_new_content(content_hash, normalized_json, data)
                
            # Step 5: Update statistics
            self._update_statistics(is_exact_duplicate, similarity_score)
            
            # Step 6: Create deduplication info
            dedup_info = DeduplicationInfo(
                content_hash=content_hash,
                normalized_json=normalized_json,
                is_duplicate=is_exact_duplicate or similarity_score >= self.similarity_threshold,
                duplicate_of=duplicate_of,
                similarity_score=similarity_score,
                minhash_signature=list(self.minhash_cache[content_hash].hashvalues) if content_hash in self.minhash_cache else None
            )
            
            # Log performance
            duration_ms = (time.time() - start_time) * 1000
            self._log_deduplication_performance(duration_ms, is_exact_duplicate, similarity_score)
            
            return dedup_info
            
        except Exception as e:
            print(f"Deduplication error: {e}")
            # Return safe fallback
            content_hash, normalized_json = self._generate_content_hash(data)
            return DeduplicationInfo(
                content_hash=content_hash,
                normalized_json=normalized_json,
                is_duplicate=False,
                similarity_score=0.0
            )

    def _generate_content_hash(self, data: LLMResponse) -> Tuple[str, str]:
        """Generate SHA256 hash of normalized content"""
        # Normalize data for consistent hashing
        normalized_data = {
            "data_points": [
                {
                    # Core identifying fields only
                    "commodity_name": self._normalize_text(dp.commodity_name),
                    "category": dp.category.value,
                    "region": self._normalize_text(dp.region),
                    "date": dp.date.isoformat(),
                    "price": round(float(dp.price), 2),  # Round to avoid floating point differences
                    "currency": dp.currency.value,
                    "unit": self._normalize_text(dp.unit)
                }
                for dp in sorted(data.data_points, 
                               key=lambda x: (x.commodity_name, x.region, x.date))
            ]
        }
        
        # Generate normalized JSON
        normalized_json = json.dumps(normalized_data, sort_keys=True, separators=(',', ':'))
        
        # Generate SHA256 hash
        content_hash = hashlib.sha256(normalized_json.encode('utf-8')).hexdigest()
        
        return content_hash, normalized_json

    def _normalize_text(self, text: str) -> str:
        """Normalize text for consistent comparison"""
        # Convert to lowercase, remove extra whitespace, normalize Vietnamese characters
        normalized = text.lower().strip()
        
        # Remove common variations and extra characters
        normalized = re.sub(r'[^\w\s]', '', normalized)  # Remove punctuation
        normalized = re.sub(r'\s+', ' ', normalized)  # Normalize whitespace
        
        # Handle Vietnamese diacritics normalization (basic approach)
        vietnamese_chars = {
            'à': 'a', 'á': 'a', 'ạ': 'a', 'ả': 'a', 'ã': 'a',
            'â': 'a', 'ầ': 'a', 'ấ': 'a', 'ậ': 'a', 'ẩ': 'a', 'ẫ': 'a',
            'ă': 'a', 'ằ': 'a', 'ắ': 'a', 'ặ': 'a', 'ẳ': 'a', 'ẵ': 'a',
            'è': 'e', 'é': 'e', 'ẹ': 'e', 'ẻ': 'e', 'ẽ': 'e',
            'ê': 'e', 'ề': 'e', 'ế': 'e', 'ệ': 'e', 'ể': 'e', 'ễ': 'e',
            'ì': 'i', 'í': 'i', 'ị': 'i', 'ỉ': 'i', 'ĩ': 'i',
            'ò': 'o', 'ó': 'o', 'ọ': 'o', 'ỏ': 'o', 'õ': 'o',
            'ô': 'o', 'ồ': 'o', 'ố': 'o', 'ộ': 'o', 'ổ': 'o', 'ỗ': 'o',
            'ơ': 'o', 'ờ': 'o', 'ớ': 'o', 'ợ': 'o', 'ở': 'o', 'ỡ': 'o',
            'ù': 'u', 'ú': 'u', 'ụ': 'u', 'ủ': 'u', 'ũ': 'u',
            'ư': 'u', 'ừ': 'u', 'ứ': 'u', 'ự': 'u', 'ử': 'u', 'ữ': 'u',
            'ỳ': 'y', 'ý': 'y', 'ỵ': 'y', 'ỷ': 'y', 'ỹ': 'y',
            'đ': 'd'
        }
        
        for vn_char, latin_char in vietnamese_chars.items():
            normalized = normalized.replace(vn_char, latin_char)
            
        return normalized.strip()

    def _generate_minhash(self, text: str) -> MinHash:
        """Generate MinHash signature for text"""
        # Create MinHash object
        minhash = MinHash(num_perm=self.lsh_num_perm)
        
        # Generate shingles (n-grams) for better similarity detection
        shingles = self._generate_shingles(text, n=3)
        
        # Update MinHash with shingles
        for shingle in shingles:
            minhash.update(shingle.encode('utf-8'))
            
        return minhash

    def _generate_shingles(self, text: str, n: int = 3) -> Set[str]:
        """Generate character n-grams (shingles) from text"""
        # Clean text for shingling
        clean_text = re.sub(r'\s+', '', text.lower())
        
        # Generate character n-grams
        shingles = set()
        for i in range(len(clean_text) - n + 1):
            shingle = clean_text[i:i+n]
            shingles.add(shingle)
            
        # Also add word-level shingles for structured data
        words = text.lower().split()
        for i in range(len(words) - n + 1):
            word_shingle = ' '.join(words[i:i+n])
            shingles.add(word_shingle)
            
        return shingles

    def _check_near_duplicate(self, content_hash: str, minhash: MinHash) -> Tuple[float, Optional[str]]:
        """Check for near-duplicates using LSH"""
        try:
            # Query LSH for similar items
            similar_items = self.lsh.query(minhash)
            
            if not similar_items:
                # No similar items found, add this one to LSH
                self.lsh.insert(content_hash, minhash)
                self.minhash_cache[content_hash] = minhash
                return 0.0, None
                
            # Calculate similarity with each similar item
            max_similarity = 0.0
            most_similar_hash = None
            
            for similar_hash in similar_items:
                if similar_hash in self.minhash_cache:
                    similarity = minhash.jaccard(self.minhash_cache[similar_hash])
                    if similarity > max_similarity:
                        max_similarity = similarity
                        most_similar_hash = similar_hash
                        
            return max_similarity, most_similar_hash
            
        except Exception as e:
            print(f"Near-duplicate check error: {e}")
            return 0.0, None

    def _store_new_content(self, content_hash: str, normalized_json: str, data: LLMResponse) -> None:
        """Store new unique content"""
        current_time = datetime.utcnow()
        
        # Store exact hash
        self.exact_hashes.add(content_hash)
        self.hash_to_content[content_hash] = normalized_json
        self.hash_to_timestamp[content_hash] = current_time
        
        # Add to LSH if we have a MinHash
        if content_hash in self.minhash_cache:
            try:
                self.lsh.insert(content_hash, self.minhash_cache[content_hash])
            except Exception as e:
                print(f"LSH insertion error: {e}")
                
        # Cleanup if cache is getting too large
        if len(self.exact_hashes) > self.max_cache_size:
            self._cleanup_old_entries()

    def _update_statistics(self, is_exact_duplicate: bool, similarity_score: float) -> None:
        """Update deduplication statistics"""
        self.stats["total_processed"] += 1
        
        if is_exact_duplicate:
            self.stats["exact_matches"] += 1
        elif similarity_score >= self.similarity_threshold:
            self.stats["near_duplicates"] += 1
        else:
            self.stats["unique_items"] += 1

    def _cleanup_old_entries(self) -> None:
        """Remove old entries to prevent memory bloat"""
        current_time = datetime.utcnow()
        
        # Only cleanup if it's been a while since last cleanup
        if current_time - self.stats["last_cleanup"] < self.cleanup_interval:
            return
            
        # Find old entries to remove
        cutoff_time = current_time - timedelta(days=7)  # Keep 7 days
        old_hashes = []
        
        for content_hash, timestamp in self.hash_to_timestamp.items():
            if timestamp < cutoff_time:
                old_hashes.append(content_hash)
                
        # Remove old entries (keep most recent entries)
        if len(old_hashes) > self.max_cache_size // 2:
            # Sort by timestamp and remove oldest half
            old_hashes.sort(key=lambda h: self.hash_to_timestamp[h])
            to_remove = old_hashes[:len(old_hashes) // 2]
            
            for content_hash in to_remove:
                self.exact_hashes.discard(content_hash)
                self.hash_to_content.pop(content_hash, None)
                self.hash_to_timestamp.pop(content_hash, None)
                self.minhash_cache.pop(content_hash, None)
                
        # Reset LSH (expensive but necessary for cleanup)
        self._rebuild_lsh()
        
        self.stats["last_cleanup"] = current_time
        print(f"Cleaned up {len(old_hashes)} old entries from deduplication cache")

    def _rebuild_lsh(self) -> None:
        """Rebuild LSH index with current items"""
        self.lsh = MinHashLSH(threshold=self.lsh_threshold, num_perm=self.lsh_num_perm)
        
        for content_hash, minhash in self.minhash_cache.items():
            if content_hash in self.exact_hashes:  # Only add items that still exist
                try:
                    self.lsh.insert(content_hash, minhash)
                except Exception as e:
                    print(f"LSH rebuild error for {content_hash}: {e}")

    def _log_deduplication_performance(self, duration_ms: float, is_exact: bool, similarity: float) -> None:
        """Log performance metrics for monitoring"""
        # Basic performance logging
        if duration_ms > 100:  # Log slow operations
            print(f"Slow deduplication: {duration_ms:.2f}ms, exact={is_exact}, similarity={similarity:.3f}")

    def get_statistics(self) -> Dict[str, Any]:
        """Get comprehensive deduplication statistics"""
        total = self.stats["total_processed"]
        
        return {
            "total_processed": total,
            "unique_items": self.stats["unique_items"],
            "exact_matches": self.stats["exact_matches"],
            "near_duplicates": self.stats["near_duplicates"],
            
            # Rates
            "duplicate_rate": (self.stats["exact_matches"] + self.stats["near_duplicates"]) / max(total, 1),
            "exact_duplicate_rate": self.stats["exact_matches"] / max(total, 1),
            "near_duplicate_rate": self.stats["near_duplicates"] / max(total, 1),
            
            # Cache status
            "cache_size": len(self.exact_hashes),
            "max_cache_size": self.max_cache_size,
            "cache_utilization": len(self.exact_hashes) / self.max_cache_size,
            
            # LSH status
            "lsh_size": len(self.minhash_cache),
            "lsh_threshold": self.lsh_threshold,
            "similarity_threshold": self.similarity_threshold,
            
            # Timing
            "last_cleanup": self.stats["last_cleanup"].isoformat(),
            "next_cleanup": (self.stats["last_cleanup"] + self.cleanup_interval).isoformat()
        }

    def reset_cache(self) -> None:
        """Reset all caches (useful for testing or fresh start)"""
        self.exact_hashes.clear()
        self.hash_to_content.clear()
        self.hash_to_timestamp.clear()
        self.minhash_cache.clear()
        self.duplicate_clusters.clear()
        
        # Recreate LSH
        self.lsh = MinHashLSH(threshold=self.lsh_threshold, num_perm=self.lsh_num_perm)
        
        # Reset stats
        self.stats = {
            "exact_matches": 0,
            "near_duplicates": 0,
            "unique_items": 0,
            "total_processed": 0,
            "last_cleanup": datetime.utcnow()
        }
        
        print("Deduplication cache reset")

# Global deduplication service instance
deduplication_service = AdvancedDeduplicationService()

# Convenience functions
def check_duplicate(data: LLMResponse, enable_near_duplicate: bool = True) -> DeduplicationInfo:
    """Check for duplicates in LLM response data"""
    return deduplication_service.check_duplicate(data, enable_near_duplicate)

def get_deduplication_stats() -> Dict[str, Any]:
    """Get deduplication statistics"""
    return deduplication_service.get_statistics()

def reset_deduplication_cache() -> None:
    """Reset deduplication cache"""
    deduplication_service.reset_cache()

if __name__ == "__main__":
    # Test deduplication service
    from models.data_collection_schemas import create_sample_data
    
    service = AdvancedDeduplicationService()
    
    # Test with sample data
    sample_data = create_sample_data()
    
    # Check first time (should be unique)
    result1 = service.check_duplicate(sample_data)
    print(f"First check: duplicate={result1.is_duplicate}, similarity={result1.similarity_score}")
    
    # Check second time (should be exact duplicate)
    result2 = service.check_duplicate(sample_data)
    print(f"Second check: duplicate={result2.is_duplicate}, similarity={result2.similarity_score}")
    
    # Check stats
    stats = service.get_statistics()
    print(f"Statistics: {stats}")
    
    print("Deduplication test completed")