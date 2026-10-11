import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Connection,Keypair,PublicKey,SystemProgram,Transaction,LAMPORTS_PER_SOL,sendAndConfirmTransaction} from '@solana/web3.js';
import {getOrCreateAssociatedTokenAccount,transferChecked} from '@solana/spl-token';

const [recipientText,amountText]=process.argv.slice(2);
if(!recipientText||!amountText)throw new Error('Usage: send-devnet-amt.ts <recipient-wallet-address> <amount, max 100>');
const amount=amountText.replace(',','.');
if(!/^(0|[1-9]\d{0,2})(\.\d{1,9})?$/.test(amount))throw new Error('Invalid amount. Use up to 9 decimal places.');
const [whole,fraction='']=amount.split('.');
const units=BigInt(whole)*1_000_000_000n+BigInt(fraction.padEnd(9,'0'));
if(units<=0n||units>100n*1_000_000_000n)throw new Error('Amount must be greater than zero and no more than 100 AMT.');
const recipient=new PublicKey(recipientText);
const directory=join(process.cwd(),'.devnet');
const authority=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(join(directory,'mint-authority.json'),'utf8'))));
const manifest=JSON.parse(await readFile(join(directory,'antimatter-token.json'),'utf8')) as {cluster:string;mint:string;authority:string};
if(manifest.cluster!=='devnet'||manifest.authority!==authority.publicKey.toBase58())throw new Error('Devnet mint authority mismatch.');
const mint=new PublicKey(manifest.mint);
const connection=new Connection('https://api.devnet.solana.com','confirmed');
const source=await getOrCreateAssociatedTokenAccount(connection,authority,mint,authority.publicKey);
const destination=await getOrCreateAssociatedTokenAccount(connection,authority,mint,recipient);
const signature=await transferChecked(connection,authority,source.address,mint,destination.address,authority,units,9);
const solBalance=await connection.getBalance(recipient,'confirmed');
if(solBalance<Math.round(.01*LAMPORTS_PER_SOL)){
  await sendAndConfirmTransaction(connection,new Transaction().add(SystemProgram.transfer({fromPubkey:authority.publicKey,toPubkey:recipient,lamports:Math.round(.01*LAMPORTS_PER_SOL)-solBalance})),[authority],{commitment:'confirmed'});
}
console.log(`Sent ${amount} AMT on Devnet to ${recipient.toBase58()}`);
console.log('Recipient has at least 0.01 test SOL for network fees.');
console.log(`https://explorer.solana.com/tx/${signature}?cluster=devnet`);
