import {expect,it,vi} from 'vitest';
import {TOKEN_NETWORK,type RecordItem} from '../src/domain';

it('keeps pending desktop Devnet transfers across room reloads and separates sender from receiver',async()=>{
  const values=new Map<string,string>();
  vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>values.set(key,value)});
  const record:RecordItem={offer:{kind:'offer',id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',network:TOKEN_NETWORK,from:'sender',to:'receiver',senderSession:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',receiverSession:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',lamports:1_000_000_000,expires:Date.now()+60_000},status:'pending',direction:'out',created:Date.now()};
  try{
    vi.stubGlobal('location',{search:'?desktopPhone=sender&desktopRoom=first'});
    vi.resetModules();
    (await import('../src/journal')).saveRecord(record);
    vi.stubGlobal('location',{search:'?desktopPhone=sender&desktopRoom=second'});
    vi.resetModules();
    expect((await import('../src/journal')).readJournal()).toEqual([record]);
    vi.stubGlobal('location',{search:'?desktopPhone=receiver&desktopRoom=second'});
    vi.resetModules();
    expect((await import('../src/journal')).readJournal()).toEqual([]);
  }finally{vi.unstubAllGlobals();vi.resetModules();}
});
