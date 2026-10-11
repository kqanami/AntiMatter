export type Impact={at:number;strength:number};
export type ClockOffset={remoteMinusLocal:number;uncertainty:number};

// NTP-style four timestamps, all in milliseconds. The lowest-RTT sample is
// preferred because radio transport delay makes the offset uncertain.
export function clockOffset(t0:number,t1:number,t2:number,t3:number):ClockOffset|null{
  if(![t0,t1,t2,t3].every(Number.isFinite)||t0>t3||t1>t2)return null;
  const roundTrip=t3-t0-(t2-t1);
  if(roundTrip<0||roundTrip>500)return null;
  return {remoteMinusLocal:((t1-t0)+(t2-t3))/2,uncertainty:roundTrip/2};
}

export function matchingImpact(local:Impact[],remote:Impact[],clock:ClockOffset|null,now:number):{local:Impact;remote:Impact}|null{
  if(!clock||clock.uncertainty>70)return null;
  const candidates:{local:Impact;remote:Impact}[]=[];
  for(const a of local){
    if(!Number.isFinite(a.at)||!Number.isFinite(a.strength)||a.strength<0.8||now-a.at>5_000||a.at>now+200)continue;
    for(const b of remote){
      const corrected=b.at-clock.remoteMinusLocal;
      if(!Number.isFinite(b.at)||!Number.isFinite(b.strength)||b.strength<0.8||now-corrected>5_000||corrected>now+200)continue;
      if(Math.abs(a.at-corrected)<=Math.max(55,clock.uncertainty+35))candidates.push({local:a,remote:b});
    }
  }
  // Multiple possible event pairings are ambiguous, even if one looks closer.
  return candidates.length===1?candidates[0]:null;
}
