import type { AlexandriaSearchResponse, WaybackAvailability } from './internetArchiveService';
import { searchArchive, checkWaybackStatus } from './internetArchiveService';

export interface MinimalHttpResponse {
  json: (body: unknown) => void;
  status?: (code: number) => MinimalHttpResponse;
  setHeader?: (name: string, value: string) => void;
  end?: (body?: string) => void;
}

export interface MinimalHttpRequest {
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
}

export type MinimalHandler = (req: MinimalHttpRequest, res: MinimalHttpResponse) => Promise<void> | void;

export interface AlexandriaRouterOptions {
  enabled: boolean;
  transformQuery?: (raw: unknown) => { query?: string; page?: number; rows?: number; url?: string };
}

export interface AlexandriaRouteHandles {
  search: MinimalHandler;
  status: MinimalHandler;
}

function sendJson(res: MinimalHttpResponse, statusCode: number, payload: unknown) {
  if (typeof res.status === 'function') {
    res.status(statusCode).json(payload);
    return;
  }

  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/json');
  }

  if (typeof res.json === 'function') {
    res.json(payload);
    return;
  }

  if (typeof res.end === 'function') {
    res.end(JSON.stringify(payload));
  }
}

export function createAlexandriaRouteHandlers(options: AlexandriaRouterOptions): AlexandriaRouteHandles {
  const { enabled } = options;

  const disabledResponse = {
    error: 'Alexandria module is disabled',
  } as const;

  const normalizeSearchParams = (request: MinimalHttpRequest) => {
    if (typeof options.transformQuery === 'function') {
      return options.transformQuery(request.query ?? request.body);
    }

    const source = request.query ?? {};
    const query = typeof source.query === 'string' ? source.query : '';
    const page = typeof source.page === 'string' ? parseInt(source.page, 10) : undefined;
    const rows = typeof source.rows === 'string' ? parseInt(source.rows, 10) : undefined;

    return { query, page, rows };
  };

  const normalizeStatusParams = (request: MinimalHttpRequest) => {
    if (typeof options.transformQuery === 'function') {
      return options.transformQuery(request.query ?? request.body);
    }

    const source = request.query ?? {};
    const url = typeof source.url === 'string' ? source.url : '';
    return { url };
  };

  const search: MinimalHandler = async (req, res) => {
    if (!enabled) {
      sendJson(res, 503, disabledResponse);
      return;
    }

    const params = normalizeSearchParams(req);
    const result: AlexandriaSearchResponse = await searchArchive(params.query ?? '', params.page ?? 1, params.rows ?? 20);
    sendJson(res, 200, result);
  };

  const status: MinimalHandler = async (req, res) => {
    if (!enabled) {
      sendJson(res, 503, disabledResponse);
      return;
    }

    const params = normalizeStatusParams(req);
    const result: WaybackAvailability | null = await checkWaybackStatus(params.url ?? '');
    if (!result) {
      sendJson(res, 200, { url: params.url ?? '', archivedSnapshots: {} });
      return;
    }

    sendJson(res, 200, result);
  };

  return { search, status };
}

export interface PluggableRouter {
  get: (path: string, handler: MinimalHandler) => unknown;
}

export function registerAlexandriaRoutes(router: PluggableRouter, options: AlexandriaRouterOptions): AlexandriaRouteHandles {
  const handlers = createAlexandriaRouteHandlers(options);

  if (!options.enabled) {
    return handlers;
  }

  router.get('/api/alexandria/search', handlers.search);
  router.get('/api/alexandria/status', handlers.status);

  return handlers;
}
