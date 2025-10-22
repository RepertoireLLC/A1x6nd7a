declare module "gpt4all";

declare module "node-llama-cpp" {
  export interface LlamaModelOptions {
    modelPath: string;
  }

  export interface LlamaContextOptions {
    model: LlamaModel;
    contextSize?: number;
  }

  export interface LlamaChatSessionOptions {
    context: LlamaContext;
  }

  export interface LlamaChatPromptOptions {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    stop?: string[];
  }

  export class LlamaModel {
    constructor(options: LlamaModelOptions);
    createContext?(options?: LlamaContextOptions): Promise<LlamaContext>;
    dispose(): Promise<void>;
  }

  export class LlamaContext {
    constructor(options: LlamaContextOptions);
    getSequence?(): unknown;
    dispose(): Promise<void>;
  }

  export class LlamaChatSession {
    constructor(options: LlamaChatSessionOptions);
    prompt(prompt: string, options?: LlamaChatPromptOptions): Promise<string>;
    dispose(): Promise<void>;
  }
}
