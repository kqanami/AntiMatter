import {Buffer} from 'buffer';
import bs58 from 'bs58';
import {PublicKey,Transaction,TransactionInstruction} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,ASSOCIATED_TOKEN_PROGRAM_ID,getAssociatedTokenAddressSync,createAssociatedTokenAccountIdempotentInstruction,createTransferCheckedInstruction,decodeTransferCheckedInstruction} from '@solana/spl-token';
import {memoFor,TOKEN_NETWORK,type Offer,type RecordItem} from './domain';
import {TOKEN_MINT,TOKEN_DECIMALS} from './token-config';
import {rpc,checkNetwork,type Rpc,type Signer} from './solana';

const MEMO=new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const ACCOUNT_SIZE=165;
type AccountInfo={value:{owner:string}|null};
type TokenAmount={value:{amount:string;decimals:number}};
const verifiedMints=new Map<string,number>();

export function requireMint(address=TOKEN_MINT):PublicKey{
  if(!address)throw new Error('Токен AMT ещё не выпущен в Solana Devnet. Режим недоступен.');
  try{return new PublicKey(address);}catch{throw new Error('Неверный адрес токена AMT. Перевод заблокирован.');}
}
export function tokenAccount(owner:string,mint=TOKEN_MINT){return getAssociatedTokenAddressSync(requireMint(mint),new PublicKey(owner));}
export async function checkTokenMint(call:Rpc=rpc,mint=TOKEN_MINT){
  await checkNetwork(call);
  const address=requireMint(mint);
  if(call===rpc&&Date.now()<(verifiedMints.get(mint)||0))return address;
  const account=await call<AccountInfo>('getAccountInfo',[address.toBase58(),{encoding:'base64',commitment:'confirmed'}]);
  if(account.value?.owner!==TOKEN_PROGRAM_ID.toBase58())throw new Error('Mint AMT не найден в Solana Devnet.');
  const supply=await call<{value:{decimals:number}}>('getTokenSupply',[address.toBase58(),{commitment:'confirmed'}]);
  if(supply.value.decimals!==TOKEN_DECIMALS)throw new Error('Точность mint AMT отличается от приложения.');
  if(call===rpc)verifiedMints.set(mint,Date.now()+60_000);
  return address;
}
export async function tokenBalance(owner:string,call:Rpc=rpc,mint=TOKEN_MINT){
  await checkTokenMint(call,mint);
  const ata=tokenAccount(owner,mint).toBase58();
  const info=await call<AccountInfo>('getAccountInfo',[ata,{encoding:'base64',commitment:'confirmed'}]);
  if(!info.value)return 0;
  if(info.value.owner!==TOKEN_PROGRAM_ID.toBase58())throw new Error('Счёт AMT не принадлежит программе токенов.');
  const amount=await call<TokenAmount>('getTokenAccountBalance',[ata,{commitment:'confirmed'}]);
  if(amount.value.decimals!==TOKEN_DECIMALS)throw new Error('Точность счёта AMT не совпадает.');
  const value=BigInt(amount.value.amount);
  if(value>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Баланс AMT слишком велик для безопасного отображения.');
  return Number(value);
}
function transaction(from:string,to:string,amount:number,mintAddress:string,blockhash:string,memo:string){
  const mint=requireMint(mintAddress),sender=new PublicKey(from),recipient=new PublicKey(to);
  const source=getAssociatedTokenAddressSync(mint,sender),destination=getAssociatedTokenAddressSync(mint,recipient);
  return new Transaction({feePayer:sender,recentBlockhash:blockhash}).add(
    createAssociatedTokenAccountIdempotentInstruction(sender,destination,recipient,mint),
    createTransferCheckedInstruction(source,mint,destination,sender,BigInt(amount),TOKEN_DECIMALS),
    new TransactionInstruction({programId:MEMO,keys:[],data:Buffer.from(memo)})
  );
}
export async function estimateTokenCost(from:string,to:string,call:Rpc=rpc,mint=TOKEN_MINT){
  await checkTokenMint(call,mint);
  const latest=await call<{value:{blockhash:string}}>('getLatestBlockhash',[{commitment:'confirmed'}]);
  const tx=transaction(from,to,1,mint,latest.value.blockhash,'ARM1:'+'0'.repeat(36)+':'+'0'.repeat(36));
  const fee=(await call<{value:number|null}>('getFeeForMessage',[tx.serializeMessage().toString('base64'),{commitment:'confirmed'}])).value;
  if(fee===null)throw new Error('Не удалось рассчитать комиссию Devnet.');
  const destination=tokenAccount(to,mint).toBase58();
  const exists=(await call<AccountInfo>('getAccountInfo',[destination,{encoding:'base64',commitment:'confirmed'}])).value;
  if(exists&&exists.owner!==TOKEN_PROGRAM_ID.toBase58())throw new Error('Счёт получателя занят другой программой.');
  const rent=exists?0:await call<number>('getMinimumBalanceForRentExemption',[ACCOUNT_SIZE,{commitment:'confirmed'}]);
  return {fee,rent,requiredSol:fee+rent};
}
export async function prepareToken(o:Offer,sign:Signer,call:Rpc=rpc):Promise<RecordItem>{
  if(o.network!==TOKEN_NETWORK||o.expires<Date.now())throw new Error('Предложение AMT истекло или имеет неверную сеть.');
  await checkTokenMint(call,o.mint);
  const amount=await tokenBalance(o.from,call,o.mint);
  if(amount<o.lamports)throw new Error('Недостаточно AMT для перевода.');
  const cost=await estimateTokenCost(o.from,o.to,call,o.mint);
  const sol=(await call<{value:number}>('getBalance',[o.from,{commitment:'confirmed'}])).value;
  if(sol<cost.requiredSol)throw new Error('Недостаточно тестовых SOL для комиссии и открытия счёта получателя AMT.');
  const latest=await call<{value:{blockhash:string;lastValidBlockHeight:number}}>('getLatestBlockhash',[{commitment:'confirmed'}]);
  const tx=transaction(o.from,o.to,o.lamports,o.mint!,latest.value.blockhash,memoFor(o));
  const signature=await sign(tx.serializeMessage(),`${o.lamports/1e9} AMT → ${o.to}\nSolana Devnet · комиссия и счёт до ${cost.requiredSol} lamports`,o);
  tx.addSignature(new PublicKey(o.from),Buffer.from(signature));
  if(!tx.verifySignatures())throw new Error('Неверная подпись перевода AMT.');
  return {offer:o,signature:bs58.encode(signature),raw:tx.serialize().toString('base64'),lastValidBlockHeight:latest.value.lastValidBlockHeight,status:'pending',direction:'out',created:Date.now()};
}
export function verifyTokenTransfer(tx:Transaction,o:Offer){
  if(o.network!==TOKEN_NETWORK||!o.mint||tx.instructions.length!==3||tx.feePayer?.toBase58()!==o.from||tx.signatures.length!==1||!tx.verifySignatures())throw new Error('Состав или подпись AMT транзакции не совпадает.');
  const mint=requireMint(o.mint),from=new PublicKey(o.from),to=new PublicKey(o.to);
  const source=getAssociatedTokenAddressSync(mint,from),destination=getAssociatedTokenAddressSync(mint,to);
  const expected=createAssociatedTokenAccountIdempotentInstruction(from,destination,to,mint);
  const actual=tx.instructions[0];
  if(!actual.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)||!actual.data.equals(expected.data)||actual.keys.length!==expected.keys.length||actual.keys.some((k,i)=>!k.pubkey.equals(expected.keys[i].pubkey)||k.isSigner!==expected.keys[i].isSigner||k.isWritable!==expected.keys[i].isWritable))throw new Error('Создание счёта AMT не совпадает с получателем.');
  const transfer=decodeTransferCheckedInstruction(tx.instructions[1]);
  if(!transfer.programId.equals(TOKEN_PROGRAM_ID)||!transfer.keys.source.pubkey.equals(source)||!transfer.keys.mint.pubkey.equals(mint)||!transfer.keys.destination.pubkey.equals(destination)||!transfer.keys.owner.pubkey.equals(from)||transfer.data.amount!==BigInt(o.lamports)||transfer.data.decimals!==TOKEN_DECIMALS)throw new Error('Mint, получатель или сумма AMT не совпадают.');
  const memo=tx.instructions[2];
  if(!memo.programId.equals(MEMO)||memo.keys.length!==0||memo.data.toString('utf8')!==memoFor(o))throw new Error('AMT транзакция относится к другому переводу.');
}
export async function broadcastToken(record:RecordItem,call:Rpc=rpc){
  await checkTokenMint(call,record.offer.mint);
  if(!record.raw||!record.signature)throw new Error('Нет подписанной AMT транзакции.');
  const tx=Transaction.from(Buffer.from(record.raw,'base64'));
  verifyTokenTransfer(tx,record.offer);
  if(!tx.signature||bs58.encode(tx.signature)!==record.signature)throw new Error('Подпись AMT в журнале не совпадает.');
  const returned=await call<string>('sendTransaction',[record.raw,{encoding:'base64',skipPreflight:false,preflightCommitment:'confirmed',maxRetries:3}]);
  if(returned!==record.signature)throw new Error('RPC вернул другую подпись AMT.');
}
type ChainTx={meta:{err:unknown;preTokenBalances?:Array<{accountIndex:number;mint:string;uiTokenAmount:{amount:string}}> ;postTokenBalances?:Array<{accountIndex:number;mint:string;uiTokenAmount:{amount:string}}> }|null;transaction:[string,string]};
export async function reconcileToken(record:RecordItem,call:Rpc=rpc):Promise<RecordItem>{
  await checkTokenMint(call,record.offer.mint);
  if(!record.signature)return record;
  const status=(await call<{value:({err:unknown;confirmationStatus:string}|null)[]}>('getSignatureStatuses',[[record.signature],{searchTransactionHistory:true}])).value[0];
  if(status?.err)return {...record,status:'failed',error:'Solana отклонила AMT транзакцию.'};
  if(!status||!['confirmed','finalized'].includes(status.confirmationStatus))return {...record,status:'pending'};
  const result=await call<ChainTx|null>('getTransaction',[record.signature,{encoding:'base64',commitment:'confirmed',maxSupportedTransactionVersion:0}]);
  if(!result?.meta)return {...record,status:'pending'};
  if(result.meta.err)return {...record,status:'failed',error:'Ошибка исполнения AMT транзакции.'};
  const tx=Transaction.from(Buffer.from(result.transaction[0],'base64'));
  if(!tx.signature||bs58.encode(tx.signature)!==record.signature)throw new Error('RPC вернул другую подпись AMT.');
  verifyTokenTransfer(tx,record.offer);
  const destination=tokenAccount(record.offer.to,record.offer.mint).toBase58();
  const index=tx.compileMessage().accountKeys.findIndex(k=>k.toBase58()===destination);
  const pre=BigInt(result.meta.preTokenBalances?.find(x=>x.accountIndex===index&&x.mint===record.offer.mint)?.uiTokenAmount.amount||'0');
  const post=BigInt(result.meta.postTokenBalances?.find(x=>x.accountIndex===index&&x.mint===record.offer.mint)?.uiTokenAmount.amount||'0');
  if(post-pre!==BigInt(record.offer.lamports))throw new Error('Зачисление AMT не совпадает с суммой перевода.');
  return {...record,status:'confirmed',error:undefined};
}
export async function recoverIncomingToken(record:RecordItem,call:Rpc=rpc){
  if(record.signature)return reconcileToken(record,call);
  await checkTokenMint(call,record.offer.mint);
  const destination=tokenAccount(record.offer.to,record.offer.mint).toBase58();
  const signatures=await call<{signature:string;memo:string|null;err:unknown}[]>('getSignaturesForAddress',[destination,{limit:30,commitment:'confirmed'}]);
  const match=signatures.find(s=>!s.err&&s.memo?.endsWith(memoFor(record.offer)));
  return match?reconcileToken({...record,signature:match.signature,status:'pending'},call):record;
}
