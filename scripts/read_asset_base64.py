#!/usr/bin/env python3
"""Read existing PNG/JPEG bytes for a connected GitHub create_blob call.

Read JSON into the tool orchestrator, concatenate data in offset order, pass
encoding=base64 to create_blob and compare its SHA to git_blob_sha. This script
never generates, changes, approves or uploads artwork. No network or keys.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('source',type=Path)
p.add_argument('--offset',type=int,default=0)
p.add_argument('--count',type=int,default=500000)
a=p.parse_args()
if a.offset<0 or not 1<=a.count<=500000:p.error('invalid chunk bounds')
b=a.source.read_bytes()
if len(b)>10*1024*1024 or not (b.startswith(b'\x89PNG\r\n\x1a\n') or b.startswith(b'\xff\xd8\xff') and b.endswith(b'\xff\xd9')):
 p.error('expected existing PNG/JPEG <=10 MiB')
s=base64.b64encode(b).decode('ascii')
if a.offset>len(s):p.error('offset outside asset')
part=s[a.offset:a.offset+a.count]
print(json.dumps(dict(size_bytes=len(b),sha256=hashlib.sha256(b).hexdigest(),
 git_blob_sha=hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest(),
 offset=a.offset,next_offset=a.offset+len(part),total_characters=len(s),
 complete=a.offset+len(part)==len(s),data=part)))
