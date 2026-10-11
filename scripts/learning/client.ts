// Anchor client for the Devnet learning program. Never falls back to mainnet.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {AnchorProvider,Program,Wallet,type Idl} from '@anchor-lang/core';
import {Connection,Keypair,PublicKey,SystemProgram} from '@solana/web3.js';
import idl from '../../learning/idl/antimatter_learning.json';
import {GENESIS} from '../../src/domain';

const rpcUrl=process.env.LEARNING_RPC_URL||'https://api.devnet.solana.com';
if(!rpcUrl.startsWith('https://'))throw new Error('LEARNING_RPC_URL must use HTTPS and point to Devnet.');
const connection=new Connection(rpcUrl,'confirmed');
const programId=new PublicKey(idl.address);
const [command,...args]=process.argv.slice(2);

function address(value:string|undefined):PublicKey{
  if(!value)throw new Error('Provide a wallet address.');
  return new PublicKey(value);
}
function pda(seed:string,authority:PublicKey){return PublicKey.findProgramAddressSync([Buffer.from(seed),authority.toBuffer()],programId)[0];}
async function devnet(){if(await connection.getGenesisHash()!==GENESIS)throw new Error('RPC is not Solana Devnet.');}
async function deployed(){
  await devnet();
  const info=await connection.getAccountInfo(programId,'confirmed');
  if(!info?.executable)throw new Error(`Program ${programId.toBase58()} is not deployed on Devnet. Build and deploy from learning/anchor first.`);
}
async function signer(){
  const path=resolve(process.env.LEARNING_KEYPAIR||'.devnet/learning-wallet.json');
  const secret=Uint8Array.from(JSON.parse(await readFile(path,'utf8')));
  if(secret.length!==64)throw new Error('Learning keypair must contain 64 bytes.');
  return Keypair.fromSecretKey(secret);
}
async function anchored(){
  await deployed();
  const keypair=await signer();
  const provider=new AnchorProvider(connection,new Wallet(keypair),{commitment:'confirmed',preflightCommitment:'confirmed'});
  return {keypair,program:new Program(idl as Idl,provider)};
}
function link(signature:string){return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;}

try{
  if(command==='status'){
    await devnet();
    const info=await connection.getAccountInfo(programId,'confirmed');
    console.log(JSON.stringify({cluster:'devnet',programId:programId.toBase58(),deployed:!!info?.executable,explorer:`https://explorer.solana.com/address/${programId}?cluster=devnet`},null,2));
  }else if(command==='derive'){
    const owner=address(args[0]);
    console.log(JSON.stringify({wallet:owner.toBase58(),counter:pda('counter',owner).toBase58(),profile:pda('profile',owner).toBase58()},null,2));
  }else if(command==='ping'){
    const {keypair,program}=await anchored();
    const signature=await program.methods.ping().accountsStrict({authority:keypair.publicKey}).rpc();
    console.log(JSON.stringify({signature,explorer:link(signature)},null,2));
  }else if(command==='counter:init'||command==='counter:increment'||command==='counter:show'){
    const {keypair,program}=await anchored();
    const counter=pda('counter',keypair.publicKey);
    if(command==='counter:init'){
      const signature=await program.methods.initializeCounter().accountsStrict({authority:keypair.publicKey,counter,systemProgram:SystemProgram.programId}).rpc();
      console.log(`Created counter: ${counter.toBase58()}\n${link(signature)}`);
    }else if(command==='counter:increment'){
      const signature=await program.methods.incrementCounter().accountsStrict({authority:keypair.publicKey,counter}).rpc();
      console.log(`Incremented counter: ${counter.toBase58()}\n${link(signature)}`);
    }
    const state=await program.account.counter.fetch(counter);
    console.log(JSON.stringify({address:counter.toBase58(),authority:String(state.authority),count:String(state.count),bump:state.bump},null,2));
  }else if(command==='profile:create'||command==='profile:update'||command==='profile:show'){
    const {keypair,program}=await anchored();
    const profile=pda('profile',keypair.publicKey);
    if(command!=='profile:show'){
      const displayName=args[0]?.trim()||'';
      const bio=args[1]?.trim()||'';
      if(!displayName||Buffer.byteLength(displayName,'utf8')>32||Buffer.byteLength(bio,'utf8')>160)throw new Error('Name: 1–32 UTF-8 bytes; bio: up to 160 UTF-8 bytes. This data will be public on-chain.');
      const signature=command==='profile:create'
        ?await program.methods.createProfile(displayName,bio).accountsStrict({authority:keypair.publicKey,profile,systemProgram:SystemProgram.programId}).rpc()
        :await program.methods.updateProfile(displayName,bio).accountsStrict({authority:keypair.publicKey,profile}).rpc();
      console.log(`Updated profile: ${profile.toBase58()}\n${link(signature)}`);
    }
    const state=await program.account.profile.fetch(profile);
    console.log(JSON.stringify({address:profile.toBase58(),authority:String(state.authority),displayName:state.displayName,bio:state.bio,updatedSlot:String(state.updatedSlot),bump:state.bump},null,2));
  }else{
    console.log('Usage: pnpm learning:client <status|derive WALLET|ping|counter:init|counter:increment|counter:show|profile:create NAME BIO|profile:update NAME BIO|profile:show>');
    process.exitCode=command?2:0;
  }
}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
