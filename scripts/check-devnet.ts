// Real network integration check. Ephemeral test keys stay in RAM, never printed or saved.
import {Keypair} from '@solana/web3.js';
import {createPrivateKey,sign} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {rpc,checkNetwork,balance,prepare,broadcast,reconcile,explorer} from '../src/solana';
import {NETWORK,type Offer} from '../src/domain';
const report:Record<string,unknown>={date:new Date().toISOString(),rpc:'https://api.devnet.solana.com',genesisVerified:false,transferConfirmed:false};
try{
  await checkNetwork();report.genesisVerified=true;report.slot=await rpc('getSlot');
  const sender=Keypair.generate(),receiver=Keypair.generate();report.sender=sender.publicKey.toBase58();report.receiver=receiver.publicKey.toBase58();
  const airdrop=await rpc<string>('requestAirdrop',[sender.publicKey.toBase58(),1e9,{commitment:'confirmed'}]);report.airdrop=airdrop;
  for(let i=0;i<15;i++){if(await balance(sender.publicKey.toBase58())>1_005_000)break;await new Promise(r=>setTimeout(r,4000));}
  const o:Offer={kind:'offer',id:crypto.randomUUID(),network:NETWORK,from:sender.publicKey.toBase58(),to:receiver.publicKey.toBase58(),senderSession:crypto.randomUUID(),receiverSession:crypto.randomUUID(),lamports:1_000_000,expires:Date.now()+120_000};
  const key=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.from(sender.secretKey.slice(0,32))]),format:'der',type:'pkcs8'});
  let record=await prepare(o,async message=>new Uint8Array(sign(null,Buffer.from(message),key)));
  report.signature=record.signature;report.explorer=explorer(record.signature!);
  await broadcast(record);
  for(let i=0;i<20;i++){record=await reconcile(record);if(record.status==='confirmed'||record.status==='failed')break;await new Promise(r=>setTimeout(r,4000));}
  report.transferConfirmed=record.status==='confirmed';report.status=record.status;report.receiverBalance=await balance(o.to);
  if(record.status!=='confirmed')process.exitCode=1;
}catch(e){report.error=e instanceof Error?e.message:String(e);process.exitCode=1;}
mkdirSync('verification',{recursive:true});writeFileSync('verification/devnet-check.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
