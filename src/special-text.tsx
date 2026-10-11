import {useEffect,useRef,useState} from 'react';

interface SpecialTextProps {
  children:string;
  speed?:number;
  delay?:number;
  className?:string;
  inView?:boolean;
  once?:boolean;
}

const RANDOM_CHARS='_!X$0-+*#';
const scramble=()=>RANDOM_CHARS[Math.floor(Math.random()*RANDOM_CHARS.length)];

/** Two-stage character scramble, adapted for the app without a motion runtime. */
export function SpecialText({children,speed=20,delay=0,className='',inView=false,once=true}:SpecialTextProps){
  const host=useRef<HTMLSpanElement>(null);
  const [visible,setVisible]=useState(!inView);
  const [display,setDisplay]=useState(children);
  const reduced=typeof window!=='undefined'&&window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useEffect(()=>{
    if(!inView||!host.current||typeof IntersectionObserver==='undefined'){
      setVisible(true);
      return;
    }
    const observer=new IntersectionObserver(entries=>{
      if(entries[0]?.isIntersecting){setVisible(true);if(once)observer.disconnect();}
      else if(!once)setVisible(false);
    },{rootMargin:'-40px'});
    observer.observe(host.current);
    return()=>observer.disconnect();
  },[inView,once]);

  useEffect(()=>{
    if(reduced||!visible){setDisplay(children);return;}
    let step=0;
    let interval:number|undefined;
    const length=children.length;
    const start=window.setTimeout(()=>{
      setDisplay('\u00a0'.repeat(length));
      interval=window.setInterval(()=>{
        step++;
        if(step<=length*2){
          const count=Math.min(step,length);
          setDisplay(Array.from({length},(_,i)=>i<count?scramble():'\u00a0').join(''));
        }else if(step<=length*4){
          const revealed=Math.min(length,Math.floor((step-length*2)/2));
          setDisplay(Array.from({length},(_,i)=>i<revealed?children[i]:i===revealed?'_':scramble()).join(''));
        }else{
          setDisplay(children);
          window.clearInterval(interval);
        }
      },Math.max(16,speed));
    },Math.max(0,delay*1000));
    return()=>{window.clearTimeout(start);if(interval!==undefined)window.clearInterval(interval);};
  },[children,speed,delay,visible,reduced]);

  return <span ref={host} className={`special-text ${className}`} aria-label={children}>
    <span className="special-text-measure" aria-hidden="true">{children}</span>
    <span className="special-text-live" aria-hidden="true">{display}</span>
  </span>;
}
