import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Keypair, Connection, LAMPORTS_PER_SOL} from '@solana/web3.js';
import {createMint, getOrCreateAssociatedTokenAccount, mintTo, getMint} from '@solana/spl-token';

// This script only creates a test asset on Solana Devnet. The authority key
// never belongs in the app, its APK, an archive, or source control.
const directory=join(process.cwd(),'.devnet');
const authorityFile=join(directory,'mint-authority.json');
const mintKeyFile=join(directory,'mint-keypair.json');
const manifestFile=join(directory,'antimatter-token.json');
const appConfigFile=join(process.cwd(),'.env.local');
const connection=new Connection('https://api.devnet.solana.com','confirmed');

await mkdir(directory,{recursive:true});
let authority:Keypair;
try {
  authority=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(authorityFile,'utf8'))));
} catch(e) {
  if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;
  authority=Keypair.generate();
  await writeFile(authorityFile,JSON.stringify([...authority.secretKey]),{flag:'wx',mode:0o600});
}

console.log(`Devnet authority: ${authority.publicKey.toBase58()}`);
const funds=await connection.getBalance(authority.publicKey,'confirmed');
if(funds<Math.round(.06*LAMPORTS_PER_SOL)) {
  console.log('Requesting free Devnet SOL for token account rent and fees…');
  try {
    const sig=await connection.requestAirdrop(authority.publicKey,LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig,'confirmed');
  } catch(e) {
    console.error('Devnet airdrop unavailable; mint has not been created. Fund the printed authority address with test SOL and rerun this script.');
    console.error(e instanceof Error?e.message:String(e));
    process.exit(2);
  }
}

let mintKey:Keypair;
try {
  mintKey=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(mintKeyFile,'utf8'))));
} catch(e) {
  if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;
  mintKey=Keypair.generate();
  await writeFile(mintKeyFile,JSON.stringify([...mintKey.secretKey]),{flag:'wx',mode:0o600});
}
const mintAddress=mintKey.publicKey;
if(!await connection.getAccountInfo(mintAddress,'confirmed')){
  await createMint(connection,authority,authority.publicKey,null,9,mintKey);
  console.log(`Created token mint: ${mintAddress.toBase58()}`);
}
const mint=await getMint(connection,mintAddress,'confirmed');
if(mint.decimals!==9||mint.mintAuthority?.toBase58()!==authority.publicKey.toBase58())throw new Error('Mint does not match its authority and decimals.');
const treasury=await getOrCreateAssociatedTokenAccount(connection,authority,mintAddress,authority.publicKey);
const targetSupply=1_000n*1_000_000_000n;
if(mint.supply<targetSupply)await mintTo(connection,authority,mintAddress,treasury.address,authority,targetSupply-mint.supply);
const manifest={cluster:'devnet',mint:mintAddress.toBase58(),decimals:9,symbol:'AMT',name:'ANTIMATTER Test',authority:authority.publicKey.toBase58(),treasury:treasury.address.toBase58(),supply:targetSupply.toString()};
await writeFile(manifestFile,JSON.stringify(manifest,null,2));
await writeFile(appConfigFile,`VITE_AMT_MINT=${manifest.mint}\n`);
console.log(`Explorer: https://explorer.solana.com/address/${manifest.mint}?cluster=devnet`);
