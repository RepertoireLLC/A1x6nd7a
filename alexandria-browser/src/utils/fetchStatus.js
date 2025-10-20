const DEFAULT_TIMEOUT = 4000;

/**
 * Performs a HEAD request to determine whether a resource is reachable.
 * Falls back to GET when HEAD is not supported by the remote server.
 * @param {string} url
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<'online'|'offline'|'unknown'>}
 */
export async function checkUrlStatus(url, options = {}) {
  if (!url) return 'unknown';
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const tryRequest = async (method) => {
    try {
      const response = await fetch(url, {
        method,
        signal: controller.signal,
        mode: 'no-cors'
      });
      // When using no-cors the status is 0, treat as unknown but not offline.
      if (response.status === 0) {
        return 'unknown';
      }
      return response.ok ? 'online' : 'offline';
    } catch (error) {
      if (error.name === 'AbortError') {
        return 'unknown';
      }
      if (method === 'HEAD') {
        return tryRequest('GET');
      }
      return 'offline';
    }
  };

  try {
    const result = await tryRequest('HEAD');
    return result;
  } finally {
    clearTimeout(timer);
  }
}
