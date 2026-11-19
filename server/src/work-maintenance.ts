import {problem} from './accounts';
import {LIMITS} from './budget';
/** Explicit owner actions; never exposed as creator-Agent tools. */
export function cleanupWork(s:any,owner:string,id:string,base:number,confirm:boolean){
 const work=s.work(owner,id);if(work.rev!==base)problem('作品已变化，请重新预览清理',409);
 const builds=s.owned('build',owner).filter((b:any)=>b.work_id===id).sort((a:any,b:any)=>b.rev-a.rev);
 const protectedIds=new Set(builds.slice(0,3).map((b:any)=>b.id));
 for(const d of s.owned('device',owner))if(d.observed?.build_id)protectedIds.add(d.observed.build_id);
 for(const op of s.owned('operation',owner))if(!['failed','cancelled','stopped','completed','duplicate','confirmed','rolled_back'].includes(op.state)&&op.build_id)protectedIds.add(op.build_id);
 const protectedRevisions=new Set([work.rev,...builds.filter((b:any)=>protectedIds.has(b.id)).map((b:any)=>b.rev)]);
 const revisions=s.owned('revision',owner).filter((r:any)=>r.work_id===id).sort((a:any,b:any)=>b.rev-a.rev);
 for(const r of revisions.slice(0,3))protectedRevisions.add(r.rev);
 const oldBuilds=builds.filter((b:any)=>!protectedIds.has(b.id));const oldRevisions=revisions.filter((r:any)=>!protectedRevisions.has(r.rev));
 const result={base_rev:base,keep_recent:3,builds:oldBuilds.length,revisions:oldRevisions.length,bytes_estimate:oldBuilds.reduce((n:number,b:any)=>n+b.byte_length,0)+oldRevisions.reduce((n:number,r:any)=>n+new TextEncoder().encode(JSON.stringify(r)).length,0),protected_builds:protectedIds.size,performed:confirm};
 if(confirm)s.ctx.storage.transactionSync(()=>{for(const b of oldBuilds){s.ctx.storage.sql.exec('DELETE FROM blobs WHERE id=?',b.id);s.ctx.storage.sql.exec("DELETE FROM records WHERE type='build' AND id=?",b.id);}for(const r of oldRevisions)s.ctx.storage.sql.exec("DELETE FROM records WHERE type='revision' AND id=?",r.id);});return result;
}
export function archiveWork(s:any,owner:string,id:string,restore=false){const work=s.work(owner,id);if(restore){if(s.owned('work',owner).filter((w:any)=>!w.archived).length>=LIMITS.works_per_user)problem('先归档其他作品，再恢复',429);work.archived=false;}else{if(s.owned('task',owner).some((t:any)=>t.work_id===id&&['queued','running'].includes(t.state)))problem('请先取消正在进行的创作',409);if(s.hosted.list(owner).some((x:any)=>x.spec.work_id===id&&x.state==='published'))problem('请先暂停这个作品的后台服务',409);work.archived=true;}return s.put('work',work);}
