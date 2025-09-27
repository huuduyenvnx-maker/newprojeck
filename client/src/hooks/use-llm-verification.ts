import { useQuery } from "@tanstack/react-query";
import type { LlmVerification } from "@/types/forecast";

export function useLlmVerifications(forecastId?: string) {
  return useQuery<LlmVerification[]>({
    queryKey: ["/api/verifications", forecastId],
    enabled: !!forecastId,
  });
}

export function calculateCCS(verifications: LlmVerification[]): number {
  if (!verifications || verifications.length === 0) return 0;
  
  const validVerifications = verifications.filter(v => v.verified);
  if (validVerifications.length === 0) return 0;
  
  // Calculate weighted average based on provider reliability
  const weights = { openai: 0.6, gemini: 0.4 };
  let totalWeight = 0;
  let weightedSum = 0;
  
  validVerifications.forEach(v => {
    const weight = weights[v.provider as keyof typeof weights] || 0.5;
    const confidence = parseFloat(v.confidence);
    weightedSum += confidence * weight;
    totalWeight += weight;
  });
  
  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

export function getConfidenceLevel(ccs: number): string {
  if (ccs >= 0.8) return "High";
  if (ccs >= 0.6) return "Medium";
  return "Low";
}

export function getConfidenceColor(ccs: number): string {
  if (ccs >= 0.8) return "text-green-600";
  if (ccs >= 0.6) return "text-amber-600";
  return "text-red-600";
}
