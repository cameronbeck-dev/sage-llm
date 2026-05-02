export type ProviderId = 'openai' | 'anthropic' | 'minimax';

export interface ModelInfo {
  id: string;
  displayName: string;
  contextWindow?: number;
  inputCostPer1k?: number;
  outputCostPer1k?: number;
}

export interface ProviderInfo {
  id: ProviderId;
  displayName: string;
  models: ModelInfo[];
}
