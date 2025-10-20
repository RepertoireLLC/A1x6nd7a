declare module "http" {
  interface IncomingMessage {
    method?: string;
    url?: string;
    headers?: Record<string, string | string[] | undefined>;
    on(event: "data", listener: (chunk: unknown) => void): this;
    on(event: "end", listener: () => void): this;
    on(event: "error", listener: (error: unknown) => void): this;
  }

  interface ServerResponse {
    statusCode: number;
    setHeader(name: string, value: string): void;
    end(data?: unknown): void;
  }

  interface Server {
    listen(port: number, callback?: () => void): void;
  }

  type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

  function createServer(handler: RequestHandler): Server;

  export { IncomingMessage, ServerResponse, Server, createServer };
  export default { createServer };
}
