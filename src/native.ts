import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import {isDesktopPhone,isLanPhone} from './runtime';
import {DesktopBridge} from './desktop-bridge';
import {LanBridge} from './lan-bridge';
export type NearbyEvent = {type: 'found'|'lost'|'verify'|'connected'|'disconnected'|'data'|'error'|'stopped'|'impact'; endpoint?:string; name?:string; code?:string; data?:string; message?:string; at?:number; strength?:number};
export interface NativeBridge {
  wallet(): Promise<{publicKey:string}>;
  sign(options:{message:string; summary:string; recipient:string; amount:number; memo:string; network:string}):Promise<{signature:string}>;
  signDemo(options:{message:string}):Promise<{signature:string}>;
  start(options:{role:'send'|'receive'; name:string}):Promise<void>;
  connect(options:{endpoint:string}):Promise<void>;
  verify(options:{endpoint:string; accept:boolean}):Promise<void>;
  send(options:{endpoint:string; data:string}):Promise<void>;
  stop():Promise<void>;
  addListener(event:'nearby', listener:(event:NearbyEvent)=>void):Promise<PluginListenerHandle>;
}
export const Native:NativeBridge = isDesktopPhone ? DesktopBridge : isLanPhone ? LanBridge : registerPlugin<NativeBridge>('Tranzit');
export const isNative = Capacitor.isNativePlatform() || isDesktopPhone || isLanPhone;
