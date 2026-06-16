import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const PHAROS_RPC_URL = process.env.PHAROS_RPC_URL ?? "https://atlantic.dplabs-internal.com";
const PRIVATE_KEY = process.env.PHAROS_PRIVATE_KEY ?? "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    // Pharos Atlantic testnet — chain id 688689
    pharos: {
      url: PHAROS_RPC_URL,
      chainId: 688689,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
};

export default config;
