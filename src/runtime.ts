export const desktopPhone = new URLSearchParams(typeof location==='undefined'?'':location.search).get('desktopPhone');
export const desktopRoom = new URLSearchParams(typeof location==='undefined'?'':location.search).get('desktopRoom')||'standalone';
export const isDesktopPhone = desktopPhone === 'sender' || desktopPhone === 'receiver';
export const isLanPhone = typeof location!=='undefined' && new URLSearchParams(location.search).get('lan') === '1';
export const isWebPhone = isDesktopPhone || isLanPhone;
export const phoneStorageKey = (key: string) => isDesktopPhone ? `${key}-${desktopRoom}-${desktopPhone}` : key;
export function uuid(){const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const hex=Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;}
