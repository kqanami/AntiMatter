import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import nacl from 'tweetnacl';
import {Connection,Keypair,LAMPORTS_PER_SOL,PublicKey,SystemProgram,Transaction,sendAndConfirmTransaction} from '@solana/web3.js';
import {getMint,getOrCreateAssociatedTokenAccount,getAccount,transferChecked} from '@solana/spl-token';
import {TOKEN_NETWORK,type Offer} from '../src/domain';

const directory=join(process.cwd(),'.devnet');
const authority=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(join(directory,'mint-authority.json'),'utf8'))));
const manifest=JSON.parse(await readFile(join(directory,'antimatter-token.json'),'utf8')) as {cluster:string;mint:string;authority:string;treasury:string;supply:string};
if(manifest.cluster!=='devnet'||manifest.authority!==authority.publicKey.toBase58())throw new Error('Manifest/authority mismatch.');
const connection=new Connection('https://api.devnet.solana.com','confirmed');
const mintAddress=new PublicKey(manifest.mint);
const mint=await getMint(connection,mintAddress,'confirmed');
const treasury=await getAccount(connection,new PublicKey(manifest.treasury),'confirmed');
const solBalance=await connection.getBalance(authority.publicKey,'confirmed');
if(mint.decimals!==9||mint.mintAuthority?.toBase58()!==manifest.authority||mint.supply!==BigInt(manifest.supply)||treasury.mint.toBase58()!==manifest.mint||treasury.owner.toBase58()!==manifest.authority||treasury.amount<BigInt(10*LAMPORTS_PER_SOL))throw new Error('Devnet mint state does not match manifest.');
console.log(`Verified AMT mint ${manifest.mint}; supply ${Number(mint.supply)/LAMPORTS_PER_SOL}; treasury ${Number(treasury.amount)/LAMPORTS_PER_SOL}; authority SOL ${solBalance/LAMPORTS_PER_SOL}`);

// Exercise the exact app preparation, broadcast and reconciliation path against Devnet.
process.env.VITE_AMT_MINT=manifest.mint;
const {prepareToken,broadcastToken,reconcileToken,tokenBalance}=await import('../src/amt');
const sender=Keypair.generate(),recipient=Keypair.generate();
const senderAccount=await getOrCreateAssociatedTokenAccount(connection,authority,mintAddress,sender.publicKey);
const funding=await transferChecked(connection,authority,new PublicKey(manifest.treasury),mintAddress,senderAccount.address,authority,2n*BigInt(LAMPORTS_PER_SOL),9);
await connection.confirmTransaction(funding,'confirmed');
await sendAndConfirmTransaction(connection,new Transaction().add(SystemProgram.transfer({fromPubkey:authority.publicKey,toPubkey:sender.publicKey,lamports:Math.round(0.01*LAMPORTS_PER_SOL)})),[authority],{commitment:'confirmed'});
const offer:Offer={kind:'offer',id:randomUUID(),network:TOKEN_NETWORK,mint:manifest.mint,from:sender.publicKey.toBase58(),to:recipient.publicKey.toBase58(),senderSession:randomUUID(),receiverSession:randomUUID(),lamports:LAMPORTS_PER_SOL,expires:Date.now()+120_000};
const before=await tokenBalance(offer.to);
const record=await prepareToken(offer,async message=>nacl.sign.detached(message,sender.secretKey));
await broadcastToken(record);
let result=record;
for(let i=0;i<12;i++){
  result=await reconcileToken(result);
  if(result.status!=='pending')break;
  await new Promise(resolve=>setTimeout(resolve,1500));
}
const after=await tokenBalance(offer.to);
if(result.status!=='confirmed'||after-before!==offer.lamports)throw new Error(`Live transfer not confirmed: ${result.status}; balance change ${after-before}.`);
await writeFile(join(process.cwd(),'verification','learning-week8-mvp.json'),JSON.stringify({
  cluster:'devnet',scenario:'ANTIMATTER AMT app transfer path',mint:manifest.mint,
  sender:offer.from,recipient:offer.to,amountBaseUnits:String(offer.lamports),
  beforeBaseUnits:String(before),afterBaseUnits:String(after),
  fundingSignature:funding,transferSignature:record.signature,
  status:result.status,explorer:`https://explorer.solana.com/tx/${record.signature}?cluster=devnet`,
},null,2)+'\n');
console.log(`Verified live app transfer: 1 AMT credited to a new wallet; signature ${record.signature}`);
