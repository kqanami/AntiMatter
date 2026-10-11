import { Buffer } from 'buffer';
import { PublicKey } from '@solana/web3.js';
import { Native,isNative,type NearbyEvent } from './native';
import { type Hello,type Offer,type Role,type RecordItem,type Network,type DemoBlock,NETWORK,TOKEN_NETWORK,DEMO_NETWORK,parseWire,validateOffer,parseAmount,formatSOL,autoCandidate,memoFor } from './domain';
import { balance,prepare,broadcast,reconcile,recoverIncoming } from './solana';
import {requestFunding} from './funding';
import {tokenBalance,prepareToken,broadcastToken,reconcileToken,recoverIncomingToken} from './amt';
import {TOKEN_MINT} from './token-config';
import {clockOffset,matchingImpact,type ClockOffset,type Impact} from './impact';
import { readJournal,saveRecord,hasUnresolvedOutgoing } from './journal';
import {readChain,writeChain,verifyChain,makeBlock,appendBlock,labBalance} from './demo-chain';
import {desktopPhone,isDesktopPhone,isLanPhone,phoneStorageKey,uuid} from './runtime';
export type State={address:string;name:string;mode:Network;balance:number|null;solBalance:number|null;balanceAt:number|null;role:Role;active:boolean;endpoint?:string;peer?:Hello;candidates:Record<string,string>;verification?:{endpoint:string;code:string;name:string};verifiedCode?:string;impactVerifiedAt?:number;busy:boolean;notice:string;error:string;records:RecordItem[];incoming?:Offer;phase:'idle'|'authorizing'|'pending'|'confirmed'};
const DISCOVERY_SETTLE_MS=800;
export class Engine {
  state:State={address:'',name:localStorage.getItem(phoneStorageKey('arm-name'))||(desktopPhone==='sender'?'Вы':desktopPhone==='receiver'?'Другой телефон':'Участник'),mode:!isLanPhone&&localStorage.getItem('arm-mode')===TOKEN_NETWORK&&TOKEN_MINT?TOKEN_NETWORK:!isLanPhone&&localStorage.getItem('arm-mode')===NETWORK?NETWORK:!isLanPhone&&localStorage.getItem('arm-mode')===DEMO_NETWORK?DEMO_NETWORK:isNative&&TOKEN_MINT?TOKEN_NETWORK:DEMO_NETWORK,balance:null,solBalance:null,balanceAt:null,role:desktopPhone==='receiver'?'receive':'send',active:false,candidates:{},busy:false,notice:'Откройте приложение на двух телефонах',error:'',records:[],phase:'idle'};
  private listeners=new Set<()=>void>(); private me?:Hello; private selected?:string; private connectTimer?:ReturnType<typeof setTimeout>; private pairingTimer?:ReturnType<typeof setTimeout>; private authTimer?:ReturnType<typeof setTimeout>; private acceptedCode?:string; private remoteSession?:string; private authMatched=false; private ack?:{id:string;resolve:()=>void;reject:(e:Error)=>void}; private demoAck?:{id:string;hash:string;resolve:()=>void;reject:(e:Error)=>void}; private demoHead?:DemoBlock[]; private refreshing=false; private poll?:ReturnType<typeof setInterval>;
  private localImpacts:Impact[]=[];private remoteImpacts:Impact[]=[];private clock?:ClockOffset;private clockRequests=new Map<string,number>();
  private checkImpact(){const match=matchingImpact(this.localImpacts,this.remoteImpacts,this.clock||null,Date.now());if(match){this.localImpacts=[];this.remoteImpacts=[];this.patch({impactVerifiedAt:Date.now(),notice:'Эксперимент: оба телефона зафиксировали одно соприкосновение.'});}}
  private async syncClock(){for(let i=0;i<3&&this.state.endpoint&&this.authMatched;i++){const id=uuid(),t0=Date.now();this.clockRequests.set(id,t0);await this.send({kind:'clock-ping',id,t0});await new Promise(resolve=>setTimeout(resolve,140));}}
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return ()=>{this.listeners.delete(fn);};};
  snapshot=()=>this.state;
  patch=(p:Partial<State>)=>{this.state={...this.state,...p};this.listeners.forEach(f=>f());};
  error=(e:unknown)=>this.patch({error:e instanceof Error?e.message:String(e)});
  async init(){
    try{
      this.patch({records:readJournal()});
      if(!isNative){this.patch({notice:'Предпросмотр интерфейса. Переводы и поиск доступны в приложении на телефоне.'});return;}
      await Native.addListener('nearby',event=>{void this.event(event).catch(this.error);});
      const key=await Native.wallet();
      this.patch({address:new PublicKey(Buffer.from(key.publicKey,'base64')).toBase58()});
      await this.refresh();
      if(isDesktopPhone)await this.start(desktopPhone==='receiver'?'receive':'send');
      this.poll=setInterval(()=>{if(document.visibilityState==='visible')void this.refresh();},15_000);
    }catch(e){this.error(e);}
  }
  async refresh(){
    if(!this.state.address||this.refreshing)return;
    this.refreshing=true;
    try{
      for(const record of this.state.records.filter(r=>this.state.mode!==DEMO_NETWORK&&r.offer.network===this.state.mode&&(r.status==='pending'||r.status==='waiting'))){
        const next=record.offer.network===TOKEN_NETWORK?(record.direction==='in'?await recoverIncomingToken(record):await reconcileToken(record)):(record.direction==='in'?await recoverIncoming(record):await reconcile(record));
        this.patch({records:saveRecord(next)});
        if(record.status!=='confirmed'&&next.status==='confirmed')this.patch({phase:'confirmed',notice:next.direction==='in'?'Зачислено · проверено в Solana':'Перевод подтверждён Solana'});
      }
      if(this.state.mode===DEMO_NETWORK){const chain=await verifyChain(readChain());this.patch({balance:labBalance(chain,this.state.address),solBalance:null,balanceAt:Date.now()});}
      else if(this.state.mode===TOKEN_NETWORK){const [amt,sol]=await Promise.all([tokenBalance(this.state.address),balance(this.state.address)]);this.patch({balance:amt,solBalance:sol,balanceAt:Date.now()});}
      else {const sol=await balance(this.state.address);this.patch({balance:sol,solBalance:sol,balanceAt:Date.now()});}
      if(this.state.error.startsWith('Не удалось связаться с Solana Devnet.'))this.patch({error:''});
    }catch(e){this.error(e);}finally{this.refreshing=false;}
  }
  setName(name:string){if(this.state.active)return; const clean=name.replace(/[\p{C}]/gu,'').trim().slice(0,24)||'Участник';localStorage.setItem(phoneStorageKey('arm-name'),clean);this.patch({name:clean});}
  async setMode(mode:Network){if(isLanPhone&&mode!==DEMO_NETWORK)throw new Error('В браузере по Wi-Fi доступна только учебная цепь.');if(mode===TOKEN_NETWORK&&!TOKEN_MINT)throw new Error('Mint AMT ещё не выпущен в Solana Devnet.');if(this.state.busy||hasUnresolvedOutgoing(this.state.records))throw new Error('Сначала проверьте незавершённый перевод.');const wasActive=this.state.active,role=this.state.role;await this.stop();localStorage.setItem('arm-mode',mode);this.patch({mode,balance:null,solBalance:null,phase:'idle',error:'',notice:mode===DEMO_NETWORK?'Учебная цепь: операции только между двумя телефонами, без денежной стоимости.':mode===TOKEN_NETWORK?'Тестовый AMT в настоящей сети Solana Devnet.':'Solana Devnet: тестовые SOL в настоящей сети.'});if(wasActive)await this.start(role);await this.refresh();}
  async start(role:Role){
    if(!isNative||!this.state.address||this.state.busy)return;
    await this.stop();
    this.me={kind:'hello',v:1,network:this.state.mode,mint:this.state.mode===TOKEN_NETWORK?TOKEN_MINT:undefined,session:uuid(),address:this.state.address,name:this.state.name,role};
    this.patch({role,active:true,error:'',phase:'idle',notice:role==='send'?'Поднесите телефоны. Ищем получателя…':'Телефон виден отправителю. Оставьте этот экран открытым.'});
    try{await Native.start({role,name:this.state.name});}catch(e){this.patch({active:false,notice:'Поиск рядом не запущен. Проверьте разрешения и повторите.'});this.error(e);}
  }
  async stop(){clearTimeout(this.connectTimer);clearTimeout(this.pairingTimer);clearTimeout(this.authTimer);this.selected=undefined;this.acceptedCode=undefined;this.remoteSession=undefined;this.authMatched=false;this.me=undefined;this.localImpacts=[];this.remoteImpacts=[];this.clock=undefined;this.clockRequests.clear();this.ack?.reject(new Error('Сеанс завершён.'));this.ack=undefined;this.demoAck?.reject(new Error('Сеанс завершён.'));this.demoAck=undefined;this.demoHead=undefined;if(isNative)await Native.stop();this.patch({active:false,peer:undefined,endpoint:undefined,candidates:{},verification:undefined,verifiedCode:undefined,impactVerifiedAt:undefined,incoming:undefined});}
  async connect(endpoint:string){
    if(this.selected||!this.state.active||Object.keys(this.state.candidates).length!==1)return;
    this.selected=endpoint;clearTimeout(this.connectTimer);
    this.pairingTimer=setTimeout(()=>{if(this.selected===endpoint&&!this.state.verification&&!this.authMatched){void this.stop().then(()=>this.error('Соединение не завершилось. Повторите поиск рядом.'));}},15_000);
    try{await Native.connect({endpoint});this.patch({notice:'Соединяем телефоны. Сверьте код на обоих экранах.'});}catch(e){await this.stop();this.error(e);}
  }
  async verify(accept:boolean){const v=this.state.verification;if(!v)return;this.acceptedCode=accept?v.code:undefined;try{await Native.verify({endpoint:v.endpoint,accept});}catch(e){this.acceptedCode=undefined;throw e;}this.patch({verification:undefined,verifiedCode:undefined,notice:accept?'Сверяем код с другим телефоном…':'Соединение отклонено.'});if(!accept)this.selected=undefined;}
  private async send(data:unknown,endpoint=this.state.endpoint){if(!endpoint)throw new Error('Телефон отключился.');await Native.send({endpoint,data:JSON.stringify(data)});}
  private async event(e:NearbyEvent){
    if(e.type==='error'){this.error(e.message||'Ошибка Nearby');return;}
    if(e.type==='stopped'){clearTimeout(this.pairingTimer);clearTimeout(this.authTimer);this.localImpacts=[];this.remoteImpacts=[];this.clock=undefined;this.clockRequests.clear();this.acceptedCode=undefined;this.remoteSession=undefined;this.authMatched=false;this.me=undefined;this.selected=undefined;this.patch({active:false,peer:undefined,endpoint:undefined,verification:undefined,verifiedCode:undefined,impactVerifiedAt:undefined,candidates:{}});return;}
    if(!this.state.active)return;
    if(e.type==='impact'&&Number.isSafeInteger(e.at)&&typeof e.strength==='number'&&Number.isFinite(e.strength)&&e.strength>=0.8&&e.strength<=20){this.localImpacts=[...this.localImpacts.filter(x=>e.at!-x.at<5_000),{at:e.at!,strength:e.strength}].slice(-8);this.checkImpact();if(this.authMatched&&this.me&&this.state.endpoint)await this.send({kind:'impact',session:this.me.session,at:e.at,strength:e.strength});return;}
    if(e.type==='found'&&e.endpoint&&!this.authMatched){const candidates={...this.state.candidates,[e.endpoint]:e.name||'Участник'};this.patch({candidates});clearTimeout(this.connectTimer);if(Object.keys(candidates).length>1&&this.selected){await this.stop();this.error('Обнаружено несколько получателей до проверки пары. Отойдите вдвоём и повторите поиск.');return;}this.connectTimer=setTimeout(()=>{const id=autoCandidate(Object.keys(this.state.candidates));if(id&&!this.selected)void this.connect(id);},DISCOVERY_SETTLE_MS);}
    if(e.type==='lost'&&e.endpoint){clearTimeout(this.connectTimer);const candidates={...this.state.candidates};delete candidates[e.endpoint];this.patch({candidates});if(e.endpoint===this.selected&&!this.authMatched){await this.stop();this.error('Телефон исчез до проверки соединения. Повторите поиск рядом.');return;}if(!this.selected){const id=autoCandidate(Object.keys(candidates));if(id)this.connectTimer=setTimeout(()=>{void this.connect(id);},DISCOVERY_SETTLE_MS);}}
    if(e.type==='verify'&&e.endpoint&&e.code){clearTimeout(this.pairingTimer);if((this.selected&&this.selected!==e.endpoint)||(this.state.role==='send'&&Object.keys(this.state.candidates).length!==1)){await Native.verify({endpoint:e.endpoint,accept:false});this.error('Код пришёл от неподходящего сеанса. Соединение отклонено.');return;}this.selected=e.endpoint;this.acceptedCode=undefined;this.remoteSession=undefined;this.authMatched=false;this.patch({verification:{endpoint:e.endpoint,code:e.code,name:e.name||this.state.candidates[e.endpoint]||'Участник'}});}
    if(e.type==='connected'&&e.endpoint){
      if(e.endpoint!==this.selected||!this.acceptedCode||!this.me){await this.stop();this.error('Соединение без подтверждённого кода отклонено.');return;}
      this.patch({endpoint:e.endpoint,verification:undefined,notice:'Сверяем код с другим телефоном…'});
      this.authTimer=setTimeout(()=>{if(!this.authMatched){void this.stop().then(()=>this.error('Не удалось сверить код второго телефона. Начните соединение заново.'));}},10_000);
      await this.send({kind:'auth-check',code:this.acceptedCode,session:this.me.session},e.endpoint);
    }
    if(e.type==='disconnected'&&e.endpoint===this.selected){clearTimeout(this.pairingTimer);clearTimeout(this.authTimer);this.localImpacts=[];this.remoteImpacts=[];this.clock=undefined;this.clockRequests.clear();this.acceptedCode=undefined;this.remoteSession=undefined;this.authMatched=false;this.selected=undefined;this.ack?.reject(new Error('Телефон отключился.'));this.demoAck?.reject(new Error('Телефон отключился.'));const retry=!isDesktopPhone&&!isLanPhone&&!this.state.busy&&this.state.phase==='idle'&&!hasUnresolvedOutgoing(this.state.records);this.patch({active:retry,peer:undefined,endpoint:undefined,verification:undefined,verifiedCode:undefined,impactVerifiedAt:undefined,notice:retry?'Связь прервалась. Снова ищем телефон рядом…':'Связь прервана. Проверьте результат перевода в истории.'});if(retry)await this.start(this.state.role);}
    if(e.type==='data'&&e.endpoint===this.state.endpoint&&e.data&&this.me){
      const data=parseWire(e.data);
      if(data.kind==='auth-check'){
        if(!this.acceptedCode||data.code!==this.acceptedCode||data.session===this.me.session||(this.remoteSession&&this.remoteSession!==data.session)){const local=this.acceptedCode||'—',remote=data.code;await this.stop();this.error(`Коды или сеансы различаются: здесь ${local}, на втором телефоне ${remote}. Передача заблокирована. Начните соединение заново.`);return;}
        if(!this.authMatched){this.remoteSession=data.session;this.authMatched=true;clearTimeout(this.authTimer);this.patch({verifiedCode:this.acceptedCode,notice:'Код совпал. Обмениваемся данными кошельков…'});await this.send(this.me,e.endpoint);void this.syncClock().catch(()=>{});for(const impact of this.localImpacts)await this.send({kind:'impact',session:this.me.session,...impact},e.endpoint);}
        return;
      }
      if(!this.authMatched)throw new Error('Код второго телефона ещё не проверен. Передача заблокирована.');
      if(data.kind==='clock-ping'){const t1=Date.now();await this.send({kind:'clock-pong',id:data.id,t0:data.t0,t1,t2:Date.now()},e.endpoint);return;}
      if(data.kind==='clock-pong'){if(this.clockRequests.get(data.id)===data.t0){this.clockRequests.delete(data.id);const next=clockOffset(data.t0,data.t1,data.t2,Date.now());if(next&&(!this.clock||next.uncertainty<this.clock.uncertainty)){this.clock=next;this.checkImpact();}}return;}
      if(data.kind==='impact'){if(data.session!==this.remoteSession)throw new Error('Событие движения от другого сеанса отклонено.');this.remoteImpacts=[...this.remoteImpacts.filter(x=>data.at-x.at<5_000),{at:data.at,strength:data.strength}].slice(-8);this.checkImpact();return;}
      if(data.kind==='hello'){
        if(data.session!==this.remoteSession)throw new Error('Данные другого сеанса после сверки кода. Передача заблокирована.');
        if(data.address===this.me.address||data.role===this.me.role||data.network!==this.me.network||(data.network===TOKEN_NETWORK&&data.mint!==this.me.mint))throw new Error('Нужен другой кошелёк, та же сеть и противоположный режим.');
        if(this.state.peer&&JSON.stringify(this.state.peer)!==JSON.stringify(data))throw new Error('Данные получателя изменились. Начните новый сеанс.');
        this.patch({peer:data,notice:this.state.role==='send'?'Получатель проверен. Проведите каплю вверх.':'Соединение проверено. Ожидаем перевод.'});
      }
      if(data.kind==='offer'&&this.state.peer){
        validateOffer(data,this.me,this.state.peer);
        const existing=this.state.records.find(r=>r.offer.id===data.id);
        if(existing&&JSON.stringify(existing.offer)!==JSON.stringify(data))throw new Error('Повторный идентификатор с другими данными.');
        if(!existing)this.patch({records:saveRecord({offer:data,status:'waiting',direction:'in',created:Date.now()})});
        this.patch({incoming:data,phase:'pending',notice:data.network===DEMO_NETWORK?'Получено событие учебной передачи. Ждём подписанный блок.':'Отправитель подтверждает перевод. Зачисления пока нет.'});
        if(data.network===DEMO_NETWORK)await this.send({kind:'demo-head',id:data.id,chain:await verifyChain(readChain())});
        await this.send({kind:'ack',id:data.id});
      }
      if(data.kind==='ack'&&this.ack?.id===data.id)this.ack.resolve();
      if(data.kind==='demo-head'){const r=this.state.records.find(x=>x.offer.id===data.id);if(this.me.role!=='send'||r)throw new Error('Лишние данные учебной цепи.');this.demoHead=await verifyChain(data.chain);}
      if(data.kind==='demo-block'){
        const r=this.state.records.find(x=>x.offer.id===data.id&&x.direction==='in'&&x.offer.network===DEMO_NETWORK);
        if(!r||!this.state.peer||r.offer.from!==this.state.peer.address||r.offer.to!==this.me.address||data.block.payload.id!==r.offer.id||data.block.payload.from!==r.offer.from||data.block.payload.to!==r.offer.to||data.block.payload.lamports!==r.offer.lamports)throw new Error('Учебный блок не соответствует предложенному переводу.');
        const local=await verifyChain(readChain());const remote=await verifyChain(data.chain);
        if(local.length&&remote.length&&local[local.length-1].hash!==remote[remote.length-1].hash)throw new Error('Учебные цепи разошлись. Перевод заблокирован.');
        if(!local.length&&remote.length)writeChain(remote);
        const next=await appendBlock(readChain(),data.block);
        this.patch({records:saveRecord({...r,signature:data.block.signature,raw:JSON.stringify(data.block),status:'confirmed'}),balance:labBalance(next,this.me.address),balanceAt:Date.now(),phase:'confirmed',notice:'Учебный блок проверен и добавлен. Реальные деньги не переводились.'});
        await this.send({kind:'demo-accepted',id:data.id,hash:data.block.hash});
      }
      if(data.kind==='demo-accepted'&&this.demoAck?.id===data.id&&this.demoAck.hash===data.hash)this.demoAck.resolve();
      if(data.kind==='cancel'){
        const r=this.state.records.find(x=>x.offer.id===data.id&&x.direction==='in'&&x.status==='waiting');
        if(r)this.patch({records:saveRecord({...r,status:'failed',error:'Отправитель отменил. Деньги не переводились.'}),incoming:undefined,phase:'idle'});
      }
      if(data.kind==='receipt'){
        const r=this.state.records.find(r=>r.offer.id===data.id&&r.direction==='in');
        if(!r||r.offer.from!==this.state.peer?.address||r.offer.receiverSession!==this.me.session)throw new Error('Квитанция без согласованного перевода.');
        if(r.signature&&r.signature!==data.signature)throw new Error('Подпись перевода изменилась.');
        this.patch({records:saveRecord({...r,signature:data.signature,status:r.status==='confirmed'?'confirmed':'pending'})});void this.refresh();
      }
    }
  }
  async transfer(amount:string){
    if(this.state.busy)return;
    this.patch({busy:true,error:'',phase:'authorizing'});
    let offer:Offer|undefined;let signed=false;
    try{
      if(hasUnresolvedOutgoing(this.state.records))throw new Error('Сначала проверьте незавершённый перевод в истории. Повторная отправка заблокирована.');
      const peer=this.state.peer,me=this.me,endpoint=this.state.endpoint;
      if(!peer||!me||!endpoint||me.role!=='send'||!this.authMatched||peer.session!==this.remoteSession)throw new Error('Сначала соедините телефоны и сверьте код.');
      if(Object.keys(this.state.candidates).length>1)throw new Error('Рядом несколько получателей. Отойдите с нужным человеком и повторите.');
      const lamports=parseAmount(amount);
      if(this.state.balance===null)throw new Error('Баланс ещё не получен. Обновите кошелёк перед переводом.');
      if(this.state.mode===DEMO_NETWORK&&lamports>this.state.balance)throw new Error(`Не хватает ${formatSOL(lamports-this.state.balance)} LAB. Уменьшите сумму.`);
      if(this.state.mode===NETWORK&&lamports>=this.state.balance)throw new Error('Сумма должна оставлять тестовые SOL для комиссии сети. Уменьшите её и обновите баланс.');
      if(this.state.mode===TOKEN_NETWORK&&lamports>this.state.balance)throw new Error(`Не хватает ${formatSOL(lamports-this.state.balance)} AMT. Уменьшите сумму.`);
      offer={kind:'offer',id:uuid(),network:this.state.mode,mint:this.state.mode===TOKEN_NETWORK?TOKEN_MINT:undefined,from:me.address,to:peer.address,senderSession:me.session,receiverSession:peer.session,lamports,expires:Date.now()+120_000};
      const currentOffer=offer;
      await new Promise<void>((resolve,reject)=>{
        const timer=setTimeout(()=>{this.ack=undefined;reject(new Error('Получатель не ответил. Подпись не создана.'));},12_000);
        this.ack={id:currentOffer.id,resolve:()=>{clearTimeout(timer);this.ack=undefined;resolve();},reject:e=>{clearTimeout(timer);this.ack=undefined;reject(e);}};
        void this.send(currentOffer).catch(e=>this.ack?.reject(e));
      });
      if(this.state.peer?.session!==peer.session||this.state.endpoint!==endpoint)throw new Error('Получатель отключился до авторизации.');
      if(offer.network===DEMO_NETWORK){
        const own=await verifyChain(readChain()),remote=this.demoHead;
        if(!remote)throw new Error('Не получили учебную цепь получателя.');
        if(own.length&&remote.length&&own[own.length-1].hash!==remote[remote.length-1].hash)throw new Error('Учебные цепи разошлись. Перевод заблокирован.');
        const prior=own.length?own:remote;
        this.patch({notice:'Подтвердите создание учебного блока на телефоне.'});
        const block=await makeBlock(prior,offer.from,offer.to,offer.lamports,offer.id,async message=>Buffer.from((await Native.signDemo({message:Buffer.from(message).toString('base64')})).signature,'base64'));
        signed=true;
        const record:RecordItem={offer,signature:block.signature,raw:JSON.stringify({block,chain:prior}),status:'pending',direction:'out',created:Date.now()};
        this.patch({records:saveRecord(record),phase:'pending',notice:'Учебный блок передаётся второму телефону. Зачисления пока нет.'});
        await this.sendDemoBlock(record,endpoint);
        return;
      }
      this.patch({notice:'Подтвердите тестовый перевод средствами защиты телефона.'});
      const sign=async(message:Uint8Array,summary:string,approved:Offer)=>Buffer.from((await Native.sign({message:Buffer.from(message).toString('base64'),summary,recipient:approved.to,amount:approved.lamports,memo:memoFor(approved),network:approved.network})).signature,'base64');
      const record=offer.network===TOKEN_NETWORK?await prepareToken(offer,sign):await prepare(offer,sign);
      signed=true;
      this.patch({records:saveRecord(record),phase:'pending',notice:'Подпись сохранена. Ожидаем подтверждение Solana…'});
      // The receipt is a pending claim, never proof of credit. Receiver independently verifies RPC.
      await this.send({kind:'receipt',id:offer.id,signature:record.signature},endpoint).catch(()=>{});
      if(offer.network===TOKEN_NETWORK)await broadcastToken(record);else await broadcast(record);
      await this.refresh();
    }catch(e){if(offer&&!signed)await this.send({kind:'cancel',id:offer.id}).catch(()=>{});this.error(e);this.patch({phase:hasUnresolvedOutgoing(this.state.records)?'pending':'idle'});}finally{this.patch({busy:false});}
  }
  private async sendDemoBlock(record:RecordItem,endpoint:string){
    if(!record.raw)throw new Error('Нет сохранённого учебного блока.');
    const {block,chain}=JSON.parse(record.raw) as {block:DemoBlock;chain:DemoBlock[]};
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>{this.demoAck=undefined;reject(new Error('Ответ второго телефона не получен. Учебный блок остаётся неподтверждённым.'));},12_000);
      this.demoAck={id:record.offer.id,hash:block.hash,resolve:()=>{clearTimeout(timer);this.demoAck=undefined;resolve();},reject:e=>{clearTimeout(timer);this.demoAck=undefined;reject(e);}};
      void this.send({kind:'demo-block',id:record.offer.id,block,chain},endpoint).catch(e=>this.demoAck?.reject(e));
    });
    const next=await appendBlock(readChain(),block);
    this.patch({records:saveRecord({...record,status:'confirmed'}),balance:labBalance(next,this.state.address),balanceAt:Date.now(),phase:'pending',notice:'Учебный блок принят вторым телефоном. Показываем результат.'});
    await new Promise(resolve=>setTimeout(resolve,700));
    this.patch({phase:'confirmed',notice:'Учебный блок принят вторым телефоном. Реальные деньги не переводились.'});
  }
  async retry(record:RecordItem){if(this.state.busy)return;this.patch({busy:true,error:''});try{if(record.offer.network===DEMO_NETWORK){if(!this.state.endpoint||this.state.peer?.address!==record.offer.to)throw new Error('Подключите того же получателя для повтора учебного блока.');await this.sendDemoBlock(record,this.state.endpoint);}else{const checked=record.offer.network===TOKEN_NETWORK?await reconcileToken(record):await reconcile(record);this.patch({records:saveRecord(checked)});if(checked.status==='pending'){if(record.offer.network===TOKEN_NETWORK)await broadcastToken(checked);else await broadcast(checked);}await this.refresh();}}catch(e){this.error(e);}finally{this.patch({busy:false});}}
  async nextTransfer(){this.patch({phase:'idle',notice:''});if(isNative&&!this.state.endpoint&&!this.state.active)await this.start(this.state.role);}
  async fund(){
    if(this.state.busy)return;
    this.patch({busy:true,error:''});
    try{
      if(!this.state.address)throw new Error('Кошелёк ещё создаётся.');
      this.patch({notice:'Выдаём 1 AMT и 0,02 тестовых SOL из резерва проекта…'});
      const result=await requestFunding(this.state.address);
      this.patch({notice:result.alreadyIssued?'Этому кошельку тестовые AMT и SOL уже выдавались. Проверяем текущий баланс.':result.status==='confirmed'?'Тестовые AMT и SOL зачислены в Solana Devnet.':'Транзакция отправлена. Проверяем зачисление в Solana Devnet.'});
      for(let i=0;i<3;i++){await new Promise(resolve=>setTimeout(resolve,i===0?300:1200));await this.refresh();if(this.state.balance!==null&&this.state.mode===TOKEN_NETWORK&&this.state.balance>=1_000_000_000)break;}
    }catch(e){this.error(e);}finally{this.patch({busy:false});}
  }
}
