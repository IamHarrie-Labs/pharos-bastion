import { ethers } from "ethers";
import { config, getProvider, getSigner } from "../src/config.js";

async function main() {
  const signer = getSigner();
  if (!signer) {
    console.error("No PHAROS_PRIVATE_KEY found in .env");
    process.exit(1);
  }
  const provider = getProvider();
  const net = await provider.getNetwork();
  const balance = await provider.getBalance(signer.address);
  console.log(`Wallet address: ${signer.address}`);
  console.log(`Connected chainId: ${net.chainId} (expected ${config.chainId})`);
  console.log(`Balance: ${ethers.formatEther(balance)} PHRS`);
  if (balance === 0n) {
    console.log("WARNING: balance is 0 — fund this address with Atlantic testnet PHRS before deploying.");
  } else {
    console.log("OK: wallet is funded and ready to deploy.");
  }
}

main().catch((e) => {
  console.error("Check failed:", e?.message ?? e);
  process.exit(1);
});
