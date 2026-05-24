import type { ToolSchema } from '../providers/types.js';
import { webSearch } from './webSearch.js';
import { webFetch } from './webFetch.js';

export interface ToolExecutionContext {
  userId: string;
  conversationId: string;
}

export type ToolResult = { ok: true; data: unknown } | { ok: false; error: string };

export interface Tool {
  name: string;
  description: string;
  inputSchema: object;
  execute(input: unknown, ctx: ToolExecutionContext): Promise<ToolResult>;
}

export function getAllTools(): Tool[] {
  return [webSearch, webFetch];
}

export function getToolSchemas(): ToolSchema[] {
  return getAllTools().map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

export function getToolByName(name: string): Tool | undefined {
  return getAllTools().find((t) => t.name === name);
}
