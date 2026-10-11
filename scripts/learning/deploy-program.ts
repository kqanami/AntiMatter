// Deploy the CI-built Anchor ELF with Solana's upgradeable loader from Windows.
// All signing keys and resumable buffer progress remain under ignored .devnet/.
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Connection,Keypair,PublicKey,sendAndConfirmTransaction,SYSVAR_CLOCK_PUBKEY,SYSVAR_RENT_PUBKEY,SystemProgram,Transaction,TransactionInstruction} from '@solana/web3.js';
import {GENESIS} from '../../src/domain';
import idl from '../../learning/idl/antimatter_learning.json';

const [command='status']=process.argv.slice(2);
const BPF_LOADER_UPGRADEABLE_PROGRAM_ID=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const rpcUrl=process.env.LEARNING_RPC_URL||'https://api.devnet.solana.com';
if(!rpcUrl.startsWith('https://'))throw new Error('LEARNING_RPC_URL must be HTTPS.');
const connection=new Connection(rpcUrl,'confirmed');
const root=resolve('.devnet');
const programId=new PublicKey(idl.address);
const bufferKeyPath=resolve(root,`learning-${command}-${programId.toBase58().slice(0,8)}-buffer-keypair.json`);
const progressPath=resolve(root,`learning-${command}-${programId.toBase58().slice(0,8)}-progress.json`);
const ELF=await readFile(resolve('learning/build/antimatter_learning.so'));
const build=JSON.parse(await readFile(resolve('verification/learning-sbf-build.json'),'utf8')) as {sourceProgramId:string;binarySha256:string};
if(build.sourceProgramId!==programId.toBase58()||createHash('sha256').update(ELF).digest('hex')!==build.binarySha256)throw new Error('Built binary does not match the verified program ID and SHA-256.');
if(await connection.getGenesisHash()!==GENESIS)throw new Error('RPC is not Solana Devnet.');
const authority=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(resolve(root,'learning-wallet.json'),'utf8'))));
const program=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(resolve(root,'learning-program-keypair.json'),'utf8'))));
if(program.publicKey.toBase58()!==programId.toBase58())throw new Error('Local program keypair does not match the built IDL.');
const programData=PublicKey.findProgramAddressSync([programId.toBuffer()],BPF_LOADER_UPGRADEABLE_PROGRAM_ID)[0];
const bufferSpace=37+ELF.length;
const bufferRent=await connection.getMinimumBalanceForRentExemption(bufferSpace);
const programRent=await connection.getMinimumBalanceForRentExemption(36);
const programDataRent=await connection.getMinimumBalanceForRentExemption(45+ELF.length);
const currentProgram=await connection.getAccountInfo(programId,'confirmed');
const currentProgramData=currentProgram?.executable?await connection.getAccountInfo(programData,'confirmed'):null;
const binaryMatchesOnChain=!!currentProgramData&&currentProgramData.data.subarray(45).equals(ELF);

async function existingBuffer(){
  try{return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(bufferKeyPath,'utf8'))));}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
}
async function send(tx:Transaction,signers:Keypair[],label:string){
  let lastError:unknown;
  for(let attempt=0;attempt<12;attempt++){
    try{return await sendAndConfirmTransaction(connection,tx,signers,{commitment:'confirmed',preflightCommitment:'confirmed',maxRetries:3});}
    catch(error){lastError=error;console.error(`${label}: ${error instanceof Error?error.message:String(error)}`);await new Promise(r=>setTimeout(r,Math.min(3000*2**attempt,30000)));}
  }
  throw lastError;
}
function instruction(data:Buffer,keys:TransactionInstruction['keys']){return new TransactionInstruction({programId:BPF_LOADER_UPGRADEABLE_PROGRAM_ID,keys,data});}
function opcode(value:number){const data=Buffer.alloc(4);data.writeUInt32LE(value);return data;}

