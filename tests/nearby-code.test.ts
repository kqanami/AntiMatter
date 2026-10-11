import {beforeEach,describe,expect,it,vi} from 'vitest';
import {Keypair} from '@solana/web3.js';
import {DEMO_NETWORK,type Hello,parseWire} from '../src/domain';

const mockNative=vi.hoisted(()=>({stop:vi.fn(async()=>{}),connect:vi.fn(async (_target:unknown)=>{}),send:vi.fn(async (_packet:unknown)=>{})}));
vi.mock('../src/native',()=>({Native:mockNative,isNative:true}));
import {Engine} from '../src/engine';

type InternalEngine={state:Engine['state'];patch:Engine['patch'];acceptedCode?:string;selected?:string;me?:Hello;authMatched:boolean;event:(data:{type:string;endpoint:string;data:string;name?:string})=>Promise<void>};
const remoteSession='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function pairedEngine(localCode:string){
  const engine=new Engine() as unknown as InternalEngine;
  engine.selected='peer';engine.acceptedCode=localCode;
  engine.me={kind:'hello',v:1,network:DEMO_NETWORK,session:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',address:Keypair.generate().publicKey.toBase58(),name:'Отправитель',role:'send'};
  engine.patch({active:true,endpoint:'peer',role:'send',verifiedCode:undefined});
  return engine;
}

describe('Nearby code agreement',()=>{
  beforeEach(()=>{
    vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});
    mockNative.stop.mockClear();mockNative.connect.mockClear();mockNative.send.mockClear();
  });
  it('rejects a different code even when the endpoint and displayed name are correct',async()=>{
    const engine=pairedEngine('1834');
    await engine.event({type:'data',endpoint:'peer',data:JSON.stringify({kind:'auth-check',code:'7281',session:remoteSession})});
    expect(engine.state.active).toBe(false);
    expect(engine.state.peer).toBeUndefined();
    expect(engine.state.error).toContain('1834');
    expect(engine.state.error).toContain('7281');
    expect(mockNative.stop).toHaveBeenCalledOnce();
    expect(mockNative.send).not.toHaveBeenCalled();
  });
  it('exchanges wallet identity only after the two codes agree',async()=>{
    const engine=pairedEngine('1834');
    await engine.event({type:'data',endpoint:'peer',data:JSON.stringify({kind:'auth-check',code:'1834',session:remoteSession})});
    expect(engine.state.verifiedCode).toBe('1834');
    expect(engine.authMatched).toBe(true);
    const packet=mockNative.send.mock.calls[0]?.[0] as {data:string};
    expect(JSON.parse(packet.data).kind).toBe('hello');
  });
  it('rejects malformed code packets',()=>{
    expect(()=>parseWire(JSON.stringify({kind:'auth-check',code:'\n',session:remoteSession}))).toThrow();
    expect(()=>parseWire(JSON.stringify({kind:'auth-check',code:'1234',session:'old'}))).toThrow();
    expect(()=>parseWire(JSON.stringify({kind:'auth-check',code:'1234',session:remoteSession}))).not.toThrow();
  });
  it('starts the sole discovered pair after 800 ms, but never chooses among two',async()=>{
    vi.useFakeTimers();
    try{
      const single=new Engine() as unknown as InternalEngine;
      single.patch({active:true,role:'send'});
      await single.event({type:'found',endpoint:'one',name:'Алия',data:''});
      await vi.advanceTimersByTimeAsync(799);
      expect(mockNative.connect).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(mockNative.connect).toHaveBeenCalledOnce();
      await (single as unknown as Engine).stop();

      mockNative.connect.mockClear();
      const multiple=new Engine() as unknown as InternalEngine;
      multiple.patch({active:true,role:'send'});
      await multiple.event({type:'found',endpoint:'one',name:'Алия',data:''});
      await vi.advanceTimersByTimeAsync(400);
      await multiple.event({type:'found',endpoint:'two',name:'Данияр',data:''});
      await vi.advanceTimersByTimeAsync(1200);
      expect(mockNative.connect).not.toHaveBeenCalled();
      await (multiple as unknown as Engine).stop();
    }finally{vi.useRealTimers();}
  });
  it('cancels an unverified connection if a second recipient appears',async()=>{
    vi.useFakeTimers();
    try{
      const engine=new Engine() as unknown as InternalEngine;
      engine.patch({active:true,role:'send'});
      await engine.event({type:'found',endpoint:'one',name:'Алия',data:''});
      await vi.advanceTimersByTimeAsync(800);
      expect(mockNative.connect).toHaveBeenCalledOnce();
      await engine.event({type:'found',endpoint:'two',name:'Данияр',data:''});
      expect(mockNative.stop).toHaveBeenCalledOnce();
      expect(engine.state.active).toBe(false);
      expect(engine.state.error).toContain('несколько');
    }finally{vi.useRealTimers();}
  });
  it('rejects a replayed code bound to its own session',async()=>{
    const engine=pairedEngine('1834');
    await engine.event({type:'data',endpoint:'peer',data:JSON.stringify({kind:'auth-check',code:'1834',session:engine.me!.session})});
    expect(engine.state.active).toBe(false);
    expect(engine.authMatched).toBe(false);
  });
});
