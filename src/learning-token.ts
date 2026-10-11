import {PublicKey} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {TOKEN_MINT,TOKEN_DECIMALS} from './token-config';
import {checkNetwork,rpc,type Rpc} from './solana';

export const METADATA_PROGRAM_ID=new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
export function metadataAddress(mint:string){
  const key=new PublicKey(mint);
  return PublicKey.findProgramAddressSync([new TextEncoder().encode('metadata'),METADATA_PROGRAM_ID.toBuffer(),key.toBuffer()],METADATA_PROGRAM_ID)[0].toBase58();
}
export async function learningTokenStatus(call:Rpc=rpc,mint=TOKEN_MINT){
  if(!mint)throw new Error('Адрес AMT mint не настроен.');
  const address=new PublicKey(mint).toBase58();
  await checkNetwork(call);
  const account=await call<{value:{owner:string}|null}>('getAccountInfo',[address,{encoding:'base64',commitment:'confirmed'}]);
  if(account.value?.owner!==TOKEN_PROGRAM_ID.toBase58())throw new Error('Mint AMT не найден в Devnet.');
  const supply=await call<{value:{amount:string;decimals:number}}>('getTokenSupply',[address,{commitment:'confirmed'}]);
  if(supply.value.decimals!==TOKEN_DECIMALS)throw new Error('Точность AMT mint не совпадает.');
  const metadata=metadataAddress(address);
  const info=await call<{value:{owner:string}|null}>('getAccountInfo',[metadata,{encoding:'base64',commitment:'confirmed'}]);
  if(info.value&&info.value.owner!==METADATA_PROGRAM_ID.toBase58())throw new Error('Метаданные AMT принадлежат другой программе.');
  return {mint:address,supply:supply.value.amount,decimals:supply.value.decimals,metadataAddress:metadata,metadataCreated:!!info.value};
}
