import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {Buffer} from 'buffer';
import {Keypair,PublicKey,SystemProgram,Transaction,TransactionInstruction} from '@solana/web3.js';
import {createAssociatedTokenAccountIdempotentInstruction,createTransferCheckedInstruction,getAssociatedTokenAddressSync} from '@solana/spl-token';

const manifest=JSON.parse(await readFile('.devnet/antimatter-token.json','utf8')) as {mint:string};
const source=resolve('android/app/src/main/java/kz/armtranzit/app/TransferMessage.java');
const output=resolve('.devnet/native-sign-check');
await mkdir(output,{recursive:true});
const runner=join(output,'CheckTransferMessage.java');
await writeFile(runner,`package kz.armtranzit.app;
import java.util.Base64;
public class CheckTransferMessage {
  public static void main(String[] args) {
    try {
      String summary=TransferMessage.describe(Base64.getDecoder().decode(args[0]),Base64.getDecoder().decode(args[1]),args[2],Long.parseLong(args[3]),args[4],args[5]);
      if (!args[6].equals("accept")) throw new RuntimeException("Unsafe message was accepted: "+summary);
      if (!summary.contains(args[7])) throw new RuntimeException("Wrong summary: "+summary);
      System.out.println(summary.replace('\\n',' '));
    } catch (IllegalArgumentException e) {
      if (!args[6].equals("reject")) throw e;
      System.out.println("Rejected unsafe message");
    }
  }
}`);
const jdkFolders=await readdir('.tools/jdk');
const javaBin=process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin'):join(resolve('.tools/jdk'),jdkFolders[0],'bin');
const javac=join(javaBin,process.platform==='win32'?'javac.exe':'javac');
const java=join(javaBin,process.platform==='win32'?'java.exe':'java');
const compiled=spawnSync(javac,['-encoding','UTF-8','-d',output,source,runner],{encoding:'utf8'});
if(compiled.status!==0)throw new Error(compiled.stderr||'javac failed');
const sender=Keypair.generate().publicKey,recipient=Keypair.generate().publicKey;
const blockhash=Keypair.generate().publicKey.toBase58();
const memoProgram=new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
function message(mintText:string,amount:bigint,extra=false){
  const mint=new PublicKey(mintText);
  const transaction=new Transaction({feePayer:sender,recentBlockhash:blockhash}).add(
    createAssociatedTokenAccountIdempotentInstruction(sender,getAssociatedTokenAddressSync(mint,recipient),recipient,mint),
    createTransferCheckedInstruction(getAssociatedTokenAddressSync(mint,sender),mint,getAssociatedTokenAddressSync(mint,recipient),sender,amount,9),
    new TransactionInstruction({programId:memoProgram,keys:[],data:Buffer.from('ARM1:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222')})
  );
  if(extra)transaction.add(SystemProgram.transfer({fromPubkey:sender,toPubkey:recipient,lamports:1}));
  return transaction.serializeMessage().toString('base64');
}
const memo='ARM1:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222';
function solMessage(amount:number){return new Transaction({feePayer:sender,recentBlockhash:blockhash}).add(SystemProgram.transfer({fromPubkey:sender,toPubkey:recipient,lamports:amount}),new TransactionInstruction({programId:memoProgram,keys:[],data:Buffer.from(memo)})).serializeMessage().toString('base64');}
const cases:[string,string,bigint,string,string,string][]=[
  [message(manifest.mint,1_000_000_000n),recipient.toBase58(),1_000_000_000n,memo,'solana-devnet-amt','accept'],
  [message(manifest.mint,1_000_000_000n),sender.toBase58(),1_000_000_000n,memo,'solana-devnet-amt','reject'],
  [message(manifest.mint,1_000_000_000n),recipient.toBase58(),2_000_000_000n,memo,'solana-devnet-amt','reject'],
  [message(manifest.mint,1_000_000_000n),recipient.toBase58(),1_000_000_000n,memo.replace('ARM1:','ARM1:x'),'solana-devnet-amt','reject'],
  [message(manifest.mint,1_000_000_000n),recipient.toBase58(),1_000_000_000n,memo,'solana-devnet','reject'],
  [message(Keypair.generate().publicKey.toBase58(),1_000_000_000n),recipient.toBase58(),1_000_000_000n,memo,'solana-devnet-amt','reject'],
  [message(manifest.mint,11_000_000_000n),recipient.toBase58(),11_000_000_000n,memo,'solana-devnet-amt','reject'],
  [message(manifest.mint,1_000_000_000n,true),recipient.toBase58(),1_000_000_000n,memo,'solana-devnet-amt','reject'],
  [solMessage(1_000_000),recipient.toBase58(),1_000_000n,memo,'solana-devnet','accept'],
  [solMessage(1_000_000),sender.toBase58(),1_000_000n,memo,'solana-devnet','reject'],
  [solMessage(1_000_000),recipient.toBase58(),2_000_000n,memo,'solana-devnet','reject']
];
for(const [payload,expectedRecipient,expectedAmount,expectedMemo,network,result] of cases){
  const run=spawnSync(java,['-cp',output,'kz.armtranzit.app.CheckTransferMessage',payload,Buffer.from(sender.toBytes()).toString('base64'),expectedRecipient,String(expectedAmount),expectedMemo,network,result,result==='accept'?(network==='solana-devnet'?'SOL':'AMT'):''],{encoding:'utf8'});
  if(run.status!==0)throw new Error(run.stderr||run.stdout||'Native signing check failed');
  console.log(run.stdout.trim());
}
