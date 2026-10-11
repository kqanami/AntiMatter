import {createServer} from 'node:http';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {Keypair,PublicKey,Connection,SystemProgram,Transaction} from '@solana/web3.js';
import {createAssociatedTokenAccountIdempotentInstruction,createTransferCheckedInstruction,getAssociatedTokenAddressSync,getMint,getAccount} from '@solana/spl-token';
import bs58 from 'bs58';

// Test assets only. The mint authority never leaves this process or .devnet/.
const root=process.cwd(),dir=join(root,'.devnet');
const ledgerPath=join(dir,'dispenser-claims.json');
const rpcUrl=process.env.DEVNET_RPC_URL||'https://api.devnet.solana.com';
const port=Number(process.env.DISPENSER_PORT||5181);
const expectedGenesis='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const units=1_000_000_000n; // 1 AMT, 9 decimals
const solLamports=20_000_000; // 0.02 Devnet SOL for transfer fees and ATA rent
const maxClaims=6;
const authority=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(join(dir,'mint-authority.json'),'utf8'))));
const manifest=JSON.parse(await readFile(join(dir,'antimatter-token.json'),'utf8'));
if(manifest.cluster!=='devnet'||manifest.authority!==authority.publicKey.toBase58())throw new Error('Devnet authority mismatch');
const mint=new PublicKey(manifest.mint);
const connection=new Connection(rpcUrl,'confirmed');
if(await connection.getGenesisHash()!==expectedGenesis)throw new Error('RPC is not Solana Devnet');
const mintInfo=await getMint(connection,mint);
if(mintInfo.decimals!==9)throw new Error('Unexpected token decimals');
const source=getAssociatedTokenAddressSync(mint,authority.publicKey);
await getAccount(connection,source);
await mkdir(dir,{recursive:true});
let claims={};
try{claims=JSON.parse(await readFile(ledgerPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
let queue=Promise.resolve();
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'});res.end(JSON.stringify(data));};
async function persist(){const temp=ledgerPath+'.tmp';await writeFile(temp,JSON.stringify(claims,null,2));await rename(temp,ledgerPath);}
async function claim(addressText){
  if(typeof addressText!=='string'||addressText.length<32||addressText.length>44)throw Object.assign(new Error('Неверный адрес кошелька.'),{status:400});
  let recipient;try{recipient=new PublicKey(addressText);if(!PublicKey.isOnCurve(recipient.toBytes()))throw new Error();}catch{throw Object.assign(new Error('Неверный адрес кошелька.'),{status:400});}
  const address=recipient.toBase58();
  if(claims[address]){
    const existing=claims[address];
    if(existing.signature&&existing.status==='pending'){
      const result=await connection.getSignatureStatus(existing.signature,{searchTransactionHistory:true});
      if(result.value?.confirmationStatus==='confirmed'||result.value?.confirmationStatus==='finalized'){
        existing.status='confirmed';await persist();
      }
    }
    return {status:existing.status,signature:existing.signature||null,amountAMT:1,amountSOL:0.02,alreadyIssued:true};
  }
  if(Object.keys(claims).length>=maxClaims)throw Object.assign(new Error('Лимит тестовой выдачи проекта исчерпан.'),{status:429});
  const [sol,account]=await Promise.all([connection.getBalance(authority.publicKey,'confirmed'),getAccount(connection,source)]);
  if(sol<solLamports+5_000_000||account.amount<units)throw Object.assign(new Error('Тестовый резерв проекта пока пуст.'),{status:503});
  const destination=getAssociatedTokenAddressSync(mint,recipient);
  const transaction=new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(authority.publicKey,destination,recipient,mint),
    createTransferCheckedInstruction(source,mint,destination,authority.publicKey,units,9),
    SystemProgram.transfer({fromPubkey:authority.publicKey,toPubkey:recipient,lamports:solLamports})
  );
  const block=await connection.getLatestBlockhash('confirmed');
  transaction.feePayer=authority.publicKey;transaction.recentBlockhash=block.blockhash;
  transaction.sign(authority);
  const raw=transaction.serialize();
  const signature=bs58.encode(transaction.signature);
  claims[address]={status:'pending',signature,createdAt:new Date().toISOString()};
  await persist(); // reserve before broadcast, so repeated calls cannot double-spend
  try{
    await connection.sendRawTransaction(raw,{skipPreflight:false,maxRetries:3});
    await connection.confirmTransaction({signature,...block},'confirmed');
    claims[address].status='confirmed';await persist();
  }catch(error){
    // The signed transaction may have landed. Keep the address reserved until checked.
    console.error('Claim pending:',address,signature,error.message);
  }
  return {status:claims[address].status,signature,amountAMT:1,amountSOL:0.02,alreadyIssued:false};
}
createServer(async(req,res)=>{
  if(req.method==='OPTIONS')return json(res,204,{});
  if(req.method==='GET'&&req.url==='/health')return json(res,200,{ok:true,cluster:'devnet',mint:mint.toBase58(),remaining:maxClaims-Object.keys(claims).length});
  if(req.method!=='POST'||req.url!=='/v1/claim')return json(res,404,{error:'Not found'});
  let body='';req.on('data',part=>{body+=part;if(body.length>1024)req.destroy();});
  req.on('end',()=>{queue=queue.then(async()=>{
    try{const data=JSON.parse(body);json(res,200,await claim(data.address));}
    catch(error){console.error('Claim rejected:',error.message);json(res,error.status||500,{error:error.status?error.message:'Выдача временно недоступна. Повторите позже.'});}
  }).catch(error=>console.error(error));});
}).listen(port,'127.0.0.1',()=>console.log(`Devnet dispenser listening on 127.0.0.1:${port}; mint ${mint.toBase58()}; capacity ${maxClaims}`));
