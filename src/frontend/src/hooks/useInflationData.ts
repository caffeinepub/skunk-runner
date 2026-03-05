import { useQuery } from "@tanstack/react-query";
import type { InflationSeries } from "../backend";
import { useActor } from "./useActor";

export function useInflationData(region: string, category: string) {
  const { actor, isFetching: actorFetching } = useActor();

  return useQuery<number | null>({
    queryKey: ["inflationData", region, category],
    queryFn: async () => {
      if (!actor) return null;

      try {
        const series: InflationSeries = await actor.getInflationData({
          region,
          category,
        });

        // Get the latest inflation value from the series
        if (series.length === 0) {
          return null;
        }

        // Return the most recent value (last in the series)
        const latestEntry = series[series.length - 1];
        return latestEntry[1];
      } catch (error) {
        console.error("Error fetching inflation data:", error);
        throw error;
      }
    },
    enabled: !!actor && !actorFetching && !!region && !!category,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
