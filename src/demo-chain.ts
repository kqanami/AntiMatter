import bs58 from 'bs58';
import nacl from 'tweetnacl';
import {DEMO_NETWORK,MAX_LAMPORTS,validAddress,type DemoBlock,type DemoPayload} from './domain';
import {phoneStorageKey} from './runtime';
import {sha256 as hash256} from 'js-sha256';
const KEY='arm-tranzit-lab-chain-v1';
export const DEMO_GENESIS='ARM Lab Chain v1 · учебные единицы · без денежной стоимости';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export async function sha256(value:string){return hash256(value);}
export const genesisHash=()=>sha256(DEMO_GENESIS);
export const payloadText=(p:DemoPayload)=>`ARM-LAB-1\n${JSON.stringify(p)}`;
export async function blockHash(p:DemoPayload,signature:string){return sha256(payloadText(p)+'\n'+signature);}
export function readChain():DemoBlock[]{const raw=localStorage.getItem(phoneStorageKey(KEY));if(!raw)return [];const value=JSON.parse(raw);if(!Array.isArray(value)||value.length>100)throw new Error('Учебная цепь повреждена.');return value;}
export function writeChain(chain:DemoBlock[]){if(chain.length>100)throw new Error('Учебная цепь заполнена.');localStorage.setItem(phoneStorageKey(KEY),JSON.stringify(chain));}
export function labBalance(chain:DemoBlock[],address:string){let amount=10_000_000_000;for(const b of chain){if(b.payload.from===address)amount-=b.payload.lamports;if(b.payload.to===address)amount+=b.payload.lamports;}return amount;}
export async function verifyBlock(prior:DemoBlock[],b:DemoBlock,now=Date.now(),historical=false){
  if(!b||!b.payload||typeof b.signature!=='string'||typeof b.hash!=='string')throw new Error('Некорректный блок.');
  const p=b.payload;
  if(p.network!==DEMO_NETWORK||!uuid.test(p.id)||p.height!==prior.length+1||p.previous!==(prior.length?prior[prior.length-1].hash:await genesisHash())||!validAddress(p.from)||!validAddress(p.to)||p.from===p.to||!Number.isSafeInteger(p.lamports)||p.lamports<=0||p.lamports>MAX_LAMPORTS||!Number.isSafeInteger(p.timestamp)||(!historical&&Math.abs(now-p.timestamp)>120_000))throw new Error('Содержимое учебного блока не прошло проверку.');
  if(prior.some(x=>x.payload.id===p.id))throw new Error('Блок уже присутствует в цепи.');
  if(labBalance(prior,p.from)<p.lamports)throw new Error('Недостаточно учебных единиц.');
  let signature:Uint8Array;try{signature=bs58.decode(b.signature);}catch{throw new Error('Подпись блока повреждена.');}
  if(signature.length!==64||!nacl.sign.detached.verify(new TextEncoder().encode(payloadText(p)),signature,bs58.decode(p.from)))throw new Error('Подпись учебного блока не совпадает.');
  if(await blockHash(p,b.signature)!==b.hash)throw new Error('Хеш блока не совпадает.');
}
export async function verifyChain(chain:DemoBlock[]){if(chain.length>100)throw new Error('Слишком длинная учебная цепь.');const seen:DemoBlock[]=[];for(const block of chain){await verifyBlock(seen,block,Date.now(),true);seen.push(block);}return chain;}
export async function makeBlock(prior:DemoBlock[],from:string,to:string,lamports:number,id:string,sign:(data:Uint8Array)=>Promise<Uint8Array>):Promise<DemoBlock>{
  await verifyChain(prior);
  const payload:DemoPayload={network:DEMO_NETWORK,id,height:prior.length+1,previous:prior.length?prior[prior.length-1].hash:await genesisHash(),from,to,lamports,timestamp:Date.now()};
  if(labBalance(prior,from)<lamports)throw new Error('Недостаточно учебных единиц.');
  const signature=bs58.encode(await sign(new TextEncoder().encode(payloadText(payload))));
  const block:DemoBlock={payload,signature,hash:await blockHash(payload,signature)};
  await verifyBlock(prior,block);
  return block;
}
export async function appendBlock(prior:DemoBlock[],block:DemoBlock){
  await verifyChain(prior);if(prior.some(x=>x.hash===block.hash))return prior;
  await verifyBlock(prior,block);const next=[...prior,block];writeChain(next);return next;
}
