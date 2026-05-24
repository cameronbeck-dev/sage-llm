import { Agent, fetch as undiciFetch } from 'undici';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { assertSafeUrl } from './ssrfGuard.js';
import { config } from '../config.js';
import type { Tool, ToolResult, ToolExecutionContext } from './registry.js';

interface WebFetchInput {
  url: string;
}

export const webFetch: Tool = {
  name: 'web_fetch',
  description: 'Fetch a specific URL and return its main textual content. Extracts readable article text from HTML using Readability. Use after web_search to get more detail from a specific result.',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch. Must be http or https.',
      },
    },
    required: ['url'],
  },

  async execute(input: unknown, _ctx: ToolExecutionContext): Promise<ToolResult> {
    const { url: rawUrl } = input as WebFetchInput;

    let safeUrl: Awaited<ReturnType<typeof assertSafeUrl>>;
    try {
      safeUrl = await assertSafeUrl(rawUrl);
    } catch (e) {
      const err = e as { error?: string };
      return { ok: false, error: err.error ?? 'blocked: unknown' };
    }

    const { url, pinnedIp, family } = safeUrl;

    const agent = new Agent({
      connect: {
        lookup: (_hostname, opts, cb) => {
          if (opts && (opts as { all?: boolean }).all) {
            (cb as unknown as (err: Error | null, addresses: Array<{ address: string; family: number }>) => void)(
              null,
              [{ address: pinnedIp, family }],
            );
          } else {
            cb(null, pinnedIp, family);
          }
        },
      },
    });

    let res: Response;
    try {
      res = await undiciFetch(url.toString(), {
        dispatcher: agent,
        redirect: 'manual',
        signal: AbortSignal.timeout(config.WEB_FETCH_TIMEOUT_MS),
        headers: { 'User-Agent': config.WEB_FETCH_USER_AGENT },
      }) as unknown as Response;
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }

    const status = res.status;

    if (status >= 300 && status < 400) {
      const location = (res.headers as unknown as { get(k: string): string | null }).get('location') ?? '';
      return {
        ok: true,
        data: { redirect: true, location, status, hint: 'call web_fetch again with the new URL' },
      };
    }

    if (status >= 400) {
      return { ok: false, error: 'http_error', ...{ status } };
    }

    const contentType = ((res.headers as unknown as { get(k: string): string | null }).get('content-type') ?? '').toLowerCase();
    const maxBytes = config.WEB_FETCH_MAX_BYTES;

    let bodyText = '';
    let bytesRead = 0;
    const body = res.body as unknown as AsyncIterable<Uint8Array>;
    if (body) {
      const decoder = new TextDecoder();
      for await (const chunk of body) {
        bytesRead += chunk.length;
        bodyText += decoder.decode(chunk, { stream: true });
        if (bytesRead > maxBytes) break;
      }
    }

    const isHtml = contentType.includes('text/html') || contentType.includes('application/xhtml');

    if (isHtml) {
      const dom = new JSDOM(bodyText, { url: url.toString() });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();

      if (article) {
        return {
          ok: true,
          data: {
            url: url.toString(),
            status,
            title: article.title,
            byline: article.byline,
            excerpt: article.excerpt,
            content_text: article.textContent,
          },
        };
      }

      const fallback = dom.window.document.body?.textContent?.slice(0, 50000) ?? '';
      return {
        ok: true,
        data: { url: url.toString(), status, content_text: fallback },
      };
    }

    return {
      ok: true,
      data: {
        url: url.toString(),
        status,
        content_type: contentType,
        text: bodyText.slice(0, 50000),
      },
    };
  },
};
