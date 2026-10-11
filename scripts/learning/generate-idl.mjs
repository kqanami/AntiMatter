// A provisional Anchor 1.x IDL for client testing before `anchor build` is available.
// After a real SBF build, compare this file with target/idl/antimatter_learning.json.
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'../..');
const source=readFileSync(resolve(root,'learning/anchor/programs/antimatter_learning/src/lib.rs'),'utf8');
const address=source.match(/declare_id!\("([^"]+)"\)/)?.[1];
if(!address)throw new Error('Program ID not found in Rust source');
const discriminator=(prefix,name)=>[...createHash('sha256').update(`${prefix}:${name}`).digest().subarray(0,8)];
const pda=(seed)=>({seeds:[{kind:'const',value:[...Buffer.from(seed)]},{kind:'account',path:'authority'}]});
const authority=(writable=false)=>({name:'authority',signer:true,...(writable?{writable:true}:{})});
const state=(name,seed)=>({name,writable:true,pda:pda(seed)});
const system={name:'system_program',address:'11111111111111111111111111111111'};
const instruction=(name,accounts,args=[])=>({name,discriminator:discriminator('global',name),accounts,args});
const idl={
  address,
  metadata:{name:'antimatter_learning',version:'0.1.0',spec:'0.1.0',description:'Provisional IDL; replace or verify after Anchor build'},
  instructions:[
    instruction('ping',[authority()]),
    instruction('initialize_counter',[authority(true),state('counter','counter'),system]),
    instruction('increment_counter',[authority(),state('counter','counter')]),
    instruction('create_profile',[authority(true),state('profile','profile'),system],[{name:'display_name',type:'string'},{name:'bio',type:'string'}]),
    instruction('update_profile',[authority(),state('profile','profile')],[{name:'display_name',type:'string'},{name:'bio',type:'string'}]),
  ],
  accounts:['Counter','Profile'].map(name=>({name,discriminator:discriminator('account',name)})),
  types:[
    {name:'Counter',type:{kind:'struct',fields:[{name:'authority',type:'pubkey'},{name:'count',type:'u64'},{name:'bump',type:'u8'}]}},
    {name:'Profile',type:{kind:'struct',fields:[{name:'authority',type:'pubkey'},{name:'bump',type:'u8'},{name:'display_name',type:'string'},{name:'bio',type:'string'},{name:'updated_slot',type:'u64'}]}},
  ],
  errors:[
    {code:6000,name:'CounterOverflow',msg:'Counter overflow'},
    {code:6001,name:'EmptyName',msg:'Profile name is empty'},
    {code:6002,name:'NameTooLong',msg:'Profile name exceeds 32 UTF-8 bytes'},
    {code:6003,name:'BioTooLong',msg:'Profile bio exceeds 160 UTF-8 bytes'},
  ],
};
const target=resolve(root,'learning/idl/antimatter_learning.json');
mkdirSync(resolve(root,'learning/idl'),{recursive:true});
writeFileSync(target,JSON.stringify(idl,null,2)+'\n');
console.log(`Wrote provisional IDL for ${address}`);
