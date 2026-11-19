export function executeSandbox(source:string,input:any,broker:(method:string,args:any)=>Promise<any>,signal?:AbortSignal):Promise<any>;
export function poolStats():{workers:number;active:number;queued:number};
export function closeSandboxPool():Promise<void>;
