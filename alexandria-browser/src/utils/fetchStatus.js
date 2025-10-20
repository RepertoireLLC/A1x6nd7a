const DEFAULT_TIMEOUT = 4000;

/**
 * Performs reachability checks while avoiding console noise from blocked requests.
 * @param {string} url
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<'online'|'offline'|'unknown'>}
 */
export async function checkUrlStatus(url, options = {}) {
  if (!url) {
    return 'unknown';
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const fetchWithMode = async (method, mode) => {
    const response = await fetch(url, { method, mode, signal: controller.signal });
    if (mode === 'no-cors' && response.status === 0) {
      return 'unknown'; // ADD: Treat opaque responses as unknown because their status cannot be inspected.
    }
    return response.ok ? 'online' : 'offline';
  };

  try {
    return await fetchWithMode('HEAD', 'cors'); // FIX: Prefer a proper HEAD request first so successful servers return immediately.
  } catch (error) {
    if (error.name === 'AbortError') {
      return 'unknown'; // FIX: Respect timeouts by reporting an unknown status instead of throwing.
    }
    try {
      return await fetchWithMode('GET', 'cors'); // ADD: Retry with a CORS GET for servers that block HEAD requests.
    } catch (innerError) {
      if (innerError.name === 'AbortError') {
        return 'unknown';
      }
      try {
        return await fetchWithMode('GET', 'no-cors'); // ADD: Fall back to an opaque request to at least detect reachability.
      } catch (finalError) {
        if (finalError.name === 'AbortError') {
          return 'unknown';
        }
        return 'offline'; // FIX: If every attempt fails, report the resource as offline instead of crashing.
      }
    }
  } finally {
    clearTimeout(timer);
  }
}
