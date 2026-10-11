import {describe,it,expect} from 'vitest';
import {Keypair} from '@solana/web3.js';
import nacl from 'tweetnacl';
import {makeBlock,verifyBlock,verifyChain,labBalance,blockHash} from '../src/demo-chain';
const alice=Keypair.generate(),bob=Keypair.generate(),carol=Keypair.generate();
const signAlice=async(data:Uint8Array)=>nacl.sign.detached(data,alice.secretKey);
const signBob=async(data:Uint8Array)=>nacl.sign.detached(data,bob.secretKey);
describe('ARM Lab Chain signed blocks',()=>{
  it('creates and verifies a signed block bound to prior hash',async()=>{
    const a=await makeBlock([],alice.publicKey.toBase58(),bob.publicKey.toBase58(),1e9,crypto.randomUUID(),signAlice);
    expect(a.payload.height).toBe(1);await expect(verifyBlock([],a)).resolves.toBeUndefined();
    const b=await makeBlock([a],bob.publicKey.toBase58(),carol.publicKey.toBase58(),2e9,crypto.randomUUID(),signBob);
    await expect(verifyChain([a,b])).resolves.toHaveLength(2);
    expect(b.payload.previous).toBe(a.hash);
    expect(labBalance([a,b],alice.publicKey.toBase58())).toBe(9e9);
    expect(labBalance([a,b],bob.publicKey.toBase58())).toBe(9e9);
    expect(labBalance([a,b],carol.publicKey.toBase58())).toBe(12e9);
  });
  it('rejects forged amount, destination and signature',async()=>{
    const a=await makeBlock([],alice.publicKey.toBase58(),bob.publicKey.toBase58(),1e9,crypto.randomUUID(),signAlice);
    await expect(verifyBlock([],{...a,payload:{...a.payload,lamports:2e9}})).rejects.toThrow();
    await expect(verifyBlock([],{...a,payload:{...a.payload,to:carol.publicKey.toBase58()}})).rejects.toThrow();
    await expect(verifyBlock([],{...a,signature:'bad'})).rejects.toThrow();
    await expect(verifyBlock([],{...a,hash:'0'.repeat(64)})).rejects.toThrow('Хеш');
  });
  it('rejects fork, duplicate and overspending',async()=>{
    const a=await makeBlock([],alice.publicKey.toBase58(),bob.publicKey.toBase58(),1e9,crypto.randomUUID(),signAlice);
    const b=await makeBlock([],alice.publicKey.toBase58(),carol.publicKey.toBase58(),1e9,crypto.randomUUID(),signAlice);
    await expect(verifyChain([a,b])).rejects.toThrow();
    await expect(verifyBlock([a],a)).rejects.toThrow();
    await expect(makeBlock([a],alice.publicKey.toBase58(),bob.publicKey.toBase58(),10e9,crypto.randomUUID(),signAlice)).rejects.toThrow('Недостаточно');
  });
  it('rejects stale new blocks but validates historical chain',async()=>{
    const a=await makeBlock([],alice.publicKey.toBase58(),bob.publicKey.toBase58(),1e9,crypto.randomUUID(),signAlice);
    a.payload.timestamp=Date.now()-600_000;a.signature=(await import('bs58')).default.encode(nacl.sign.detached(new TextEncoder().encode((await import('../src/demo-chain')).payloadText(a.payload)),alice.secretKey));a.hash=await blockHash(a.payload,a.signature);
    await expect(verifyBlock([],a)).rejects.toThrow();
    await expect(verifyChain([a])).resolves.toHaveLength(1);
  });
});
