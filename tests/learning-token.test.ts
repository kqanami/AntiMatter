import {describe,expect,it} from 'vitest';
import {TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {GENESIS} from '../src/domain';
import {learningTokenStatus,metadataAddress,METADATA_PROGRAM_ID} from '../src/learning-token';
import type {Rpc} from '../src/solana';

const mint='GTYjjjnW9hcLg1UrgfZBfpL4BXP74eJcZ9TWDeguL9MR';

describe('week 7 token status',()=>{
  it('derives the actual metadata PDA and verifies mint ownership before reporting supply',async()=>{
    expect(metadataAddress(mint)).toBe('DZzJr29qZ8tsG6pRwhywpZMrJmKpQeUJQaevYo3A8C9');
    const calls:string[]=[];
    const rpc:Rpc=async (method,params=[])=>{
      calls.push(method);
      if(method==='getGenesisHash')return GENESIS as never;
      if(method==='getTokenSupply')return {value:{amount:'1000000000000',decimals:9}} as never;
      if(method==='getAccountInfo')return {value:{owner:params[0]===mint?TOKEN_PROGRAM_ID.toBase58():METADATA_PROGRAM_ID.toBase58()}} as never;
      throw new Error(method);
    };
    await expect(learningTokenStatus(rpc,mint)).resolves.toMatchObject({mint,supply:'1000000000000',metadataCreated:true});
    expect(calls).toEqual(['getGenesisHash','getAccountInfo','getTokenSupply','getAccountInfo']);
  });
  it('rejects a mint controlled by another program',async()=>{
    const rpc:Rpc=async method=>method==='getGenesisHash'?GENESIS as never:{value:{owner:METADATA_PROGRAM_ID.toBase58()}} as never;
    await expect(learningTokenStatus(rpc,mint)).rejects.toThrow('Mint AMT не найден');
  });
});
