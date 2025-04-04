import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, mbDeployer } from "hardhat";

async function main() {
  const signers = await ethers.getSigners();
  const signer = signers[0];

  await mbDeployer.setup();

  const MESSAGE_TRANSMITTER = process.env.MESSAGE_TRANSMITTER_TESTNET;
  if (!MESSAGE_TRANSMITTER) {
    throw new Error("MESSAGE_TRANSMITTER_TESTNET is not set");
  }

  // Deploy the CCTPHookWrapper contract with MultiBaas
  await mbDeployer.deploy(
    signer as SignerWithAddress,
    "CCTPHookWrapper",
    [MESSAGE_TRANSMITTER],
    {
      addressAlias: "cctphookwrapper1", // replace with the actual alias
      contractVersion: "1.0",
      contractLabel: "cctphookwrapper1", // replace with the actual label
    }
  );
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
