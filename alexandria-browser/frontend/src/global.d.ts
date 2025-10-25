export {};

declare global {
  interface PuterAiNamespace {
    chat: (input: unknown, options?: Record<string, unknown>) => Promise<unknown>;
    txt2img?: (input: unknown, options?: Record<string, unknown>) => Promise<unknown>;
  }

  interface PuterRuntime {
    ai?: PuterAiNamespace;
    print?: (value: unknown) => void;
  }

  interface Window {
    puter?: PuterRuntime;
  }
}
