import {Buffer} from 'buffer';
import {describe,it,expect} from 'vitest';
import {AnchorProvider,Program,type Idl} from '@anchor-lang/core';
import {Connection,Keypair,PublicKey} from '@solana/web3.js';
import {sha256} from 'js-sha256';
import {GENESIS} from '../src/domain';
import {LEARNING_PROGRAM_ID,learningAddresses,learningCounter,learningProfile} from '../src/learning-program';
import type {Rpc} from '../src/solana';
import idl from '../learning/idl/antimatter_learning.json';

describe('Anchor learning client contract',()=>{
  it('encodes a PDA counter instruction with the exact signer and program',async()=>{
    const owner=Keypair.generate().publicKey;
    const counter=new PublicKey(learningAddresses(owner.toBase58()).counter);
    const program=new Program(idl as Idl,{connection:new Connection('https://api.devnet.solana.com')});
    const ix=await program.methods.incrementCounter().accountsStrict({authority:owner,counter}).instruction();
    expect(ix.programId.toBase58()).toBe(LEARNING_PROGRAM_ID.toBase58());
    expect(ix.keys.map(k=>[k.pubkey.toBase58(),k.isSigner,k.isWritable])).toEqual([
      [owner.toBase58(),true,false],[counter.toBase58(),false,true],
    ]);
    expect([...ix.data]).toEqual(idl.instructions.find(x=>x.name==='increment_counter')!.discriminator);
  });
  it('reads only counter data owned by the derived wallet and program',async()=>{
    const owner=Keypair.generate().publicKey;
    const data=Buffer.alloc(49);
    Buffer.from(sha256('account:Counter').slice(0,16),'hex').copy(data,0);
    owner.toBuffer().copy(data,8);
    data.writeBigUInt64LE(42n,40);data[48]=253;
    const call:Rpc=async method=>method==='getGenesisHash'?GENESIS as never:{value:{owner:LEARNING_PROGRAM_ID.toBase58(),executable:false,data:[data.toString('base64'),'base64']}} as never;
    expect((await learningCounter(owner.toBase58(),call))?.count).toBe('42');
    data[8]^=1;
    await expect(learningCounter(owner.toBase58(),call)).rejects.toThrow('другой владелец');
  });
  it('rejects a profile payload whose declared text length exceeds its account',async()=>{
    const owner=Keypair.generate().publicKey;
    const data=Buffer.alloc(53);
    Buffer.from(sha256('account:Profile').slice(0,16),'hex').copy(data,0);
    owner.toBuffer().copy(data,8);
    data.writeUInt32LE(999,41);
    const call:Rpc=async method=>method==='getGenesisHash'?GENESIS as never:{value:{owner:LEARNING_PROGRAM_ID.toBase58(),executable:false,data:[data.toString('base64'),'base64']}} as never;
    await expect(learningProfile(owner.toBase58(),call)).rejects.toThrow('Длина поля');
  });
});
