import { ethers, ignition } from "hardhat";
// Import fs for reading files
import * as fs from "node:fs";
import * as path from "node:path";
// Make sure you have run 'npx hardhat compile' to generate typechain types and artifacts
import type { MultichainPayroll, IERC20 } from "../../typechain-types";
import MultichainPayrollArtifact from "../../artifacts/contracts/core/MultichainPayroll.sol/MultichainPayroll.json";
import IERC20Artifact from "../../artifacts/@openzeppelin/contracts/token/ERC20/IERC20.sol/IERC20.json";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = network.chainId;

  console.log(
    `Running script on network: ${network.name} (chainId: ${chainId})`
  );
  console.log(`Using deployer account: ${deployer.address}`);

  // --- Configuration ---
  // Deployment ID for MultichainPayroll on Sepolia.
  // This ID is typically structured as "ModuleName#ContractName".
  // You may need to verify this ID based on your actual Ignition deployment script or output files in ignition/deployments/chain-11155111/.
  const sepoliaPayrollDeploymentId =
    "MultichainPayrollModule#MultichainPayroll"; // Replace with your actual deployment ID if different

  const sepoliaUsdcAddress = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"; // Sepolia USDC address
  const employeeAddress = "0x45D17a2C9092ec9F86FB27A8416c2777858fB591";
  const destinationDomain = 6; // CCTP Domain ID for Base Sepolia.
  const destinationToken = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // BaseSepolia USDC address
  const lendingEnabled = false;
  const usdcDecimals = 6;
  const paymentAmount = ethers.parseUnits("0.1", usdcDecimals); // 0.1 USDC
  const transferAmount = ethers.parseUnits("0.2", usdcDecimals); // Amount to fund the contract

  // --- Get Deployed Contract (Reading deployed_addresses.json) ---
  console.log(
    `\nGetting deployed contract address for ID: ${sepoliaPayrollDeploymentId} on chain ${chainId}...`
  );

  let payrollContract: MultichainPayroll;
  let payrollContractAddress: string;
  try {
    // Construct the path to the deployed_addresses.json file
    const deployedAddressesPath = path.join(
      __dirname, // Assumes script is run from workspace root via 'npx hardhat run'
      "..", // Go up one level from 'scripts'
      "..",
      "ignition",
      "deployments",
      `chain-${chainId}`,
      "deployed_addresses.json" // Target file
    );

    console.log(`  Reading deployed addresses from: ${deployedAddressesPath}`);

    // Read and parse the JSON file
    const deployedAddressesContent = fs.readFileSync(
      deployedAddressesPath,
      "utf-8"
    );
    const deployedAddresses = JSON.parse(deployedAddressesContent);

    // Extract the address using the deployment ID as the key
    payrollContractAddress = deployedAddresses[sepoliaPayrollDeploymentId];

    if (!payrollContractAddress) {
      throw new Error(
        `Address for deployment ID '${sepoliaPayrollDeploymentId}' not found in ${deployedAddressesPath}`
      );
    }

    if (!ethers.isAddress(payrollContractAddress)) {
      throw new Error(
        `Invalid address found in deployed_addresses.json for ID '${sepoliaPayrollDeploymentId}': ${payrollContractAddress}`
      );
    }

    console.log(`  Found contract address: ${payrollContractAddress}`);

    // Get contract instance
    payrollContract = (await ethers.getContractAt(
      MultichainPayrollArtifact.abi,
      payrollContractAddress,
      deployer
    )) as unknown as MultichainPayroll;

    console.log("Successfully retrieved MultichainPayroll contract instance.");
  } catch (error: unknown) {
    let errorMessage = `Failed to get contract address for ID '${sepoliaPayrollDeploymentId}'.`;
    if (error instanceof Error) {
      errorMessage += ` Error: ${error.message}`;
    } else {
      errorMessage += ` Unexpected error: ${error}`;
    }
    console.error(errorMessage);
    console.error("Please ensure:");
    console.error(
      `1. Ignition deployment for chain ${chainId} has been run successfully.`
    );
    console.error(
      `2. The deployment ID '${sepoliaPayrollDeploymentId}' is correct and exists as a key in 'ignition/deployments/chain-${chainId}/deployed_addresses.json'.`
    );
    console.error(
      `3. The file 'ignition/deployments/chain-${chainId}/deployed_addresses.json' exists and contains a valid address for the key.`
    );
    console.error("4. Your hardhat config has the correct network settings.");
    console.error("Aborting script.");
    return; // Exit if contract cannot be obtained
  }

  // --- 1. Set Route Info ---
  console.log(
    `\nStep 1: Setting route info for employee ${employeeAddress}...`
  );
  try {
    const txSetRoute = await payrollContract.setRouteInfo(
      employeeAddress,
      destinationDomain,
      destinationToken,
      lendingEnabled
    );
    console.log(`  Transaction sent: ${txSetRoute.hash}`);
    const receiptSetRoute = await txSetRoute.wait();
    console.log(
      `  Route info set successfully. Gas used: ${receiptSetRoute?.gasUsed.toString()}`
    );
  } catch (error: unknown) {
    let message = "Failed to set route info.";
    if (error instanceof Error) {
      message += ` Error: ${error.message}`;
    } else {
      message += ` Unexpected error: ${error}`;
    }
    console.error(`  ${message}`);
    return; // Stop if this step fails
  }

  // --- 2. Send USDC to Payroll Contract ---
  console.log(
    `\nStep 2: Sending ${ethers.formatUnits(
      transferAmount,
      usdcDecimals
    )} USDC to Payroll contract (${payrollContractAddress})...`
  );
  const usdcContract = (await ethers.getContractAt(
    IERC20Artifact.abi,
    sepoliaUsdcAddress,
    deployer
  )) as unknown as IERC20; // Cast to specific contract type

  try {
    // Check deployer's USDC balance
    const deployerBalance = await usdcContract.balanceOf(deployer.address);
    console.log(
      `  Deployer (${deployer.address}) USDC balance: ${ethers.formatUnits(
        deployerBalance,
        usdcDecimals
      )}`
    );
    if (deployerBalance < transferAmount) {
      console.error(
        `  Error: Deployer has insufficient USDC balance. Need ${ethers.formatUnits(
          transferAmount,
          usdcDecimals
        )}, have ${ethers.formatUnits(deployerBalance, usdcDecimals)}.`
      );
      console.error(
        `  Please fund the deployer account with Sepolia USDC (${sepoliaUsdcAddress}).`
      );
      return; // Stop if balance is insufficient
    }

    // Transfer USDC to the payroll contract
    const txTransfer = await usdcContract.transfer(
      payrollContractAddress,
      transferAmount
    );
    console.log(`  USDC transfer transaction sent: ${txTransfer.hash}`);
    const receiptTransfer = await txTransfer.wait();
    console.log(
      `  USDC transferred successfully. Gas used: ${receiptTransfer?.gasUsed.toString()}`
    );

    // Verify Payroll contract USDC balance
    const payrollBalance = await usdcContract.balanceOf(payrollContractAddress);
    console.log(
      `  Payroll contract USDC balance: ${ethers.formatUnits(
        payrollBalance,
        usdcDecimals
      )}`
    );
  } catch (error: unknown) {
    let message = "Failed to send USDC.";
    if (error instanceof Error) {
      message += ` Error: ${error.message}`;
    } else {
      message += ` Unexpected error: ${error}`;
    }
    console.error(`  ${message}`);
    return; // Stop if transfer fails
  }

  // --- 3. Batch Pay Employees ---
  console.log(
    `\nStep 3: Paying employee ${employeeAddress} (${ethers.formatUnits(
      paymentAmount,
      usdcDecimals
    )} USDC) via batchPayEmployees...`
  );
  const employeesToPay = [{ employee: employeeAddress, amount: paymentAmount }];

  try {
    // Verify Payroll contract has enough balance before attempting payment
    const payrollBalancePrePay = await usdcContract.balanceOf(
      payrollContractAddress
    );
    if (payrollBalancePrePay < paymentAmount) {
      console.error(
        `  Error: Payroll contract has insufficient USDC balance. Need ${ethers.formatUnits(
          paymentAmount,
          usdcDecimals
        )}, have ${ethers.formatUnits(payrollBalancePrePay, usdcDecimals)}.`
      );
      return; // Stop if balance is insufficient
    }
    console.log(
      ` Payroll contract balance before payment: ${ethers.formatUnits(
        payrollBalancePrePay,
        usdcDecimals
      )} USDC`
    );

    // The MultichainPayroll contract's _sendCCTP function should handle approving the TokenMessenger.
    // No external approval from the deployer is needed here for the contract to spend its own funds.
    const txPay = await payrollContract.batchPayEmployees(employeesToPay);
    console.log(`  batchPayEmployees transaction sent: ${txPay.hash}`);
    const receiptPay = await txPay.wait();
    console.log(
      `  Payment sent successfully via CCTP. Gas used: ${receiptPay?.gasUsed.toString()}`
    );

    // Verify Payroll contract USDC balance after payment attempt
    // Note: Balance decreases only after the CCTP burn on the source chain is confirmed.
    // We check immediately after tx confirmation, the burn might take a moment.
    const payrollBalanceAfter = await usdcContract.balanceOf(
      payrollContractAddress
    );
    console.log(
      `  Payroll contract USDC balance after payment tx: ${ethers.formatUnits(
        payrollBalanceAfter,
        usdcDecimals
      )}`
    );
  } catch (error: unknown) {
    let message = "Failed to execute batchPayEmployees.";
    if (error instanceof Error) {
      message += ` Error: ${error.message}`;
    } else {
      message += ` Unexpected error: ${error}`;
    }
    console.error(`  ${message}`);
    return; // Stop if payment fails
  }

  console.log("\nScript finished successfully.");
}

main().catch((error) => {
  console.error("Script failed:");
  console.error(error);
  process.exitCode = 1;
});
