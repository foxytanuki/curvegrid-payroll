import { ethers } from "hardhat";
// Import fs for reading files
import * as fs from "node:fs";
import * as path from "node:path";
// Make sure you have run 'npx hardhat compile' to generate typechain types and artifacts
import type { CCTPHookWrapperV2 } from "../../typechain-types";
import CCTPHookWrapperV2Artifact from "../../artifacts/contracts/core/CCTPHookWrapperV2.sol/CCTPHookWrapperV2.json";

const ATTESTATION_DATA_FILE = path.join(
  __dirname,
  "..",
  "attestation_data.json"
);

// Helper function to validate hex strings
function isValidHexString(str: string): boolean {
  return typeof str === "string" && /^0x[a-fA-F0-9]+$/.test(str);
}

async function main() {
  // --- 1. Read Attestation Data from File ---
  let message: string;
  let attestation: string;

  console.log(`Reading attestation data from: ${ATTESTATION_DATA_FILE}`);
  try {
    if (!fs.existsSync(ATTESTATION_DATA_FILE)) {
      throw new Error(
        `Attestation data file not found at ${ATTESTATION_DATA_FILE}. Run script 1 first.`
      );
    }
    const fileContent = fs.readFileSync(ATTESTATION_DATA_FILE, "utf-8");
    const data = JSON.parse(fileContent);

    if (!data.message || !data.attestation) {
      throw new Error(
        `File ${ATTESTATION_DATA_FILE} is missing 'message' or 'attestation' field.`
      );
    }

    message = data.message;
    attestation = data.attestation;

    if (!isValidHexString(message)) {
      throw new Error(
        `Invalid message format in ${ATTESTATION_DATA_FILE}: ${message}`
      );
    }
    if (!isValidHexString(attestation)) {
      throw new Error(
        `Invalid attestation format in ${ATTESTATION_DATA_FILE}: ${attestation}`
      );
    }

    console.log("Successfully read attestation data:");
    console.log(`  Message: ${message.substring(0, 42)}...`);
    console.log(`  Attestation: ${attestation.substring(0, 42)}...`);
  } catch (error: unknown) {
    console.error("Error reading or parsing attestation data file:");
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }
    console.error(
      "Please ensure 'scripts/1-attestation.ts' ran successfully and created a valid 'attestation_data.json' file in the project root."
    );
    process.exit(1);
  }

  // --- 2. Setup Environment ---
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = network.chainId;

  console.log(
    `\nRunning script on network: ${network.name} (chainId: ${chainId})`
  );
  console.log(`Using signer account: ${deployer.address}`);

  // --- 3. Configuration ---
  const hookDeploymentId = "CCTPHookWrapperV2Module#CCTPHookWrapperV2";

  // --- 4. Get Deployed Contract (Reading deployed_addresses.json) ---
  console.log(
    `\nGetting deployed CCTPHookWrapperV2 address for ID: ${hookDeploymentId} on chain ${chainId}...`
  );

  let hookContract: CCTPHookWrapperV2;
  let hookContractAddress: string;
  try {
    // Construct the path to the deployed_addresses.json file for the *destination* chain
    // Assuming this script runs on the destination chain where CCTPHookWrapper is deployed.
    const deployedAddressesPath = path.join(
      __dirname, // Assumes script is run from workspace root via 'npx hardhat run'
      "..", // Go up one level from 'scripts'
      "..", // Go up one more level from 'scripts'
      "ignition",
      "deployments",
      `chain-${chainId}`, // Use the current network's chainId
      "deployed_addresses.json" // Target file
    );

    console.log(`  Reading deployed addresses from: ${deployedAddressesPath}`);

    if (!fs.existsSync(deployedAddressesPath)) {
      throw new Error(
        `Deployment address file not found at ${deployedAddressesPath}. Ensure Ignition deployment ran on this network.`
      );
    }

    // Read and parse the JSON file
    const deployedAddressesContent = fs.readFileSync(
      deployedAddressesPath,
      "utf-8"
    );
    const deployedAddresses = JSON.parse(deployedAddressesContent);

    // Extract the address using the deployment ID as the key
    hookContractAddress = deployedAddresses[hookDeploymentId];

    if (!hookContractAddress) {
      throw new Error(
        `Address for deployment ID '${hookDeploymentId}' not found in ${deployedAddressesPath}`
      );
    }

    if (!ethers.isAddress(hookContractAddress)) {
      throw new Error(
        `Invalid address found in deployed_addresses.json for ID '${hookDeploymentId}': ${hookContractAddress}`
      );
    }

    console.log(`  Found contract address: ${hookContractAddress}`);

    // Get contract instance using the new artifact and type
    hookContract = (await ethers.getContractAt(
      CCTPHookWrapperV2Artifact.abi,
      hookContractAddress,
      deployer // Use the deployer/signer for the transaction
    )) as unknown as CCTPHookWrapperV2;

    console.log("Successfully retrieved CCTPHookWrapperV2 contract instance.");
  } catch (error: unknown) {
    let errorMessage = `Failed to get contract address for ID '${hookDeploymentId}'.`;
    if (error instanceof Error) {
      errorMessage += ` Error: ${error.message}`;
    } else {
      errorMessage += ` Unexpected error: ${error}`;
    }
    console.error(errorMessage);
    console.error("Please ensure:");
    console.error(
      `1. Ignition deployment for CCTPHookWrapperV2 (ID: ${hookDeploymentId}) on chain ${chainId} has run successfully.`
    );
    console.error(
      `2. The file 'ignition/deployments/chain-${chainId}/deployed_addresses.json' exists and contains a valid address for the key '${hookDeploymentId}'.`
    );
    console.error(
      "3. Your hardhat config has the correct network settings for the destination chain."
    );
    console.error("Aborting script.");
    return; // Exit if contract cannot be obtained
  }

  // --- 5. Call receiveMessage ---
  console.log(
    `\nCalling relay on CCTPHookWrapperV2 (${hookContractAddress})...`
  );
  try {
    const tx = await hookContract.relay(message, attestation);
    console.log(`  Transaction sent: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(
      `  Message relayed successfully. Gas used: ${receipt?.gasUsed.toString()}`
    );
    console.log(
      `  View transaction on explorer: https://sepolia.basescan.io/tx/${tx.hash}`
    ); // Adjust URL if needed
    // You might want to add checks here to verify the state change on the destination contract (e.g., token balance)
  } catch (error: unknown) {
    let failMessage = "Failed to execute relay.";
    if (
      error instanceof Error &&
      typeof error === "object" &&
      "reason" in error &&
      error.reason // Make sure reason is not null/undefined
    ) {
      failMessage += ` Reason: ${error.reason}`;
    } else if (error instanceof Error) {
      // Check for common Hardhat Network revert data using type guard
      // if (typeof error === 'object' && error !== null && 'data' in error && typeof (error as any).data === 'string') {
      //    failMessage += ` Revert data: ${(error as any).data}`; // Access data after check
      // } else {
      //   failMessage += ` Error: ${error.message}`;
      // }
      let revertData: string | undefined = undefined;
      // Check if the error object might have a 'data' property typical of Hardhat reverts
      if (typeof error === "object" && error !== null && "data" in error) {
        const potentialData = (error as { data?: unknown }).data; // Access potentially existing property more safely
        // Validate if it looks like hex data
        if (
          typeof potentialData === "string" &&
          /^0x[a-fA-F0-9]*$/.test(potentialData)
        ) {
          revertData = potentialData;
        }
      }

      if (revertData) {
        // If we found valid revert data, include it
        failMessage += ` Revert data: ${revertData}`;
      } else {
        // Otherwise, just include the standard error message
        failMessage += ` Error: ${error.message}`;
      }
    } else {
      failMessage += ` Unexpected error: ${error}`;
    }
    console.error(`  ${failMessage}`);
    // console.error("Raw error object:", error); // Uncomment for full error details if needed
    return; // Stop if transaction fails
  }

  console.log("\nScript finished successfully.");
}

main().catch((error) => {
  console.error("\nUnhandled script error:");
  console.error(error);
  process.exitCode = 1;
});
