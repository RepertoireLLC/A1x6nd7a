const REQUEST_TIMEOUT_MS = 4500;
const PLANNER_OVERALL_TIMEOUT_MS = 5000;
const RUNTIME_WAIT_MS = 2000;
const RUNTIME_POLL_INTERVAL_MS = 120;
const PRIMARY_MODELS = ['gpt-5', 'gpt-5-mini', 'gpt-4o'];
const DEFAULT_API_ORIGIN = 'https://api.puter.com';

let attemptedApiSignIn = false;

function getRuntime() {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.puter ?? null;
}

async function waitForRuntime() {
  const start = Date.now();
  while (Date.now() - start < RUNTIME_WAIT_MS) {
    const runtime = getRuntime();
    if (runtime) {
      return runtime;
    }
    await new Promise((resolve) => setTimeout(resolve, RUNTIME_POLL_INTERVAL_MS));
  }
  return getRuntime();
}

function normalizeConfidence(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 0 && value <= 1) return value;
    if (value > 1 && value <= 100) return value / 100;
    return undefined;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return normalizeConfidence(parsed);
    }
  }
  return undefined;
}

function coerceResponseText(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value;
  if (typeof candidate.text === 'string') {
    return candidate.text;
  }
  if (typeof candidate.output === 'string') {
    return candidate.output;
  }
  if (candidate.message && typeof candidate.message === 'object') {
    const message = candidate.message;
    if (typeof message.content === 'string') {
      return message.content;
    }
    if (Array.isArray(message.content)) {
      return message.content
        .map((part) => {
          if (typeof part === 'string') return part;
          if (part && typeof part === 'object' && typeof part.text === 'string') {
            return part.text;
          }
          return '';
        })
        .join('');
    }
  }
  if (Array.isArray(candidate.choices)) {
    const [first] = candidate.choices;
    if (first) {
      if (typeof first.text === 'string') {
        return first.text;
      }
      if (first.message && typeof first.message === 'object') {
        const inner = first.message;
        if (typeof inner.content === 'string') {
          return inner.content;
        }
        if (Array.isArray(inner.content)) {
          return inner.content
            .map((part) => {
              if (typeof part === 'string') return part;
              if (part && typeof part === 'object' && typeof part.text === 'string') {
                return part.text;
              }
              return '';
            })
            .join('');
        }
      }
    }
  }
  return null;
}

function hasAuthToken(runtime) {
  return typeof runtime?.authToken === 'string' && runtime.authToken.trim().length > 0;
}

function isPromiseLike(value) {
  return value && typeof value === 'object' && typeof value.then === 'function';
}

async function checkSignedIn(runtime) {
  if (hasAuthToken(runtime)) {
    return true;
  }

  const auth = runtime?.auth;
  if (!auth || typeof auth.isSignedIn !== 'function') {
    return false;
  }

  try {
    const result = auth.isSignedIn();
    if (typeof result === 'boolean') {
      return result;
    }
    if (isPromiseLike(result)) {
      return await result;
    }
  } catch (error) {
    console.warn('Unable to determine Puter auth state', error);
  }

  return false;
}

async function ensureApiAccess(runtime) {
  if (hasAuthToken(runtime)) {
    return runtime;
  }

  const signedIn = await checkSignedIn(runtime);
  if (signedIn && hasAuthToken(runtime)) {
    return runtime;
  }

  if (attemptedApiSignIn) {
    return runtime;
  }

  attemptedApiSignIn = true;

  if (runtime?.auth && typeof runtime.auth.signIn === 'function') {
    try {
      await runtime.auth.signIn({ attempt_temp_user_creation: true });
    } catch (error) {
      console.warn('Puter sign-in prompt was dismissed or failed', error);
    }
  }

  return runtime;
}

function extractJsonCandidate(payload) {
  const startIndex = payload.indexOf('{');
  const endIndex = payload.lastIndexOf('}');
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return null;
  }
  const snippet = payload.slice(startIndex, endIndex + 1);
  try {
    return JSON.parse(snippet);
  } catch (error) {
    console.warn('AI planner returned non-JSON payload', error, { snippet });
    return null;
  }
}

function buildPlanFromPayload(source, model, payload) {
  const optimizedCandidate =
    typeof payload.optimized_query === 'string' && payload.optimized_query.trim()
      ? payload.optimized_query.trim()
      : typeof payload.optimizedQuery === 'string' && payload.optimizedQuery.trim()
      ? payload.optimizedQuery.trim()
      : typeof payload.search_query === 'string' && payload.search_query.trim()
      ? payload.search_query.trim()
      : typeof payload.query === 'string' && payload.query.trim()
      ? payload.query.trim()
      : source;

  const keywordSource = Array.isArray(payload.keywords)
    ? payload.keywords
    : Array.isArray(payload.terms)
    ? payload.terms
    : Array.isArray(payload.focus_terms)
    ? payload.focus_terms
    : [];

  const keywords = [];
  if (Array.isArray(keywordSource)) {
    const seen = new Set();
    for (const entry of keywordSource) {
      if (typeof entry !== 'string') continue;
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const normalized = trimmed.toLowerCase();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      keywords.push(trimmed);
      if (keywords.length >= 8) break;
    }
  }

  const rationale =
    typeof payload.rationale === 'string' && payload.rationale.trim()
      ? payload.rationale.trim()
      : typeof payload.reason === 'string' && payload.reason.trim()
      ? payload.reason.trim()
      : undefined;

  const confidence = normalizeConfidence(
    payload.confidence ?? payload.score ?? payload.certainty ?? payload.probability
  );

  const modelName =
    typeof payload.model === 'string' && payload.model.trim() ? payload.model.trim() : model;

  if (!optimizedCandidate) {
    return null;
  }

  return {
    source,
    optimizedQuery: optimizedCandidate,
    keywords,
    rationale,
    model: modelName,
    confidence,
  };
}

