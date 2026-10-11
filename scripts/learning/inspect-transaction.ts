// Week 2: break down a real Devnet transaction into accounts, programs and instructions.
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {Connection} from '@solana/web3.js';
import {GENESIS} from '../../src/domain';

const [signature,flag,path]=process.argv.slice(2);
if(!signature){console.error('Usage: pnpm learning:inspect SIGNATURE [--out FILE]');process.exit(2);}
const connection=new Connection(process.env.LEARNING_RPC_URL||'https://api.devnet.solana.com','confirmed');
try{
  if(await connection.getGenesisHash()!==GENESIS)throw new Error('RPC is not Solana Devnet.');
  const tx=await connection.getParsedTransaction(signature,{commitment:'confirmed',maxSupportedTransactionVersion:0});
  if(!tx)throw new Error('Transaction not found in Devnet history.');
  const keys=tx.transaction.message.accountKeys.map(k=>({address:k.pubkey.toBase58(),signer:k.signer,writable:k.writable}));
  const instructions=tx.transaction.message.instructions.map((instruction,index)=>({
    index,programId:instruction.programId.toBase58(),program:'program' in instruction?instruction.program:undefined,
    accounts:'accounts' in instruction?instruction.accounts.map(x=>x.toBase58()):undefined,
    parsed:'parsed' in instruction?instruction.parsed:undefined,
    data:'data' in instruction?instruction.data:undefined,
  }));
  const accountChanges=keys.map((key,index)=>({...key,beforeLamports:tx.meta?.preBalances[index],afterLamports:tx.meta?.postBalances[index],deltaLamports:tx.meta?tx.meta.postBalances[index]-tx.meta.preBalances[index]:undefined}));
  const report={cluster:'devnet',signature,explorer:`https://explorer.solana.com/tx/${signature}?cluster=devnet`,slot:tx.slot,time:tx.blockTime?new Date(tx.blockTime*1000).toISOString():null,status:tx.meta?.err?'failed':'confirmed',feeLamports:tx.meta?.fee,accountChanges,instructions,innerInstructions:tx.meta?.innerInstructions,logs:tx.meta?.logMessages};
  const output=JSON.stringify(report,null,2)+'\n';
  if(flag==='--out'&&path){const target=resolve(path);await mkdir(dirname(target),{recursive:true});await writeFile(target,output);console.log(`Saved ${target}`);}
  else console.log(output);
}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
