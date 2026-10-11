import {readFileSync,writeFileSync,copyFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const edit=(path,fn)=>writeFileSync(path,fn(readFileSync(path,'utf8')));
const service='kz.armtranzit.app.devnet.v1';
const bonjour=`_${createHash('sha256').update(service).digest('hex').slice(0,12).toUpperCase()}._tcp`;
const javaDir='android/app/src/main/java/kz/armtranzit/app';mkdirSync(javaDir,{recursive:true});
for(const file of ['TranzitPlugin.java','TransferMessage.java','MainActivity.java'])copyFileSync(`native/android/${file}`,`${javaDir}/${file}`);
edit('android/app/build.gradle',s=>s.includes('play-services-nearby')?s:s.replace('dependencies {',`dependencies {\n    implementation 'com.google.android.gms:play-services-nearby:19.3.0'\n    implementation 'androidx.biometric:biometric:1.1.0'\n    implementation 'org.bouncycastle:bcprov-jdk18on:1.83'`));
edit('android/variables.gradle',s=>s.replace(/minSdkVersion = \d+/,'minSdkVersion = 30'));
edit('android/app/src/main/AndroidManifest.xml',s=>{
  s=s.replace('android:allowBackup="true"','android:allowBackup="false"');
  s=s.replace('android.permission.ACCESS_FINE_LOCATION" android:maxSdkVersion="31"','android.permission.ACCESS_FINE_LOCATION"');
  if(!s.includes('android.permission.ACCESS_COARSE_LOCATION'))s=s.replace('</manifest>','    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />\n</manifest>');
  if(s.includes('BLUETOOTH_SCAN'))return s;
  return s.replace('</manifest>',`<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
    <uses-permission android:name="android.permission.CHANGE_WIFI_STATE" />
    <uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
    <uses-permission android:name="android.permission.BLUETOOTH_ADVERTISE" />
    <uses-permission android:name="android.permission.NEARBY_WIFI_DEVICES" android:usesPermissionFlags="neverForLocation" />
    <uses-permission android:name="android.permission.USE_BIOMETRIC" />
</manifest>`);
});
// Capacitor regenerates this manifest on sync; apply pinned Nearby dependency every time.
edit('ios/App/CapApp-SPM/Package.swift',s=>s.includes('google/nearby')?s:s.replace('dependencies: [','dependencies: [\n        .package(url: "https://github.com/google/nearby.git", revision: "45680b6783b2f2cab074c56ac658a7ed7ba1c16c"),').replace('.product(name: "Cordova", package: "capacitor-swift-pm")','.product(name: "Cordova", package: "capacitor-swift-pm"),\n                .product(name: "NearbyConnections", package: "nearby")'));
copyFileSync('native/ios/TranzitPlugin.swift','ios/App/CapApp-SPM/Sources/CapApp-SPM/TranzitPlugin.swift');
edit('ios/App/App/AppDelegate.swift',s=>s.includes('class TranzitViewController')?s:s+'\nimport CapApp_SPM\n\nclass TranzitViewController: CAPBridgeViewController {\n    override func capacitorDidLoad() { bridge?.registerPluginInstance(TranzitPlugin()) }\n}\n');
edit('ios/App/App/SceneDelegate.swift',s=>s.replace('rootViewController = CAPBridgeViewController()','rootViewController = TranzitViewController()'));
edit('ios/App/App/Base.lproj/Main.storyboard',s=>s.replace('customClass="CAPBridgeViewController" customModule="Capacitor"','customClass="TranzitViewController" customModule="App"'));
edit('ios/App/App/Info.plist',s=>s.includes('NSBluetoothAlwaysUsageDescription')?s:s.replace('</dict>\n</plist>',`<key>NSBluetoothAlwaysUsageDescription</key><string>Bluetooth нужен для обмена адресами тестовых кошельков между телефонами.</string>
    <key>NSLocalNetworkUsageDescription</key><string>Nearby соединяет два телефона для учебного перевода.</string>
    <key>NSFaceIDUsageDescription</key><string>Подтверждение подписи перевода тестовых SOL.</string>
    <key>NSBonjourServices</key><array><string>${bonjour}</string></array>
    </dict>\n</plist>`).replace('</dict>\r\n</plist>',`<key>NSBluetoothAlwaysUsageDescription</key><string>Bluetooth нужен для обмена адресами тестовых кошельков между телефонами.</string>
    <key>NSLocalNetworkUsageDescription</key><string>Nearby соединяет два телефона для учебного перевода.</string>
    <key>NSFaceIDUsageDescription</key><string>Подтверждение подписи перевода тестовых SOL.</string>
    <key>NSBonjourServices</key><array><string>${bonjour}</string></array>
    </dict>\n</plist>`));
edit('ios/App/App/Info.plist',s=>s.includes('NSMotionUsageDescription')?s:s.replace(/<\/dict>\s*<\/plist>/,`<key>NSMotionUsageDescription</key><string>Датчик движения помогает проверить одновременное физическое соприкосновение двух телефонов.</string>\n    </dict>\n</plist>`));
console.log(`Native sources configured. Bonjour service: ${bonjour}`);
