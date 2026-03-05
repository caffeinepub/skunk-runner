import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { useInflationData } from "../hooks/useInflationData";
import { PRODUCT_CATEGORIES } from "../lib/categories";
import { UK_REGIONS } from "../lib/regions";

interface ComparisonResultsProps {
  currentRegion: string;
  comparisonRegion: string;
  category: string;
}

export function ComparisonResults({
  currentRegion,
  comparisonRegion,
  category,
}: ComparisonResultsProps) {
  const {
    data: currentData,
    isLoading: currentLoading,
    error: currentError,
  } = useInflationData(currentRegion, category);

  const {
    data: comparisonData,
    isLoading: comparisonLoading,
    error: comparisonError,
  } = useInflationData(comparisonRegion, category);

  const isLoading = currentLoading || comparisonLoading;
  const hasError = currentError || comparisonError;

  const currentRegionName =
    UK_REGIONS.find((r) => r.id === currentRegion)?.name || currentRegion;
  const comparisonRegionName =
    UK_REGIONS.find((r) => r.id === comparisonRegion)?.name || comparisonRegion;
  const categoryName =
    PRODUCT_CATEGORIES.find((c) => c.id === category)?.name || category;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }

  if (hasError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          {currentError?.message ||
            comparisonError?.message ||
            "Failed to load inflation data"}
        </AlertDescription>
      </Alert>
    );
  }

  const getInflationIcon = (value: number) => {
    if (value > 0.5) return <TrendingUp className="h-5 w-5" />;
    if (value < -0.5) return <TrendingDown className="h-5 w-5" />;
    return <Minus className="h-5 w-5" />;
  };

  const getInflationColor = (value: number) => {
    if (value > 0.5) return "text-destructive";
    if (value < -0.5) return "text-chart-2";
    return "text-muted-foreground";
  };

  const getInflationLabel = (value: number) => {
    if (value > 0.5) return "Inflation";
    if (value < -0.5) return "Deflation";
    return "Stable";
  };

  const difference =
    currentData && comparisonData ? currentData - comparisonData : 0;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">{categoryName}</h2>
        <p className="text-sm text-muted-foreground">
          Annual inflation rate comparison
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Current Region Card */}
        <Card className="border-2">
          <CardHeader>
            <CardTitle className="text-lg">{currentRegionName}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Inflation Rate
                </span>
                <div
                  className={`flex items-center gap-2 ${getInflationColor(currentData || 0)}`}
                >
                  {getInflationIcon(currentData || 0)}
                  <span className="text-3xl font-bold">
                    {currentData !== null && currentData !== undefined
                      ? `${currentData > 0 ? "+" : ""}${currentData.toFixed(2)}%`
                      : "N/A"}
                  </span>
                </div>
              </div>
              <div className="pt-2 border-t border-border">
                <span
                  className={`text-sm font-medium ${getInflationColor(currentData || 0)}`}
                >
                  {getInflationLabel(currentData || 0)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Comparison Region Card */}
        <Card className="border-2">
          <CardHeader>
            <CardTitle className="text-lg">{comparisonRegionName}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Inflation Rate
                </span>
                <div
                  className={`flex items-center gap-2 ${getInflationColor(comparisonData || 0)}`}
                >
                  {getInflationIcon(comparisonData || 0)}
                  <span className="text-3xl font-bold">
                    {comparisonData !== null && comparisonData !== undefined
                      ? `${comparisonData > 0 ? "+" : ""}${comparisonData.toFixed(2)}%`
                      : "N/A"}
                  </span>
                </div>
              </div>
              <div className="pt-2 border-t border-border">
                <span
                  className={`text-sm font-medium ${getInflationColor(comparisonData || 0)}`}
                >
                  {getInflationLabel(comparisonData || 0)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Difference Summary */}
      <Card className="bg-accent/50">
        <CardContent className="pt-6">
          <div className="text-center space-y-2">
            <p className="text-sm text-muted-foreground">Difference</p>
            <p className="text-2xl font-bold">
              {difference > 0 ? "+" : ""}
              {difference.toFixed(2)}%
            </p>
            <p className="text-sm text-muted-foreground">
              {Math.abs(difference) < 0.1
                ? "Both regions have similar inflation rates"
                : difference > 0
                  ? `${currentRegionName} has higher inflation than ${comparisonRegionName}`
                  : `${comparisonRegionName} has higher inflation than ${currentRegionName}`}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
