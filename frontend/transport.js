(function(root){
  'use strict';let token=null,expires=0;
  function credential(value){token=value;try{expires=JSON.parse(atob(value.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).exp*1000;}catch{token=null;expires=0;}}
  function ready(){return !!token&&expires>Date.now()+30000;}
  // Form POST avoids CORS preflight; UUID nonce correlates the Google-hosted response.
  function call(settings,payload){return new Promise((resolve,reject)=>{
    if(!ready())return reject(Object.assign(new Error('AUTH_REQUIRED'),{code:'AUTH_REQUIRED'}));
    const nonce=crypto.randomUUID(),frame=document.createElement('iframe'),form=document.createElement('form');frame.name='tt_'+nonce;frame.hidden=true;frame.title='云端同步';
    form.method='POST';form.action=settings.backendUrl;form.target=frame.name;form.hidden=true;
    const input=document.createElement('input');input.name='payload';input.value=JSON.stringify({...payload,nonce,origin:location.origin,token});form.append(input);
    let timer;
    const cleanup=()=>{clearTimeout(timer);removeEventListener('message',onMessage);frame.remove();form.remove();};
    const onMessage=e=>{
      let host;try{host=new URL(e.origin).hostname;}catch{return;}
      if(e.origin!=='https://script.google.com'&&!(e.origin.startsWith('https://')&&(host==='script.googleusercontent.com'||host.endsWith('-script.googleusercontent.com'))))return;
      if(!e.data||e.data.channel!=='time-tracker-v1'||e.data.nonce!==nonce)return;
      cleanup();resolve(e.data.reply);
    };
    addEventListener('message',onMessage);document.body.append(frame,form);timer=setTimeout(()=>{cleanup();reject(new Error('网络请求超时；待同步记录已保留'));},45000);form.submit();
  });}
  root.TimeTransport={credential,ready,call};
})(globalThis);
