import {executeSandbox} from './sandbox-pool.mjs';
export const SANDBOX_LIMITS={wall_ms:30000,compute_ms:50,compute_watchdog_ms:60,memory_bytes:16*1024*1024,stack_bytes:256*1024,source_bytes:32768,input_bytes:16384,result_bytes:32768,api_calls:3,ai_calls:1,logs:20};
export type Broker=(method:string,args:any)=>Promise<any>;
export const runSandbox=(source:string,input:any,broker:Broker,signal?:AbortSignal)=>executeSandbox(source,input,broker,signal);
