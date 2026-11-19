#!/usr/bin/env python3
"""Package actual newly-built app + distinct audited initial-flash manifest. Never flash."""
import argparse,hashlib,json,pathlib,shutil,struct
p=argparse.ArgumentParser();p.add_argument('--build',default='build');p.add_argument('--out',default='artifacts');p.add_argument('--url',required=True,help='Actual authorized same-origin HTTPS app download URL, or explicitly labelled undeployed example');a=p.parse_args()
b=pathlib.Path(a.build);out=pathlib.Path(a.out);out.mkdir(parents=True,exist_ok=True)
app=b/'note4_joint.bin';data=app.read_bytes()
assert data[0]==0xe9 and struct.unpack_from('<H',data,12)[0]==9,'Not ESP32-S3 app image'
assert struct.unpack_from('<I',data,32)[0]==0xabcd5432,'Missing ESP app descriptor'
version=data[48:80].split(b'\0')[0].decode();project=data[80:112].split(b'\0')[0].decode()
assert project=='note4_joint' and len(data)<=0x300000,'Wrong application/slot size'
assert a.url.startswith('https://'),'Verified HTTPS required'
release={'release_id':'note4-'+version,'version':version,'model':'NOTE4-ESP32-S3','layout':'note4-16m-ota-v1','abi':1,'url':a.url,'byte_length':len(data),'sha256':hashlib.sha256(data).hexdigest()}
(out/'ota-release.json').write_text(json.dumps(release,indent=2)+'\n')
initial=[('bootloader/bootloader.bin','bootloader.bin',0x0),('partition_table/partition-table.bin','partition-table.bin',0x8000),('ota_data_initial.bin','ota_data_initial.bin',0xf000),('note4_joint.bin','note4_joint.bin',0x20000),('works.bin','works-initial-only.bin',0x620000)]
entries=[]
for src,dst,address in initial:
 source=b/src;assert source.exists(),f'Missing actual build output {source}'
 shutil.copy2(source,out/dst);entries.append({'file':dst,'address':hex(address),'bytes':source.stat().st_size})
for suffix in ['elf','map']:shutil.copy2(b/f'note4_joint.{suffix}',out/f'note4_joint.{suffix}')
manifest={'purpose':'INITIAL INSTALL ONLY — local audit/backup required; NOT an OTA payload','model':release['model'],'layout':release['layout'],'flash_bytes':0x1000000,'application_version':version,'files':entries,'preserved_by_ordinary_ota':['NVS credentials and identity','works and NFC user-area backup'],'migration_warning':'v1.0 factory layout is incompatible. Back up original flash/NVS/works first; these files are NOT permission to erase or flash. Blank works image destroys old content. No NVS image or shared device key is included.'}
(out/'initial-install-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'version':version,'app_bytes':len(data),'out':str(out),'flashed':False}))
