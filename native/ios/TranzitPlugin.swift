import Foundation
import UIKit
import Capacitor
import NearbyConnections
import CryptoKit
import Security
import LocalAuthentication
import CoreMotion

@objc(TranzitPlugin)
public final class TranzitPlugin: CAPPlugin, CAPBridgedPlugin, ConnectionManagerDelegate, AdvertiserDelegate, DiscovererDelegate {
    public let identifier = "TranzitPlugin"
    public let jsName = "Tranzit"
    public let pluginMethods: [CAPPluginMethod] = ["wallet", "sign", "signDemo", "start", "connect", "verify", "send", "stop"].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }
    private let manager = ConnectionManager(serviceID: "kz.armtranzit.app.devnet.v1", strategy: .pointToPoint)
    private lazy var advertiser = Advertiser(connectionManager: manager)
    private lazy var discoverer = Discoverer(connectionManager: manager)
    private var active = false
    private var signing = false
    private var name = "Участник"
    private var current: EndpointID?
    private var names: [EndpointID: String] = [:]
    private var verifications: [EndpointID: (Bool) -> Void] = [:]
    private var verified = Set<EndpointID>()
    private var backgroundObserver: NSObjectProtocol?
    private let motion = CMMotionManager()
    private var lastImpactTime = 0.0
    public override func load() {
        manager.delegate = self; advertiser.delegate = self; discoverer.delegate = self
        backgroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            self?.stopAll(); self?.emit("stopped")
        }
    }
    deinit { if let observer = backgroundObserver { NotificationCenter.default.removeObserver(observer) } }
    private func emit(_ type: String, _ endpoint: String? = nil, _ extra: [String: Any] = [:]) {
        var data = extra; data["type"] = type; if let endpoint = endpoint { data["endpoint"] = endpoint }
        notifyListeners("nearby", data: data)
    }
    private func finish(_ call: CAPPluginCall, _ error: Error?) { if let error = error { call.reject(error.localizedDescription) } else { call.resolve() } }
    @objc public func start(_ call: CAPPluginCall) { DispatchQueue.main.async {
        self.stopAll(); self.active = true; self.name = String((call.getString("name") ?? "Участник").prefix(24)); self.startMotion()
        if call.getString("role") == "receive" {
            self.advertiser.startAdvertising(using: Data(self.name.utf8)) { error in if error != nil { self.active = false }; self.finish(call, error) }
        } else { self.discoverer.startDiscovery { error in if error != nil { self.active = false }; self.finish(call, error) } }
    } }
    @objc public func connect(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard self.active, self.current == nil, let endpoint = call.getString("endpoint") else { call.reject("Сеанс занят или остановлен."); return }
        self.current = endpoint; self.discoverer.stopDiscovery()
        self.discoverer.requestConnection(to: endpoint, using: Data(self.name.utf8)) { error in if error != nil { self.current = nil }; self.finish(call, error) }
    } }
    @objc public func verify(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard let endpoint = call.getString("endpoint"), let handler = self.verifications.removeValue(forKey: endpoint) else { call.reject("Код истёк. Начните сеанс заново."); return }
        let accept = call.getBool("accept") ?? false
        if accept { self.verified.insert(endpoint) } else { self.current = nil; self.verified.remove(endpoint) }
        handler(accept); call.resolve()
    } }
    @objc public func send(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard let endpoint = call.getString("endpoint"), self.verified.contains(endpoint), let text = call.getString("data"), text.utf8.count <= 32768 else { call.reject("Нет проверенного соединения."); return }
        _ = self.manager.send(Data(text.utf8), to: [endpoint]) { error in self.finish(call, error) }
    } }
    private func stopAll() {
        active = false; motion.stopDeviceMotionUpdates(); advertiser.stopAdvertising(); discoverer.stopDiscovery()
        for (_, handler) in verifications { handler(false) }; verifications.removeAll()
        if let endpoint = current { manager.disconnect(from: endpoint) }
        current = nil; verified.removeAll(); names.removeAll()
    }
    private func startMotion() {
        guard motion.isDeviceMotionAvailable else { return }
        motion.deviceMotionUpdateInterval = 0.02
        motion.startDeviceMotionUpdates(to: .main) { [weak self] sample, _ in
            guard let self = self, self.active, let sample = sample else { return }
            let a = sample.userAcceleration
            let strength = sqrt(a.x * a.x + a.y * a.y + a.z * a.z)
            if strength < 0.8 || sample.timestamp - self.lastImpactTime < 0.4 { return }
            self.lastImpactTime = sample.timestamp
            let at = Date().timeIntervalSince1970 * 1000 - (ProcessInfo.processInfo.systemUptime - sample.timestamp) * 1000
            self.emit("impact", nil, ["at": Int(at), "strength": strength])
        }
    }
    @objc public func stop(_ call: CAPPluginCall) { DispatchQueue.main.async { self.stopAll(); call.resolve() } }
    public func discoverer(_ discoverer: Discoverer, didFind endpointID: EndpointID, with context: Data) {
        guard active else { return }; let name = String(data: context, encoding: .utf8) ?? "Участник"; names[endpointID] = name
        emit("found", endpointID, ["name": name])
    }
    public func discoverer(_ discoverer: Discoverer, didLose endpointID: EndpointID) { names.removeValue(forKey: endpointID); emit("lost", endpointID) }
    public func advertiser(_ advertiser: Advertiser, didReceiveConnectionRequestFrom endpointID: EndpointID, with context: Data, connectionRequestHandler: @escaping (Bool) -> Void) {
        guard active, current == nil || current == endpointID else { connectionRequestHandler(false); return }
        current = endpointID; names[endpointID] = String(data: context, encoding: .utf8) ?? "Участник"; connectionRequestHandler(true)
    }
    public func connectionManager(_ connectionManager: ConnectionManager, didReceive verificationCode: String, from endpointID: EndpointID, verificationHandler: @escaping (Bool) -> Void) {
        guard active, current == endpointID else { verificationHandler(false); return }
        verifications[endpointID] = verificationHandler
        emit("verify", endpointID, ["code": verificationCode, "name": names[endpointID] ?? "Участник"])
        DispatchQueue.main.asyncAfter(deadline: .now() + 60) { [weak self] in
            if let handler = self?.verifications.removeValue(forKey: endpointID) { handler(false); self?.current = nil; self?.emit("disconnected", endpointID) }
        }
    }
    public func connectionManager(_ connectionManager: ConnectionManager, didChangeTo state: ConnectionState, for endpointID: EndpointID) {
        switch state {
        case .connected:
            guard active, verified.contains(endpointID) else { manager.disconnect(from: endpointID); return }
            advertiser.stopAdvertising(); discoverer.stopDiscovery(); emit("connected", endpointID)
        case .disconnected, .rejected:
            verifications.removeValue(forKey: endpointID); verified.remove(endpointID); if current == endpointID { current = nil }; emit("disconnected", endpointID)
        case .connecting: break
        }
    }
    public func connectionManager(_ connectionManager: ConnectionManager, didReceive data: Data, withID payloadID: PayloadID, from endpointID: EndpointID) {
        if verified.contains(endpointID), data.count <= 32768, let text = String(data: data, encoding: .utf8) { emit("data", endpointID, ["data": text]) }
    }
    public func connectionManager(_ connectionManager: ConnectionManager, didReceive stream: InputStream, withID payloadID: PayloadID, from endpointID: EndpointID, cancellationToken token: CancellationToken) { token.cancel() }
    public func connectionManager(_ connectionManager: ConnectionManager, didStartReceivingResourceWithID payloadID: PayloadID, from endpointID: EndpointID, at localURL: URL, withName name: String, cancellationToken token: CancellationToken) { token.cancel() }
    public func connectionManager(_ connectionManager: ConnectionManager, didReceiveTransferUpdate update: TransferUpdate, from endpointID: EndpointID, forPayload payloadID: PayloadID) {
        if case .failure = update { emit("error", endpointID, ["message": "Передача Nearby не завершилась. Проверьте историю Solana."]) }
    }
    private func key() throws -> Curve25519.Signing.PrivateKey {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "kz.armtranzit.devnet.wallet", kSecAttrAccount as String: "ed25519-v1"]
        var lookup = query; lookup[kSecReturnData as String] = true; lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?; let status = SecItemCopyMatching(lookup as CFDictionary, &result)
        if status == errSecSuccess, let data = result as? Data { return try Curve25519.Signing.PrivateKey(rawRepresentation: data) }
        guard status == errSecItemNotFound else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
        let key = Curve25519.Signing.PrivateKey()
        var insert = query; insert[kSecValueData as String] = key.rawRepresentation; insert[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let saved = SecItemAdd(insert as CFDictionary, nil)
        guard saved == errSecSuccess else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(saved)) }
        return key
    }
    @objc public func wallet(_ call: CAPPluginCall) { do { call.resolve(["publicKey": try key().publicKey.rawRepresentation.base64EncodedString()]) } catch { call.reject(error.localizedDescription) } }
    @objc public func sign(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard !self.signing else { call.reject("Подтверждение уже открыто."); return }
        do {
            guard let base64 = call.getString("message"), let data = Data(base64Encoded: base64),
                  let recipient = call.getString("recipient"), let amount = call.getInt("amount"),
                  let memo = call.getString("memo"), let network = call.getString("network") else { throw TransferError.invalid }
            let reason = try TransferMessage.describe(data, own: self.key().publicKey.rawRepresentation, recipient: recipient, amount: amount, memo: memo, network: network)
            self.authorizeSignature(call, data: data, reason: reason)
        } catch { call.reject(error.localizedDescription) }
    } }
    @objc public func signDemo(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard !self.signing else { call.reject("Подтверждение уже открыто."); return }
        do {
            guard let base64 = call.getString("message"), let data = Data(base64Encoded: base64), let raw = String(data: data, encoding: .utf8), raw.hasPrefix("ARM-LAB-1\n"), let json = String(raw.dropFirst(10)).data(using: .utf8), let p = try JSONSerialization.jsonObject(with: json) as? [String: Any], let network = p["network"] as? String, network == "arm-lab-v1", let from = p["from"] as? String, from == TransferMessage.base58([UInt8](try self.key().publicKey.rawRepresentation)), let to = p["to"] as? String, (32...44).contains(to.count), to != from, let amount = p["lamports"] as? Int, amount > 0, amount <= 10_000_000_000, let height = p["height"] as? Int, (1...100).contains(height), let previous = p["previous"] as? String, previous.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil, let timestamp = p["timestamp"] as? Int, abs(Int(Date().timeIntervalSince1970 * 1000) - timestamp) < 120_000 else { throw TransferError.invalid }
            let value = NSDecimalNumber(value: amount).dividing(by: NSDecimalNumber(value: 1_000_000_000)).stringValue
            self.authorizeSignature(call, data: data, reason: "\(value) учебных единиц → \(to)\nANTIMATTER Lab · без денежной стоимости")
        } catch { call.reject(error.localizedDescription) }
    } }
    private func authorizeSignature(_ call: CAPPluginCall, data: Data, reason: String) {
        let context = LAContext(); var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else { call.reject("Настройте код-пароль или Face ID / Touch ID телефона."); return }
        signing = true
        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, error in DispatchQueue.main.async {
            defer { self.signing = false }
            guard success else { call.reject("Подпись отменена: " + (error?.localizedDescription ?? "отказ")); return }
            do { call.resolve(["signature": try self.key().signature(for: data).base64EncodedString()]) } catch { call.reject(error.localizedDescription) }
        } }
    }
}

