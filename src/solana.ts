import { Buffer } from 'buffer';
import bs58 from 'bs58';
import { PublicKey, SystemProgram, Transaction, TransactionInstruction, SystemInstruction } from '@solana/web3.js';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { GENESIS, memoFor, type Offer, type RecordItem } from './domain';
export const RPC_URL='https://api.devnet.solana.com';
const RPC_STORAGE_KEY='antimatter-devnet-rpc';
const MEMO=new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
export type Rpc = <T=unknown>(method:string, params?:unknown[])=>Promise<T>;
export function getRpcUrl(){return typeof localStorage==='undefined'?RPC_URL:localStorage.getItem(RPC_STORAGE_KEY)||RPC_URL;}
type RpcResponse={status:number;data:unknown;retryAfter?:string};
async function requestRpc(url:string,method:string,params:unknown[]):Promise<RpcResponse>{
  const data={jsonrpc:'2.0',id:1,method,params};
  if(Capacitor.isNativePlatform()){
    const result=await CapacitorHttp.post({url,headers:{'Content-Type':'application/json'},data,connectTimeout:15_000,readTimeout:15_000,responseType:'json'});
    return {status:result.status,data:result.data,retryAfter:result.headers['Retry-After']||result.headers['retry-after']};
  }
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),15_000);
  try{
    const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:controller.signal});
    return {status:response.status,data:await response.json(),retryAfter:response.headers.get('Retry-After')||undefined};
  }finally{clearTimeout(timeout);}
}
async function rpcAt<T>(url:string,method:string,params:unknown[]=[]):Promise<T>{
  for(let attempt=0;attempt<2;attempt++){
    let response:RpcResponse;
    try{response=await requestRpc(url,method,params);}
    catch{throw new Error('Не удалось связаться с Solana Devnet. Проверьте интернет или выберите другой Devnet RPC в кошельке.');}
    if(response.status===429&&attempt<1){
      const retryAfter=Number(response.retryAfter);
      await new Promise(resolve=>setTimeout(resolve,Number.isFinite(retryAfter)&&retryAfter>0?Math.min(retryAfter*1000,2000):750));
      continue;
    }
    if(response.status===403)throw new Error('Devnet RPC отклонил подключение (HTTP 403). Укажите другой Devnet RPC в кошельке.');
    if(response.status===429)throw new Error('Devnet RPC ограничивает частоту запросов (HTTP 429). Подождите или укажите другой Devnet RPC в кошельке.');
    if(response.status<200||response.status>=300)throw new Error(`Devnet RPC: HTTP ${response.status}. Проверьте адрес RPC в кошельке.`);
    const body=typeof response.data==='string'?JSON.parse(response.data):response.data as Record<string,unknown>;
    if(!body||typeof body!=='object')throw new Error('Некорректный ответ Devnet RPC.');
    if(body.error) throw new Error(`Solana: ${body.error.message}`);
    if(!('result' in body)) throw new Error('Пустой ответ Solana.');
    return body.result as T;
  }
  throw new Error('Devnet временно недоступен. Повторите попытку.');
}
export const rpc:Rpc=<T>(method:string,params:unknown[]=[])=>rpcAt<T>(getRpcUrl(),method,params);
let checkedDefaultNetworkUntil=0;
let checkedUrl='';
export async function setRpcUrl(input:string){
  const value=input.trim();
  if(!value){localStorage.removeItem(RPC_STORAGE_KEY);checkedDefaultNetworkUntil=0;checkedUrl='';return;}
  let url:URL;
  try{url=new URL(value);}catch{throw new Error('Укажите полный HTTPS-адрес Devnet RPC.');}
  if(url.protocol!=='https:'||!url.hostname||url.username||url.password||url.hash)throw new Error('Для Devnet RPC нужен HTTPS-адрес без логина, пароля и фрагмента.');
  if(await rpcAt<string>(url.href,'getGenesisHash')!==GENESIS)throw new Error('Этот RPC подключён не к Solana Devnet. Адрес не сохранён.');
  localStorage.setItem(RPC_STORAGE_KEY,url.href);checkedUrl='';checkedDefaultNetworkUntil=0;
}
export async function checkNetwork(call:Rpc=rpc) {
  if(call===rpc&&checkedUrl===getRpcUrl()&&Date.now()<checkedDefaultNetworkUntil)return;
  if(await call('getGenesisHash')!==GENESIS)throw new Error('Сеть не Solana Devnet. Перевод заблокирован.');
  if(call===rpc){checkedUrl=getRpcUrl();checkedDefaultNetworkUntil=Date.now()+60_000;}
}
export async function balance(address:string,call:Rpc=rpc) {await checkNetwork(call);return (await call<{value:number}>('getBalance',[address,{commitment:'confirmed'}])).value;}
export async function estimateFee(from:string,to:string,call:Rpc=rpc){
  await checkNetwork(call);
  const latest=await call<{value:{blockhash:string}}>('getLatestBlockhash',[{commitment:'confirmed'}]);
  const tx=new Transaction({feePayer:new PublicKey(from),recentBlockhash:latest.value.blockhash}).add(
    SystemProgram.transfer({fromPubkey:new PublicKey(from),toPubkey:new PublicKey(to),lamports:1}),
    new TransactionInstruction({programId:MEMO,keys:[],data:Buffer.from('ARM1:'+ '0'.repeat(36)+':'+ '0'.repeat(36))})
  );
  const fee=(await call<{value:number|null}>('getFeeForMessage',[tx.serializeMessage().toString('base64'),{commitment:'confirmed'}])).value;
  if(fee===null)throw new Error('Не удалось рассчитать комиссию Solana Devnet.');
  return fee;
}
export type Signer=(message:Uint8Array, summary:string, offer:Offer)=>Promise<Uint8Array>;
export async function prepare(o:Offer,sign:Signer,call:Rpc=rpc):Promise<RecordItem> {
  await checkNetwork(call);
  if(o.expires<Date.now()) throw new Error('Предложение истекло. Начните новый перевод.');
  const latest=await call<{value:{blockhash:string;lastValidBlockHeight:number}}>('getLatestBlockhash',[{commitment:'confirmed'}]);
  const tx=new Transaction({feePayer:new PublicKey(o.from),recentBlockhash:latest.value.blockhash}).add(
    SystemProgram.transfer({fromPubkey:new PublicKey(o.from),toPubkey:new PublicKey(o.to),lamports:o.lamports}),
    new TransactionInstruction({programId:MEMO,keys:[],data:Buffer.from(memoFor(o))})
  );
  const fee=(await call<{value:number|null}>('getFeeForMessage',[tx.serializeMessage().toString('base64'),{commitment:'confirmed'}])).value;
  if(fee===null) throw new Error('Не удалось рассчитать комиссию. Повторите подготовку.');
  const funds=(await call<{value:number}>('getBalance',[o.from,{commitment:'confirmed'}])).value;
  if(funds<o.lamports+fee) throw new Error(`Недостаточно тестовых SOL с учётом комиссии ${fee} lamports.`);
  const signature=await sign(tx.serializeMessage(),`${o.lamports/1e9} SOL → ${o.to}\nSolana Devnet · комиссия ${fee} lamports`,o);
  tx.addSignature(new PublicKey(o.from),Buffer.from(signature));
  if(!tx.verifySignatures()) throw new Error('Неверная подпись кошелька.');
  return {offer:o,signature:bs58.encode(signature),raw:tx.serialize().toString('base64'),lastValidBlockHeight:latest.value.lastValidBlockHeight,status:'pending',direction:'out',created:Date.now()};
}
export async function broadcast(record:RecordItem,call:Rpc=rpc) {
  await checkNetwork(call);
  if(!record.raw || !record.signature) throw new Error('Нет сохранённой транзакции.');
  const tx=Transaction.from(Buffer.from(record.raw,'base64'));
  verifyTransfer(tx,record.offer);
  if(!tx.signature || bs58.encode(tx.signature)!==record.signature) throw new Error('Подпись в журнале не совпадает.');
  const result=await call<string>('sendTransaction',[record.raw,{encoding:'base64',skipPreflight:false,preflightCommitment:'confirmed',maxRetries:3}]);
  if(result!==record.signature) throw new Error('RPC вернул другую подпись.');
}
export function verifyTransfer(tx:Transaction,o:Offer) {
  if(tx.instructions.length!==2 || tx.feePayer?.toBase58()!==o.from || tx.signatures.length!==1 || !tx.verifySignatures()) throw new Error('Состав или подпись транзакции не совпадает.');
  const transfer=SystemInstruction.decodeTransfer(tx.instructions[0]);
  if(transfer.fromPubkey.toBase58()!==o.from || transfer.toPubkey.toBase58()!==o.to || BigInt(transfer.lamports)!==BigInt(o.lamports)) throw new Error('Получатель или сумма транзакции не совпадает.');
  const memo=tx.instructions[1];
  if(!memo.programId.equals(MEMO) || memo.keys.length!==0 || memo.data.toString('utf8')!==memoFor(o)) throw new Error('Транзакция относится к другому переводу.');
}
type ChainTx={meta:{err:unknown;preBalances:number[];postBalances:number[]}|null;transaction:[string,string];slot:number};
export async function reconcile(record:RecordItem,call:Rpc=rpc):Promise<RecordItem> {
  await checkNetwork(call);
  if(!record.signature) return record;
  const status=(await call<{value:({err:unknown;confirmationStatus:string}|null)[]}>('getSignatureStatuses',[[record.signature],{searchTransactionHistory:true}])).value[0];
  if(status?.err) return {...record,status:'failed',error:'Solana отклонила транзакцию: '+JSON.stringify(status.err)};
  if(!status || !['confirmed','finalized'].includes(status.confirmationStatus)) return {...record,status:'pending'};
  const result=await call<ChainTx|null>('getTransaction',[record.signature,{encoding:'base64',commitment:'confirmed',maxSupportedTransactionVersion:0}]);
  if(!result || !result.meta) return {...record,status:'pending'};
  if(result.meta.err) return {...record,status:'failed',error:'Ошибка исполнения Solana.'};
  const tx=Transaction.from(Buffer.from(result.transaction[0],'base64'));
  if(!tx.signature || bs58.encode(tx.signature)!==record.signature) throw new Error('Неверная подпись в ответе RPC.');
  verifyTransfer(tx,record.offer);
  const index=tx.compileMessage().accountKeys.findIndex(k=>k.toBase58()===record.offer.to);
  if(result.meta.postBalances[index]-result.meta.preBalances[index]!==record.offer.lamports) throw new Error('Зачисление не совпадает с суммой перевода.');
  return {...record,status:'confirmed',error:undefined};
}
// If a Nearby receipt was lost, locate the unique memo in the actual chain history.
export async function recoverIncoming(record:RecordItem,call:Rpc=rpc):Promise<RecordItem> {
  if(record.signature) return reconcile(record,call);
  await checkNetwork(call);
  const signatures=await call<{signature:string;memo:string|null;err:unknown}[]>('getSignaturesForAddress',[record.offer.to,{limit:30,commitment:'confirmed'}]);
  const match=signatures.find(s=>!s.err && s.memo?.endsWith(memoFor(record.offer)));
  return match?reconcile({...record,signature:match.signature,status:'pending'},call):record;
}
export const explorer=(signature:string)=>`https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`;
