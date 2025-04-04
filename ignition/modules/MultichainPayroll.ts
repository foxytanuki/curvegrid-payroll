import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// This module is used to deploy the CCTPHookWrapper contract
// e.g. npx hardhat ignition deploy ignition/modules/CCTPHookWrapper.sol --parameters ignition/parameters.json --network <network>

const MultichainPayrollModule = buildModule("MultichainPayrollModule", (m) => {
  // Define the message transmitter address as a parameter
  const usdcAddress = m.getParameter<string>("usdcAddress");
  const tokenMessengerAddress = m.getParameter<string>("tokenMessengerAddress");

  // Deploy the MultichainPayroll contract with the parameters
  const multichainPayroll = m.contract("MultichainPayroll", [
    usdcAddress,
    tokenMessengerAddress,
  ]);

  // Return the deployed contract instance
  return { multichainPayroll };
});

export default MultichainPayrollModule;
