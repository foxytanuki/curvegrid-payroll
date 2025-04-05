import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import MultichainPayrollModule from "./MultichainPayroll";

// This module is used to deploy the CCTPHookWrapper contract
// e.g. npx hardhat ignition deploy ignition/modules/CCTPHookWrapper.sol --parameters ignition/parameters.json --network <network>

const MultichainPayrollMultisigModule = buildModule(
  "MultichainPayrollMultisigModule",
  (m) => {
    // Define the message transmitter address as a parameter
    const usdcAddress = m.getParameter<string>("usdcAddress");
    const tokenMessengerAddress = m.getParameter<string>(
      "tokenMessengerAddress"
    );

    // Deploy the MultichainPayrollMultisig contract with the parameters
    const multichainPayrollMultisig = m.contract("MultichainPayrollMultisig", [
      usdcAddress,
      tokenMessengerAddress,
    ]);

    // Return the deployed contract instance
    return { multichainPayrollMultisig };
  }
);

export default MultichainPayrollMultisigModule;
