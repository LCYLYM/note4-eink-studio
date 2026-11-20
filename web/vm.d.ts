export interface Note4NetReq {
  key: string;
  url: string;
  method: string;
  headers: string;
  body: string;
  keep: boolean;
  gen: number;
}

export declare class Note4Vm {
  netQueue: Note4NetReq[];
  gen: number;
  onFrame?: (index: number, target: Uint8Array) => void;
  onNet?: (req: Note4NetReq) => void;
  static create(wasm: Uint8Array | WebAssembly.Module, font: Uint8Array, tickLimit?: number, aaFont?: Uint8Array): Promise<Note4Vm>;
  start(source: string, store?: Record<string, string>, fast?: boolean | string | number, frames?: number): number;
  tick(): number;
  tickMs(): number;
  net(key: string, status: number, body?: string): number;
  key(k: string): number;
  log(): string;
  clearLog(): void;
  oob(): {count: number; x: number; y: number};
  layout(): {minX: number; minY: number; maxX: number; maxY: number; issues: {code: number; x: number; y: number; detail: number}[]} | null;
  dirty(): boolean;
  pixels(fast: boolean): Uint8Array;
  store(): Record<string, string>;
  ticks(): number;
}
