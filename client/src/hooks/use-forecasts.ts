import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Forecast, Commodity, Region } from "@/types/forecast";

export function useForecasts(commodityId?: string, regionId?: string) {
  return useQuery<Forecast | null>({ // Return single Forecast or null
    queryKey: ["/api/forecasts", commodityId, regionId],
    enabled: !!commodityId && !!regionId,
    // Use specific forecast endpoint that returns array, extract first item
    queryFn: async () => {
      if (!commodityId || !regionId) return null;
      const response = await fetch(`/api/forecasts/${commodityId}/${regionId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch forecast: ${response.status}`);
      }
      const data = await response.json();
      // API returns array of forecasts, return the most recent one
      return Array.isArray(data) && data.length > 0 ? data[0] : null;
    },
  });
}

export function useCommodities() {
  return useQuery<Commodity[]>({
    queryKey: ["/api/commodities"],
  });
}

export function useRegions() {
  return useQuery<Region[]>({
    queryKey: ["/api/regions"],
  });
}

export function useGenerateForecast() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ commodityId, regionId, horizon }: { 
      commodityId: string; 
      regionId: string; 
      horizon?: number; 
    }) => {
      return await apiRequest("/api/forecasts/generate", {
        method: "POST",
        body: {
          commodityId,
          regionId,
          horizon,
        },
      });
    },
    onSuccess: (data, variables) => {
      // Invalidate and refetch forecasts
      queryClient.invalidateQueries({
        queryKey: ["/api/forecasts", variables.commodityId, variables.regionId],
      });
    },
  });
}

export function useLlmVerification() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (forecastId: string) => {
      return await apiRequest(`/api/llm-verification/${forecastId}`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      // Invalidate forecasts to refetch with new verifications
      queryClient.invalidateQueries({
        queryKey: ["/api/forecasts"],
      });
    },
  });
}
