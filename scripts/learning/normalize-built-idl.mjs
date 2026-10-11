// The program keypair is supplied to CI as an encrypted GitHub Actions secret.
// Reject mismatched builds before publishing the SBF binary or IDL.
import {createHash} from 'node:crypto';
import {copyFileSync,mkdirSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'../..');
const artifactRoot=resolve(process.argv[2]||resolve(root,'learning/anchor/target'));
const workflowRun=process.argv[3]||'';
const source=readFileSync(resolve(root,'learning/anchor/programs/antimatter_learning/src/lib.rs'),'utf8');
const declared=source.match(/declare_id!\("([^"]+)"\)/)?.[1];
const anchorToml=readFileSync(resolve(root,'learning/anchor/Anchor.toml'),'utf8');
const configured=anchorToml.match(/antimatter_learning\s*=\s*"([^"]+)"/)?.[1];
if(!declared||configured!==declared)throw new Error('Program ID differs between Rust and Anchor.toml.');
const idlPath=resolve(artifactRoot,'idl/antimatter_learning.json');
const binaryPath=resolve(artifactRoot,'deploy/antimatter_learning.so');
const idl=JSON.parse(readFileSync(idlPath,'utf8'));
if(idl.address!==declared)throw new Error(`Built IDL address ${idl.address} does not match declared Program ID ${declared}.`);
const required=['ping','initialize_counter','increment_counter','create_profile','update_profile'];
for(const name of required){
  const instruction=idl.instructions?.find(item=>item.name===name);
  const discriminator=[...createHash('sha256').update(`global:${name}`).digest().subarray(0,8)];
  if(!instruction||JSON.stringify(instruction.discriminator)!==JSON.stringify(discriminator))throw new Error(`Built IDL instruction mismatch: ${name}`);
}
for(const name of ['Counter','Profile'])if(!idl.accounts?.some(item=>item.name===name))throw new Error(`Built IDL account missing: ${name}`);
const binary=readFileSync(binaryPath);
if(binary.length<10_000||binary.subarray(0,4).toString('hex')!=='7f454c46')throw new Error('Built SBF ELF is invalid.');
const output=resolve(root,'learning/build');
mkdirSync(output,{recursive:true});
copyFileSync(binaryPath,resolve(output,'antimatter_learning.so'));
const generatedIdlAddress=idl.address;
writeFileSync(resolve(root,'learning/idl/antimatter_learning.json'),JSON.stringify(idl,null,2)+'\n');
const report={
  sourceProgramId:declared,generatedIdlAddress,binaryBytes:statSync(binaryPath).size,
  binarySha256:createHash('sha256').update(binary).digest('hex'),
  instructions:required,workflowRun:workflowRun||null,
  deployed:false,
};
writeFileSync(resolve(root,'verification/learning-sbf-build.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
