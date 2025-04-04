// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

/**
 * @title ITokenMessengerV2
 * @notice Interface for Circle's CCTP TokenMessengerV2 contract
 */
interface ITokenMessengerV2 {
    /**
     * @notice Burns tokens and sends a message to the destination domain for minting
     * @param amount Amount of tokens to burn
     * @param destinationDomain Destination domain (Chain ID in CCTP)
     * @param mintRecipient Address (as bytes32) of recipient on destination domain
     * @param burnToken Address of token to burn
     * @param destinationCaller Authorized caller on the destination domain, as bytes32
     * @param maxFee Maximum fee to pay on the destination domain
     * @param minFinalityThreshold Minimum finality at which the message should be attested to
     */
    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold
    ) external;

    /**
     * @notice Burns tokens and sends a message with hook data to the destination domain for minting
     * @param amount Amount of tokens to burn
     * @param destinationDomain Destination domain (Chain ID in CCTP)
     * @param mintRecipient Address (as bytes32) of recipient on destination domain
     * @param burnToken Address of token to burn
     * @param destinationCaller Authorized caller on the destination domain, as bytes32
     * @param maxFee Maximum fee to pay on the destination domain
     * @param minFinalityThreshold Minimum finality at which the message should be attested to
     * @param hookData Hook data to append to burn message for interpretation on destination domain
     */
    function depositForBurnWithHook(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes calldata hookData
    ) external;
} 
