import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,copyFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Keypair} from '@solana/web3.js';

const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const secrets=resolve(root,'.devnet');
const programKey=resolve(secrets,'learning-program-keypair.json');
const walletKey=resolve(secrets,'learning-wallet.json');
mkdirSync(secrets,{recursive:true});

function loadOrCreate(path){
  if(existsSync(path))return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path,'utf8'))));
  const keypair=Keypair.generate();
  writeFileSync(path,JSON.stringify([...keypair.secretKey])+'\n',{mode:0o600,flag:'wx'});
  return keypair;
}

const program=loadOrCreate(programKey);
const wallet=loadOrCreate(walletKey);
const address=program.publicKey.toBase58();
const replacements=[
  ['learning/anchor/programs/antimatter_learning/src/lib.rs',/declare_id!\("[^"]+"\)/,`declare_id!("${address}")`],
  ['learning/anchor/Anchor.toml',/antimatter_learning = "[^"]+"/,`antimatter_learning = "${address}"`],
  ['src/learning-program.ts',/export const LEARNING_PROGRAM_ID=new PublicKey\('[^']+'\)/,`export const LEARNING_PROGRAM_ID=new PublicKey('${address}')`],
];
for(const [relative,pattern,replacement] of replacements){
  const path=resolve(root,relative);
  const current=readFileSync(path,'utf8');
  if(!pattern.test(current))throw new Error(`Expected Program ID declaration not found in ${relative}`);
  const updated=current.replace(pattern,replacement);
  if(updated!==current)writeFileSync(path,updated);
}
const deployDir=resolve(root,'learning/anchor/target/deploy');
mkdirSync(deployDir,{recursive:true});
copyFileSync(programKey,resolve(deployDir,'antimatter_learning-keypair.json'));
execFileSync(process.execPath,[resolve(root,'scripts/learning/generate-idl.mjs')],{cwd:root,stdio:'inherit'});
console.log(JSON.stringify({programId:address,wallet:wallet.publicKey.toBase58(),keypair:programKey,anchorDeployKeypair:resolve(deployDir,'antimatter_learning-keypair.json')},null,2));
