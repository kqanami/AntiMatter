import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PublicKey} from '@solana/web3.js';
import {rpc,checkNetwork} from './solana';
import {learningAddresses,learningCounter,learningProfile,learningProgramStatus} from './learning-program';
import {learningTokenStatus} from './learning-token';
import {tokenBalance} from './amt';
import report from '../verification/learning-first-transfer.json';
import '@fontsource-variable/manrope';
import './learning.css';

type AccountKey={pubkey:string;signer:boolean;writable:boolean};
type Instruction={programId:string;program?:string;parsed?:{type?:string;info?:Record<string,unknown>};accounts?:string[]};
type ParsedTx={slot:number;meta:{err:unknown;fee:number;preBalances:number[];postBalances:number[]}|null;transaction:{message:{accountKeys:AccountKey[];instructions:Instruction[]}}};
const explorer=(signature:string)=>`https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`;

function App(){
  const [signature,setSignature]=useState(report.signature);
  const [transaction,setTransaction]=useState<ParsedTx|null>(null);
  const [txError,setTxError]=useState('');
  const [txBusy,setTxBusy]=useState(false);
  const [program,setProgram]=useState<{address:string;deployed:boolean}|null>(null);
  const [programError,setProgramError]=useState('');
  const [wallet,setWallet]=useState('');
  const [addresses,setAddresses]=useState<{counter:string;profile:string}|null>(null);
  const [counter,setCounter]=useState<string|null>(null);
  const [profile,setProfile]=useState<{displayName:string;bio:string;updatedSlot:string}|null>(null);
  const [walletError,setWalletError]=useState('');
  const [token,setToken]=useState<Awaited<ReturnType<typeof learningTokenStatus>>|null>(null);
  const [tokenError,setTokenError]=useState('');
  const [walletTokenBalance,setWalletTokenBalance]=useState<string|null>(null);

  async function inspect(value:string){
    setTxBusy(true);setTxError('');setTransaction(null);
    try{
      await checkNetwork();
      const tx=await rpc<ParsedTx|null>('getTransaction',[value.trim(),{encoding:'jsonParsed',commitment:'confirmed',maxSupportedTransactionVersion:0}]);
      if(!tx)throw new Error('Транзакция не найдена в Solana Devnet.');
      setTransaction(tx);
    }catch(error){setTxError(error instanceof Error?error.message:String(error));}
    finally{setTxBusy(false);}
  }
  async function lookup(){
    setWalletError('');setCounter(null);setProfile(null);setWalletTokenBalance(null);
    try{
      const owner=new PublicKey(wallet.trim()).toBase58();
      setAddresses(learningAddresses(owner));
      if(token){const amount=await tokenBalance(owner);setWalletTokenBalance((amount/1_000_000_000).toLocaleString('ru-RU',{maximumFractionDigits:9}));}
      if(program?.deployed){
        const [count,data]=await Promise.all([learningCounter(owner),learningProfile(owner)]);
        setCounter(count?.count??null);
        setProfile(data?{displayName:data.displayName,bio:data.bio,updatedSlot:data.updatedSlot}:null);
      }
    }catch(error){setWalletError(error instanceof Error?error.message:String(error));}
  }
  useEffect(()=>{void inspect(report.signature);void learningProgramStatus().then(setProgram).catch(error=>setProgramError(error instanceof Error?error.message:String(error)));void learningTokenStatus().then(setToken).catch(error=>setTokenError(error instanceof Error?error.message:String(error)));},[]);
  const keys=transaction?.transaction.message.accountKeys||[];
  return <main className="learning-shell">
    <header><a href="/desktop.html" aria-label="Вернуться к прототипу">← ПРОТОТИП</a><strong>ANTIMATTER<span>.</span></strong><span>SOLANA / DEVNET</span></header>
    <section className="learning-hero"><p>УЧЕБНЫЙ МОДУЛЬ · НЕДЕЛИ 1–8</p><h1>От первой транзакции<br/>до работающего MVP.</h1><span>Все операции здесь относятся к Solana Devnet. Тестовые SOL и AMT не имеют денежной стоимости.</span></section>
    <div className="learning-grid">
      <section className="learning-block"><div className="learning-number">01 / ПЕРВАЯ ТРАНЗАКЦИЯ</div><h2>0,001 SOL переведены в Devnet</h2><p>Созданы два отдельных тестовых кошелька. Отправитель получил тестовые SOL и подписал перевод. Получатель получил ровно 1 000 000 lamports.</p><dl><div><dt>Подпись</dt><dd><a href={explorer(report.signature)} target="_blank" rel="noreferrer">{report.signature.slice(0,22)}… ↗</a></dd></div><div><dt>Слот</dt><dd>{report.slot}</dd></div><div><dt>Комиссия</dt><dd>{report.feeLamports} lamports</dd></div></dl></section>
      <section className="learning-block"><div className="learning-number">02 / TRANSACTION DETECTIVE</div><h2>Разберите любую транзакцию</h2><p>Введите подпись из Solana Explorer. Покажем accounts, signer, изменения баланса и вызванные программы и инструкции.</p><form onSubmit={event=>{event.preventDefault();void inspect(signature)}}><label htmlFor="tx-signature">Подпись Devnet-транзакции</label><div className="learning-form-row"><input id="tx-signature" value={signature} onChange={event=>setSignature(event.target.value)} spellCheck={false}/><button disabled={txBusy||!signature.trim()}>{txBusy?'Проверяем…':'Разобрать'}</button></div></form>{txError&&<p className="learning-error" role="alert">{txError}</p>}{transaction&&<div className="tx-result"><p>Слот {transaction.slot} · комиссия {transaction.meta?.fee??'—'} lamports · {transaction.meta?.err?'ошибка':'подтверждено'}</p><h3>Accounts</h3>{keys.map((key,index)=><div className="tx-row" key={key.pubkey}><code>{key.pubkey.slice(0,11)}…{key.pubkey.slice(-7)}</code><span>{key.signer?'подписант · ':''}{key.writable?'запись':'чтение'} · {transaction.meta?transaction.meta.postBalances[index]-transaction.meta.preBalances[index]:0} lamports</span></div>)}<h3>Instructions / programs</h3>{transaction.transaction.message.instructions.map((ix,index)=><div className="tx-row" key={index}><code>{ix.program||ix.programId.slice(0,15)}</code><span>{ix.parsed?.type||'raw instruction'}</span></div>)}</div>}</section>
      <section className="learning-block"><div className="learning-number">03 / RUST CLI</div><h2>Инструмент разработчика</h2><p>CLI написан на Rust и умеет читать баланс, аккаунт, программу и транзакцию. Он проверяет genesis hash Devnet перед каждым запросом.</p><code className="learning-command">cargo run --manifest-path learning/rust-cli/Cargo.toml -- tx &lt;SIGNATURE&gt;</code><span className="learning-note">Исходники и команды запуска: learning/rust-cli</span></section>
      <section className="learning-block"><div className="learning-number">04 / ПЕРВАЯ PROGRAM</div><h2>Ping в Anchor</h2><p>Инструкция `ping` пишет сообщение в логи Solana. Исходник добавлен в проект и прошёл проверку Rust. Развёртывание требует Solana CLI и SBF toolchain на Mac, Linux или WSL.</p><dl><div><dt>Program ID</dt><dd><code>{program?.address||'проверяем…'}</code></dd></div><div><dt>Devnet</dt><dd>{programError?`RPC: ${programError}`:program?.deployed?'Развёрнута':'Пока не развёрнута'}</dd></div></dl></section>
      <section className="learning-block"><div className="learning-number">05 / COUNTER PROGRAM</div><h2>Счётчик для каждого кошелька</h2><p>`initialize_counter` создаёт PDA, `increment_counter` увеличивает значение. Только владелец кошелька может обновлять свой счётчик; сложение защищено от переполнения.</p><code className="learning-command">pnpm learning:client counter:init<br/>pnpm learning:client counter:increment</code></section>
      <section className="learning-block"><div className="learning-number">06 / PDA PROFILE</div><h2>Публичный on-chain профиль</h2><p>Адрес профиля вычисляется из `profile` + адреса кошелька. Создание и изменение доступны только подписи владельца. Имя и описание будут видны всем после развёртывания.</p><form onSubmit={event=>{event.preventDefault();void lookup()}}><label htmlFor="wallet-address">Адрес кошелька для просмотра PDA и AMT</label><div className="learning-form-row"><input id="wallet-address" value={wallet} onChange={event=>setWallet(event.target.value)} spellCheck={false}/><button disabled={!wallet.trim()}>Показать</button></div></form>{walletError&&<p className="learning-error" role="alert">{walletError}</p>}{addresses&&<div className="pda-result"><p>Counter PDA: <code>{addresses.counter}</code></p><p>Profile PDA: <code>{addresses.profile}</code></p>{walletTokenBalance!==null&&<p>Баланс AMT: {walletTokenBalance}</p>}{program?.deployed?<><p>Счётчик: {counter??'ещё не создан'}</p><p>Профиль: {profile?`${profile.displayName} — ${profile.bio}`:'ещё не создан'}</p></>:<p>Чтение состояния появится после развёртывания программы.</p>}</div>}</section>
      <section className="learning-block"><div className="learning-number">07 / SPL TOKEN + METADATA</div><h2>Собственный токен AMT</h2><p>Mint выпущен в Devnet, токены хранятся в Associated Token Accounts и передаются инструкцией TransferChecked. Метаданные содержат имя, символ и ссылку на изображение.</p>{tokenError?<p className="learning-error" role="alert">{tokenError}</p>:<dl><div><dt>Mint</dt><dd><a href={`https://explorer.solana.com/address/${token?.mint}?cluster=devnet`} target="_blank" rel="noreferrer"><code>{token?.mint||'проверяем…'}</code> ↗</a></dd></div><div><dt>Выпуск</dt><dd>{token?`${Number(BigInt(token.supply)/1_000_000_000n).toLocaleString('ru-RU')} AMT`:'проверяем…'}</dd></div><div><dt>Metadata</dt><dd>{token?.metadataCreated?<a href={`https://explorer.solana.com/address/${token.metadataAddress}?cluster=devnet`} target="_blank" rel="noreferrer">On-chain ↗</a>:'ещё не опубликованы'}</dd></div></dl>}<span className="learning-note">Выпуск и перевод: scripts/create-devnet-token.ts, scripts/send-devnet-amt.ts. Метаданные: learning/token/metadata.json.</span></section>
      <section className="learning-block"><div className="learning-number">08 / BUILD SPRINT · WEB3 MVP</div><h2>Работающий прототип ANTIMATTER</h2><p>Два браузерных экрана находят друг друга, сверяют код, подписывают перевод AMT локальным тестовым кошельком и показывают зачисление только после подтверждения Solana Devnet. История содержит ссылку на транзакцию.</p><a className="learning-mvp-link" href="/desktop.html">Открыть MVP с двумя экранами ↗</a><p className="learning-note">На Android и iPhone для поиска рядом используется Nearby. Браузерная демонстрация связывает экраны внутри одного компьютера и не измеряет физическую близость.</p></section>
    </div>
    <footer>ANTIMATTER LAB · недели 1–8 · <a href="https://explorer.solana.com/?cluster=devnet" target="_blank" rel="noreferrer">Solana Explorer ↗</a></footer>
  </main>;
}
createRoot(document.getElementById('learning-root')!).render(<App/>);
