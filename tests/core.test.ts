import {describe,it,expect} from 'vitest';
import {Keypair,Transaction} from '@solana/web3.js';
import {createPrivateKey,sign} from 'node:crypto';
import {Buffer} from 'buffer';
import {parseAmount,parseWire,validateOffer,autoCandidate,NETWORK,GENESIS,type Offer,type Hello} from '../src/domain';
import {prepare,broadcast,reconcile,verifyTransfer,recoverIncoming,type Rpc} from '../src/solana';
const sender=Keypair.generate(),receiver=Keypair.generate();
const senderSession='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',receiverSession='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const offer=():Offer=>({kind:'offer',id:crypto.randomUUID(),network:NETWORK,from:sender.publicKey.toBase58(),to:receiver.publicKey.toBase58(),senderSession,receiverSession,lamports:1_000_000,expires:Date.now()+120_000});
const signer=async(data:Uint8Array)=>new Uint8Array(sign(null,Buffer.from(data),createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.from(sender.secretKey.slice(0,32))]),format:'der',type:'pkcs8'})));
function fixture(overrides:Record<string,unknown>={}){const calls:{method:string;params:unknown[]|undefined}[]=[];const call:Rpc=async<T>(method:string,params?:unknown[])=>{calls.push({method,params});if(method in overrides)return overrides[method] as T;const base:Record<string,unknown>={getGenesisHash:GENESIS,getLatestBlockhash:{value:{blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:100}},getFeeForMessage:{value:5000},getBalance:{value:2e9},getSignatureStatuses:{value:[null]},getTransaction:null};if(method==='sendTransaction'){const tx=Transaction.from(Buffer.from(params![0] as string,'base64'));return (await import('bs58')).default.encode(tx.signature!) as T;}if(!(method in base))throw new Error('Unexpected '+method);return base[method] as T;};return {call,calls};}
describe('Amounts and Nearby boundary',()=>{
  it('preserves one lamport and comma decimals',()=>{expect(parseAmount('0,000000001')).toBe(1);expect(parseAmount('10')).toBe(10e9);});
  it.each(['0','-1','1e-3','0.0000000001','10.000000001','Infinity','1,2,3',''])('rejects invalid amount %s',a=>expect(()=>parseAmount(a)).toThrow());
  it('never selects arbitrarily among multiple peers',()=>{expect(autoCandidate([])).toBeUndefined();expect(autoCandidate(['a','b'])).toBeUndefined();expect(autoCandidate(['a'])).toBe('a');});
  it('rejects wrong network and oversized packets',()=>{expect(()=>parseWire(JSON.stringify({...offer(),network:'mainnet-beta'}))).toThrow();expect(()=>parseWire(' '.repeat(4097))).toThrow();});
  it('binds receiving offers to both verified sessions, addresses and expiry',()=>{
    const o=offer();const me:Hello={kind:'hello',v:1,network:NETWORK,session:receiverSession,address:o.to,name:'Алия',role:'receive'};const peer:Hello={...me,session:senderSession,address:o.from,role:'send'};
    expect(()=>validateOffer(o,me,peer)).not.toThrow();
    for(const bad of [{receiverSession:senderSession},{senderSession:receiverSession},{to:o.from},{expires:Date.now()-1000},{expires:Date.now()+500_000}])expect(()=>validateOffer({...o,...bad},me,peer)).toThrow();
  });
});
describe('Signed Solana transfer and confirmation',()=>{
  it('creates valid Ed25519 signature, transfers exact amount and binds memo',async()=>{const o=offer(),{call}=fixture();const r=await prepare(o,async (message,_summary,approved)=>{expect(approved).toBe(o);return signer(message);},call);const tx=Transaction.from(Buffer.from(r.raw!,'base64'));expect(tx.verifySignatures()).toBe(true);expect(()=>verifyTransfer(tx,o)).not.toThrow();for(const bad of [{lamports:o.lamports+1},{to:Keypair.generate().publicKey.toBase58()},{id:crypto.randomUUID()}])expect(()=>verifyTransfer(tx,{...o,...bad})).toThrow();});
  it('blocks wrong genesis before signing',async()=>{let signed=false;await expect(prepare(offer(),async()=>{signed=true;return new Uint8Array();},fixture({getGenesisHash:'mainnet'}).call)).rejects.toThrow('Devnet');expect(signed).toBe(false);});
  it('reserves fee and rejects insufficient funds',async()=>{await expect(prepare(offer(),signer,fixture({getBalance:{value:1_000_000}}).call)).rejects.toThrow('комиссии');});
  it('rebroadcasts identical bytes and signature, never resigns',async()=>{const {call,calls}=fixture();const r=await prepare(offer(),signer,call);await broadcast(r,call);await broadcast(r,call);const sent=calls.filter(c=>c.method==='sendTransaction');expect(sent[0].params?.[0]).toBe(sent[1].params?.[0]);expect(sent[0].params?.[0]).toBe(r.raw);});
  it('missing and processed status never produce success',async()=>{const r=await prepare(offer(),signer,fixture().call);expect((await reconcile(r,fixture().call)).status).toBe('pending');expect((await reconcile(r,fixture({getSignatureStatuses:{value:[{err:null,confirmationStatus:'processed'}]}}).call)).status).toBe('pending');});
  it('on-chain failure is a failure, not a credit',async()=>{const r=await prepare(offer(),signer,fixture().call);expect((await reconcile(r,fixture({getSignatureStatuses:{value:[{err:{InstructionError:[0,'fail']},confirmationStatus:'confirmed'}]}}).call)).status).toBe('failed');});
  it('confirms only after checking signature, instructions and actual credit',async()=>{const r=await prepare(offer(),signer,fixture().call);const chain={meta:{err:null,preBalances:[2e9,0,0,0],postBalances:[2e9-1005000,1000000,0,0]},transaction:[r.raw,'base64'],slot:123};const overrides={getSignatureStatuses:{value:[{err:null,confirmationStatus:'confirmed'}]},getTransaction:chain};expect((await reconcile(r,fixture(overrides).call)).status).toBe('confirmed');await expect(reconcile(r,fixture({...overrides,getTransaction:{...chain,meta:{...chain.meta,postBalances:[1e9,999999,0,0]}}}).call)).rejects.toThrow('Зачисление');});
  it('a confirmed status without transaction body remains pending',async()=>{const r=await prepare(offer(),signer,fixture().call);expect((await reconcile(r,fixture({getSignatureStatuses:{value:[{err:null,confirmationStatus:'confirmed'}]}}).call)).status).toBe('pending');});
  it('does not trust an unrelated receipt or replay memo',async()=>{const r=await prepare(offer(),signer,fixture().call);await expect(reconcile({...r,offer:{...r.offer,id:crypto.randomUUID()}},fixture({getSignatureStatuses:{value:[{err:null,confirmationStatus:'confirmed'}]},getTransaction:{meta:{err:null,preBalances:[],postBalances:[]},transaction:[r.raw,'base64']}}).call)).rejects.toThrow('другому переводу');});
  it('no memo match does not invent incoming credit',async()=>{const r={offer:offer(),direction:'in' as const,status:'waiting' as const,created:Date.now()};expect((await recoverIncoming(r,fixture({getSignaturesForAddress:[]}).call)).status).toBe('waiting');});
});
