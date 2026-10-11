import {describe,it,expect} from 'vitest';
import {Buffer} from 'buffer';
import {Keypair,Transaction} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID} from '@solana/spl-token';
import nacl from 'tweetnacl';
import {GENESIS,TOKEN_NETWORK,type Offer} from '../src/domain';
import {prepareToken,reconcileToken,tokenAccount,verifyTokenTransfer} from '../src/amt';
import {transferReadiness} from '../src/transfer-readiness';
import type {Rpc} from '../src/solana';

describe('AMT Devnet transaction',()=>{
  it('shows whether AMT or test SOL is missing before the gesture',()=>{
    expect(transferReadiness('1',TOKEN_NETWORK,0,2_000_000,'',1_000_000_000).message).toContain('AMT');
    expect(transferReadiness('1',TOKEN_NETWORK,1_000_000_000,2_000_000,'',0).message).toContain('SOL');
    expect(transferReadiness('1',TOKEN_NETWORK,1_000_000_000,2_000_000,'',3_000_000).ok).toBe(true);
  });
  it('signs the exact mint, destination, amount and receipt, then checks credited tokens',async()=>{
    const sender=Keypair.generate(),receiver=Keypair.generate(),mint=Keypair.generate();
    const offer:Offer={kind:'offer',id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',network:TOKEN_NETWORK,mint:mint.publicKey.toBase58(),from:sender.publicKey.toBase58(),to:receiver.publicKey.toBase58(),senderSession:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',receiverSession:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',lamports:250_000_000,expires:Date.now()+60_000};
    const source=tokenAccount(offer.from,offer.mint).toBase58(),destination=tokenAccount(offer.to,offer.mint).toBase58();
    let signed='';
    const call:Rpc=async(method,params)=>{
      if(method==='getGenesisHash')return GENESIS as never;
      if(method==='getAccountInfo')return {value:params?.[0]===mint.publicKey.toBase58()||params?.[0]===source?{owner:TOKEN_PROGRAM_ID.toBase58()}:null} as never;
      if(method==='getTokenSupply')return {value:{decimals:9}} as never;
      if(method==='getTokenAccountBalance')return {value:{amount:'1000000000',decimals:9}} as never;
      if(method==='getLatestBlockhash')return {value:{blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:123}} as never;
      if(method==='getFeeForMessage')return {value:5000} as never;
      if(method==='getMinimumBalanceForRentExemption')return 2039280 as never;
      if(method==='getBalance')return {value:1_000_000_000} as never;
      if(method==='getSignatureStatuses')return {value:[{err:null,confirmationStatus:'confirmed'}]} as never;
      if(method==='getTransaction'){
        const tx=Transaction.from(Buffer.from(signed,'base64'));
        const index=tx.compileMessage().accountKeys.findIndex(k=>k.toBase58()===destination);
        return {transaction:[signed,'base64'],meta:{err:null,preTokenBalances:[],postTokenBalances:[{accountIndex:index,mint:offer.mint,uiTokenAmount:{amount:String(offer.lamports)}}]}} as never;
      }
      throw new Error(`Unexpected RPC: ${method}`);
    };
    const record=await prepareToken(offer,async (msg,_summary,approved)=>{expect(approved).toBe(offer);return nacl.sign.detached(msg,sender.secretKey);},call);
    signed=record.raw!;
    const tx=Transaction.from(Buffer.from(signed,'base64'));
    expect(()=>verifyTokenTransfer(tx,offer)).not.toThrow();
    expect(()=>verifyTokenTransfer(tx,{...offer,to:sender.publicKey.toBase58()})).toThrow();
    expect(()=>verifyTokenTransfer(tx,{...offer,lamports:offer.lamports+1})).toThrow();
    expect((await reconcileToken(record,call)).status).toBe('confirmed');
  });
});
