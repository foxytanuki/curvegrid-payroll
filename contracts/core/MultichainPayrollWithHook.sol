// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../lib/interfaces/ITokenMessengerV2.sol";

/// @title MultichainPayrollWithHook - Unified Payroll Contract for CCTP-based USDC payments
/// @notice This contract provides payroll functionality using contract's USDC balance.
/// USDC must be deposited to the contract before making payments.
contract MultichainPayrollWithHook is Ownable {
    // ============ Constants ============
    
    string private constant ERROR_INVALID_ADDRESS = "MultichainPayrollWithHook: Invalid address";
    string private constant ERROR_INVALID_AMOUNT = "MultichainPayrollWithHook: Amount must be greater than 0";
    string private constant ERROR_ROUTE_NOT_CONFIGURED = "MultichainPayrollWithHook: Employee route not configured";
    string private constant ERROR_INVALID_USDC = "MultichainPayrollWithHook: Invalid USDC address";
    string private constant ERROR_INVALID_TOKEN_MESSENGER = "MultichainPayrollWithHook: Invalid TokenMessenger address";
    string private constant ERROR_INVALID_HOOK_WRAPPER = "MultichainPayrollWithHook: Invalid HookWrapper address";
    string private constant ERROR_INVALID_MULTICHAIN_PAYROLL = "MultichainPayrollWithHook: Invalid MultichainPayroll address";

    // ================================
    // ============ Events ============
    // ================================
    
    // ============ Admin Events ============ 
    // ----- both on destination chain and source chain -----
    event USDCWithdrawn(address indexed recipient, uint256 amount);
    // ----- only on source chain -----
    event PaymentSent(
        address indexed employee,
        uint256 amount,
        uint32 destinationDomain
    );
    // ----- only on destination chain -----
    event EmployeeRouteSet(
        address indexed employee,
        uint32 domain,
        address token,
        bool lending
    );

    // ============ Destination Chain Hooks Events ============
    // ----- only on destination chain -----
    event PaymentReceived(
        address indexed employee,
        address token,
        uint256 amount,
        uint32 destinationDomain,
        PaymentType paymentType
    );
    event DirectTransferExecuted(
        address indexed employee,
        address token,
        uint256 amount
    );
    event TokenSwapExecuted(
        address indexed employee,
        uint256 usdcAmount,
        address targetToken,
        uint256 receivedAmount
    );
    event LendingDepositExecuted(
        address indexed employee,
        address token,
        uint256 amount
    );

    event PaymentRequestedFromHook(
        address indexed employee,
        address token,
        uint256 amount,
        uint32 destinationDomain
    );
    
    // ================================
    // ============ Structs ===========
    // ================================
    
    // Define payment type enum
    enum PaymentType { DIRECT, SWAP, LENDING }

    struct RouteInfo {
        uint32 destinationCCTPDomain;
        address desiredERC20Token;
        bool lendingEnabled;
    }

    struct Employee {
        address employee;
        uint256 amount;
    }

    // ================================
    // ============ Storage ===========
    // ================================

    mapping(address => RouteInfo) public routes;
    address public immutable USDC;
    ITokenMessengerV2 public immutable tokenMessenger;
    address public immutable hookWrapper;
    // In the future, this can be changed to a mapping that supports domains for better multichain compatibility
    address public immutable targetMultichainPayroll;

    // ================================
    // ============ Constructor =======
    // ================================

    constructor(address _usdc, address _tokenMessenger, address _hookWrapper, address _targetMultichainPayroll) {
        require(_usdc != address(0), ERROR_INVALID_USDC);
        require(_tokenMessenger != address(0), ERROR_INVALID_TOKEN_MESSENGER);
        require(_hookWrapper != address(0), ERROR_INVALID_HOOK_WRAPPER);
        require(_targetMultichainPayroll != address(0), ERROR_INVALID_MULTICHAIN_PAYROLL);

        USDC = _usdc;
        tokenMessenger = ITokenMessengerV2(_tokenMessenger);
        hookWrapper = _hookWrapper;
        targetMultichainPayroll = _targetMultichainPayroll;
    }

    // =========================================
    // ============ Admin Functions ============
    // =========================================

    /// @notice Admin registers payroll route info for an employee
    /// @param employee The address of the employee
    /// @param domain The CCTP domain where the employee will receive payments
    /// @param token The token the employee wants to receive (can be USDC)
    /// @param lending Whether to deposit to DeFi protocols or transfer directly
    function setRouteInfo(
        address employee,
        uint32 domain,
        address token,
        bool lending
    ) external onlyOwner {
        require(employee != address(0), ERROR_INVALID_ADDRESS);
        routes[employee] = RouteInfo(domain, token, lending);
        emit EmployeeRouteSet(employee, domain, token, lending);
    }

    /// @notice Admin sends USDC to employees across chains via CCTP
    /// @dev Uses contract's USDC balance
    /// @param employees Array of employee addresses and payment amounts
    function batchPayEmployees(Employee[] calldata employees) external onlyOwner {
        for (uint256 i = 0; i < employees.length; i++) {
            Employee memory emp = employees[i];
            _validateEmployee(emp);
            
            RouteInfo memory route = routes[emp.employee];
            require(isRouteConfigured(emp.employee), ERROR_ROUTE_NOT_CONFIGURED);
            
            // Send USDC to hookWrapper on destination chain at first,
            // then the hookWrapper will call handleReceiveMessage on the targetMultichainPayroll
            _sendCCTP(emp.employee, emp.amount, route.destinationCCTPDomain);
            
            emit PaymentSent(emp.employee, emp.amount, route.destinationCCTPDomain);
        }
    }

    /// @notice Allows the owner to withdraw USDC from the contract
    /// @param amount The amount of USDC to withdraw
    /// @param recipient The address to send the withdrawn USDC to
    function withdrawUSDC(uint256 amount, address recipient) external onlyOwner {
        require(recipient != address(0), ERROR_INVALID_ADDRESS);
        require(amount > 0, ERROR_INVALID_AMOUNT);
        
        IERC20(USDC).transfer(recipient, amount);
        emit USDCWithdrawn(recipient, amount);
    }

    // ============ Internal Functions ============

    /// @dev Validate employee data
    /// @param emp Employee struct to validate
    function _validateEmployee(Employee memory emp) internal pure {
        require(emp.employee != address(0), ERROR_INVALID_ADDRESS);
        require(emp.amount > 0, ERROR_INVALID_AMOUNT);
    }

    /// @dev Checks if a route has been configured for an employee
    /// @param employee The employee address to check
    /// @return true if the route has been configured, false otherwise
    function isRouteConfigured(address employee) internal view returns (bool) {
        return routes[employee].desiredERC20Token != address(0);
    }

    /// @dev Calls CCTP depositForBurn using TokenMessenger
    /// @param to Recipient address (hookWrapper)
    /// @param amount Amount to send
    /// @param domain CCTP destination domain
    function _sendCCTP(address to, uint256 amount, uint32 domain) internal {
        IERC20(USDC).approve(address(tokenMessenger), amount);

        // 1. Prepare calldata for handleReceiveMessage(address recipient, uint256 amount)
        // This function resides on the targetMultichainPayroll contract, which will be called by the hookWrapper
        bytes memory targetCalldata = abi.encodeWithSelector(
            // Use the selector from the target contract instance/interface if available
            // Casting the address assumes MultichainPayrollWithHook type compatibility
            MultichainPayrollWithHook(targetMultichainPayroll).directTransfer.selector,
            to,
            amount
        );

        // 2. Construct hookData by tightly packing the target contract address (targetMultichainPayroll) and its calldata
        // The hookWrapper will use this data to make the final call
        bytes memory hookData = abi.encodePacked(bytes20(targetMultichainPayroll), targetCalldata);

        // 3. Call CCTP's depositForBurnWithHook function with corrected parameters
        bytes32 mintRecipient = _addressToBytes32(targetMultichainPayroll);
        bytes32 destinationCaller = bytes32(0); // Any address can broadcast the message
        uint256 cctpMaxFee = 500; // Set max fee (0.0005 USDC)
        uint32 cctpMinFinalityThreshold = 1000; // Set min finality threshold (consistent with TS example)

        tokenMessenger.depositForBurnWithHook(
           amount,                    // amount to burn
           domain,                    // destination CCTP domain
           mintRecipient,              // mintRecipient on destination
           USDC,                       // address of token being burned
           destinationCaller,          // authorized caller on the destination domain
           cctpMaxFee,                 // maximum fee to pay on the destination domain
           cctpMinFinalityThreshold,   // minimum finality threshold
           hookData                    // custom data passed to the hook contract
        );
    }

    /// @dev Converts an Ethereum address to bytes32 format for CCTP
    function _addressToBytes32(address addr) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(addr)));
    }

    // =========================================
    // =========== Called via Hooks ============
    // =========================================

    /// @notice Called via CCTPHookWrapper relay(), triggered by Multichain message
    /// @dev hookCallData = abi.encodeWithSelector(this.handleReceiveMessage.selector, recipient, amount)
    /// @param recipient The employee receiving the payment
    /// @param amount The USDC amount received
    function handleReceiveMessage(address recipient, uint256 amount) external {
        require(recipient != address(0), ERROR_INVALID_ADDRESS);
        require(amount > 0, ERROR_INVALID_AMOUNT);
        
        RouteInfo memory route = routes[recipient];
        address finalToken = route.desiredERC20Token;
        PaymentType paymentType = PaymentType.DIRECT;

        emit PaymentRequestedFromHook(recipient, USDC, amount, route.destinationCCTPDomain);
        
        // Determine if token swap is needed
        bool isSwapNeeded = finalToken != address(0) && finalToken != USDC;
        
        if (isSwapNeeded) {
            amount = _swapUSDCToToken(amount, finalToken);
            emit TokenSwapExecuted(recipient, amount, finalToken, amount);
            paymentType = PaymentType.SWAP;
        }

        // Override payment type if lending is enabled
        if (route.lendingEnabled) {
            _depositToLendingProtocol(finalToken, amount, recipient);
            emit LendingDepositExecuted(recipient, finalToken, amount);
            paymentType = PaymentType.LENDING;
        } else {
            _transferToRecipient(finalToken, amount, recipient);
            emit DirectTransferExecuted(recipient, finalToken, amount);
        }

        emit PaymentReceived(
            recipient, 
            finalToken, 
            amount, 
            route.destinationCCTPDomain, 
            paymentType
        );
    }

    function directTransfer(address recipient, uint256 amount) external {
        require(recipient != address(0), ERROR_INVALID_ADDRESS);
        require(amount > 0, ERROR_INVALID_AMOUNT);

        _transferToRecipient(USDC, amount, recipient);
        emit DirectTransferExecuted(recipient, USDC, amount);
        // TODO: replace with a real destination domain
        emit PaymentReceived(recipient, USDC, amount, 6, PaymentType.DIRECT);
    }

    // ============ Internal Token Logic (Mocked) ============

    /// @dev Swap USDC to another token (implementation would use DEX)
    function _swapUSDCToToken(uint256 amount, address /* token */) internal pure returns (uint256) {
        // Swap logic via Uniswap etc. (mocked for demo)
        return amount;
    }

    /// @dev Deposit tokens to DeFi lending protocol
    function _depositToLendingProtocol(address token, uint256 amount, address recipient) internal {
        // Lending protocol integration, e.g., Aave's deposit onBehalfOf
    }

    /// @dev Transfer tokens directly to recipient
    function _transferToRecipient(address token, uint256 amount, address recipient) internal {
        IERC20(token).transfer(recipient, amount);
    }
}
