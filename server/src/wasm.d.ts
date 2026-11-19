declare module '*.wasm' {const value:Uint8Array;export default value;}
declare module '@jitl/quickjs-wasmfile-release-asyncify/wasm' {const value:WebAssembly.Module;export default value;}
declare module 'node:fs' {export function readFileSync(path:string):Uint8Array;export function existsSync(path:string):boolean;}
declare const process:{cwd():string;env:Record<string,string|undefined>;};
