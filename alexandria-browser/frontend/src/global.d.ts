export {};

declare global {
  interface PuterAiNamespace {
    chat: (input: unknown, options?: Record<string, unknown>) => Promise<unknown>;
    txt2img?: (input: unknown, options?: Record<string, unknown>) => Promise<unknown>;
  }

  interface PuterAuthNamespace {
    isSignedIn?: () => boolean | Promise<boolean>;
    signIn?: (options?: Record<string, unknown>) => Promise<unknown>;
  }

  interface PuterDriversNamespace {
    call?: (
      iface: string,
      serviceOrMethod?: string | Record<string, unknown>,
      maybeMethod?: string | Record<string, unknown>,
      maybeParams?: Record<string, unknown>
    ) => Promise<unknown>;
  }

  interface PuterRuntime {
    ai?: PuterAiNamespace;
    auth?: PuterAuthNamespace;
    drivers?: PuterDriversNamespace;
    authToken?: string | null;
    APIOrigin?: string;
    print?: (value: unknown) => void;
  }

  interface Window {
    puter?: PuterRuntime;
  }
}
