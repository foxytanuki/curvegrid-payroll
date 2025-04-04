# Curvegrid Payroll

This application proceeds with Sepolia as the source chain and Base Sepolia as the destination chain.

## Commands

### Deploy Contracts via Hardhat Ignition

#### CCTPHookWrapper.sol

The following command will deploy CCTPHookWrapper to Hardhat local network.

```
pnpm deploy:hook
```

#### BaseSepolia

```
pnpm deploy:hook --network baseSepolia
```

## Architecture

```mermaid
sequenceDiagram
    participant BO as Business Owner
    participant CP_S as CirclePayroll (Source)
    participant TM as TokenMessenger
    participant Circle as Circle API
    participant CG as Curvegrid Gas
    participant CCTP_H as CCTPHookWrapper
    participant MT as MessageTransmitter
    participant CP_D as CirclePayroll (Destination)
    participant Emp as Employee

    Note over BO,Emp: Destination Chain Setup
    BO->>CP_D: setRouteInfo(employee, domain, token, lending)

    Note over BO,Emp: Source Chain Setup
    BO->>CP_D: setRouteInfo(employee, domain, token, lending)

    Note over BO,Emp: Source Chain Payment
    BO->>CP_S: transfer USDC to contract
    BO->>CP_S: batchPayEmployees(employees)
    CP_S->>TM: depositForBurn(amount, domain, to, USDC)
    
    Note over BO,Emp: Offchain Process
    Note over TM,Circle: Circle API Processing
    TM->>Circle: Request attestation
    Circle-->>CG: Generate attestation

    Note over CG,CCTP_H: Message Relay
    loop Polling
        CG->>Circle: Check attestation status
        Circle-->>CG: Return attestation when ready
    end
    
    Note over BO,Emp: Destination Chain Payment
    CG->>CCTP_H: relay(message, attestation)
    
    Note over CCTP_H,CP_D: Receive Bridged Assets
    CCTP_H->>MT: receiveMessage(message, attestation)
    CCTP_H->>CP_D: handleReceiveMessage(recipient, amount)
    
    Note over CP_D,Emp: Hook Execution
    alt Route Configured
        CP_D->>CP_D: Check route info
        alt Token Swap Required
            CP_D->>CP_D: _swapUSDCToToken()
        end
        alt Lending Enabled
            CP_D->>CP_D: _depositToDeFi()
        else Direct Transfer
            CP_D->>Emp: transfer tokens
        end
    else Route Not Configured
        Note over CP_D: USDC remains in contract
        Note over CP_D: Admin can withdraw using withdrawUSDC()
    end
```
