import {describe,expect,it} from 'vitest';
import {clockOffset,matchingImpact} from '../src/impact';

describe('physical impact correlation',()=>{
  it('matches a single shared impact with a measured clock offset',()=>{
    const clock=clockOffset(1000,1120,1122,1042);
    expect(clock).toEqual({remoteMinusLocal:100,uncertainty:20});
    expect(matchingImpact([{at:2000,strength:1.4}],[{at:2109,strength:1.1}],clock,2200)).not.toBeNull();
  });
  it('rejects poor clock quality, stale impacts and ambiguous movements',()=>{
    expect(matchingImpact([{at:2000,strength:2}],[{at:2100,strength:2}],{remoteMinusLocal:100,uncertainty:100},2200)).toBeNull();
    expect(matchingImpact([{at:2000,strength:2}],[{at:2100,strength:2}],{remoteMinusLocal:100,uncertainty:20},8000)).toBeNull();
    expect(matchingImpact([{at:2000,strength:2},{at:2040,strength:2}],[{at:2100,strength:2}],{remoteMinusLocal:100,uncertainty:20},2200)).toBeNull();
  });
});
