import {Inflate} from 'pako';
import {decode} from 'fast-png';
/** Bound decompression before entering the general PNG decoder. Ancillary metadata is omitted. */
export function decodePanelPng(buf:Uint8Array){
 if(buf.length<33||buf.length>250000)throw Error('PNG size is invalid');const view=new DataView(buf.buffer,buf.byteOffset,buf.byteLength);
 const width=view.getUint32(16),height=view.getUint32(20),channels=({0:1,2:3,4:2,6:4} as Record<number,number>)[buf[25]];
 if(view.getUint32(0)!==0x89504e47||view.getUint32(4)!==0x0d0a1a0a||view.getUint32(8)!==13||view.getUint32(12)!==0x49484452||!width||!height||width>400||height>300||buf[24]!==8||!channels||buf[28]!==0)throw Error('PNG must be <=400x300, noninterlaced 8-bit RGB/RGBA/gray before decoding');
 const parts=[buf.subarray(0,8)],compressed=[];let end=false,count=0,ihdr=0;
 for(let offset=8;offset<buf.length;){if(++count>128||offset+12>buf.length)throw Error('PNG chunk limit');const n=view.getUint32(offset);if(offset+n+12>buf.length)throw Error('PNG chunk exceeds input');const type=String.fromCharCode(...buf.subarray(offset+4,offset+8));if(type==='IHDR'&&++ihdr!==1)throw Error('Duplicate PNG header');if(['IHDR','IDAT','IEND','tRNS'].includes(type))parts.push(buf.subarray(offset,offset+n+12));if(type==='IDAT')compressed.push(buf.subarray(offset+8,offset+8+n));offset+=n+12;if(type==='IEND'){end=true;break;}}
 if(!end||!compressed.length)throw Error('Incomplete PNG');const expected=height*(width*channels+1);let expanded=0;const inflate=new Inflate({chunkSize:16384});inflate.onData=chunk=>{expanded+=chunk.length;if(expanded>expected)throw Error('PNG expands beyond its pixel buffer');};for(let i=0;i<compressed.length;i++)inflate.push(compressed[i],i===compressed.length-1);if(inflate.err||expanded!==expected)throw Error('PNG decompressed size mismatch');
 const clean=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const part of parts){clean.set(part,offset);offset+=part.length;}return decode(clean,{checkCrc:true});
}
