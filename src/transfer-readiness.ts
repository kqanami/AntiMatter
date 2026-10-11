import {DEMO_NETWORK,NETWORK,TOKEN_NETWORK,formatSOL,parseAmount,type Network} from './domain';

export type TransferReadiness={ok:boolean;amountLamports?:number;requiredLamports?:number;shortageLamports?:number;message:string};

export function transferReadiness(amountText:string,network:Network,balance:number|null,fee:number|null|undefined,feeError='',solBalance:number|null=null):TransferReadiness{
  let amountLamports:number;
  try{amountLamports=parseAmount(amountText);}catch(e){return {ok:false,message:amountText.trim()?(e instanceof Error?e.message:'Проверьте сумму.'): 'Введите сумму перевода.'};}
  if(balance===null)return {ok:false,amountLamports,message:network===DEMO_NETWORK?'Проверяем учебный баланс…':'Получаем баланс из Solana Devnet…'};
  if(network!==DEMO_NETWORK){
    if(feeError)return {ok:false,amountLamports,message:'Не удалось рассчитать комиссию Devnet. Проверьте интернет и обновите баланс.'};
    if(fee===undefined)return {ok:false,amountLamports,message:'Комиссия появится после соединения с получателем.'};
    if(fee===null)return {ok:false,amountLamports,message:'Рассчитываем комиссию Solana Devnet…'};
  }
  const requiredLamports=amountLamports+(network===NETWORK?fee!:0);
  if(requiredLamports>balance){
    const shortageLamports=requiredLamports-balance;
    return {ok:false,amountLamports,requiredLamports,shortageLamports,message:`Не хватает ${formatSOL(shortageLamports)} ${network===DEMO_NETWORK?'LAB':network===TOKEN_NETWORK?'AMT':'SOL'}${network===NETWORK?' с учётом комиссии':''}.`};
  }
  if(network===TOKEN_NETWORK){
    if(solBalance===null)return {ok:false,amountLamports,message:'Получаем тестовые SOL для комиссии сети…'};
    if(solBalance<fee!)return {ok:false,amountLamports,message:`Не хватает ${formatSOL(fee!-solBalance)} тестовых SOL для комиссии и счёта получателя.`};
    return {ok:true,amountLamports,requiredLamports,message:'AMT доступны · тестовые SOL для сети есть'};
  }
  return {ok:true,amountLamports,requiredLamports,message:network===DEMO_NETWORK?'Сумма доступна · без комиссии':'Сумма и комиссия укладываются в баланс'};
}
