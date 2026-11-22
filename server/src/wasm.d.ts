declare module '*.wasm' {const value:Uint8Array;export default value;}
declare module '@jitl/quickjs-wasmfile-release-asyncify/wasm' {const value:WebAssembly.Module;export default value;}
declare module 'node:fs' {export function readFileSync(path:string):Uint8Array;export function existsSync(path:string):boolean;}
declare module 'node:url' {export function fileURLToPath(url:string|URL):string;}
declare module 'node:worker_threads' {
  export const isMainThread: boolean;
  export const parentPort: {on(ev:string,fn:(m:any)=>void):void;postMessage(m:any):void}|null;
  export class Worker {
    constructor(filename:string|URL,options?:any);
    on(ev:string,fn:(...args:any[])=>void):this;
    off(ev:string,fn:(...args:any[])=>void):this;
    postMessage(value:any):void;
    terminate():Promise<number>;
    ref():void;
    unref():void;
  }
}
interface ImportMeta {url:string;}
declare const process:{cwd():string;env:Record<string,string|undefined>;};
