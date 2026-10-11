import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Keypair} from '@solana/web3.js';

const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const built=resolve(root,'learning/anchor/target/idl/antimatter_learning.json');
const target=resolve(root,'learning/idl/antimatter_learning.json');
const key=resolve(root,'.devnet/learning-program-keypair.json');
const idl=JSON.parse(readFileSync(built,'utf8'));
const address=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(key,'utf8')))).publicKey.toBase58();
if(idl.address!==address)throw new Error(`Built IDL address ${idl.address} differs from program keypair ${address}.`);
const instructions=new Set((idl.instructions||[]).map(item=>item.name));
for(const name of ['ping','initialize_counter','increment_counter','create_profile','update_profile']){
  if(!instructions.has(name))throw new Error(`Built IDL is missing ${name}.`);
}
writeFileSync(target,JSON.stringify(idl,null,2)+'\n');
console.log(`Synchronized Anchor-built IDL for ${address}`);
