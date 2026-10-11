package kz.armtranzit.app;
import java.math.BigInteger;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/** Strict native decoder: only the app's SOL or AMT transfer with an ARM session memo is signable. */
public final class TransferMessage {
  private static final String ALPHABET="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  private static final String AMT_MINT="GTYjjjnW9hcLg1UrgfZBfpL4BXP74eJcZ9TWDeguL9MR";
  private static final String ATA_PROGRAM="ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
  private static final String TOKEN_PROGRAM="TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  private static final String MEMO_PROGRAM="MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
  static String b58(byte[] bytes){BigInteger n=new BigInteger(1,bytes);StringBuilder out=new StringBuilder();while(n.signum()>0){BigInteger[] div=n.divideAndRemainder(BigInteger.valueOf(58));out.append(ALPHABET.charAt(div[1].intValue()));n=div[0];}for(byte b:bytes){if(b!=0)break;out.append('1');}return out.reverse().toString();}
  private static int u8(ByteBuffer b){return Byte.toUnsignedInt(b.get());}
  private static byte[] read(ByteBuffer b,int n){byte[] value=new byte[n];b.get(value);return value;}
  private static int compact(ByteBuffer b){int value=u8(b);if(value>=128)throw new IllegalArgumentException();return value;}
  private static final class Instruction {
    final int program;final int[] accounts;final byte[] data;
    Instruction(ByteBuffer b,int keyCount){program=compact(b);int count=compact(b);if(program>=keyCount||count>8)throw new IllegalArgumentException();accounts=new int[count];for(int i=0;i<count;i++){accounts[i]=compact(b);if(accounts[i]>=keyCount)throw new IllegalArgumentException();}int length=compact(b);if(length>128)throw new IllegalArgumentException();data=read(b,length);}
  }
  private static String describeToken(byte[] message,byte[] own,String recipient,long expectedAmount,String expectedMemo){
    ByteBuffer b=ByteBuffer.wrap(message).order(ByteOrder.LITTLE_ENDIAN);
    if(u8(b)!=1||u8(b)!=0)throw new IllegalArgumentException();
    int readonly=u8(b),count=compact(b);if(count<8||count>16||readonly>count-1)throw new IllegalArgumentException();
    byte[][] keys=new byte[count][];for(int i=0;i<count;i++)keys[i]=read(b,32);
    if(!Arrays.equals(keys[0],own))throw new IllegalArgumentException();
    read(b,32);if(compact(b)!=3)throw new IllegalArgumentException();
    Instruction ata=new Instruction(b,count),transfer=new Instruction(b,count),memo=new Instruction(b,count);
    if(b.hasRemaining()||!b58(keys[ata.program]).equals(ATA_PROGRAM)||!b58(keys[transfer.program]).equals(TOKEN_PROGRAM)||!b58(keys[memo.program]).equals(MEMO_PROGRAM))throw new IllegalArgumentException();
    if(ata.accounts.length!=6||ata.data.length!=1||ata.data[0]!=1||ata.accounts[0]!=0||!b58(keys[ata.accounts[3]]).equals(AMT_MINT)||!b58(keys[ata.accounts[4]]).equals("11111111111111111111111111111111")||!b58(keys[ata.accounts[5]]).equals(TOKEN_PROGRAM))throw new IllegalArgumentException();
    if(transfer.accounts.length!=4||transfer.data.length!=10||Byte.toUnsignedInt(transfer.data[0])!=12||Byte.toUnsignedInt(transfer.data[9])!=9||transfer.accounts[1]!=ata.accounts[3]||transfer.accounts[2]!=ata.accounts[1]||transfer.accounts[3]!=0||transfer.accounts[0]==transfer.accounts[2])throw new IllegalArgumentException();
    if(ata.accounts[1]>=count-readonly||transfer.accounts[0]>=count-readonly||transfer.accounts[2]>=count-readonly||ata.program<count-readonly||transfer.program<count-readonly||memo.program<count-readonly)throw new IllegalArgumentException();
    if(memo.accounts.length!=0||memo.data.length!=78||!new String(memo.data,StandardCharsets.UTF_8).matches("ARM1:[a-f0-9-]{36}:[a-f0-9-]{36}"))throw new IllegalArgumentException();
    long amount=ByteBuffer.wrap(transfer.data,1,8).order(ByteOrder.LITTLE_ENDIAN).getLong();
    if(amount<=0||amount>10_000_000_000L)throw new IllegalArgumentException();
    if(amount!=expectedAmount||!b58(keys[ata.accounts[2]]).equals(recipient)||!new String(memo.data,StandardCharsets.UTF_8).equals(expectedMemo))throw new IllegalArgumentException();
    return new java.math.BigDecimal(amount).movePointLeft(9).stripTrailingZeros().toPlainString()+" AMT · Solana Devnet\nПолучатель: "+b58(keys[ata.accounts[2]])+"\nБез денежной стоимости";
  }
  private static String describeSol(byte[] message,byte[] own,String recipient,long expectedAmount,String expectedMemo){
    try{
      ByteBuffer b=ByteBuffer.wrap(message).order(ByteOrder.LITTLE_ENDIAN);
      if(u8(b)!=1||u8(b)!=0||u8(b)!=2||u8(b)!=4)throw new Exception();
      byte[][] keys=new byte[4][];for(int i=0;i<4;i++)keys[i]=read(b,32);
      if(!Arrays.equals(keys[0],own)||Arrays.equals(keys[0],keys[1]))throw new Exception();
      read(b,32);if(u8(b)!=2)throw new Exception();
      int program=u8(b);if(program<2||program>3||!Arrays.equals(keys[program],new byte[32])||u8(b)!=2||u8(b)!=0||u8(b)!=1||u8(b)!=12||b.getInt()!=2)throw new Exception();
      long amount=b.getLong();if(amount<=0||amount>10_000_000_000L)throw new Exception();
      int memoProgram=u8(b);if(memoProgram<2||memoProgram>3||!b58(keys[memoProgram]).equals("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr")||u8(b)!=0)throw new Exception();
      int size=u8(b);if(size!=78||b.remaining()!=size)throw new Exception();
      String memo=new String(read(b,size),StandardCharsets.UTF_8);
      if(!memo.matches("ARM1:[a-f0-9-]{36}:[a-f0-9-]{36}"))throw new Exception();
      if(amount!=expectedAmount||!b58(keys[1]).equals(recipient)||!memo.equals(expectedMemo))throw new Exception();
      return new java.math.BigDecimal(amount).movePointLeft(9).stripTrailingZeros().toPlainString()+" тестовых SOL\nПолучатель: "+b58(keys[1])+"\nБез денежной стоимости";
    }catch(Exception e){throw new IllegalArgumentException();}
  }
  public static String describe(byte[] message,byte[] own,String recipient,long amount,String memo,String network){
    if(recipient==null||memo==null||network==null||amount<=0||amount>10_000_000_000L)throw new IllegalArgumentException();
    if(network.equals("solana-devnet-amt")){try{return describeToken(message,own,recipient,amount,memo);}catch(Exception ignored){}}
    if(network.equals("solana-devnet")){try{return describeSol(message,own,recipient,amount,memo);}catch(Exception ignored){}}
    throw new IllegalArgumentException("Подпись запрещена: ожидается перевод SOL или AMT с проверенным получателем и меткой сеанса.");
  }
}
