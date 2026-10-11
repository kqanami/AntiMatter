// Week 7: inspect the existing Devnet AMT mint and attach Metaplex metadata.
// The signing key stays in .devnet; only public addresses are printed.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import bs58 from 'bs58';
import {Connection,Keypair,PublicKey} from '@solana/web3.js';
import {getAccount,getMint,TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {createUmi} from '@metaplex-foundation/umi-bundle-defaults';
import {createSignerFromKeypair,keypairIdentity,publicKey} from '@metaplex-foundation/umi';
import {createMetadataAccountV3,fetchMetadata,findMetadataPda,mplTokenMetadata} from '@metaplex-foundation/mpl-token-metadata';
import {GENESIS} from '../../src/domain';

const [command='status']=process.argv.slice(2);
const rpcUrl=process.env.LEARNING_RPC_URL||'https://api.devnet.solana.com';
if(!rpcUrl.startsWith('https://'))throw new Error('LEARNING_RPC_URL must be HTTPS.');
const connection=new Connection(rpcUrl,'confirmed');
const umi=createUmi(rpcUrl).use(mplTokenMetadata());
const metadataUri='https://raw.githubusercontent.com/kqanami/AntiMatter/main/learning/token/metadata.json';
const manifest=JSON.parse(await readFile(resolve('.devnet/antimatter-token.json'),'utf8')) as {
  cluster:string;mint:string;decimals:number;symbol:string;name:string;authority:string;treasury:string;supply:string;
};
if(manifest.cluster!=='devnet')throw new Error('Token manifest is not for Devnet.');
if(await connection.getGenesisHash()!==GENESIS)throw new Error('RPC is not Solana Devnet.');
const mintAddress=new PublicKey(manifest.mint);
const mint=await getMint(connection,mintAddress,'confirmed',TOKEN_PROGRAM_ID);
const treasury=await getAccount(connection,new PublicKey(manifest.treasury),'confirmed',TOKEN_PROGRAM_ID);
if(mint.mintAuthority?.toBase58()!==manifest.authority||mint.decimals!==manifest.decimals||mint.supply!==BigInt(manifest.supply)||treasury.mint.toBase58()!==manifest.mint||treasury.owner.toBase58()!==manifest.authority){
  throw new Error('On-chain mint or treasury does not match the local manifest.');
}
const metadataPda=findMetadataPda(umi,{mint:publicKey(manifest.mint)});
const metadataAddress=metadataPda[0];
const metadataInfo=await connection.getAccountInfo(new PublicKey(metadataAddress),'confirmed');

async function status(signature?:string){
  const metadata=metadataInfo?await fetchMetadata(umi,metadataPda):null;
  const valid=metadata?.name.trim()===manifest.name&&metadata?.symbol.trim()===manifest.symbol&&metadata?.uri.trim()===metadataUri;
  const result={cluster:'devnet',mint:manifest.mint,decimals:mint.decimals,supply:mint.supply.toString(),treasury:manifest.treasury,treasuryAmount:treasury.amount.toString(),metadataAddress,metadataCreated:!!metadata,metadataMatches:!!valid,metadataUri,signature,explorer:`https://explorer.solana.com/address/${manifest.mint}?cluster=devnet`};
  console.log(JSON.stringify(result,null,2));
  await mkdir(resolve('verification'),{recursive:true});
  await writeFile(resolve('verification/learning-week7-token.json'),JSON.stringify(result,null,2)+'\n');
}

if(command==='status'){
  await status();
}else if(command==='metadata:create'){
  if(metadataInfo){
    const current=await fetchMetadata(umi,metadataPda);
    if(current.name.trim()!==manifest.name||current.symbol.trim()!==manifest.symbol||current.uri.trim()!==metadataUri)throw new Error('Metadata already exists with different values; refusing to overwrite it.');
    await status();
  }else{
    const response=await fetch(metadataUri);
    if(!response.ok)throw new Error(`Public metadata JSON is unavailable: HTTP ${response.status}. Push learning/token first.`);
    const json=await response.json() as {name?:string;symbol?:string;image?:string};
    if(json.name!==manifest.name||json.symbol!==manifest.symbol||!json.image||!(await fetch(json.image)).ok)throw new Error('Public metadata JSON or token image does not match the mint.');
    const key=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(resolve('.devnet/mint-authority.json'),'utf8'))));
    if(key.publicKey.toBase58()!==manifest.authority)throw new Error('Mint authority key does not match the manifest.');
    const umiSigner=createSignerFromKeypair(umi,umi.eddsa.createKeypairFromSecretKey(key.secretKey));
    umi.use(keypairIdentity(umiSigner));
    const result=await createMetadataAccountV3(umi,{
      mint:publicKey(manifest.mint),mintAuthority:umiSigner,updateAuthority:umiSigner,
      data:{name:manifest.name,symbol:manifest.symbol,uri:metadataUri,sellerFeeBasisPoints:0,creators:null,collection:null,uses:null},
      isMutable:true,collectionDetails:null,
    }).sendAndConfirm(umi,{confirm:{commitment:'confirmed'}});
    const signature=bs58.encode(result.signature);
    const confirmed=await fetchMetadata(umi,metadataPda);
    if(confirmed.name.trim()!==manifest.name||confirmed.symbol.trim()!==manifest.symbol||confirmed.uri.trim()!==metadataUri)throw new Error('Metadata transaction confirmed but the fetched fields differ.');
    const report={cluster:'devnet',mint:manifest.mint,metadataAddress,metadataUri,signature,explorer:`https://explorer.solana.com/tx/${signature}?cluster=devnet`};
    await writeFile(resolve('verification/learning-week7-metadata.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
  }
}else{
  throw new Error('Usage: pnpm learning:token <status|metadata:create>');
}
