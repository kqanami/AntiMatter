use serde_json::{json, Value};
use std::{env, error::Error, io, process::Command};

const DEVNET_GENESIS: &str = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

fn rpc(url: &str, method: &str, params: Value) -> Result<Value, Box<dyn Error>> {
    // curl supplies HTTPS on Windows, macOS and Linux without a platform-specific Rust linker.
    let request = json!({"jsonrpc":"2.0","id":1,"method":method,"params":params});
    let output = Command::new("curl")
        .args(["--fail", "--silent", "--show-error", "--max-time", "20", "-X", "POST", "-H", "Content-Type: application/json", "--data-binary", &request.to_string(), url])
        .output()?;
    if !output.status.success() {
        return Err(io::Error::other(format!("curl failed: {}", String::from_utf8_lossy(&output.stderr))).into());
    }
    let body: Value = serde_json::from_slice(&output.stdout)?;
    if let Some(error) = body.get("error") {
        return Err(io::Error::other(format!("Devnet RPC: {error}")).into());
    }
    body.get("result")
        .cloned()
        .ok_or_else(|| io::Error::other("Devnet RPC returned no result").into())
}

fn main() -> Result<(), Box<dyn Error>> {
    let mut args = env::args().skip(1);
    let command = args.next().unwrap_or_default();
    let value = args.next().unwrap_or_default();
    if value.is_empty() || !matches!(command.as_str(), "balance" | "account" | "program" | "tx") {
        eprintln!("Usage: antimatter-solana-cli <balance|account|program|tx> <ADDRESS_OR_SIGNATURE>");
        std::process::exit(2);
    }
    let url = env::var("SOLANA_RPC_URL").unwrap_or_else(|_| "https://api.devnet.solana.com".into());
    if !url.starts_with("https://") {
        return Err(io::Error::other("Use an HTTPS Solana Devnet RPC URL").into());
    }
    let genesis = rpc(&url, "getGenesisHash", json!([]))?;
    if genesis.as_str() != Some(DEVNET_GENESIS) {
        return Err(io::Error::other("RPC is not Solana Devnet").into());
    }
    let result = match command.as_str() {
        "balance" => {
            let response = rpc(&url, "getBalance", json!([value,{"commitment":"confirmed"}]))?;
            json!({"cluster":"devnet","address":value,"lamports":response["value"]})
        }
        "account" | "program" => {
            let response = rpc(&url, "getAccountInfo", json!([value,{"encoding":"base64","commitment":"confirmed"}]))?;
            let info = &response["value"];
            if command == "program" && info["executable"] != true {
                return Err(io::Error::other("Account is not an executable Devnet program (or is not deployed)").into());
            }
            json!({"cluster":"devnet","address":value,"owner":info["owner"],"lamports":info["lamports"],"executable":info["executable"],"dataBytes":info["space"]})
        }
        "tx" => {
            let response = rpc(&url, "getTransaction", json!([value,{"encoding":"jsonParsed","commitment":"confirmed","maxSupportedTransactionVersion":0}]))?;
            if response.is_null() {
                return Err(io::Error::other("Transaction not found in Devnet history").into());
            }
            let keys = &response["transaction"]["message"]["accountKeys"];
            let instructions = &response["transaction"]["message"]["instructions"];
            json!({"cluster":"devnet","signature":value,"slot":response["slot"],"feeLamports":response["meta"]["fee"],"error":response["meta"]["err"],"accounts":keys,"instructions":instructions,"logs":response["meta"]["logMessages"]})
        }
        _ => unreachable!(),
    };
    println!("{}", serde_json::to_string_pretty(&result)?);
    Ok(())
}
