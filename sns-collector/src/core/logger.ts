import type { Platform } from './types';

const PREFIX_MAP: Record<Platform, string> = {
  threads: '[Threads収集]',
  x: '[X収集]',
};

let currentPlatform: Platform = 'threads';

export function setLogPlatform(platform: Platform): void {
  currentPlatform = platform;
}

export function log(...args: unknown[]): void {
  console.log(PREFIX_MAP[currentPlatform], ...args);
}

export function warn(...args: unknown[]): void {
  console.warn(PREFIX_MAP[currentPlatform], ...args);
}

export function error(...args: unknown[]): void {
  console.error(PREFIX_MAP[currentPlatform], ...args);
}
