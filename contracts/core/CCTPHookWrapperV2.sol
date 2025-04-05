/*
 * Copyright 2024 Circle Internet Group, Inc. All rights reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
pragma solidity 0.7.6;

import {IReceiverV2} from "../lib/interfaces/IReceiverV2.sol";
import {TypedMemView} from "../lib/memview/TypedMemView.sol";
import {MessageV2} from "../lib/messages/MessageV2.sol";
import {BurnMessageV2} from "../lib/messages/BurnMessageV2.sol";
import {Ownable} from "../lib/roles/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title CCTPHookWrapper
 * @notice A sample wrapper around CCTP v2 that relays a message and
 * optionally executes the hook contained in the Burn Message.
 * @dev Intended to only work with CCTP v2 message formats and interfaces.
 */
contract CCTPHookWrapperV2 is Ownable {
    // ============ Constants ============
    string private constant ERROR_INVALID_MESSAGE_TRANSMITTER = "CCTPHookWrapperV2: Message transmitter is the zero address";
    string private constant ERROR_INVALID_MESSAGE_VERSION = "CCTPHookWrapperV2: Invalid message version";
    string private constant ERROR_INVALID_MESSAGE_BODY_VERSION = "CCTPHookWrapperV2: Invalid message body version";
    string private constant ERROR_RECEIVE_MESSAGE_FAILED = "CCTPHookWrapperV2: Receive message failed";
    string private constant ERROR_TOKEN_TRANSFER_FAILED = "CCTPHookWrapperV2: Token transfer failed"; // Generic transfer error
    string private constant ERROR_INVALID_RECIPIENT = "CCTPHookWrapperV2: Invalid recipient address";
    string private constant ERROR_INVALID_TOKEN = "CCTPHookWrapperV2: Invalid token address";
    string private constant ERROR_ZERO_AMOUNT = "CCTPHookWrapperV2: Amount must be greater than 0";
    string private constant ERROR_INSUFFICIENT_BALANCE = "CCTPHookWrapperV2: Insufficient balance";

    // Address of the local message transmitter
    IReceiverV2 public immutable messageTransmitter;

    // The supported Message Format version
    uint32 public constant supportedMessageVersion = 1;

    // The supported Message Body version
    uint32 public constant supportedMessageBodyVersion = 1;

    // Byte-length of an address
    uint256 internal constant ADDRESS_BYTE_LENGTH = 20;

    // ============ Libraries ============
    using TypedMemView for bytes;
    using TypedMemView for bytes29;

    // ================================
    // ============ Events ============
    // ================================
    event MessageReceived(
        address indexed employee,
        address token,
        uint256 amount,
        uint32 destinationDomain
    );

    // ============ Constructor ============
    /**
     * @param _messageTransmitter The address of the local message transmitter
     */
    constructor(address _messageTransmitter) Ownable() {
        require(
            _messageTransmitter != address(0),
            ERROR_INVALID_MESSAGE_TRANSMITTER
        );

        messageTransmitter = IReceiverV2(_messageTransmitter);
    }

    // ============ External Functions  ============
    /**
     * @notice Relays a burn message to a local message transmitter
     * and executes the hook, if present.
     *
     * @dev The hook data contained in the Burn Message is expected to follow this format:
     * Field                 Bytes      Type       Index
     * target                20         address    0
     * hookCallData          dynamic    bytes      20
     *
     * The hook handler will call the target address with the hookCallData, even if hookCallData
     * is zero-length. Additional data about the burn message is not passed in this call.
     *
     * @dev Reverts if not called by the Owner. Due to the lack of atomicity with the hook call, permissionless relay of messages containing hooks via
     * an implementation like this contract should be carefully considered, as a malicious caller could use a low gas attack to consume
     * the message's nonce without executing the hook.
     *
     * WARNING: this implementation does NOT enforce atomicity in the hook call. This is to prevent a failed hook call
     * from preventing relay of a message if this contract is set as the destinationCaller.
     *
     * @dev Reverts if the receiveMessage() call to the local message transmitter reverts, or returns false.
     * @param message The message to relay, as bytes
     * @param attestation The attestation corresponding to the message, as bytes
     * @return relaySuccess True if the call to the local message transmitter succeeded.
     * @return hookSuccess True if the call to the hook target succeeded. False if the hook call failed,
     * or if no hook was present.
     * @return hookReturnData The data returned from the call to the hook target. This will be empty
     * if there was no hook in the message.
     */
    function relay(
        bytes calldata message,
        bytes calldata attestation
    )
        external
        virtual
        returns (
            bool relaySuccess,
            bool hookSuccess,
            bytes memory hookReturnData
        )
    {
        _checkOwner();

        // Validate message
        bytes29 _msg = message.ref(0);
        MessageV2._validateMessageFormat(_msg);
        require(
            MessageV2._getVersion(_msg) == supportedMessageVersion,
            ERROR_INVALID_MESSAGE_VERSION
        );

        // Validate burn message
        bytes29 _msgBody = MessageV2._getMessageBody(_msg);
        BurnMessageV2._validateBurnMessageFormat(_msgBody);
        require(
            BurnMessageV2._getVersion(_msgBody) == supportedMessageBodyVersion,
            ERROR_INVALID_MESSAGE_BODY_VERSION
        );

        // Relay message
        relaySuccess = messageTransmitter.receiveMessage(message, attestation);
        require(relaySuccess, ERROR_RECEIVE_MESSAGE_FAILED);
        emit MessageReceived(
          address(uint160(uint256(BurnMessageV2._getMintRecipient(_msgBody)))),
          address(uint160(uint256(BurnMessageV2._getBurnToken(_msgBody)))),
          BurnMessageV2._getAmount(_msgBody),
          MessageV2._getDestinationDomain(_msg)
        );

        // Handle hook if present
        bytes29 _hookData = BurnMessageV2._getHookData(_msgBody);
        if (_hookData.isValid()) {
            uint256 _hookDataLength = _hookData.len();
            if (_hookDataLength >= ADDRESS_BYTE_LENGTH) {
                address _target = _hookData.indexAddress(0);
                bytes memory _hookCalldata = _hookData
                    .postfix(_hookDataLength - ADDRESS_BYTE_LENGTH, 0)
                    .clone();

                // Get the token address and amount from the burn message
                address burnToken = address(uint160(uint256(BurnMessageV2._getBurnToken(_msgBody))));
                uint256 amount = BurnMessageV2._getAmount(_msgBody);

                // Transfer the received token to the hook target *before* executing the hook
                // Ensure this contract has sufficient balance (which it should after receiveMessage)
                require(IERC20(burnToken).transfer(_target, amount), ERROR_TOKEN_TRANSFER_FAILED);

                // Now execute the hook. The target contract should have the tokens.
                (hookSuccess, hookReturnData) = _executeHook(
                    _target,
                    _hookCalldata
                );
            }
        } else {
        }
    }

    // ============ Owner Functions ============

    /**
     * @notice Allows the owner to withdraw any ERC20 tokens held by this contract.
     * @dev Useful for retrieving tokens sent unexpectedly or left over from messages without hooks.
     * @param tokenContract The address of the ERC20 token contract to withdraw.
     * @param to The address to send the withdrawn tokens to.
     * @param amount The amount of tokens to withdraw.
     */
    function withdrawTokens(address tokenContract, address to, uint256 amount) external onlyOwner {
        require(to != address(0), ERROR_INVALID_RECIPIENT);
        require(tokenContract != address(0), ERROR_INVALID_TOKEN);
        require(amount > 0, ERROR_ZERO_AMOUNT);

        uint256 balance = IERC20(tokenContract).balanceOf(address(this));
        require(balance >= amount, ERROR_INSUFFICIENT_BALANCE);

        require(IERC20(tokenContract).transfer(to, amount), ERROR_TOKEN_TRANSFER_FAILED);
    }

    // ============ Internal Functions  ============
    /**
     * @notice Handles hook data by executing a call to a target address
     * @dev Can be overridden to customize execution behavior
     * @dev Does not revert if the CALL to the hook target fails
     * @param _hookTarget The target address of the hook
     * @param _hookCalldata The hook calldata
     * @return _success True if the call to the encoded hook target succeeds
     * @return _returnData The data returned from the call to the hook target
     */
    function _executeHook(
        address _hookTarget,
        bytes memory _hookCalldata
    ) internal virtual returns (bool _success, bytes memory _returnData) {
        (_success, _returnData) = address(_hookTarget).call(_hookCalldata);
    }
}
