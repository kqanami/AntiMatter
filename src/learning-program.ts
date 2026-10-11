import {Buffer} from 'buffer';
import {sha256} from 'js-sha256';
import {PublicKey} from '@solana/web3.js';
import {checkNetwork,rpc,type Rpc} from './solana';

export const LEARNING_PROGRAM_ID=new PublicKey('24HLBRfv1vZsty1w9A27qn1QgQJDtbQGbU9HC1fqwk9B');
type RawAccount={value:{owner:string;executable:boolean;data:[string,string]}|null};

function discriminator(name:string){return Buffer.from(sha256(`account:${name}`).slice(0,16),'hex');}
function accountData(info:RawAccount,kind:'Counter'|'Profile'){
  if(!info.value)return null;
  if(info.value.owner!==LEARNING_PROGRAM_ID.toBase58())throw new Error('PDA принадлежит другой программе.');
  if(info.value.data[1]!=='base64')throw new Error('Неизвестный формат данных PDA.');
  const data=Buffer.from(info.value.data[0],'base64');
  if(data.length<8||!data.subarray(0,8).equals(discriminator(kind)))throw new Error('Тип on-chain аккаунта не совпадает.');
  return data;
}
function ownedAddress(seed:'counter'|'profile',owner:PublicKey){return PublicKey.findProgramAddressSync([Buffer.from(seed),owner.toBuffer()],LEARNING_PROGRAM_ID)[0];}
export function learningAddresses(wallet:string){const owner=new PublicKey(wallet);return {counter:ownedAddress('counter',owner).toBase58(),profile:ownedAddress('profile',owner).toBase58()};}
export async function learningProgramStatus(call:Rpc=rpc){await checkNetwork(call);const result=await call<RawAccount>('getAccountInfo',[LEARNING_PROGRAM_ID.toBase58(),{encoding:'base64',commitment:'confirmed'}]);return {address:LEARNING_PROGRAM_ID.toBase58(),deployed:!!result.value?.executable};}
async function readOwned(seed:'counter'|'profile',wallet:string,call:Rpc){
  await checkNetwork(call);
  const owner=new PublicKey(wallet),pda=ownedAddress(seed,owner);
  const info=await call<RawAccount>('getAccountInfo',[pda.toBase58(),{encoding:'base64',commitment:'confirmed'}]);
  const data=accountData(info,seed==='counter'?'Counter':'Profile');
  if(!data)return null;
  if(data.length<41||!data.subarray(8,40).equals(owner.toBuffer()))throw new Error('В PDA указан другой владелец.');
  return {address:pda.toBase58(),data};
}
export async function learningCounter(wallet:string,call:Rpc=rpc){
  const account=await readOwned('counter',wallet,call);
  if(!account)return null;
  const {data}=account;
  if(data.length!==49)throw new Error('Размер счётчика не совпадает.');
  return {address:account.address,count:data.readBigUInt64LE(40).toString(),bump:data[48]};
}
export async function learningProfile(wallet:string,call:Rpc=rpc){
  const account=await readOwned('profile',wallet,call);
  if(!account)return null;
  const {data}=account;
  let cursor=41;
  const text=(limit:number)=>{
    if(cursor+4>data.length)throw new Error('Поля профиля повреждены.');
    const size=data.readUInt32LE(cursor);cursor+=4;
    if(size>limit||cursor+size>data.length)throw new Error('Длина поля профиля недопустима.');
    const value=new TextDecoder('utf-8',{fatal:true}).decode(data.subarray(cursor,cursor+size));cursor+=size;
    return value;
  };
  const displayName=text(32),bio=text(160);
  if(cursor+8>data.length)throw new Error('Отсутствует номер слота профиля.');
  return {address:account.address,displayName,bio,updatedSlot:data.readBigUInt64LE(cursor).toString(),bump:data[40]};
}
