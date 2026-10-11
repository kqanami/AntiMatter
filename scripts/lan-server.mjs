import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {WebSocketServer} from 'ws';
import {randomUUID,randomInt} from 'node:crypto';

const root=resolve('dist');
const port=Number(process.env.PORT||5180);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml'};
const clients=new Map();
const send=(client,value)=>{if(client?.ws.readyState===1)client.ws.send(JSON.stringify(value));};
const event=(client,value)=>send(client,{type:'event',...value});
function stop(client){
  if(client.role==='receive')for(const c of clients.values())if(c.role==='send')event(c,{event:'lost',endpoint:client.id});
  const peer=clients.get(client.peer);
  if(peer){peer.peer=null;peer.accepted=false;peer.verified=false;event(peer,{event:'disconnected',endpoint:client.id});}
  client.role=null;client.peer=null;client.accepted=false;client.verified=false;
}
const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url||'/',`http://${req.headers.host}`).pathname;
  const path=pathname==='/'?'/index.html':pathname==='/phone'?'/index.html':pathname;
  const file=resolve(root,'.'+decodeURIComponent(path));
  if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
  try{const bytes=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(bytes);}catch{res.writeHead(404).end('Not found');}
});
const wss=new WebSocketServer({server,path:'/nearby'});
wss.on('connection',ws=>{
  const client={id:randomUUID(),ws,role:null,name:'Участник',peer:null,accepted:false,verified:false,code:null};clients.set(client.id,client);send(client,{type:'id',id:client.id});
  ws.on('message',raw=>{
    if(raw.length>40000)return;
    let msg;try{msg=JSON.parse(String(raw));}catch{return;}
    if(msg.type==='start'&&['send','receive'].includes(msg.role)){
      stop(client);client.role=msg.role;client.name=typeof msg.name==='string'?msg.name.slice(0,24):'Участник';
      if(client.role==='receive'){for(const c of clients.values())if(c.role==='send')event(c,{event:'found',endpoint:client.id,name:client.name});}
      else {for(const c of clients.values())if(c.role==='receive')event(client,{event:'found',endpoint:c.id,name:c.name});}
    }
    if(msg.type==='stop')stop(client);
    if(msg.type==='connect'&&client.role==='send'&&!client.peer){const peer=clients.get(msg.endpoint);if(!peer||peer.role!=='receive'||peer.peer)return;client.peer=peer.id;peer.peer=client.id;client.code=peer.code=String(randomInt(1000,10000));event(client,{event:'verify',endpoint:peer.id,name:peer.name,code:client.code});event(peer,{event:'verify',endpoint:client.id,name:client.name,code:client.code});}
    if(msg.type==='verify'&&client.peer===msg.endpoint){const peer=clients.get(client.peer);if(!peer)return;if(!msg.accept){event(peer,{event:'disconnected',endpoint:client.id});event(client,{event:'disconnected',endpoint:peer.id});peer.peer=null;client.peer=null;peer.accepted=client.accepted=false;return;}client.accepted=true;if(peer.accepted){client.verified=peer.verified=true;event(client,{event:'connected',endpoint:peer.id});event(peer,{event:'connected',endpoint:client.id});}}
    if(msg.type==='data'&&client.verified&&client.peer===msg.endpoint&&typeof msg.data==='string'&&Buffer.byteLength(msg.data)<=32768){const peer=clients.get(client.peer);if(peer?.verified)event(peer,{event:'data',endpoint:client.id,data:msg.data});}
  });
  ws.on('close',()=>{stop(client);clients.delete(client.id);});
});
server.listen(port,'0.0.0.0',()=>console.log(`ANTIMATTER LAN server: http://0.0.0.0:${port}/phone?lan=1`));

