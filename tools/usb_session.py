#!/usr/bin/env python3
"""Bounded USB session: status, STOP, or an ND4A work with 512-byte flow control."""
import argparse,base64,hashlib,json,time,uuid
from pathlib import Path
import serial
p=argparse.ArgumentParser();p.add_argument('action',choices=['status','stop','upload','monitor']);p.add_argument('--port',default='/dev/cu.usbmodem1101');p.add_argument('--file');p.add_argument('--seconds',type=float,default=3);p.add_argument('--log');p.add_argument('--stop-after',type=float);p.add_argument('--status-every',type=float,default=0);p.add_argument('--auto-retry',action='store_true',help='USB lab only: synthetic short presses after game over, marked in ACKs');a=p.parse_args()
s=serial.Serial(port=None,baudrate=115200,timeout=.1);s.dtr=True;s.rts=True;s.port=a.port;s.open();
import termios
attrs=termios.tcgetattr(s.fileno());attrs[2]&=~termios.HUPCL;termios.tcsetattr(s.fileno(),termios.TCSANOW,attrs)
buffer=b''
log=open(a.log,'a') if a.log else None
def lines(seconds):
 global buffer
 end=time.monotonic()+seconds
 while time.monotonic()<end:
  buffer+=s.read(4096)
  while b'\n' in buffer:
   line,buffer=buffer.split(b'\n',1);text=line.decode(errors='replace').strip()
   if log:log.write(text+'\n');log.flush()
   if text:yield text
def command(v,ack=None):
 s.write(json.dumps(v,separators=(',',':')).encode()+b'\n');s.flush()
 for line in lines(8):
  if ack and line.startswith('NOTE4 USB '):
   obj=json.loads(line[len('NOTE4 USB '):])
   if obj.get('op')==ack:
    if not obj['ok']:raise RuntimeError(obj)
    return obj
  if not ack and ('STATUS ' in line or '"cpu_awake"' in line):print(line,flush=True);return json.loads(line.split('STATUS ',1)[1]) if 'STATUS ' in line else {}
  if not line.startswith('NOTE4 USB '):print(line,flush=True)
 raise TimeoutError('No acknowledgement: '+str(v.get('op')))
def observe(seconds):
 end=time.monotonic()+seconds
 interval=max(.5,a.status_every) if a.status_every else 0
 next_status=time.monotonic()+interval
 completed_since=None;retry_index=0
 while time.monotonic()<end:
  wait=max(0,min(.5,end-time.monotonic(),next_status-time.monotonic() if interval else .5))
  for line in lines(wait):print(line,flush=True)
  if interval and time.monotonic()>=next_status:
   state=command({'op':'status'});next_status=time.monotonic()+interval
   if a.auto_retry and state.get('state')=='completed':
    if completed_since is None:completed_since=time.monotonic()
    elif time.monotonic()-completed_since>=3:
     key='wave' if state.get('input_mode')=='gestures' else ('ok','up','down')[retry_index%3]
     reply=command({'op':'test_retry','key':key},'test_retry')
     print('SYNTHETIC_RETRY '+key+' '+json.dumps(reply),flush=True)
     completed_since=None;retry_index+=1
   else:completed_since=None
try:
 for line in lines(2):
  if 'STARTUP_FAILED' in line:print(line,flush=True)
 if a.action=='upload':
  for attempt in range(10):
   ready=command({'op':'status'})
   if ready.get('startup_ready'):break
   if ready.get('startup_error') not in ('none','initializing'):raise RuntimeError(ready)
   time.sleep(.3)
  else:raise RuntimeError('Managers not ready')
  data=Path(a.file).read_bytes();command({'op':'work_begin','byte_length':len(data),'sha256':hashlib.sha256(data).hexdigest()},'work_begin')
  for offset in range(0,len(data),512):
   reply=command({'op':'work_chunk','offset':offset,'data':base64.b64encode(data[offset:offset+512]).decode()},'work_chunk')
   assert reply['offset']==min(len(data),offset+512)
  command({'op':'work_commit','command_id':'usb-'+uuid.uuid4().hex},'work_commit');print('UPLOAD_VALIDATED bytes='+str(len(data)),flush=True)
 elif a.action!='monitor':command({'op':a.action})
 if a.stop_after is not None:
  observe(a.stop_after)
  command({'op':'stop'});time.sleep(.15);command({'op':'status'})
 else:
  observe(a.seconds)
except KeyboardInterrupt:
 if a.stop_after is not None:
  command({'op':'stop'})
 raise
finally:
 s.close()
 if log:log.close()
