import nacl from 'tweetnacl';
import {Buffer} from 'buffer';
import type {NearbyEvent,NativeBridge} from './native';
const listeners=new Set<(event:NearbyEvent)=>void>();
let socket:WebSocket|undefined;
let active=false;
let peerEndpoint='';
let connected=false;
const keyName='arm-tranzit-lan-seed-v1';
function key(){const saved=localStorage.getItem(keyName);if(saved)return nacl.sign.keyPair.fromSeed(Buffer.from(saved,'base64'));const seed=crypto.getRandomValues(new Uint8Array(32));localStorage.setItem(keyName,Buffer.from(seed).toString('base64'));return nacl.sign.keyPair.fromSeed(seed);}
function emit(event:NearbyEvent){listeners.forEach(fn=>fn(event));}
function open(){
  if(socket?.readyState===WebSocket.OPEN)return Promise.resolve(socket);
  return new Promise<WebSocket>((resolve,reject)=>{
    const ws=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/nearby`);socket=ws;
    ws.onopen=()=>resolve(ws);
    ws.onerror=()=>reject(new Error('LAN-сервер недоступен. Проверьте Wi‑Fi.'));
    ws.onclose=()=>{socket=undefined;connected=false;if(active)emit({type:'stopped'});active=false;};
    ws.onmessage=e=>{let m;try{m=JSON.parse(e.data);}catch{return;}if(m.type==='id')return;if(m.type==='event'){
      if(m.event==='connected'){connected=true;peerEndpoint=m.endpoint;}
      if(m.event==='disconnected'){connected=false;peerEndpoint='';}
      emit({type:m.event,endpoint:m.endpoint,name:m.name,code:m.code,data:m.data,message:m.message});
    }};
  });
}
function post(message:object){if(!socket||socket.readyState!==WebSocket.OPEN)throw new Error('LAN-соединение закрыто.');socket.send(JSON.stringify(message));}
export const LanBridge:NativeBridge={
  async wallet(){return {publicKey:Buffer.from(key().publicKey).toString('base64')};},
  async sign(){throw new Error('В браузере по Wi‑Fi доступна только учебная цепь.');},
  async signDemo({message}){const bytes=Buffer.from(message,'base64');if(!new TextDecoder().decode(bytes).startsWith('ARM-LAB-1\n'))throw new Error('Это не учебный блок.');return {signature:Buffer.from(nacl.sign.detached(bytes,key().secretKey)).toString('base64')};},
  async start({role,name}){await open();active=true;post({type:'start',role,name});},
  async connect({endpoint}){post({type:'connect',endpoint});},
  async verify({endpoint,accept}){post({type:'verify',endpoint,accept});},
  async send({endpoint,data}){if(!connected||endpoint!==peerEndpoint)throw new Error('Соединение не подтверждено.');post({type:'data',endpoint,data});},
  async stop(){if(socket?.readyState===WebSocket.OPEN)post({type:'stop'});active=false;connected=false;peerEndpoint='';},
  async addListener(_event,listener){listeners.add(listener);return {remove:async()=>{listeners.delete(listener)}};}
};
