// One idempotent real Devnet SOL transfer for weeks 1–2 of the syllabus.
// Private keys are kept in the git-ignored .devnet directory.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Connection,Keypair,SystemProgram,Transaction,LAMPORTS_PER_SOL} from '@solana/web3.js';
import {GENESIS} from '../../src/domain';

const root=resolve(import.meta.dirname,'../..');
const directory=resolve(root,'.devnet');
const reportPath=resolve(root,'verification/learning-first-transfer.json');
const connection=new Connection(process.env.LEARNING_RPC_URL||'https://api.devnet.solana.com','confirmed');
const amount=1_000_000; // 0.001 test SOL

async function wallet(file:string){
  const path=resolve(directory,file);
  try{return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(path,'utf8'))));}
  catch(error){
    if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
    const key=Keypair.generate();
    await mkdir(directory,{recursive:true});
    await writeFile(path,JSON.stringify([...key.secretKey]),{flag:'wx',mode:0o600});
    return key;
  }
}
async function transfer(from:Keypair,to:Keypair,lamports:number){
  const latest=await connection.getLatestBlockhash('confirmed');
  const tx=new Transaction({feePayer:from.publicKey,recentBlockhash:latest.blockhash}).add(SystemProgram.transfer({fromPubkey:from.publicKey,toPubkey:to.publicKey,lamports}));
  tx.sign(from);
  const signature=await connection.sendRawTransaction(tx.serialize(),{skipPreflight:false,maxRetries:3});
  const confirmed=await connection.confirmTransaction({signature,...latest},'confirmed');
  if(confirmed.value.err)throw new Error(`Devnet rejected transfer: ${JSON.stringify(confirmed.value.err)}`);
  return signature;
}
try{
  if(await connection.getGenesisHash()!==GENESIS)throw new Error('RPC is not Solana Devnet.');
  try{
    const old=JSON.parse(await readFile(reportPath,'utf8'));
    if(old.signature && (await connection.getSignatureStatus(old.signature,{searchTransactionHistory:true})).value?.confirmationStatus){
      console.log(JSON.stringify({...old,reused:true},null,2));
      process.exit(0);
    }
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const sender=await wallet('learning-wallet.json');
  const receiver=await wallet('learning-recipient.json');
  const required=amount+10_000;
  let fundingSignature:string|undefined;
  if(await connection.getBalance(sender.publicKey,'confirmed')<required){
    try{
      const drop=await connection.requestAirdrop(sender.publicKey,Math.round(.02*LAMPORTS_PER_SOL));
      const latest=await connection.getLatestBlockhash('confirmed');
      const result=await connection.confirmTransaction({signature:drop,...latest},'confirmed');
      if(result.value.err)throw new Error(JSON.stringify(result.value.err));
      fundingSignature=drop;
    }catch{
      const funderPath=process.env.LEARNING_FUNDER_KEYPAIR;
      if(!funderPath)throw new Error('Devnet faucet unavailable. Set LEARNING_FUNDER_KEYPAIR to an existing funded Devnet keypair path and rerun.');
      const funder=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(resolve(funderPath),'utf8'))));
      if(await connection.getBalance(funder.publicKey,'confirmed')<Math.round(.012*LAMPORTS_PER_SOL))throw new Error('The selected Devnet funder has insufficient test SOL.');
      fundingSignature=await transfer(funder,sender,Math.round(.01*LAMPORTS_PER_SOL));
    }
  }
  if(await connection.getBalance(sender.publicKey,'confirmed')<required)throw new Error('Sender still has insufficient test SOL.');
  const signature=await transfer(sender,receiver,amount);
  const tx=await connection.getParsedTransaction(signature,{commitment:'confirmed',maxSupportedTransactionVersion:0});
  if(!tx||tx.meta?.err)throw new Error('Confirmed transfer could not be inspected.');
  const report={cluster:'devnet',date:new Date().toISOString(),sender:sender.publicKey.toBase58(),receiver:receiver.publicKey.toBase58(),lamports:amount,signature,explorer:`https://explorer.solana.com/tx/${signature}?cluster=devnet`,fundingSignature,slot:tx.slot,feeLamports:tx.meta?.fee,receiverBalance:await connection.getBalance(receiver.publicKey,'confirmed')};
  await mkdir(resolve(root,'verification'),{recursive:true});
  await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
