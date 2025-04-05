import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const MultichainPayrollWithHookSourceModule = buildModule(
  "MultichainPayrollWithHookSourceModule",
  (m) => {
    // Get constructor arguments from module parameters
    const usdc = m.getParameter<string>("usdcAddress");
    const tokenMessenger = m.getParameter<string>("tokenMessengerAddress");
    const hookWrapper = m.getParameter<string>("hookWrapperAddress");
    const targetPayroll = m.getParameter<string>(
      "targetMultichainPayrollAddress"
    );

    // Deploy the MultichainPayrollWithHook contract
    const payroll = m.contract("MultichainPayrollWithHook", [
      usdc,
      tokenMessenger,
      hookWrapper,
      targetPayroll,
    ]);

    return { payroll };
  }
);

export default MultichainPayrollWithHookSourceModule;
