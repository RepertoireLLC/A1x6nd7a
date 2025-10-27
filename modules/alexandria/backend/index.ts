export * from './internetArchiveService';
export * from './routes';

export interface AlexandriaModuleConfig {
  enabled: boolean;
}

export function isAlexandriaEnabled(config?: AlexandriaModuleConfig): boolean {
  if (!config) {
    return false;
  }

  return Boolean(config.enabled);
}
