import nacl from 'tweetnacl';
import {Buffer} from 'buffer';
import bs58 from 'bs58';
import {Message,SystemInstruction,Transaction} from '@solana/web3.js';
import {decodeTransferCheckedInstruction} from '@solana/spl-token';
import {MAX_LAMPORTS,NETWORK,TOKEN_NETWORK,type Offer} from './domain';
import {verifyTransfer} from './solana';
import {verifyTokenTransfer} from './amt';
import {TOKEN_MINT} from './token-config';
import type {NearbyEvent,NativeBridge} from './native';
import {desktopPhone,desktopRoom,isDesktopPhone} from './runtime';

type Packet={type:'advertise'|'discover'|'connect'|'verify'|'data'|'stop';from:string;to?:string;name?:string;code?:string;accept?:boolean;data?:string};
const role=desktopPhone!;
const other=role==='sender'?'receiver':'sender';
const channel=isDesktopPhone?new BroadcastChannel(`arm-tranzit-desktop-v1-${desktopRoom}`):null;
const listeners=new Set<(event:NearbyEvent)=>void>();
let active=false,verified=false,accepted=false,peerAccepted=false,peerName='Участник',ownName='Участник';
let code='';
const emit=(event:NearbyEvent)=>listeners.forEach(fn=>fn(event));
const post=(packet:Omit<Packet,'from'>)=>channel?.postMessage({...packet,from:role});
function ownKey(){
  // Keep Devnet test wallets stable across desktop page reloads so funding is not lost.
  const storageKey=`arm-tranzit-desktop-wallet-seed-v2-${role}`;
  const saved=localStorage.getItem(storageKey);
  if(saved)return nacl.sign.keyPair.fromSeed(Buffer.from(saved,'base64'));
  const seed=crypto.getRandomValues(new Uint8Array(32));
  localStorage.setItem(storageKey,Buffer.from(seed).toString('base64'));
  return nacl.sign.keyPair.fromSeed(seed);
}
if(channel)channel.onmessage=({data}:{data:Packet})=>{
  if(data.from!==other||data.to&&data.to!==role)return;
  if(data.type==='stop'){if(active){verified=false;accepted=false;peerAccepted=false;emit({type:'disconnected',endpoint:other});}return;}
  if(!active)return;
  if(data.type==='discover'&&role==='receiver')post({type:'advertise',to:other,name:ownName});
  if(data.type==='advertise'&&role==='sender'){peerName=data.name||'Участник';emit({type:'found',endpoint:other,name:peerName});}
  if(data.type==='connect'&&role==='receiver'&&data.code){code=data.code;peerName=data.name||'Участник';emit({type:'verify',endpoint:other,name:peerName,code});}
  if(data.type==='verify'){
    if(data.accept){peerAccepted=true;if(accepted&&!verified){verified=true;emit({type:'connected',endpoint:other});}}
    else{verified=false;accepted=false;peerAccepted=false;emit({type:'disconnected',endpoint:other});}
  }
  if(data.type==='data'&&verified&&data.data)emit({type:'data',endpoint:other,data:data.data});
};
export const DesktopBridge:NativeBridge={
  async wallet(){return {publicKey:Buffer.from(ownKey().publicKey).toString('base64')};},
  async sign({message}){
    const bytes=Buffer.from(message,'base64');
    if(bytes.length>2048)throw new Error('Сообщение перевода слишком велико.');
    const key=ownKey(),signature=nacl.sign.detached(bytes,key.secretKey);
    const tx=Transaction.populate(Message.from(bytes),[bs58.encode(signature)]);
    const memo=tx.instructions.at(-1)?.data.toString('utf8')||'';
    const match=/^ARM1:([a-f0-9-]{36}):([a-f0-9-]{36})$/.exec(memo);
    if(!match)throw new Error('Подпись разрешена только для согласованного перевода.');
    const from=tx.feePayer?.toBase58();
    if(!from||from!==bs58.encode(key.publicKey))throw new Error('Кошелёк отправителя не совпадает.');
    let offer:Offer;
    if(tx.instructions.length===3&&TOKEN_MINT){
      const transfer=decodeTransferCheckedInstruction(tx.instructions[1]);
      const amount=Number(transfer.data.amount);
      if(!Number.isSafeInteger(amount)||amount<=0||amount>MAX_LAMPORTS)throw new Error('Сумма AMT вне допустимых пределов.');
      offer={kind:'offer',id:match[1],network:TOKEN_NETWORK,mint:TOKEN_MINT,from,to:tx.instructions[0].keys[2]?.pubkey.toBase58()||'',senderSession:'',receiverSession:match[2],lamports:amount,expires:0};
      verifyTokenTransfer(tx,offer);
    }else{
      const transfer=SystemInstruction.decodeTransfer(tx.instructions[0]);
      const amount=Number(transfer.lamports);
      if(!Number.isSafeInteger(amount)||amount<=0||amount>MAX_LAMPORTS)throw new Error('Сумма SOL вне допустимых пределов.');
      offer={kind:'offer',id:match[1],network:NETWORK,from,to:transfer.toPubkey.toBase58(),senderSession:'',receiverSession:match[2],lamports:amount,expires:0};
      verifyTransfer(tx,offer);
    }
    return {signature:Buffer.from(signature).toString('base64')};
  },
  async signDemo({message}){
    const bytes=Buffer.from(message,'base64');
    if(!new TextDecoder().decode(bytes).startsWith('ARM-LAB-1\n'))throw new Error('Это не учебный блок.');
    return {signature:Buffer.from(nacl.sign.detached(bytes,ownKey().secretKey)).toString('base64')};
  },
  async start({role:nextRole,name}){
    active=true;verified=false;accepted=false;peerAccepted=false;ownName=name;
    post({type:nextRole==='receive'?'advertise':'discover',name,to:other});
    if(nextRole==='send')setTimeout(()=>{if(active&&!verified)post({type:'discover',to:other,name});},700);
  },
  async connect({endpoint}){
    if(endpoint!==other||!active)throw new Error('Телефон не найден.');
    code=String(1000+crypto.getRandomValues(new Uint16Array(1))[0]%9000);
    post({type:'connect',to:other,name:ownName,code});
    emit({type:'verify',endpoint:other,name:peerName,code});
  },
  async verify({endpoint,accept}){
    if(endpoint!==other)throw new Error('Другой телефон.');
    accepted=accept;post({type:'verify',to:other,accept});
    if(!accept){verified=false;return;}
    if(peerAccepted&&!verified){verified=true;emit({type:'connected',endpoint:other});}
  },
  async send({endpoint,data}){
    if(endpoint!==other||!verified)throw new Error('Соединение не подтверждено.');
    post({type:'data',to:other,data});
  },
  async stop(){if(active)post({type:'stop',to:other});active=false;verified=false;accepted=false;peerAccepted=false;},
  async addListener(_event,listener){listeners.add(listener);return {remove:async()=>{listeners.delete(listener)}};}
};
