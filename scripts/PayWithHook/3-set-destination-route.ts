import { ethers, ignition } from "hardhat";
// Import fs for reading files
import * as fs from "node:fs";
import * as path from "node:path";
// Make sure you have run 'npx hardhat compile' to generate typechain types and artifacts
import type { MultichainPayrollWithHook } from "../../typechain-types"; // Keep only necessary type
import MultichainPayrollWithHookArtifact from "../../artifacts/contracts/core/MultichainPayrollWithHook.sol/MultichainPayrollWithHook.json";
// Removed IERC20 import as it's not needed for setRouteInfo

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = network.chainId;

  console.log(
    `Running script on DESTINATION network: ${network.name} (chainId: ${chainId})` // Indicate destination network
  );
  console.log(`Using deployer account: ${deployer.address}`);

  // --- Configuration ---
  // Update the deployment ID for MultichainPayrollWithHook on the DESTINATION chain (e.g., Base Sepolia).
  // Verify this ID matches your actual Ignition deployment output for the *destination* module.
  const payrollDeploymentId =
    "MultichainPayrollWithHookDestinationModule#MultichainPayrollWithHook"; // Destination Module ID

  // Information needed for setRouteInfo - should match the info used in 0-payroll.ts
  const employeeAddress = "0x45D17a2C9092ec9F86FB27A8416c2777858fB591"; // Example employee address - Keep consistent
  const destinationDomain = 6; // CCTP Domain ID for Base Sepolia. (This script *runs* on Base Sepolia, but setting route for future *use*)
  const destinationToken = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // Base Sepolia USDC address
  const lendingEnabled = false;
  // Removed USDC address, decimals, payment/transfer amounts as they are not needed here

  // --- Get Deployed Contract (Reading deployed_addresses.json on Destination Chain) ---
  console.log(
    `
Getting deployed DESTINATION contract address for ID: ${payrollDeploymentId} on chain ${chainId}...` // Indicate destination
  );

  let payrollContract: MultichainPayrollWithHook;
  let payrollContractAddress: string;
  try {
    // Construct the path to the deployed_addresses.json file for the DESTINATION chain
    const deployedAddressesPath = path.join(
      __dirname,
      "..", // Go up one level from 'scripts/PayWithHook'
      "..", // Go up one more level to project root
      "ignition",
      "deployments",
      `chain-${chainId}`, // Use the CURRENT network's chainId (where this script runs)
      "deployed_addresses.json"
    );

    console.log(
      `  Reading deployed addresses from (Destination): ${deployedAddressesPath}` // Indicate destination
    );

    // Read and parse the JSON file
    if (!fs.existsSync(deployedAddressesPath)) {
      throw new Error(
        `Deployment address file not found at ${deployedAddressesPath}. Ensure Ignition deployment ran on this network (${chainId}).`
      );
    }
    const deployedAddressesContent = fs.readFileSync(
      deployedAddressesPath,
      "utf-8"
    );
    const deployedAddresses = JSON.parse(deployedAddressesContent);

    // Extract the address using the deployment ID as the key
    payrollContractAddress = deployedAddresses[payrollDeploymentId]; // Use destination ID

    if (!payrollContractAddress) {
      throw new Error(
        `Address for deployment ID '${payrollDeploymentId}' not found in ${deployedAddressesPath}` // Use destination ID
      );
    }

    if (!ethers.isAddress(payrollContractAddress)) {
      throw new Error(
        `Invalid address found in deployed_addresses.json for ID '${payrollDeploymentId}': ${payrollContractAddress}` // Use destination ID
      );
    }

    console.log(`  Found contract address: ${payrollContractAddress}`);

    // Get contract instance using the artifact and type
    payrollContract = (await ethers.getContractAt(
      MultichainPayrollWithHookArtifact.abi,
      payrollContractAddress,
      deployer
    )) as unknown as MultichainPayrollWithHook;

    console.log(
      "Successfully retrieved MultichainPayrollWithHook (Destination) contract instance." // Indicate destination
    );
  } catch (error: unknown) {
    let errorMessage = `Failed to get DESTINATION contract address for ID '${payrollDeploymentId}'.`; // Indicate destination
    if (error instanceof Error) {
      errorMessage += ` Error: ${error.message}`;
    } else {
      errorMessage += ` Unexpected error: ${error}`;
    }
    console.error(errorMessage);
    console.error("Please ensure:");
    console.error(
      `1. Ignition deployment for MultichainPayrollWithHookDestinationModule on chain ${chainId} has been run successfully.` // Reference destination module
    );
    console.error(
      `2. The deployment ID '${payrollDeploymentId}' is correct and exists as a key in 'ignition/deployments/chain-${chainId}/deployed_addresses.json'.` // Use destination ID
    );
    console.error(
      `3. The file 'ignition/deployments/chain-${chainId}/deployed_addresses.json' exists and contains a valid address for the key.`
    );
    console.error(
      "4. Your hardhat config has the correct network settings for the destination chain."
    );
    console.error("Aborting script.");
    return; // Exit if contract cannot be obtained
  }

  // --- 1. Set Route Info on Destination Contract ---
  console.log(
    `
Step 1: Setting route info for employee ${employeeAddress} on the Destination Payroll contract...` // Clarify target
  );
  try {
    const txSetRoute = await payrollContract.setRouteInfo(
      employeeAddress,
      destinationDomain, // This domain likely refers to where funds *might* go next, if chained. Confirm logic if needed.
      destinationToken, // Token on this chain
      lendingEnabled
    );
    console.log(
      `  setRouteInfo transaction sent to Destination contract: ${txSetRoute.hash}`
    );
    const receiptSetRoute = await txSetRoute.wait();
    console.log(
      `  Route info set successfully on Destination contract. Gas used: ${receiptSetRoute?.gasUsed.toString()}`
    );
  } catch (error: unknown) {
    let message = "Failed to set route info on Destination contract.";
    if (error instanceof Error) {
      message += ` Error: ${error.message}`;
    } else {
      message += ` Unexpected error: ${error}`;
    }
    console.error(`  ${message}`);
    return; // Stop if this step fails
  }

  // Removed Steps 2 and 3 (Send USDC and Batch Pay) as this script only sets the route info.

  console.log("\nDestination route setting script finished successfully."); // Update final message
}

main().catch((error) => {
  console.error("Script failed:");
  console.error(error);
  process.exitCode = 1;
});
