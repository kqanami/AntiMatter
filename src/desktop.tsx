import React from 'react';
import {createRoot} from 'react-dom/client';
import '@fontsource-variable/manrope';
import './desktop.css';
import {uuid} from './runtime';
const room=uuid();

function Desktop(){return <div className="desktop-shell"><header><div className="desktop-brand"><span className="desktop-mark">A</span><span>ANTIMATTER<span className="period">.</span></span></div><div className="desktop-label">РАБОТАЮЩИЙ ПРОТОТИП <i/> LAB + SOLANA DEVNET</div></header><div className="desktop-heading"><div><p>ДВА ТЕЛЕФОНА. ОДИН ЖЕСТ.</p><h1>Передайте AMT через Solana<br/>с одного экрана на другой.</h1></div><div className="desktop-guide"><span>01&nbsp; Откройте кошелёк и выберите AMT · Solana</span><span>02&nbsp; Сверьте код на двух экранах</span><span>03&nbsp; Проведите каплю вверх до края левого экрана</span></div></div><main className="phones"><section className="phone-slot"><div className="phone-label"><span>01 / ОТПРАВИТЕЛЬ</span><b>↗</b></div><div className="phone-frame"><iframe title="Экран отправителя" src={`/?desktopPhone=sender&desktopRoom=${room}`}/></div></section><div className="desktop-flow"><span>↗</span><i/><span>↘</span></div><section className="phone-slot"><div className="phone-label"><span>02 / ПОЛУЧАТЕЛЬ</span><b>↙</b></div><div className="phone-frame"><iframe title="Экран получателя" src={`/?desktopPhone=receiver&desktopRoom=${room}`}/></div></section></main><footer><p>Режим AMT проводит настоящий тестовый перевод в Solana Devnet. Пополните AMT и тестовые SOL на адрес отправителя, указанный в его кошельке. Локальный LAB остаётся для проверки без сети. Два экранных телефона связаны внутри браузера; физическую близость этот режим не измеряет.</p><a className="desktop-learning" href="/learning.html">Учебный модуль 1–8 ↗</a><button onClick={()=>location.reload()}>Перезапустить соединение ↻</button></footer></div>}
createRoot(document.getElementById('desktop-root')!).render(<Desktop/>);


