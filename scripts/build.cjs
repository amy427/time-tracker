const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
fs.copyFileSync(path.join(root,'frontend/core.js'),path.join(root,'backend/Core.gs'));
// Generate actual install icons with standard Node APIs, without an image dependency.
function crc(buf){let c=0xffffffff;for(const b of buf){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(type,data){const t=Buffer.from(type),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);t.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([t,data])),data.length+8);return out;}
for(const size of [192,512]){const raw=Buffer.alloc((size*4+1)*size);for(let y=0;y<size;y++){raw[y*(size*4+1)]=0;for(let x=0;x<size;x++){const dx=x-size/2,dy=y-size/2,r=Math.hypot(dx,dy),s=size/512;const ring=Math.abs(r-145*s)<10*s;const hand=(Math.abs(dx)<10*s&&dy>-96*s&&dy<5*s)||(dx>=0&&dx<70*s&&Math.abs(dy-dx*44/65)<12*s);const col=ring||hand?[229,238,214,255]:[21,59,53,255];const i=y*(size*4+1)+1+x*4;for(let k=0;k<4;k++)raw[i+k]=col[k];}}
const ih=Buffer.alloc(13);ih.writeUInt32BE(size);ih.writeUInt32BE(size,4);ih[8]=8;ih[9]=6;const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);fs.writeFileSync(path.join(root,`frontend/icon-${size}.png`),png);}
const hash=crypto.createHash('sha256');for(const name of ['index.html','core.js','db.js','transport.js','app.js','style.css','manifest.json','icon-192.png','icon-512.png'])hash.update(fs.readFileSync(path.join(root,'frontend',name)));
const sw=path.join(root,'frontend/sw.js');fs.writeFileSync(sw,fs.readFileSync(sw,'utf8').replace(/const CACHE='[^']+';/,"const CACHE='time-tracker-shell-"+hash.digest('hex').slice(0,12)+"';"));
console.log('Apps Script shared core, versioned service worker and PWA icons are ready.');
