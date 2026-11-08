use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
use std::{error::Error, fs, io::Read};

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let [version, pubkey, signature_path, artifact_path] = args.as_slice() else {
        return Err("expected version, Tauri public key, signature file and artifact file".into());
    };
    let key = PublicKey::decode(&String::from_utf8(STANDARD.decode(pubkey)?)?)?;
    let signature = fs::read_to_string(signature_path)?;
    let signature = Signature::decode(&String::from_utf8(STANDARD.decode(signature.trim())?)?)?;
    let mut verifier = key.verify_stream(&signature)?;
    let mut artifact = fs::File::open(artifact_path)?;
    let mut chunk = [0; 64 * 1024];
    loop {
        let size = artifact.read(&mut chunk)?;
        if size == 0 {
            break;
        }
        verifier.update(&chunk[..size]);
    }
    verifier.finalize()?;

    let mut versions = signature
        .trusted_comment()
        .split('\t')
        .filter_map(|field| field.strip_prefix("version:"));
    match (versions.next(), versions.next()) {
        (Some(signed), None) if signed == version => Ok(()),
        _ => Err("artifact signature must bind the exact release version".into()),
    }
}
