import {parentPort} from 'node:worker_threads';
import {runCheckDirect} from './vm-check';

parentPort?.on('message', async (msg: {id: number; spec: any; mockNet?: any}) => {
  try {
    const value = await runCheckDirect(msg.spec, msg.mockNet);
    parentPort?.postMessage({id: msg.id, ok: true, value});
  } catch (e: any) {
    parentPort?.postMessage({id: msg.id, ok: false, error: String(e?.message ?? e)});
  }
});
