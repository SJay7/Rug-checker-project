# Monad Rug Checker - Learning Notes & Workflow

## Project Overview

Building a rug pull detection tool for the Monad blockchain (currently testing on Ethereum until Monad DEXes go live).

---

## Project Structure

```
Rug-checker-project/
├── backend/
│   ├── src/
│   │   ├── 1-connection-test.js      # Test blockchain connection
│   │   ├── 2-basic-token-info.js     # Read token name/symbol/supply
│   │   ├── 3-ownership-check.js      # Check owner functions
│   │   ├── 4-abi-function-scanner.js # Scan ABI for dangerous functions
│   │   ├── 5-source-code-scanner.js  # Scan source code for patterns
│   │   └── 6-liquidity-analysis.js   # Check LP pools and locks
│   ├── package.json
│   └── node_modules/
├── README.md
├── .gitignore
├── RESEARCH-NOTES.md
└── LEARNING-NOTES.md (this file)
```

---

## What Each Module Does

### 1. Connection Test (`1-connection-test.js`)
- Connects to the blockchain via RPC
- Verifies we can communicate with the network
- Returns current block number

### 2. Basic Token Info (`2-basic-token-info.js`)
- Reads ERC-20 token metadata
- Gets: name, symbol, decimals, total supply
- Checks if token has an owner function

### 3. Ownership Check (`3-ownership-check.js`)
- Checks for dangerous owner functions
- Looks for: mint, pause, blacklist, fee/tax functions
- Assesses if owner has too much control

### 4. ABI Function Scanner (`4-abi-function-scanner.js`)
- Fetches contract ABI from block explorer
- Scans ALL function names for dangerous keywords
- Categorizes risks: critical, high, medium, low

### 5. Source Code Scanner (`5-source-code-scanner.js`)
- Fetches actual Solidity source code
- Uses regex patterns to find dangerous code
- Catches obfuscated functions that ABI scan might miss

### 6. Liquidity Analysis (`6-liquidity-analysis.js`)
- Finds liquidity pools (WETH, USDC, USDT pairs)
- Checks how much liquidity is in each pool
- Analyzes LP token distribution (burned, locked, at risk)
- Calculates overall rug risk

---

## Key Concepts Learned

### What is an RPC?
**RPC = Remote Procedure Call**

It's the "phone line" to the blockchain. Your code can't connect directly to the blockchain - you need an RPC server as a middleman.

```
Your Code → RPC Server → Blockchain → RPC Server → Your Code
```

**Free RPCs:**
- `https://ethereum-rpc.publicnode.com` (Ethereum)
- `https://rpc.monad.xyz` (Monad)

**Limitation:** Free RPCs have rate limits (too many requests = blocked)

---

### What is a DEX (Decentralized Exchange)?

A smart contract that lets people swap tokens without a middleman. Instead of order books, it uses **liquidity pools**.

**Example:** Uniswap, SushiSwap

---

### What is a Liquidity Pool?

A smart contract holding TWO tokens that people trade against.

```
PEPE/ETH Pool contains:
- 1,000,000 PEPE tokens
- 10 ETH

When you buy PEPE:
- You send ETH to the pool
- Pool sends you PEPE back
- Price adjusts based on ratio
```

**High liquidity** = easy to trade, stable price
**Low liquidity** = hard to trade, price moves wildly

---

### What are LP Tokens?

**LP Token = Proof of ownership of liquidity**

When you add tokens to a pool, you get LP tokens as a receipt.

```
You deposit: 1,000,000 PEPE + 10 ETH
You receive: 100 LP tokens (your ownership certificate)
```

**LP tokens can be:**
- **Burned** (sent to dead address) → Safest, liquidity locked forever
- **Locked** (sent to locker contract) → Safe until lock expires
- **In wallet** → Risky, can remove liquidity anytime

---

### How Rug Pulls Work (Liquidity Removal)

1. Dev creates token
2. Dev creates pool (adds liquidity)
3. Dev receives LP tokens
4. People buy token, price goes up, ETH accumulates in pool
5. **Dev removes liquidity** (uses LP tokens to drain the pool)
6. Token crashes to zero
7. Dev walks away with everyone's ETH

**That's why we check LP token distribution!**

---

### LP Security Levels

| LP Status | Risk Level |
|---|---|
| 95%+ burned/locked | SAFE |
| 80-95% burned/locked | LOW |
| 50-80% burned/locked | MEDIUM |
| 20-50% burned/locked | HIGH |
| <20% burned/locked | CRITICAL |

