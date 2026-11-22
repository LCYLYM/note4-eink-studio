import protocol from '../../shared/protocol.json';
function bad(m:string):never{throw Object.assign(Error(m),{status:400});}
export const digest=async(bytes:BufferSource)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
export function versionTuple(s:string):number[]{if(!/^\d+\.\d+\.\d+$/.test(s))bad('Version must be numeric semver x.y.z');return s.split('.').map(Number);}
export function newer(a:string,b:string){const x=versionTuple(a),y=versionTuple(b);return x.some((v,i)=>v>y[i]&&x.slice(0,i).every((n,j)=>n===y[j]));}
export async function inspectImage(bytes:Uint8Array,metadata:any){
 if(bytes.length<288||bytes.length>protocol.ota_slot_bytes)bad('Application image exceeds slot or is truncated');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(bytes[0]!==0xe9||view.getUint16(12,true)!==9||view.getUint32(32,true)!==0xabcd5432)bad('Expected ESP32-S3 application image, not bootloader/works/merged image');
 let offset=24,checksum=0xef;const segments=bytes[1];if(segments<1||segments>16)bad('Invalid application segment count');for(let i=0;i<segments;i++){if(offset+8>bytes.length)bad('Truncated application segment');const length=view.getUint32(offset+4,true);offset+=8;if(length>bytes.length-offset)bad('Truncated application payload');for(let n=offset;n<offset+length;n++)checksum^=bytes[n];offset+=length;}const checksumAt=offset|15;if(checksumAt>=bytes.length||bytes[checksumAt]!==checksum)bad('Application checksum invalid');const hasHash=bytes[23]===1,expectedLength=checksumAt+1+(hasHash?32:0);if(bytes.length!==expectedLength)bad('Unexpected app trailing data or missing image digest');if(hasHash){const embedded=Array.from(bytes.subarray(checksumAt+1)).map(x=>x.toString(16).padStart(2,'0')).join('');if(await digest(bytes.subarray(0,checksumAt+1))!==embedded)bad('Application embedded digest invalid');}
 const projectName=new TextDecoder().decode(bytes.subarray(80,112)).split('\0')[0];if(projectName!=='note4_joint')bad('Expected NOTE4 application project');
 const version=new TextDecoder().decode(bytes.subarray(48,80)).split('\0')[0];versionTuple(version);
 if(metadata.version!==version||metadata.model!==protocol.device_model||metadata.layout!==protocol.partition_layout||metadata.abi!==protocol.template_abi)bad('Release metadata/image version or model/layout/ABI mismatch');
 const sha256=await digest(bytes);if(metadata.sha256&&metadata.sha256!==sha256)bad('Image SHA256 mismatch');if(metadata.byte_length&&metadata.byte_length!==bytes.length)bad('Image length mismatch');
 return {version,model:protocol.device_model,layout:protocol.partition_layout,abi:protocol.template_abi,byte_length:bytes.length,sha256};
}