if(command==='status'){
  const buffer=await existingBuffer();
  console.log(JSON.stringify({cluster:'devnet',programId:programId.toBase58(),deployed:!!currentProgram?.executable,binaryMatchesOnChain,programOwner:currentProgram?.owner.toBase58()||null,programData:programData.toBase58(),authority:authority.publicKey.toBase58(),authorityBalance:await connection.getBalance(authority.publicKey),binaryBytes:ELF.length,bufferRent,programRent,programDataRent,buffer:buffer?.publicKey.toBase58()||null},null,2));
}else if(command==='deploy'||command==='upgrade'){
  if(command==='deploy'&&currentProgram?.executable)throw new Error(`Program ${programId} is already deployed; use upgrade.`);
  if(command==='upgrade'&&!currentProgram?.executable)throw new Error(`Program ${programId} is not deployed; use deploy.`);
  if(command==='upgrade'){
    if(!currentProgram?.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID)||currentProgram.data.readUInt32LE(0)!==2||!currentProgram.data.subarray(4,36).equals(programData.toBuffer()))throw new Error('Program account is not the expected upgradeable-loader program.');
    const dataInfo=currentProgramData;
    if(!dataInfo||dataInfo.data.readUInt32LE(0)!==3||dataInfo.data[12]!==1||!dataInfo.data.subarray(13,45).equals(authority.publicKey.toBuffer()))throw new Error('Learning wallet does not hold program upgrade authority.');
    if(dataInfo.data.length<45+ELF.length)throw new Error('New ELF exceeds existing ProgramData capacity.');
  }
  await mkdir(root,{recursive:true});
  let buffer=await existingBuffer();
  if(!buffer){buffer=Keypair.generate();await writeFile(bufferKeyPath,JSON.stringify([...buffer.secretKey]),{flag:'wx',mode:0o600});}
  const bufferInfo=await connection.getAccountInfo(buffer.publicKey,'confirmed');
  const needed=(bufferInfo?0:bufferRent)+(command==='deploy'?programRent+Math.max(0,programDataRent-bufferRent):0)+2_000_000;
  const funds=await connection.getBalance(authority.publicKey,'confirmed');
  if(funds<needed)throw new Error(`Need at least ${needed} lamports in learning wallet ${authority.publicKey}; available ${funds}.`);
  if(!bufferInfo){
    const init=instruction(opcode(0),[
      {pubkey:buffer.publicKey,isSigner:false,isWritable:true},
      {pubkey:authority.publicKey,isSigner:false,isWritable:false},
    ]);
    const signature=await send(new Transaction().add(SystemProgram.createAccount({fromPubkey:authority.publicKey,newAccountPubkey:buffer.publicKey,lamports:bufferRent,space:bufferSpace,programId:BPF_LOADER_UPGRADEABLE_PROGRAM_ID}),init),[authority,buffer],'Initialize buffer');
    console.log(`Buffer initialized: ${signature}`);
  }else if(!bufferInfo.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID)||bufferInfo.data.length!==bufferSpace){
    throw new Error('Saved buffer account is not the expected upgradeable-loader buffer.');
  }
  let offset=0;
  try{
    const progress=JSON.parse(await readFile(progressPath,'utf8')) as {buffer:string;binarySha256:string;offset:number};
    if(progress.buffer===buffer.publicKey.toBase58()&&progress.binarySha256===build.binarySha256&&progress.offset>=0&&progress.offset<=ELF.length)offset=progress.offset;
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const chunkSize=900;
  while(offset<ELF.length){
    const bytes=ELF.subarray(offset,Math.min(offset+chunkSize,ELF.length));
    const data=Buffer.alloc(16+bytes.length);
    data.writeUInt32LE(1,0);
    data.writeUInt32LE(offset,4);
    data.writeBigUInt64LE(BigInt(bytes.length),8);
    bytes.copy(data,16);
    await send(new Transaction().add(instruction(data,[
      {pubkey:buffer.publicKey,isSigner:false,isWritable:true},
      {pubkey:authority.publicKey,isSigner:true,isWritable:false},
    ])),[authority],`Write ${offset}/${ELF.length}`);
    offset+=bytes.length;
    await writeFile(progressPath,JSON.stringify({buffer:buffer.publicKey.toBase58(),binarySha256:build.binarySha256,offset}));
    if(offset%9000===0||offset===ELF.length)console.log(`Uploaded ${offset}/${ELF.length} bytes`);
    await new Promise(r=>setTimeout(r,2500));
  }
  const uploaded=await connection.getAccountInfo(buffer.publicKey,'confirmed');
  if(!uploaded||!uploaded.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID)||!uploaded.data.subarray(37).equals(ELF))throw new Error('On-chain buffer bytes do not match the built ELF.');
  let signature:string;
  if(command==='deploy'){
    const data=Buffer.alloc(12);data.writeUInt32LE(2,0);data.writeBigUInt64LE(BigInt(ELF.length),4);
    const deploy=instruction(data,[
      {pubkey:authority.publicKey,isSigner:true,isWritable:true},
      {pubkey:programData,isSigner:false,isWritable:true},
      {pubkey:programId,isSigner:false,isWritable:true},
      {pubkey:buffer.publicKey,isSigner:false,isWritable:true},
      {pubkey:SYSVAR_RENT_PUBKEY,isSigner:false,isWritable:false},
      {pubkey:SYSVAR_CLOCK_PUBKEY,isSigner:false,isWritable:false},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
      {pubkey:authority.publicKey,isSigner:true,isWritable:false},
    ]);
    signature=await send(new Transaction().add(SystemProgram.createAccount({fromPubkey:authority.publicKey,newAccountPubkey:programId,lamports:programRent,space:36,programId:BPF_LOADER_UPGRADEABLE_PROGRAM_ID}),deploy),[authority,program],'Deploy program');
  }else{
    const upgrade=instruction(opcode(3),[
      {pubkey:programData,isSigner:false,isWritable:true},
      {pubkey:programId,isSigner:false,isWritable:true},
      {pubkey:buffer.publicKey,isSigner:false,isWritable:true},
      {pubkey:authority.publicKey,isSigner:true,isWritable:true},
      {pubkey:SYSVAR_RENT_PUBKEY,isSigner:false,isWritable:false},
      {pubkey:SYSVAR_CLOCK_PUBKEY,isSigner:false,isWritable:false},
      {pubkey:authority.publicKey,isSigner:true,isWritable:false},
    ]);
    signature=await send(new Transaction().add(upgrade),[authority],'Upgrade program');
  }
  const info=await connection.getAccountInfo(programId,'confirmed');
  if(!info?.executable||!info.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID))throw new Error('Deployment transaction did not produce an executable program.');
  const liveProgramData=await connection.getAccountInfo(programData,'confirmed');
  if(!liveProgramData?.data.subarray(45).equals(ELF))throw new Error('On-chain ProgramData does not match the built ELF after deployment/upgrade.');
  console.log(JSON.stringify({programId:programId.toBase58(),signature,explorer:`https://explorer.solana.com/tx/${signature}?cluster=devnet`},null,2));
  await writeFile(resolve(`verification/learning-program-${command}.json`),JSON.stringify({cluster:'devnet',programId:programId.toBase58(),programData:programData.toBase58(),authority:authority.publicKey.toBase58(),binarySha256:build.binarySha256,signature,explorer:`https://explorer.solana.com/tx/${signature}?cluster=devnet`},null,2)+'\n');
}else{
  throw new Error('Usage: pnpm learning:deploy <status|deploy|upgrade>');
}