function buildPlannerPrompt(query) {
  return [
    'You are the Alexandria Browser query planner.',
    'Convert the user request into an Internet Archive advancedsearch query.',
    'Respond with STRICT JSON using this schema:',
    '{"optimized_query":"...","keywords":["..."],"rationale":"...","confidence":0.8}',
    'Guidelines:',
    '- Use no more than 6 focus terms in optimized_query.',
    '- keywords must be 2-8 short phrases without extra punctuation.',
    '- rationale is a brief explanation.',
    '- confidence is a number between 0 and 1.',
    '- If the request is already a good query, reuse it.',
    '- Output JSON only—no commentary.',
    `User request: ${query}`,
  ].join('\n');
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('AI planner request timed out'));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function invokeModel(runtime, prompt, model) {
  if (runtime.ai && typeof runtime.ai.chat === 'function') {
    try {
      const response = await withTimeout(
        runtime.ai.chat(prompt, {
          model,
          temperature: 0.2,
          max_tokens: 220,
        }),
        REQUEST_TIMEOUT_MS
      );
      const coerced = coerceResponseText(response);
      if (coerced) {
        return coerced;
      }
    } catch (error) {
      console.warn(`AI planner chat call failed for model ${model}`, error);
    }
  }

  if (runtime.drivers && typeof runtime.drivers.call === 'function') {
    try {
      const response = await withTimeout(
        runtime.drivers.call('puter-chat-completion', 'ai-chat', 'complete', {
          messages: [{ content: prompt }],
          model,
          temperature: 0.2,
          max_tokens: 220,
        }),
        REQUEST_TIMEOUT_MS
      );
      const coerced = coerceResponseText(response);
      if (coerced) {
        return coerced;
      }
    } catch (error) {
      console.warn(`AI planner driver call failed for model ${model}`, error);
    }
  }

  const authToken = runtime?.authToken?.trim();
  const apiOrigin = runtime?.APIOrigin?.trim() || DEFAULT_API_ORIGIN;
  if (authToken) {
    try {
      // Fallback to the documented drivers/call API used in HeyPuter/puter.
      const response = await withTimeout(
        fetch(`${apiOrigin}/drivers/call`, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain;actually=json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            interface: 'puter-chat-completion',
            service: 'ai-chat',
            method: 'complete',
            args: {
              messages: [{ content: prompt }],
              model,
              temperature: 0.2,
              max_tokens: 220,
            },
          }),
        }),
        REQUEST_TIMEOUT_MS
      );

      if (!response.ok) {
        console.warn(`AI planner direct API call failed for model ${model}`, {
          status: response.status,
          statusText: response.statusText,
        });
      } else {
        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          const payload = await response.json();
          const candidate =
            payload && typeof payload === 'object' && 'result' in payload
              ? payload.result
              : payload;
          const coerced = coerceResponseText(candidate);
          if (coerced) {
            return coerced;
          }
          try {
            return JSON.stringify(candidate);
          } catch (jsonError) {
            console.warn('Unable to serialise Puter driver response', jsonError, {
              candidate,
            });
          }
        } else {
          const text = await response.text();
          const extracted = extractJsonCandidate(text);
          if (extracted) {
            return JSON.stringify(extracted);
          }
        }
      }
    } catch (error) {
      console.warn(`AI planner API fetch failed for model ${model}`, error);
    }
  }

  return null;
}

async function attemptPlan(runtime, sourceQuery, prompt, model) {
  const text = await invokeModel(runtime, prompt, model);
  if (!text) {
    return null;
  }

  const payload = extractJsonCandidate(text);
  if (!payload) {
    return null;
  }

  return buildPlanFromPayload(sourceQuery, model, payload);
}

export function isPuterReady() {
  const runtime = getRuntime();
  return Boolean(
    runtime &&
      ((runtime.ai && typeof runtime.ai.chat === 'function') ||
        (runtime.drivers && typeof runtime.drivers.call === 'function'))
  );
}

export async function planArchiveQuery(query) {
  const trimmed = typeof query === 'string' ? query.trim() : '';
  if (!trimmed) {
    return null;
  }

  const runtime = getRuntime() ?? (await waitForRuntime());
  if (!runtime) {
    return null;
  }

  const hasChat = runtime.ai && typeof runtime.ai.chat === 'function';
  const hasDriver = runtime.drivers && typeof runtime.drivers.call === 'function';
  if (!hasChat && !hasDriver) {
    return null;
  }

  await ensureApiAccess(runtime);

  const prompt = buildPlannerPrompt(trimmed);

  const attempts = PRIMARY_MODELS.map((model) =>
    attemptPlan(runtime, trimmed, prompt, model).catch((error) => {
      console.warn(`AI planner attempt failed for model ${model}`, error);
      return null;
    })
  );

  const aggregatedPromise = new Promise((resolve) => {
    if (!attempts.length) {
      resolve(null);
      return;
    }

    let settled = false;
    let remaining = attempts.length;

    attempts.forEach((attempt) => {
      attempt
        .then((plan) => {
          if (settled) {
            return;
          }

          if (plan) {
            settled = true;
            resolve(plan);
            return;
          }
        })
        .finally(() => {
          remaining -= 1;

          if (!settled && remaining === 0) {
            settled = true;
            resolve(null);
          }
        });
    });
  });

  try {
    return await withTimeout(aggregatedPromise, PLANNER_OVERALL_TIMEOUT_MS);
  } catch (error) {
    console.warn('AI planner overall timeout', error);
    return null;
  }
}
