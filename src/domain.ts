import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
export const NETWORK = 'solana-devnet';
export const TOKEN_NETWORK = 'solana-devnet-amt';
export const DEMO_NETWORK = 'arm-lab-v1';
export type Network = typeof NETWORK | typeof TOKEN_NETWORK | typeof DEMO_NETWORK;
export const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const MAX_LAMPORTS = 10_000_000_000;
export type Role = 'send'|'receive';
export type Hello = {kind:'hello'; v:1; network:Network; mint?:string; session:string; address:string; name:string; role:Role};
export type Offer = {kind:'offer'; id:string; network:Network; mint?:string; from:string; to:string; senderSession:string; receiverSession:string; lamports:number; expires:number};
export type DemoPayload = {network:typeof DEMO_NETWORK; id:string; height:number; previous:string; from:string; to:string; lamports:number; timestamp:number};
export type DemoBlock = {payload:DemoPayload; signature:string; hash:string};
export type Wire = Hello | Offer | {kind:'auth-check';code:string;session:string} | {kind:'clock-ping';id:string;t0:number} | {kind:'clock-pong';id:string;t0:number;t1:number;t2:number} | {kind:'impact';session:string;at:number;strength:number} | {kind:'ack'; id:string} | {kind:'receipt';id:string;signature:string} | {kind:'demo-head';id:string;chain:DemoBlock[]} | {kind:'demo-block';id:string;block:DemoBlock;chain:DemoBlock[]} | {kind:'demo-accepted';id:string;hash:string} | {kind:'cancel';id:string};
export type RecordItem = {offer:Offer; signature?:string; raw?:string; lastValidBlockHeight?:number; status:'waiting'|'pending'|'confirmed'|'failed'; direction:'in'|'out'; created:number; error?:string};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function validAddress(s:unknown):s is string {try {return typeof s==='string' && new PublicKey(s).toBase58()===s && PublicKey.isOnCurve(new PublicKey(s).toBytes());}catch{return false;}}
export function parseAmount(text:string):number {
  const value = text.trim().replace(',', '.');
  if (!/^(0|[1-9]\d{0,2})(\.\d{1,9})?$/.test(value)) throw new Error('Введите сумму с точностью до 9 знаков после запятой.');
  const [whole, fraction=''] = value.split('.');
  const lamports=BigInt(whole)*1_000_000_000n+BigInt(fraction.padEnd(9,'0'));
  if(lamports<=0n || lamports>BigInt(MAX_LAMPORTS)) throw new Error('Сумма должна быть больше нуля и не превышать 10 единиц.');
  return Number(lamports);
}
export const formatSOL=(n:number)=> (n/1e9).toLocaleString('ru-RU',{maximumFractionDigits:9});
export const shortAddress=(a:string)=>`${a.slice(0,5)}…${a.slice(-5)}`;
export const memoFor=(o:Offer)=>`ARM1:${o.id}:${o.receiverSession}`;
export function parseWire(data:string):Wire {
  if(new TextEncoder().encode(data).length>32768) throw new Error('Слишком большой пакет.');
  const x=JSON.parse(data);
  if(!x || typeof x!=='object') throw new Error('Неверный пакет.');
  if(x.kind==='auth-check' && typeof x.code==='string' && /^[A-Za-z0-9]{4,12}$/.test(x.code) && uuid.test(x.session)) return x;
  if(x.kind==='clock-ping'&&uuid.test(x.id)&&Number.isSafeInteger(x.t0)&&x.t0>0)return x;
  if(x.kind==='clock-pong'&&uuid.test(x.id)&&[x.t0,x.t1,x.t2].every((n:unknown)=>Number.isSafeInteger(n)&&Number(n)>0))return x;
  if(x.kind==='impact'&&uuid.test(x.session)&&Number.isSafeInteger(x.at)&&x.at>0&&typeof x.strength==='number'&&Number.isFinite(x.strength)&&x.strength>=0.8&&x.strength<=20)return x;
  if(x.kind==='hello' && x.v===1 && [NETWORK,TOKEN_NETWORK,DEMO_NETWORK].includes(x.network) && (x.network!==TOKEN_NETWORK||validAddress(x.mint)) && uuid.test(x.session) && validAddress(x.address) && typeof x.name==='string' && x.name.length>0 && x.name.length<=24 && ['send','receive'].includes(x.role)) return x;
  if(x.kind==='offer' && [NETWORK,TOKEN_NETWORK,DEMO_NETWORK].includes(x.network) && (x.network!==TOKEN_NETWORK||validAddress(x.mint)) && uuid.test(x.id) && uuid.test(x.senderSession) && uuid.test(x.receiverSession) && validAddress(x.from) && validAddress(x.to) && x.from!==x.to && Number.isSafeInteger(x.lamports) && x.lamports>0 && x.lamports<=MAX_LAMPORTS && Number.isSafeInteger(x.expires)) return x;
  if(x.kind==='ack' && uuid.test(x.id)) return x;
  if(x.kind==='cancel' && uuid.test(x.id)) return x;
  if(x.kind==='demo-head' && uuid.test(x.id) && Array.isArray(x.chain) && x.chain.length<=100) return x;
  if(x.kind==='demo-block' && uuid.test(x.id) && x.block && typeof x.block==='object' && Array.isArray(x.chain) && x.chain.length<=100) return x;
  if(x.kind==='demo-accepted' && uuid.test(x.id) && typeof x.hash==='string' && /^[a-f0-9]{64}$/.test(x.hash)) return x;
  if(x.kind==='receipt' && uuid.test(x.id) && typeof x.signature==='string') {try {if(bs58.decode(x.signature).length===64) return x;}catch{/* invalid base58 */}}
  throw new Error('Несовместимый или повреждённый пакет.');
}
export function validateOffer(o:Offer, me:Hello, peer:Hello, now=Date.now()) {
  if(me.role!=='receive' || peer.role!=='send' || o.network!==me.network || o.network!==peer.network || (o.network===TOKEN_NETWORK&&(o.mint!==me.mint||o.mint!==peer.mint)) || o.from!==peer.address || o.to!==me.address || o.senderSession!==peer.session || o.receiverSession!==me.session || o.expires<now || o.expires>now+150_000) throw new Error('Получатель, сеанс или срок перевода не совпадает.');
}
export function autoCandidate(endpoints:string[]):string|undefined {return endpoints.length===1?endpoints[0]:undefined;}
