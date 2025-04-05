// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../lib/interfaces/ITokenMessengerV2.sol";

/// @title MultichainPayroll - Unified Payroll Contract for CCTP-based USDC payments
/// @notice This contract provides payroll functionality using contract's USDC balance.
/// USDC must be deposited to the contract before making payments.
contract MultichainPayrollMultisig is Ownable {
    // ============ Constants ============
    
    string private constant ERROR_INVALID_ADDRESS = "MultichainPayroll: Invalid address";
    string private constant ERROR_INVALID_AMOUNT = "MultichainPayroll: Amount must be greater than 0";
    string private constant ERROR_ROUTE_NOT_CONFIGURED = "MultichainPayroll: Employee route not configured";
    string private constant ERROR_INVALID_USDC = "MultichainPayroll: Invalid USDC address";
    string private constant ERROR_INVALID_TOKEN_MESSENGER = "MultichainPayroll: Invalid TokenMessenger address";
    string private constant ERROR_APPROVAL_NOT_PENDING = "MultichainPayroll: No payment approval pending";
    string private constant ERROR_APPROVAL_ALREADY_PENDING = "MultichainPayroll: Payment approval already pending";
    string private constant ERROR_NOT_APPROVER = "MultichainPayroll: Caller is not the approver";
    string private constant ERROR_CANNOT_MODIFY_DURING_APPROVAL = "MultichainPayroll: Cannot modify settings during approval process";
    string private constant ERROR_EMPTY_EMPLOYEE_LIST = "MultichainPayroll: Employee list cannot be empty";
    
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
    event ApprovalRequested(uint256 indexed batchId);
    event PaymentApprovedAndExecuted(uint256 indexed batchId);
    event ApproverSet(address indexed newApprover);

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

    Employee[] private pendingPayment;
    bool public isApprovalPending;
    address public approver;
    uint256 public currentBatchId;

    // ================================
    // ======== Modifiers =========
    // ================================
    modifier onlyApprover() {
        require(msg.sender == approver, ERROR_NOT_APPROVER);
        _;
    }

    // ================================
    // ============ Constructor =======
    // ================================

    constructor(address _usdc, address _tokenMessenger) {
        require(_usdc != address(0), ERROR_INVALID_USDC);
        require(_tokenMessenger != address(0), ERROR_INVALID_TOKEN_MESSENGER);
        USDC = _usdc;
        tokenMessenger = ITokenMessengerV2(_tokenMessenger);
        approver = msg.sender;
        emit ApproverSet(msg.sender);
    }

    // =========================================
    // ============ Admin Functions ============
    // =========================================

    /// @notice Admin sets the approver address
    /// @param _newApprover The address of the new approver
    function setApprover(address _newApprover) external onlyOwner {
        require(!isApprovalPending, ERROR_CANNOT_MODIFY_DURING_APPROVAL);
        require(_newApprover != address(0), ERROR_INVALID_ADDRESS);
        approver = _newApprover;
        emit ApproverSet(_newApprover);
    }

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
        require(!isApprovalPending, ERROR_CANNOT_MODIFY_DURING_APPROVAL);
        require(employee != address(0), ERROR_INVALID_ADDRESS);
        routes[employee] = RouteInfo(domain, token, lending);
        emit EmployeeRouteSet(employee, domain, token, lending);
    }

    /// @notice Admin submits a batch of employee payments for approval
    /// @param employees Array of employee addresses and payment amounts
    function requestApproval(Employee[] calldata employees) external onlyOwner {
        require(!isApprovalPending, ERROR_APPROVAL_ALREADY_PENDING);
        require(employees.length > 0, ERROR_EMPTY_EMPLOYEE_LIST);

        // Validate all employees and their routes before storing
        for (uint256 i = 0; i < employees.length; i++) {
            _validateEmployee(employees[i]);
            require(isRouteConfigured(employees[i].employee), ERROR_ROUTE_NOT_CONFIGURED);
        }

        // Clear the previous pending payment array before populating
        delete pendingPayment;

        // Copy employee data from calldata to storage individually
        for (uint256 i = 0; i < employees.length; i++) {
            pendingPayment.push(employees[i]);
        }

        isApprovalPending = true;
        currentBatchId = block.timestamp; // Use timestamp as a simple batch ID

        emit ApprovalRequested(currentBatchId);
    }

    /// @notice Approver approves the pending payment batch, triggering execution
    function approvePayment() external onlyApprover {
        require(isApprovalPending, ERROR_APPROVAL_NOT_PENDING);

        _executeBatchPaymentInternal(pendingPayment);

        delete pendingPayment;
        isApprovalPending = false;
        uint256 executedBatchId = currentBatchId;
        currentBatchId = 0;

        emit PaymentApprovedAndExecuted(executedBatchId);
    }

    /// @notice Allows the owner to withdraw USDC from the contract
    /// @param amount The amount of USDC to withdraw
    /// @param recipient The address to send the withdrawn USDC to
    function withdrawUSDC(uint256 amount, address recipient) external onlyOwner {
        require(!isApprovalPending, ERROR_CANNOT_MODIFY_DURING_APPROVAL);
        require(recipient != address(0), ERROR_INVALID_ADDRESS);
        require(amount > 0, ERROR_INVALID_AMOUNT);

        require(IERC20(USDC).balanceOf(address(this)) >= amount, "MultichainPayroll: Insufficient contract balance for withdrawal");

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
        return routes[employee].destinationCCTPDomain != 0;
    }

    /// @dev Calls CCTP depositForBurn using TokenMessenger
    /// @param to Recipient address
    /// @param amount Amount to send
    /// @param domain CCTP destination domain
    function _sendCCTP(address to, uint256 amount, uint32 domain) internal {
        IERC20(USDC).approve(address(tokenMessenger), amount);
        tokenMessenger.depositForBurn(
           amount,
           domain,
           _addressToBytes32(to),
           USDC,
           bytes32(0),
           500,
           1000
        );
    }

    /// @dev Converts an Ethereum address to bytes32 format for CCTP
    function _addressToBytes32(address addr) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(addr)));
    }

    /// @notice Internal function to execute the batch payment logic
    /// @dev Called by approvePayment after successful approval. Validations are done in requestApproval.
    /// @param employees Array of employee addresses and payment amounts from the approved batch
    function _executeBatchPaymentInternal(Employee[] memory employees) internal {
        uint256 totalAmount = 0;
        for (uint256 i = 0; i < employees.length; i++) {
            totalAmount += employees[i].amount;
        }
        require(IERC20(USDC).balanceOf(address(this)) >= totalAmount, "MultichainPayroll: Insufficient contract balance for batch payment");

        for (uint256 i = 0; i < employees.length; i++) {
            Employee memory emp = employees[i];
            RouteInfo memory route = routes[emp.employee];
            _sendCCTP(emp.employee, emp.amount, route.destinationCCTPDomain);

            emit PaymentSent(emp.employee, emp.amount, route.destinationCCTPDomain);
        }
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
        address finalToken = route.desiredERC20Token == address(0) ? USDC : route.desiredERC20Token;
        PaymentType paymentType = PaymentType.DIRECT;
        
        uint256 amountToProcess = amount;

        bool isSwapNeeded = finalToken != USDC;

        if (isSwapNeeded) {
            amountToProcess = _swapUSDCToToken(amount, finalToken);
            emit TokenSwapExecuted(recipient, amount, finalToken, amountToProcess);
            paymentType = PaymentType.SWAP;
        }

        if (route.lendingEnabled) {
            _depositToLendingProtocol(finalToken, amountToProcess, recipient);
            emit LendingDepositExecuted(recipient, finalToken, amountToProcess);
            paymentType = PaymentType.LENDING;
        } else {
            _transferToRecipient(finalToken, amountToProcess, recipient);
            emit DirectTransferExecuted(recipient, finalToken, amountToProcess);
        }

        emit PaymentReceived(
            recipient, 
            finalToken, 
            amountToProcess, 
            route.destinationCCTPDomain, 
            paymentType
        );
    }

    // ============ Internal Token Logic (Mocked/Placeholders) ============

    /// @dev Swap USDC to another token (Placeholder - Requires actual DEX integration)
    function _swapUSDCToToken(uint256 usdcAmount, address targetToken) internal returns (uint256) {
        require(targetToken != address(0) && targetToken != USDC, "Invalid target token for swap");

        uint256 receivedAmount = usdcAmount;

        return receivedAmount;
    }

    /// @dev Deposit tokens to DeFi lending protocol (Placeholder - Requires specific protocol integration)
    function _depositToLendingProtocol(address token, uint256 amount, address recipient) internal {
        require(token != address(0), ERROR_INVALID_ADDRESS);
        require(amount > 0, ERROR_INVALID_AMOUNT);

        bool success = IERC20(token).transfer(address(0xDEAD), amount);
        require(success, "Mock deposit transfer failed");
    }

    /// @dev Transfer tokens directly to recipient
    function _transferToRecipient(address token, uint256 amount, address recipient) internal {
        require(token != address(0), ERROR_INVALID_ADDRESS);
        require(recipient != address(0), ERROR_INVALID_ADDRESS);
        require(amount > 0, ERROR_INVALID_AMOUNT);

        require(IERC20(token).balanceOf(address(this)) >= amount, "MultichainPayroll: Insufficient token balance for transfer");

        bool success = IERC20(token).transfer(recipient, amount);
        require(success, "MultichainPayroll: Token transfer failed");
    }

    function getPendingPayment() external view returns (Employee[] memory employees) {
        return pendingPayment;
    }
}
