import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// This module is used to deploy the CCTPHookWrapper contract
// e.g. npx hardhat ignition deploy ignition/modules/CCTPHookWrapper.sol --parameters ignition/parameters.json --network <network>

const CCTPHookWrapperModule = buildModule("CCTPHookWrapperModule", (m) => {
  // Define the message transmitter address as a parameter
  const messageTransmitterAddress = m.getParameter<string>(
    "messageTransmitterAddress"
  );

  // Deploy the CCTPHookWrapper contract with the parameter
  const cctpHookWrapper = m.contract("CCTPHookWrapper", [
    messageTransmitterAddress,
  ]);

  // Return the deployed contract instance
  return { cctpHookWrapper };
});

export default CCTPHookWrapperModule;