---

### Uniswap V2 vs V3

| Feature | V2 | V3 |
|---|---|---|
| LP tracking | Simple tokens | NFT positions |
| Where scams happen | Mostly here | Less common |
| Easier to analyze | Yes | Harder |

**We focus on V2 because that's where most scam tokens launch.**

---

### What is the Factory Contract?

The "registry" for all pools. We ask it: "Does TOKEN have a pool with ETH?" and it returns the pool address.

**Uniswap V2 Factory:** `0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f`

---

### Pump.fun Style Platforms

Modern memecoin platforms (Pump.fun, SunPump) work differently:

1. Dev creates token on platform
2. **Platform handles liquidity via bonding curve**
3. At threshold → Platform auto-creates DEX pool
4. **LP often burned automatically**

**Safer from liquidity rugs, but other scams still possible:**
- Pump and dump (insider selling)
- Bundled launches (insiders buy first)
- Hidden mint functions

---

### Types of Scams (Even Without LP Control)

| Scam Type | How it Works | How We Detect |
|---|---|---|
| Honeypot | Can buy, can't sell | Simulate sell (future module) |
| Hidden mint | Dev creates new tokens | Source code scan |
| High tax | 95% sell tax | Contract scan |
| Blacklist | Dev blocks your wallet | Source code scan |
| Pump & dump | Insiders sell holdings | Holder analysis |

---

### Known Locker Contracts

When devs "lock" LP, they send it to these trusted contracts:

| Locker | Address |
|---|---|
| Unicrypt | `0x663A5C229c09b049E36dCc11a9B0d4a8Eb9db214` |
| PinkLock | `0x71B5759d73262FBb223956913ecF4ecC51057641` |
| Team.Finance | `0xE2fE530C047f2d85298b07D9333C05737f1435fB` |

---

### Burn Addresses

LP sent here is permanently destroyed:

| Name | Address |
|---|---|
| Zero address | `0x0000000000000000000000000000000000000000` |
| Dead address | `0x000000000000000000000000000000000000dEaD` |

---

## Test Results Summary

### ZEUS Token
- Liquidity: $247K ✅
- LP Burned: 99.99% ✅
- Risk: **LOW** ✅

### SHIB Token
- Liquidity: $800K ✅
- LP Burned: 0% ⚠️
- Risk: **MEDIUM** (LP not in known lockers)

### PEPLEG Token
- Liquidity: $22K ⚠️
- LP Burned: 0% 🔴
- Risk: **MEDIUM** (low liquidity + no LP security)

---

## How to Run the Modules

```bash
# Navigate to backend folder
cd C:\Users\hp\Documents\GitHub\Rug-checker-project\backend

# Test connection
node src/1-connection-test.js

# Get token info
node src/2-basic-token-info.js <TOKEN_ADDRESS>

# Check ownership
node src/3-ownership-check.js <TOKEN_ADDRESS>

# Scan ABI functions
node src/4-abi-function-scanner.js <TOKEN_ADDRESS>

# Scan source code
node src/5-source-code-scanner.js <TOKEN_ADDRESS>

# Analyze liquidity
node src/6-liquidity-analysis.js <TOKEN_ADDRESS>
```

---

## Remaining Modules to Build

| Module | Purpose | Status |
|---|---|---|
| GoPlus API integration | External security data | Pending |
| BubbleMaps API | Holder distribution visualization | Pending |
| Combined risk scorer | Merge all modules into one score | Pending |
| Frontend UI | User interface | Pending |
| Telegram bot | Bot interface | Pending |

---

## Key Takeaways

1. **LP tokens are the key to rug pulls** - Check if they're burned/locked
2. **Burned LP = Safest** - Can never be removed
3. **Low liquidity = Red flag** - Hard to sell, easy to manipulate
4. **Multiple checks needed** - No single check catches everything
5. **Scanner gives warnings, not verdicts** - Human judgment still needed
6. **Free RPCs have limits** - May need API keys for production

---

## Common Terminal Commands

```bash
# Stop stuck script
Ctrl + C

# Navigate directories
cd folder_name
cd ..

# Run Node.js file
node filename.js

# Check if in correct directory
pwd (Mac/Linux) or cd (Windows)
```

---

## File Naming Convention

Files are numbered to show execution order:
- `1-` = First step
- `2-` = Second step
- etc.

Names describe what the file does:
- `connection-test` = Tests connection
- `liquidity-analysis` = Analyzes liquidity

---

*Last updated: December 7, 2025*

