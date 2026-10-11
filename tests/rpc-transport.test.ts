import {afterEach,describe,expect,it,vi} from 'vitest';
import {Capacitor,CapacitorHttp} from '@capacitor/core';
import {GENESIS} from '../src/domain';
import {rpc,RPC_URL} from '../src/solana';

vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:vi.fn(()=>true)},CapacitorHttp:{post:vi.fn()}}));
afterEach(()=>vi.clearAllMocks());

describe('Native Devnet transport',()=>{
  it('sends JSON-RPC over the native HTTP bridge on a phone',async()=>{
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    const native=vi.mocked(CapacitorHttp.post).mockResolvedValue({status:200,data:{jsonrpc:'2.0',id:1,result:GENESIS},headers:{},url:RPC_URL});
    const web=vi.spyOn(globalThis,'fetch');
    expect(await rpc('getGenesisHash')).toBe(GENESIS);
    expect(native).toHaveBeenCalledWith(expect.objectContaining({url:RPC_URL,data:expect.objectContaining({method:'getGenesisHash'}),connectTimeout:15_000}));
    expect(native.mock.calls[0][0].headers).not.toHaveProperty('Origin');
    expect(web).not.toHaveBeenCalled();
  });
  it('reports an RPC access denial without claiming an internet outage',async()=>{
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(CapacitorHttp.post).mockResolvedValue({status:403,data:{error:'Access forbidden'},headers:{},url:RPC_URL});
    await expect(rpc('getGenesisHash')).rejects.toThrow('HTTP 403');
  });
});
