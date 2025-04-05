import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// This module is used to deploy the CCTPHookWrapperV2 contract
// e.g. npx hardhat ignition deploy ignition/modules/CCTPHookWrapperV2.ts --parameters ignition/parameters.json --network <network>

const CCTPHookWrapperV2Module = buildModule("CCTPHookWrapperV2Module", (m) => {
  // Define the message transmitter address as a parameter
  const messageTransmitterAddress = m.getParameter<string>(
    "messageTransmitterAddress"
  );

  // Deploy the CCTPHookWrapperV2 contract with the parameter
  const cctpHookWrapperV2 = m.contract("CCTPHookWrapperV2", [
    messageTransmitterAddress,
  ]);

  // Return the deployed contract instance
  return { cctpHookWrapperV2 };
});

export default CCTPHookWrapperV2Module;
