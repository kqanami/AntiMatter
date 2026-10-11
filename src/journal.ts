import type { RecordItem } from './domain';
import {isDesktopPhone,desktopPhone,phoneStorageKey} from './runtime';
const KEY='arm-tranzit-journal-v1';
const storageKey=()=>isDesktopPhone?`${KEY}-${desktopPhone}`:phoneStorageKey(KEY);
export function readJournal():RecordItem[] {const raw=localStorage.getItem(storageKey());if(!raw)return []; const list=JSON.parse(raw); if(!Array.isArray(list))throw new Error('Журнал повреждён. Не отправляйте повторно до проверки обозревателя.');return list;}
export function saveRecord(item:RecordItem):RecordItem[] {
  const list=readJournal(); const i=list.findIndex(r=>r.offer.id===item.offer.id);
  if(i>=0)list[i]=item;else list.unshift(item);
  // Must succeed BEFORE network submission. No truncation of unresolved records.
  localStorage.setItem(storageKey(),JSON.stringify(list));
  return list;
}
export function hasUnresolvedOutgoing(list:RecordItem[]) {return list.some(r=>r.direction==='out' && r.status==='pending');}
