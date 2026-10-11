package kz.armtranzit.app;

import android.Manifest;
import android.os.Build;
import android.os.SystemClock;
import android.content.Context;
import android.content.SharedPreferences;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import org.json.JSONObject;
import com.google.android.gms.nearby.Nearby;
import com.google.android.gms.nearby.connection.*;
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters;
import org.bouncycastle.crypto.signers.Ed25519Signer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.*;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name="Tranzit", permissions={
  @Permission(alias="coarseLocation",strings={Manifest.permission.ACCESS_COARSE_LOCATION}),
  @Permission(alias="fineLocation",strings={Manifest.permission.ACCESS_FINE_LOCATION}),
  @Permission(alias="bluetooth",strings={Manifest.permission.BLUETOOTH_SCAN,Manifest.permission.BLUETOOTH_CONNECT,Manifest.permission.BLUETOOTH_ADVERTISE}),
  @Permission(alias="wifi",strings={Manifest.permission.NEARBY_WIFI_DEVICES})
})
public class TranzitPlugin extends Plugin implements SensorEventListener {
  private static final String SERVICE="kz.armtranzit.app.devnet.v1";
  private ConnectionsClient client;
  private String name="", current=null;
  private boolean active=false, signing=false;
  private SensorManager sensorManager;
  private long lastImpactNanos=0;
  private final Set<String> verified=new HashSet<>();
  private final Map<String,String> pending=new HashMap<>();
  @Override public void load(){client=Nearby.getConnectionsClient(getContext());}
  private void event(String type,String endpoint,String key,String value){
    JSObject o=new JSObject().put("type",type);if(endpoint!=null)o.put("endpoint",endpoint);if(key!=null)o.put(key,value);notifyListeners("nearby",o);
  }
  private void failure(Exception e){event("error",null,"message",e.getMessage());}
  @PluginMethod public void start(PluginCall call){
    List<String> aliases=new ArrayList<>();
    aliases.add("coarseLocation");
    aliases.add("fineLocation");
    if(Build.VERSION.SDK_INT>=31)aliases.add("bluetooth");
    if(Build.VERSION.SDK_INT>=33)aliases.add("wifi");
    boolean needs=aliases.stream().anyMatch(a->getPermissionState(a)!=PermissionState.GRANTED);
    if(needs)requestPermissionForAliases(aliases.toArray(new String[0]),call,"permissionsReady");else permissionsReady(call);
  }
  @PermissionCallback private void permissionsReady(PluginCall call){
    if(getPermissionState("coarseLocation")!=PermissionState.GRANTED||getPermissionState("fineLocation")!=PermissionState.GRANTED||(Build.VERSION.SDK_INT>=31&&getPermissionState("bluetooth")!=PermissionState.GRANTED)||(Build.VERSION.SDK_INT>=33&&getPermissionState("wifi")!=PermissionState.GRANTED)){call.reject("Разрешите точную геолокацию и Bluetooth / устройства поблизости в настройках Android.");return;}
    stopAll();name=call.getString("name","Участник");if(name.length()>24)name=name.substring(0,24);active=true;startMotion();
    if("receive".equals(call.getString("role"))){
      client.startAdvertising(name,SERVICE,lifecycle,new AdvertisingOptions.Builder().setStrategy(Strategy.P2P_POINT_TO_POINT).build()).addOnSuccessListener(v->call.resolve()).addOnFailureListener(e->{stopAll();call.reject("Nearby: "+e.getMessage());});
    }else{
      client.startDiscovery(SERVICE,discovery,new DiscoveryOptions.Builder().setStrategy(Strategy.P2P_POINT_TO_POINT).build()).addOnSuccessListener(v->call.resolve()).addOnFailureListener(e->{stopAll();call.reject("Nearby: "+e.getMessage());});
    }
  }
  private final EndpointDiscoveryCallback discovery=new EndpointDiscoveryCallback(){
    @Override public void onEndpointFound(@NonNull String id,@NonNull DiscoveredEndpointInfo info){if(active)event("found",id,"name",info.getEndpointName());}
    @Override public void onEndpointLost(@NonNull String id){event("lost",id,null,null);}
  };
  @PluginMethod public void connect(PluginCall call){String id=call.getString("endpoint");if(!active||id==null||current!=null){call.reject("Сеанс занят или остановлен.");return;}current=id;client.stopDiscovery();client.requestConnection(name,id,lifecycle).addOnSuccessListener(v->call.resolve()).addOnFailureListener(e->{current=null;call.reject(e.getMessage());});}
  private final ConnectionLifecycleCallback lifecycle=new ConnectionLifecycleCallback(){
    @Override public void onConnectionInitiated(@NonNull String id,@NonNull ConnectionInfo info){
      if(!active||(current!=null&&!current.equals(id))){client.rejectConnection(id);return;}
      current=id;pending.put(id,info.getAuthenticationDigits());
      notifyListeners("nearby",new JSObject().put("type","verify").put("endpoint",id).put("name",info.getEndpointName()).put("code",info.getAuthenticationDigits()));
      getActivity().getWindow().getDecorView().postDelayed(()->{if(pending.remove(id)!=null){client.rejectConnection(id);current=null;event("disconnected",id,null,null);}},60_000);
    }
    @Override public void onConnectionResult(@NonNull String id,@NonNull ConnectionResolution result){
      if(result.getStatus().isSuccess()&&verified.contains(id)){client.stopAdvertising();client.stopDiscovery();event("connected",id,null,null);}else{verified.remove(id);pending.remove(id);current=null;event("disconnected",id,null,null);}
    }
    @Override public void onDisconnected(@NonNull String id){verified.remove(id);pending.remove(id);if(id.equals(current))current=null;event("disconnected",id,null,null);}
  };
  @PluginMethod public void verify(PluginCall call){String id=call.getString("endpoint");if(id==null||pending.remove(id)==null){call.reject("Код истёк. Начните сеанс заново.");return;}if(Boolean.TRUE.equals(call.getBoolean("accept"))){verified.add(id);client.acceptConnection(id,payloads).addOnSuccessListener(v->call.resolve()).addOnFailureListener(e->{verified.remove(id);call.reject(e.getMessage());});}else{verified.remove(id);current=null;client.rejectConnection(id);call.resolve();}}
  private final PayloadCallback payloads=new PayloadCallback(){
    @Override public void onPayloadReceived(@NonNull String id,@NonNull Payload payload){byte[] bytes=payload.asBytes();if(verified.contains(id)&&bytes!=null&&bytes.length<=32768)event("data",id,"data",new String(bytes,StandardCharsets.UTF_8));}
    @Override public void onPayloadTransferUpdate(@NonNull String id,@NonNull PayloadTransferUpdate update){if(update.getStatus()==PayloadTransferUpdate.Status.FAILURE)event("error",id,"message","Передача Nearby не завершилась. Проверьте историю Solana.");}
  };
  @PluginMethod public void send(PluginCall call){String id=call.getString("endpoint"),data=call.getString("data");if(id==null||!verified.contains(id)||data==null||data.getBytes(StandardCharsets.UTF_8).length>32768){call.reject("Нет проверенного соединения.");return;}client.sendPayload(id,Payload.fromBytes(data.getBytes(StandardCharsets.UTF_8))).addOnSuccessListener(v->call.resolve()).addOnFailureListener(e->call.reject(e.getMessage()));}
  private void startMotion(){sensorManager=(SensorManager)getContext().getSystemService(Context.SENSOR_SERVICE);if(sensorManager!=null){Sensor sensor=sensorManager.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION);if(sensor!=null)sensorManager.registerListener(this,sensor,20_000,0);}}
  @Override public void onSensorChanged(SensorEvent sample){
    if(!active||sample.sensor.getType()!=Sensor.TYPE_LINEAR_ACCELERATION)return;
    float[] a=sample.values;double strength=Math.sqrt(a[0]*a[0]+a[1]*a[1]+a[2]*a[2])/9.80665;
    if(strength<0.8||sample.timestamp-lastImpactNanos<400_000_000L)return;
    lastImpactNanos=sample.timestamp;
    long at=System.currentTimeMillis()-(SystemClock.elapsedRealtimeNanos()-sample.timestamp)/1_000_000L;
    notifyListeners("nearby",new JSObject().put("type","impact").put("at",at).put("strength",strength));
  }
  @Override public void onAccuracyChanged(Sensor sensor,int accuracy){}
  private void stopAll(){active=false;if(sensorManager!=null)sensorManager.unregisterListener(this);sensorManager=null;if(client!=null){client.stopAdvertising();client.stopDiscovery();client.stopAllEndpoints();}pending.clear();verified.clear();current=null;}
  @PluginMethod public void stop(PluginCall call){stopAll();call.resolve();}
  @Override protected void handleOnStop(){stopAll();event("stopped",null,null,null);}
  @Override protected void handleOnDestroy(){stopAll();}

  // The Ed25519 seed never crosses the Capacitor bridge. AES key is non-exportable Android Keystore material.
  private synchronized Ed25519PrivateKeyParameters walletKey() throws Exception {
    KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);
    String alias="arm-tranzit-devnet-wrap-v1";
    SharedPreferences prefs=getContext().getSharedPreferences("arm-tranzit-wallet",Context.MODE_PRIVATE);
    String saved=prefs.getString("encryptedSeed",null);
    if(!ks.containsAlias(alias)){
      if(saved!=null)throw new Exception("Ключ Keystore утрачен. Не сбрасывайте приложение до проверки истории.");
      KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
      generator.init(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build());generator.generateKey();
    }
    SecretKey wrappingKey=(SecretKey)ks.getKey(alias,null);Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");byte[] seed;
    if(saved==null){
      seed=new byte[32];new SecureRandom().nextBytes(seed);cipher.init(Cipher.ENCRYPT_MODE,wrappingKey);
      byte[] encrypted=cipher.doFinal(seed);
      if(!prefs.edit().putString("encryptedSeed",Base64.encodeToString(encrypted,Base64.NO_WRAP)).putString("iv",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)).commit())throw new Exception("Не удалось сохранить ключ.");
    }else{cipher.init(Cipher.DECRYPT_MODE,wrappingKey,new GCMParameterSpec(128,Base64.decode(prefs.getString("iv",""),Base64.NO_WRAP)));seed=cipher.doFinal(Base64.decode(saved,Base64.NO_WRAP));}
    Ed25519PrivateKeyParameters key=new Ed25519PrivateKeyParameters(seed,0);Arrays.fill(seed,(byte)0);return key;
  }
  @PluginMethod public void wallet(PluginCall call){try{call.resolve(new JSObject().put("publicKey",Base64.encodeToString(walletKey().generatePublicKey().getEncoded(),Base64.NO_WRAP)));}catch(Exception e){call.reject(e.getMessage());}}
  @PluginMethod public void sign(PluginCall call){
    if(signing){call.reject("Подтверждение уже открыто.");return;}
    try{
      byte[] message=Base64.decode(call.getString("message",""),Base64.NO_WRAP);
      String summary=TransferMessage.describe(message,walletKey().generatePublicKey().getEncoded(),call.getString("recipient"),call.getLong("amount",0L),call.getString("memo"),call.getString("network"));
      authorizeSignature(call,message,summary);
    }catch(Exception e){signing=false;call.reject(e.getMessage());}
  }
  @PluginMethod public void signDemo(PluginCall call){
    if(signing){call.reject("Подтверждение уже открыто.");return;}
    try{
      byte[] message=Base64.decode(call.getString("message",""),Base64.NO_WRAP);
      String raw=new String(message,StandardCharsets.UTF_8);
      if(!raw.startsWith("ARM-LAB-1\n"))throw new Exception("Это не учебный блок.");
      JSONObject p=new JSONObject(raw.substring(10));
      String from=TransferMessage.b58(walletKey().generatePublicKey().getEncoded());
      if(!"arm-lab-v1".equals(p.getString("network"))||!from.equals(p.getString("from"))||p.getString("to").equals(from)||p.getString("to").length()<32||p.getString("to").length()>44||p.getLong("lamports")<=0||p.getLong("lamports")>10_000_000_000L||p.getInt("height")<1||p.getInt("height")>100||!p.getString("previous").matches("[a-f0-9]{64}")||Math.abs(System.currentTimeMillis()-p.getLong("timestamp"))>120_000)throw new Exception("Учебный блок не прошёл проверку.");
      String summary=new java.math.BigDecimal(p.getLong("lamports")).movePointLeft(9).stripTrailingZeros().toPlainString()+" учебных единиц → "+p.getString("to")+"\nANTIMATTER Lab · без денежной стоимости";
      authorizeSignature(call,message,summary);
    }catch(Exception e){signing=false;call.reject(e.getMessage());}
  }
  private void authorizeSignature(PluginCall call,byte[] message,String summary){
    try{
      int authenticators=BiometricManager.Authenticators.BIOMETRIC_STRONG|BiometricManager.Authenticators.DEVICE_CREDENTIAL;
      if(BiometricManager.from(getContext()).canAuthenticate(authenticators)!=BiometricManager.BIOMETRIC_SUCCESS){call.reject("Настройте PIN-код, пароль или биометрию блокировки телефона.");return;}
      signing=true;getActivity().runOnUiThread(()->{
        BiometricPrompt prompt=new BiometricPrompt(getActivity(),ContextCompat.getMainExecutor(getContext()),new BiometricPrompt.AuthenticationCallback(){
          @Override public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result){try{Ed25519Signer signer=new Ed25519Signer();signer.init(true,walletKey());signer.update(message,0,message.length);call.resolve(new JSObject().put("signature",Base64.encodeToString(signer.generateSignature(),Base64.NO_WRAP)));}catch(Exception e){call.reject(e.getMessage());}finally{signing=false;}}
          @Override public void onAuthenticationError(int code,@NonNull CharSequence error){signing=false;call.reject("Подпись отменена: "+error);}
        });
        prompt.authenticate(new BiometricPrompt.PromptInfo.Builder().setTitle("Подпись · ANTIMATTER").setDescription(summary).setAllowedAuthenticators(authenticators).build());
      });
    }catch(Exception e){signing=false;call.reject(e.getMessage());}
  }
}

