// Exercise every Anchor instruction on Devnet and save public evidence.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {AnchorProvider,Program,Wallet,type Idl} from '@anchor-lang/core';
import {Connection,Keypair,PublicKey,SystemProgram} from '@solana/web3.js';
import idl from '../../learning/idl/antimatter_learning.json';
import {GENESIS} from '../../src/domain';

const rpcUrl=process.env.LEARNING_RPC_URL||'https://api.devnet.solana.com';
if(!rpcUrl.startsWith('https://'))throw new Error('LEARNING_RPC_URL must be HTTPS.');
const connection=new Connection(rpcUrl,'confirmed');
if(await connection.getGenesisHash()!==GENESIS)throw new Error('RPC is not Solana Devnet.');
const secret=JSON.parse(await readFile(resolve('.devnet/learning-wallet.json'),'utf8'));
const signer=Keypair.fromSecretKey(Uint8Array.from(secret));
const programId=new PublicKey(idl.address);
const programInfo=await connection.getAccountInfo(programId,'confirmed');
if(!programInfo?.executable)throw new Error('The learning program is not deployed on Devnet.');
const provider=new AnchorProvider(connection,new Wallet(signer),{commitment:'confirmed',preflightCommitment:'confirmed'});
const program=new Program(idl as Idl,provider);
const counter=PublicKey.findProgramAddressSync([Buffer.from('counter'),signer.publicKey.toBuffer()],programId)[0];
const profile=PublicKey.findProgramAddressSync([Buffer.from('profile'),signer.publicKey.toBuffer()],programId)[0];
const transactions:Record<string,string>={};
transactions.ping=await program.methods.ping().accountsStrict({authority:signer.publicKey}).rpc();
console.log(`ping: ${transactions.ping}`);
if(!await connection.getAccountInfo(counter,'confirmed')){
  transactions.initializeCounter=await program.methods.initializeCounter().accountsStrict({authority:signer.publicKey,counter,systemProgram:SystemProgram.programId}).rpc();
  console.log(`initialize counter: ${transactions.initializeCounter}`);
}
const countBefore=String((await program.account.counter.fetch(counter)).count);
transactions.incrementCounter=await program.methods.incrementCounter().accountsStrict({authority:signer.publicKey,counter}).rpc();
const countAfter=String((await program.account.counter.fetch(counter)).count);
console.log(`increment counter: ${transactions.incrementCounter} (${countBefore} -> ${countAfter})`);
if(!await connection.getAccountInfo(profile,'confirmed')){
  transactions.createProfile=await program.methods.createProfile('ANTIMATTER','Учебный профиль Solana Devnet').accountsStrict({authority:signer.publicKey,profile,systemProgram:SystemProgram.programId}).rpc();
  console.log(`create profile: ${transactions.createProfile}`);
}
transactions.updateProfile=await program.methods.updateProfile('ANTIMATTER','Профиль обновлён через Anchor PDA').accountsStrict({authority:signer.publicKey,profile}).rpc();
const state=await program.account.profile.fetch(profile);
console.log(`update profile: ${transactions.updateProfile}`);
const report={cluster:'devnet',programId:programId.toBase58(),wallet:signer.publicKey.toBase58(),counter:counter.toBase58(),countBefore,countAfter,profile:profile.toBase58(),displayName:state.displayName,bio:state.bio,transactions,explorer:Object.fromEntries(Object.entries(transactions).map(([name,signature])=>[name,`https://explorer.solana.com/tx/${signature}?cluster=devnet`]))};
await writeFile(resolve('verification/learning-program-calls.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