enum TransferError: LocalizedError { case invalid; var errorDescription: String? { "Подпись запрещена: ожидается перевод SOL или AMT с проверенным получателем и меткой сеанса." } }
enum TransferMessage {
    static func base58(_ bytes: [UInt8]) -> String {
        let alphabet = Array("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")
        var digits = [Int]()
        for byte in bytes {
            var carry = Int(byte)
            for i in digits.indices { carry += digits[i] * 256; digits[i] = carry % 58; carry /= 58 }
            while carry > 0 { digits.append(carry % 58); carry /= 58 }
        }
        return String(repeating: "1", count: bytes.prefix(while: { $0 == 0 }).count) + String(digits.reversed().map { alphabet[$0] })
    }
    private static func describeSol(_ data: Data, own: Data, recipient: String, expectedAmount: Int, expectedMemo: String) throws -> String {
        let bytes = [UInt8](data); var index = 0
        func read(_ count: Int) throws -> [UInt8] { guard count >= 0, index + count <= bytes.count else { throw TransferError.invalid }; defer { index += count }; return Array(bytes[index..<(index+count)]) }
        func byte() throws -> Int { Int(try read(1)[0]) }
        guard try read(4) == [1,0,2,4] else { throw TransferError.invalid }
        var keys = [[UInt8]](); for _ in 0..<4 { keys.append(try read(32)) }
        guard keys[0] == [UInt8](own), keys[0] != keys[1] else { throw TransferError.invalid }
        _ = try read(32); guard try byte() == 2 else { throw TransferError.invalid }
        let program = try byte(); guard (2...3).contains(program), keys[program] == Array(repeating: 0, count: 32), try read(4) == [2,0,1,12], try read(4) == [2,0,0,0] else { throw TransferError.invalid }
        let little = try read(8); let amount = little.enumerated().reduce(UInt64(0)) { $0 | UInt64($1.element) << (8 * $1.offset) }
        guard amount > 0, amount <= 10_000_000_000 else { throw TransferError.invalid }
        let memo = try byte(); guard (2...3).contains(memo), base58(keys[memo]) == "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", try byte() == 0, try byte() == 78 else { throw TransferError.invalid }
        let text = String(bytes: try read(78), encoding: .utf8) ?? ""
        guard index == bytes.count, text.range(of: "^ARM1:[a-f0-9-]{36}:[a-f0-9-]{36}$", options: .regularExpression) != nil,
              amount == UInt64(expectedAmount), base58(keys[1]) == recipient, text == expectedMemo else { throw TransferError.invalid }
        let value = NSDecimalNumber(value: amount).dividing(by: NSDecimalNumber(value: 1_000_000_000)).stringValue
        return "\(value) тестовых SOL → \(base58(keys[1]))\nSolana Devnet · без денежной стоимости"
    }
    private static func describeToken(_ data: Data, own: Data, recipient: String, expectedAmount: Int, expectedMemo: String) throws -> String {
        let bytes = [UInt8](data); var index = 0
        func read(_ count: Int) throws -> [UInt8] { guard count >= 0, index + count <= bytes.count else { throw TransferError.invalid }; defer { index += count }; return Array(bytes[index..<(index+count)]) }
        func byte() throws -> Int { Int(try read(1)[0]) }
        func compact() throws -> Int { let value = try byte(); guard value < 128 else { throw TransferError.invalid }; return value }
        guard try byte() == 1, try byte() == 0 else { throw TransferError.invalid }
        let readonly = try byte(), count = try compact()
        guard (8...16).contains(count), readonly <= count - 1 else { throw TransferError.invalid }
        var keys = [[UInt8]](); for _ in 0..<count { keys.append(try read(32)) }
        guard keys[0] == [UInt8](own) else { throw TransferError.invalid }
        _ = try read(32)
        guard try compact() == 3 else { throw TransferError.invalid }
        func instruction() throws -> (program: Int, accounts: [Int], data: [UInt8]) {
            let program = try compact(), accountCount = try compact()
            guard program < count, accountCount <= 8 else { throw TransferError.invalid }
            var accounts = [Int](); for _ in 0..<accountCount { let account = try compact(); guard account < count else { throw TransferError.invalid }; accounts.append(account) }
            let length = try compact(); guard length <= 128 else { throw TransferError.invalid }
            return (program, accounts, try read(length))
        }
        let ata = try instruction(), transfer = try instruction(), memo = try instruction()
        guard index == bytes.count,
              base58(keys[ata.program]) == "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
              base58(keys[transfer.program]) == "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
              base58(keys[memo.program]) == "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr" else { throw TransferError.invalid }
        guard ata.accounts.count == 6, ata.data == [1], ata.accounts[0] == 0,
              base58(keys[ata.accounts[3]]) == "GTYjjjnW9hcLg1UrgfZBfpL4BXP74eJcZ9TWDeguL9MR",
              base58(keys[ata.accounts[4]]) == "11111111111111111111111111111111",
              base58(keys[ata.accounts[5]]) == "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" else { throw TransferError.invalid }
        guard transfer.accounts.count == 4, transfer.data.count == 10, transfer.data[0] == 12, transfer.data[9] == 9,
              transfer.accounts[1] == ata.accounts[3], transfer.accounts[2] == ata.accounts[1],
              transfer.accounts[3] == 0, transfer.accounts[0] != transfer.accounts[2] else { throw TransferError.invalid }
        let readonlyStart = count - readonly
        guard ata.accounts[1] < readonlyStart, transfer.accounts[0] < readonlyStart,
              transfer.accounts[2] < readonlyStart, ata.program >= readonlyStart,
              transfer.program >= readonlyStart, memo.program >= readonlyStart else { throw TransferError.invalid }
        guard memo.accounts.isEmpty, memo.data.count == 78,
              let text = String(bytes: memo.data, encoding: .utf8),
              text.range(of: "^ARM1:[a-f0-9-]{36}:[a-f0-9-]{36}$", options: .regularExpression) != nil else { throw TransferError.invalid }
        var amount: UInt64 = 0
        for offset in 0..<8 { amount |= UInt64(transfer.data[offset + 1]) << (8 * offset) }
        guard amount > 0, amount <= 10_000_000_000 else { throw TransferError.invalid }
        guard amount == UInt64(expectedAmount), base58(keys[ata.accounts[2]]) == recipient, text == expectedMemo else { throw TransferError.invalid }
        let value = NSDecimalNumber(value: amount).dividing(by: NSDecimalNumber(value: 1_000_000_000)).stringValue
        return "\(value) AMT · Solana Devnet\nПолучатель: \(base58(keys[ata.accounts[2]]))\nБез денежной стоимости"
    }
    static func describe(_ data: Data, own: Data, recipient: String, amount: Int, memo: String, network: String) throws -> String {
        guard amount > 0, amount <= 10_000_000_000 else { throw TransferError.invalid }
        if network == "solana-devnet-amt", let token = try? describeToken(data, own: own, recipient: recipient, expectedAmount: amount, expectedMemo: memo) { return token }
        if network == "solana-devnet", let sol = try? describeSol(data, own: own, recipient: recipient, expectedAmount: amount, expectedMemo: memo) { return sol }
        throw TransferError.invalid
    }
}

