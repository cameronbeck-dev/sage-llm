import { config } from '../config.js';
import type { Tool, ToolResult, ToolExecutionContext } from './registry.js';

interface WebSearchInput {
  query: string;
  max_results?: number;
}

interface SearXNGResult {
  title: string;
  url: string;
  content?: string;
  engine?: string;
}

interface SearXNGResponse {
  results?: SearXNGResult[];
}

export const webSearch: Tool = {
  name: 'web_search',
  description: 'Search the web for a query. Returns a list of results with titles, URLs, and snippets. Use for current events, recent news, or facts you are uncertain about.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query.',
        minLength: 1,
        maxLength: 400,
      },
      max_results: {
        type: 'number',
        description: 'Maximum number of results to return (1–10). Default: 5.',
        minimum: 1,
        maximum: 10,
        default: 5,
      },
    },
    required: ['query'],
  },

  async execute(input: unknown, _ctx: ToolExecutionContext): Promise<ToolResult> {
    const { query, max_results } = input as WebSearchInput;
    const limit = Math.min(Math.max(max_results ?? 5, 1), 10);

    try {
      const url = `${config.SEARXNG_URL}/search?q=${encodeURIComponent(query)}&format=json&safesearch=1`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return { ok: false, error: 'search_unavailable' };
      const json = (await res.json()) as SearXNGResponse;
      const results = (json.results ?? []).slice(0, limit).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content ?? '',
        engine: r.engine,
      }));
      return { ok: true, data: { results } };
    } catch {
      return { ok: false, error: 'search_unavailable' };
    }
  },
};
