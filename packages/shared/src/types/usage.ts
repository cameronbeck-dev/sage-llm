export interface DailySpend {
  date: string
  costUsd: number
}

export interface ProviderModelSpend {
  provider: string
  model: string
  costUsd: number
  messageCount: number
}

export interface ConversationSpend {
  conversationId: string
  title: string
  costUsd: number
  messageCount: number
}

export interface ToolUsageCounts {
  web_search: { count: number }
  web_fetch: { count: number }
}

export interface UsageReport {
  byDay: DailySpend[]
  byProviderModel: ProviderModelSpend[]
  topConversations: ConversationSpend[]
  totalUsd: number
  periodStart: string
  periodEnd: string
  toolUsage?: ToolUsageCounts
}

export interface BudgetSettings {
  monthlyBudgetUsd: number | null
}
