/* RS256 verification with Google JWKS. No tokeninfo dependency or frontend secret. */
function decode64_(s){return Utilities.base64DecodeWebSafe(s+'='.repeat((4-s.length%4)%4));}
function bytesHex_(bytes){return bytes.map(function(b){return ((b+256)%256).toString(16).padStart(2,'0');}).join('');}
function json64_(s){return JSON.parse(Utilities.newBlob(decode64_(s)).getDataAsString('UTF-8'));}
function powMod_(base,exponent,modulus){var result=BigInt(1);base%=modulus;while(exponent>BigInt(0)){if(exponent%BigInt(2)===BigInt(1))result=result*base%modulus;base=base*base%modulus;exponent/=BigInt(2);}return result;}
function publicKeys_(refresh){
  var cache=CacheService.getScriptCache(),raw=refresh?null:cache.get('google-jwks');
  if(!raw){var resp=UrlFetchApp.fetch('https://www.googleapis.com/oauth2/v3/certs',{muteHttpExceptions:true});if(resp.getResponseCode()!==200)throw new Error('Google 公钥暂时不可用，请稍后同步');raw=resp.getContentText();cache.put('google-jwks',raw,21600);}
  return JSON.parse(raw).keys;
}
function verifyIdToken_(token,bindOwner){
  TimeCore.assert(typeof token==='string'&&token.length<10000,'AUTH_REQUIRED');var chunks=token.split('.');TimeCore.assert(chunks.length===3,'AUTH_REQUIRED');
  var header=json64_(chunks[0]),claim=json64_(chunks[1]);TimeCore.assert(header.alg==='RS256'&&typeof header.kid==='string','AUTH_REQUIRED');
  var keys=publicKeys_(false),key=keys.find(function(k){return k.kid===header.kid;});if(!key)key=publicKeys_(true).find(function(k){return k.kid===header.kid;});
  TimeCore.assert(key&&key.kty==='RSA','AUTH_REQUIRED');
  var modulusBytes=decode64_(key.n),modulus=BigInt('0x'+bytesHex_(modulusBytes)),exp=BigInt('0x'+bytesHex_(decode64_(key.e))),signatureBytes=decode64_(chunks[2]),sig=BigInt('0x'+bytesHex_(signatureBytes));
  TimeCore.assert(signatureBytes.length===modulusBytes.length&&sig<modulus,'AUTH_REQUIRED');
  var actual=powMod_(sig,exp,modulus).toString(16).padStart(modulusBytes.length*2,'0');
  var digest=hash_(chunks[0]+'.'+chunks[1]),info='3031300d060960864801650304020105000420'+digest;
  var padding=modulusBytes.length-3-info.length/2;TimeCore.assert(padding>=8,'AUTH_REQUIRED');
  TimeCore.assert(actual==='0001'+'ff'.repeat(padding)+'00'+info,'AUTH_REQUIRED');
  var settings=props_(),now=Math.floor(Date.now()/1000);
  TimeCore.assert(claim.aud===settings.getProperty('GOOGLE_CLIENT_ID')&&(claim.iss==='https://accounts.google.com'||claim.iss==='accounts.google.com')&&Number.isFinite(claim.exp)&&claim.exp>now&&Number.isFinite(claim.iat)&&claim.iat<=now+60&&typeof claim.sub==='string'&&claim.sub.length>0,'AUTH_REQUIRED');
  var owner=settings.getProperty('OWNER_SUB');
  if(owner)TimeCore.assert(claim.sub===owner,'无权访问');
  else {TimeCore.assert((claim.email_verified===true||claim.email_verified==='true')&&String(claim.email).toLowerCase()===String(settings.getProperty('OWNER_EMAIL')).toLowerCase(),'无权访问');if(bindOwner!==false)settings.setProperty('OWNER_SUB',claim.sub);}
  return claim.sub;
}
function doGet(){return HtmlService.createHtmlOutput('<!doctype html><meta charset="utf-8"><p>时间记录后端已运行。请使用你的 PWA 前端登录。</p>');}
function doPost(e){
  var profile=perfBegin_(),lock=null,held=false,acquiredAt=0;
  function released(){held=false;profile._held=false;profile.lock_ms=Math.max(0,Date.now()-acquiredAt);}
  function releaseHeld(){if(!held||!lock)return;lock.releaseLock();released();}
  try{
  resetExecution_();
  var payload,reply,origin=props_().getProperty('ALLOWED_ORIGIN'),nonce='';
  try{
    TimeCore.assert(e&&e.parameter&&typeof e.parameter.payload==='string'&&e.parameter.payload.length<100000,'请求无效');payload=JSON.parse(e.parameter.payload);nonce=payload.nonce;profile.action=['sync','sync_batch','state','query','records'].indexOf(payload.action)>=0?payload.action:'unknown';profile.batch_size=payload.action==='sync_batch'&&Array.isArray(payload.ops)?payload.ops.length:payload.action==='sync'?1:0;
    TimeCore.assert(TimeCore.uuid(nonce)&&payload.origin===origin,'来源无效');
    // Signature/JWKS work must not hold the shared data lock. Recheck owner after
    // acquisition, so simultaneous first logins cannot bind different subjects.
    var subject=perfTimed_(profile,'auth_ms',function(){return verifyIdToken_(payload.token,false);});lock=LockService.getScriptLock();
    if(!perfTimed_(profile,'lock_wait_ms',function(){return lock.tryLock(1000);}))throw new Error('CLOUD_BUSY');
    held=true;profile._held=true;acquiredAt=Date.now();
    try{var owner=props_().getProperty('OWNER_SUB');TimeCore.assert(!owner||owner===subject,'无权访问');if(!owner)props_().setProperty('OWNER_SUB',subject);perfTimed_(profile,'recover_ms',function(){recover_();});
      if(payload.action==='sync')reply=commit_(payload.op);
      else if(payload.action==='sync_batch')reply=commitBatch_(payload.ops,acquiredAt+10000);
      else if(payload.action==='state')reply=perfTimed_(profile,'state_ms',function(){return {ok:true,state:state_()};});
      else if(payload.action==='query')reply=perfTimed_(profile,'query_ms',function(){return query_(payload);});
      else if(payload.action==='records')reply=perfTimed_(profile,'records_ms',function(){return records_(payload);});
      else throw new Error('操作无效');
    }finally{releaseHeld();}
  }catch(err){profile.exception=true;var msg=String(err.message||err),busy=msg==='CLOUD_BUSY'||/Lock timeout/i.test(msg);reply={ok:false,code:busy?'BUSY':msg==='AUTH_REQUIRED'?'AUTH_REQUIRED':'ERROR',message:busy?'云端暂忙，记录已保存在本机，稍后自动重试。':msg};if(busy)reply.retry_after_ms=15000;}
  var result={channel:'time-tracker-v1',nonce:nonce,reply:reply};
  // Escape HTML-breaking chars before placing JSON inside an inline script.
  var encoded=JSON.stringify(result).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  var target=JSON.stringify(origin||'https://invalid.example').replace(/</g,'\\u003c');
  return HtmlService.createHtmlOutput('<!doctype html><meta charset="utf-8"><script>var w=window;for(var i=0;i<4&&w.parent!==w;i++)w=w.parent;w.postMessage('+encoded+','+target+');</script>').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }catch(err){profile.exception=true;throw err;}finally{
    // One finalization point for all returns/throws. Retry only an unconfirmed
    // release; never release twice after a successful release.
    if(held&&lock){try{if(typeof lock.hasLock==='function'&&!lock.hasLock())released();else releaseHeld();}catch(ignore){}}
    try{if(!held&&profile._held===false)perfFinish_(profile);}catch(ignore){}
    finally{if(perfProfile_===profile)perfProfile_=null;}
  }
}
