import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-viem";
import "@nomicfoundation/hardhat-ethers";
import "hardhat-multibaas-plugin";
import dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const MB_API_KEY = process.env.MB_API_KEY;
const MB_HOST = process.env.MB_HOST;
const SEPOLIA_URL = process.env.SEPOLIA_URL;
const BASE_SEPOLIA_URL = process.env.BASE_SEPOLIA_URL;

if (!PRIVATE_KEY || !MB_API_KEY || !MB_HOST) {
  throw new Error("PRIVATE_KEY or MB_API_KEY or MB_HOST is not set");
}

if (!!BASE_SEPOLIA_URL && !!SEPOLIA_URL) {
  throw new Error("BASE_SEPOLIA_URL and SEPOLIA_URL cannot both be set");
}

const config: HardhatUserConfig = {
  solidity: "0.7.6",
  networks: {
    development: {
      chainId: 84532, // Base Sepolia
      url: `${MB_HOST}/web3/${MB_API_KEY}`,
      accounts: [PRIVATE_KEY],
    },
    sepolia: {
      chainId: 11155111, // Sepolia
      url: SEPOLIA_URL,
      accounts: [PRIVATE_KEY],
    },
    baseSepolia: {
      chainId: 84532, // Base Sepolia
      url: BASE_SEPOLIA_URL,
      accounts: [PRIVATE_KEY],
    },
  },
  mbConfig: {
    apiKey: MB_API_KEY,
    host: MB_HOST,
    allowUpdateAddress: ["baseSepolia"],
    allowUpdateContract: ["baseSepolia"],
  },
};

export default config;
