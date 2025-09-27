import { calculateCCS } from "@/hooks/use-llm-verification";
import type { Forecast } from "@/types/forecast";

interface EvidencePanelProps {
  forecast?: Forecast;
}

export default function EvidencePanel({ forecast }: EvidencePanelProps) {
  const verifications = forecast?.verifications || [];
  const ccs = calculateCCS(verifications);

  return (
    <div className="bg-card border border-border rounded-lg p-6" data-testid="evidence-panel">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-foreground">Evidence Panel</h3>
        <div className="evidence-badge">
          <i className="fas fa-microscope mr-1"></i>
          {verifications.some(v => v.verified) ? "Verified" : "Pending"}
        </div>
      </div>

      {verifications.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-muted-foreground">No verification data available</p>
        </div>
      ) : (
        <div className="space-y-4">
          {verifications.map((verification) => (
            <div 
              key={verification.id} 
              className="p-4 bg-muted rounded-lg"
              data-testid={`verification-${verification.provider}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2">
                  <i className={
                    verification.provider === "openai" 
                      ? "fas fa-robot text-blue-500" 
                      : "fas fa-star text-purple-500"
                  }></i>
                  <span className="font-medium text-sm">
                    {verification.provider === "openai" ? "OpenAI GPT-5" : "Google Gemini 2.5"}
                  </span>
                </div>
                <span className={`text-xs font-medium ${
                  verification.verified ? "text-green-600" : "text-red-600"
                }`}>
                  {verification.verified ? "✓ Verified" : "✗ Failed"}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mb-2" data-testid={`text-response-${verification.provider}`}>
                {verification.response}
              </p>
              <div className="flex items-center space-x-4 text-xs text-muted-foreground">
                <span>Confidence: {verification.confidence}</span>
                <span>Model: {verification.model}</span>
                <span>Tokens: {verification.metadata?.tokens || "N/A"}</span>
              </div>
            </div>
          ))}

          {/* CCS Summary */}
          <div className="pt-4 border-t border-border">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">Composite Confidence Score</span>
              <span className="ccs-score text-sm" data-testid="text-ccs-summary">
                {ccs.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Data Sources */}
          <div className="mt-4">
            <h4 className="text-sm font-medium text-foreground mb-2">Data Sources</h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm" data-testid="source-agriculture-ministry">
                <span className="text-muted-foreground">VN Agriculture Ministry</span>
                <span className="text-green-600 text-xs">98.2%</span>
              </div>
              <div className="flex items-center justify-between text-sm" data-testid="source-agrotrade-exchange">
                <span className="text-muted-foreground">AgroTrade Exchange</span>
                <span className="text-green-600 text-xs">96.8%</span>
              </div>
              <div className="flex items-center justify-between text-sm" data-testid="source-weather-api">
                <span className="text-muted-foreground">Weather API</span>
                <span className="text-green-600 text-xs">94.5%</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
