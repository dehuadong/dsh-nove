/** Minimal Node ambient types for the pilot; full TS migration can add @types/node. */
declare module 'node:path' {
  export function isAbsolute(path: string): boolean
  export function normalize(path: string): string
  export function resolve(...paths: string[]): string
  export function join(...paths: string[]): string
  export const sep: string
}

declare const process: {
  platform: string
}
