const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const Core=require('../frontend/core.js');
function environment(){
  const books=new Map(),files=new Map(),folders=new Map(),properties=new Map(),cache=new Map(),triggers=[];let counter=0,failAt=Infinity,writes=0;
  function mutate(){writes++;if(writes===failAt)throw new Error('SIMULATED_PROCESS_KILL');}
  const iter=arr=>{let i=0;return {hasNext:()=>i<arr.length,next:()=>arr[i++]};};
  class Range{constructor(s,r,c,n=1,m=1){Object.assign(this,{s,r,c,n,m});}getValues(){return Array.from({length:this.n},(_,y)=>Array.from({length:this.m},(_,x)=>this.s.data[this.r+y-1]?.[this.c+x-1]??''));}getValue(){return this.getValues()[0][0];}setValues(rows){for(let y=0;y<this.n;y++)for(let x=0;x<this.m;x++){this.s.data[this.r+y-1]??=[];this.s.data[this.r+y-1][this.c+x-1]=rows[y][x];}mutate();return this;}setValue(v){return this.setValues([[v]]);}setNumberFormat(){return this;}getRow(){return this.r;}createTextFinder(key){const range=this;return {matchEntireCell(){return this;},useRegularExpression(){return this;},findNext(){for(let y=0;y<range.n;y++)if(String(range.getValues()[y][0])===String(key))return new Range(range.s,range.r+y,range.c);return null;}};}}
  class Sheet{constructor(name){this.name=name;this.data=[];this.max=1000;}getRange(...args){return new Range(this,...args);}getLastRow(){let r=this.data.length;while(r&&!(this.data[r-1]||[]).some(x=>x!==''&&x!==undefined))r--;return r;}getMaxRows(){return this.max;}insertRowsAfter(_,n){this.max+=n;return this;}setFrozenRows(){return this;}}
  class Book{constructor(name){this.name=name;this.id='book'+(++counter);this.sheets=new Map();books.set(this.id,this);const f=new File(name,'');f.id=this.id;files.set(this.id,f);}getId(){return this.id;}getSheetByName(n){return this.sheets.get(n)||null;}insertSheet(n){const s=new Sheet(n);this.sheets.set(n,s);mutate();return s;}}
  class File{constructor(name,text){this.name=name;this.text=text;this.id='file'+(++counter);this.trashed=false;}getId(){return this.id;}moveTo(folder){folder.fileIds.push(this.id);mutate();return this;}setTrashed(v){this.trashed=v;mutate();return this;}setContent(t){this.text=t;mutate();return this;}getBlob(){return blob(this.text);}}
  class Folder{constructor(name){this.name=name;this.id='folder'+(++counter);this.children=[];this.fileIds=[];folders.set(this.id,this);}getId(){return this.id;}getFoldersByName(n){return iter(this.children.filter(f=>f.name===n));}createFolder(n){const f=new Folder(n);this.children.push(f);mutate();return f;}getFilesByName(n){return iter(this.fileIds.map(id=>files.get(id)).filter(f=>f.name===n&&!f.trashed));}createFile(n,t){const f=new File(n,t);files.set(f.id,f);this.fileIds.push(f.id);mutate();return f;}}
  function blob(v){const b=Array.isArray(v)?Buffer.from(v.map(n=>(n+256)%256)):Buffer.from(v);return {getDataAsString:()=>b.toString('utf8'),getBytes:()=>[...b].map(n=>n>127?n-256:n)};}
  const signed=b=>[...b].map(n=>n>127?n-256:n);
  const props={getProperty:k=>properties.get(k)||null,setProperty(k,v){properties.set(k,String(v));mutate();return this;},setProperties(obj){Object.entries(obj).forEach(([k,v])=>properties.set(k,String(v)));mutate();return this;},deleteProperty(k){properties.delete(k);return this;}};
  const context=vm.createContext({console:{log(){},warn(){},error:console.error},BigInt,Map,Set,Intl,JSON,Date,TimeCore:Core,
    PropertiesService:{getScriptProperties:()=>props},SpreadsheetApp:{create:n=>new Book(n),openById:id=>{if(!books.has(id))throw new Error('missing book '+id);return books.get(id);},flush:()=>mutate()},
    DriveApp:{createFolder:n=>new Folder(n),getFolderById:id=>folders.get(id),getFileById:id=>files.get(id)},
    Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},getUuid:()=>crypto.randomUUID(),computeDigest:(algo,text)=>signed(crypto.createHash(algo).update(text).digest()),newBlob:blob,base64DecodeWebSafe:s=>signed(Buffer.from(s,'base64url'))},
    CacheService:{getScriptCache:()=>({get:k=>cache.get(k)||null,put:(k,v)=>cache.set(k,v)})},
    LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
    ScriptApp:{getProjectTriggers:()=>triggers,newTrigger:name=>{const builder={timeBased:()=>builder,everyDays:()=>builder,atHour:()=>builder,inTimezone:()=>builder,create:()=>triggers.push({getHandlerFunction:()=>name})};return builder;}},
    HtmlService:{XFrameOptionsMode:{ALLOWALL:'ALLOWALL'},createHtmlOutput:html=>({html,setXFrameOptionsMode(){return this;}})},
    UrlFetchApp:{fetch:()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({keys:context.jwks||[]})})}
  });
  for(const name of ['Repository.gs','Auth.gs','Setup.gs','Backup.gs'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../backend',name),'utf8'),context,{filename:name});
  properties.set('OWNER_EMAIL','owner@gmail.com');properties.set('GOOGLE_CLIENT_ID','client.apps.googleusercontent.com');properties.set('ALLOWED_ORIGIN','https://owner.github.io');context.setup();
  return {context,books,files,folders,properties,setFailure(n){writes=0;failAt=n;},clearFailure(){failAt=Infinity;},get writes(){return writes;}};
}
module.exports={environment};
