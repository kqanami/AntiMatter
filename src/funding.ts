import {Capacitor,CapacitorHttp} from '@capacitor/core';

const STORAGE_KEY='antimatter-devnet-dispenser';
const DEFAULT_URL=(import.meta.env.VITE_DISPENSER_URL||'').trim();
export type FundingResult={status:'confirmed'|'pending';signature:string;amountAMT:number;amountSOL:number;alreadyIssued:boolean};

export function getDispenserUrl(){return localStorage.getItem(STORAGE_KEY)||DEFAULT_URL;}
export function setDispenserUrl(value:string){
  const trimmed=value.trim().replace(/\/+$/,'');
  if(!trimmed){localStorage.removeItem(STORAGE_KEY);return;}
  const url=new URL(trimmed);
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw new Error('Нужен защищённый HTTPS-адрес сервера выдачи.');
  localStorage.setItem(STORAGE_KEY,url.toString().replace(/\/$/,''));
}

export async function requestFunding(address:string):Promise<FundingResult>{
  const base=getDispenserUrl();
  if(!base)throw new Error('Сервер выдачи не настроен.');
  const url=`${base}/v1/claim`;
  let status:number,data:unknown;
  try{
    if(Capacitor.isNativePlatform()){
      const response=await CapacitorHttp.post({url,headers:{'Content-Type':'application/json'},data:{address},connectTimeout:10_000,readTimeout:30_000,responseType:'json'});
      status=response.status;data=response.data;
    }else{
      const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address})});
      status=response.status;data=await response.json();
    }
  }catch{throw new Error('Не удалось связаться с сервером выдачи. Проверьте интернет или адрес сервера.');}
  const body=typeof data==='string'?JSON.parse(data):data as Record<string,unknown>;
  if(status<200||status>=300)throw new Error(typeof body?.error==='string'?body.error:`Сервер выдачи ответил HTTP ${status}.`);
  if(!body||!['confirmed','pending'].includes(String(body.status))||typeof body.signature!=='string')throw new Error('Сервер выдачи вернул некорректный ответ.');
  return body as FundingResult;
}
