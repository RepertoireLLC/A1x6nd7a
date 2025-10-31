import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

describe("proxy configuration", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetAllMocks();
  });

  it("respects ALL_PROXY when configuring outbound requests", async () => {
    delete process.env.HTTPS_PROXY;
    delete process.env.https_proxy;
    delete process.env.HTTP_PROXY;
    delete process.env.http_proxy;
    process.env.ALL_PROXY = "http://proxy.example.com:8080";

    const dispatcher = {};
    const setGlobalDispatcher = vi.fn();
    const ProxyAgent = vi.fn(() => dispatcher);

    vi.doMock("undici", () => ({
      ProxyAgent,
      setGlobalDispatcher,
    }));

    await import("../server");

    expect(ProxyAgent).toHaveBeenCalledTimes(1);
    const proxyArg = ProxyAgent.mock.calls[0]?.[0];
    if (typeof proxyArg === "string") {
      expect(proxyArg).toBe("http://proxy.example.com:8080");
    } else {
      expect(proxyArg).toMatchObject({ uri: "http://proxy.example.com:8080" });
    }
    expect(setGlobalDispatcher).toHaveBeenCalledWith(dispatcher);
  });

  it("respects all_proxy when configuring outbound requests", async () => {
    delete process.env.HTTPS_PROXY;
    delete process.env.https_proxy;
    delete process.env.HTTP_PROXY;
    delete process.env.http_proxy;
    delete process.env.ALL_PROXY;
    process.env.all_proxy = "http://proxy.local:3128";

    const dispatcher = {};
    const setGlobalDispatcher = vi.fn();
    const ProxyAgent = vi.fn(() => dispatcher);

    vi.doMock("undici", () => ({
      ProxyAgent,
      setGlobalDispatcher,
    }));

    await import("../server");

    expect(ProxyAgent).toHaveBeenCalledTimes(1);
    const proxyArg = ProxyAgent.mock.calls[0]?.[0];
    if (typeof proxyArg === "string") {
      expect(proxyArg).toBe("http://proxy.local:3128");
    } else {
      expect(proxyArg).toMatchObject({ uri: "http://proxy.local:3128" });
    }
    expect(setGlobalDispatcher).toHaveBeenCalledWith(dispatcher);
  });
});
