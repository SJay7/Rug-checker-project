// OWNERSHIP ANALYSIS
// Checks who controls a token and what powers they have
// This is crucial for detecting rug pull risks

const { ethers } = require('ethers');

// ============================================
// SECTION 1: CONNECT TO MONAD
// ============================================
// Same connection we use everywhere - talks to the blockchain
const MONAD_RPC_URL = 'https://rpc.monad.xyz';
const provider = new ethers.JsonRpcProvider(MONAD_RPC_URL);


// ============================================
// SECTION 2: THE ABI (Contract "Dictionary")
// ============================================
// ABI = Application Binary Interface
// It tells our code what functions exist on the smart contract
// We're looking for DANGEROUS functions that owners might abuse

const OWNERSHIP_ABI = [
    // Basic ownership - who controls this contract?
    "function owner() view returns (address)",
    
    // Minting - can they create more tokens out of thin air?
    // RED FLAG: If owner can mint, they can dilute your holdings
    "function mint(address to, uint256 amount)",
    
    // Pausing - can they freeze all trading?
    // RED FLAG: They could pause, dump their bags, then unpause
    "function pause()",
    "function paused() view returns (bool)",
    
    // Blacklisting - can they block specific wallets from selling?
    // RED FLAG: Classic honeypot technique
    "function blacklist(address account)",
    "function isBlacklisted(address account) view returns (bool)",
    
    // Fee/Tax control - can they change buy/sell taxes?
    // RED FLAG: Set tax to 99% = you can't sell
    "function setFee(uint256 fee)",
    "function setTax(uint256 tax)",
    
    // Ownership transfer - can they hand control to someone else?
    "function transferOwnership(address newOwner)",
    "function renounceOwnership()"
];


// ============================================
// SECTION 3: HELPER FUNCTION
// ============================================
// Checks if a specific function exists on the contract
// Returns true if the function is there, false if not

async function hasFunction(contract, functionName) {
    try {
        // Try to get the function - if it exists, no error
        // We use estimateGas as a way to "ping" the function
        // without actually calling it
        await contract[functionName].estimateGas();
        return true;
    } catch (error) {
        // Function doesn't exist or can't be called
        return false;
    }
}


// ============================================
// SECTION 4: MAIN ANALYSIS FUNCTION
// ============================================
// This is the core function that checks everything

async function analyzeOwnership(tokenAddress) {
    console.log('\n========================================');
    console.log('OWNERSHIP ANALYSIS');
    console.log('Token:', tokenAddress);
    console.log('========================================\n');
    
    // Create a contract instance to interact with the token
    const contract = new ethers.Contract(tokenAddress, OWNERSHIP_ABI, provider);
    
    // This object will store all our findings
    const analysis = {
        owner: null,
        isRenounced: false,
        dangerousFunctions: {
            canMint: false,
            canPause: false,
            canBlacklist: false,
            canChangeFees: false
        },
        riskLevel: 'UNKNOWN',
        warnings: []
    };
    
    // -----------------------------------------
    // CHECK 1: Who is the owner?
    // -----------------------------------------
    try {
        const owner = await contract.owner();
        analysis.owner = owner;
        
        // Zero address means ownership was renounced (given up)
        // This is GOOD - no one can make changes
        const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
        
        if (owner === ZERO_ADDRESS) {
            analysis.isRenounced = true;
            console.log('[GOOD] Ownership: RENOUNCED');
            console.log('       No one controls this contract');
        } else {
            console.log('[INFO] Owner:', owner);
            analysis.warnings.push('Contract has an active owner');
        }
    } catch (error) {
        console.log('[INFO] No owner function found');
        console.log('       Could be ownerless by design, or using different pattern');
    }
    
    // -----------------------------------------
    // CHECK 2: Can owner MINT new tokens?
    // -----------------------------------------
    // If yes, they can create unlimited tokens and dump on you
    try {
        // We check if the mint function exists by looking at the contract
        const canMint = await hasFunction(contract, 'mint');
        analysis.dangerousFunctions.canMint = canMint;
        
        if (canMint) {
            console.log('[DANGER] Mint function: FOUND');
            console.log('         Owner can create new tokens');
            analysis.warnings.push('Owner can mint new tokens');
        } else {
            console.log('[GOOD] Mint function: NOT FOUND');
        }
    } catch (error) {
        console.log('[GOOD] Mint function: NOT FOUND');
    }
    
    // -----------------------------------------
    // CHECK 3: Can owner PAUSE trading?
    // -----------------------------------------
    // If yes, they can freeze everyone's tokens
    try {
        const canPause = await hasFunction(contract, 'pause');
        analysis.dangerousFunctions.canPause = canPause;
        
        if (canPause) {
            console.log('[DANGER] Pause function: FOUND');
            console.log('         Owner can freeze all trading');
            analysis.warnings.push('Owner can pause trading');
            
            // Also check if it's currently paused
            try {
                const isPaused = await contract.paused();
                if (isPaused) {
                    console.log('[CRITICAL] Contract is CURRENTLY PAUSED!');
                    analysis.warnings.push('Contract is currently paused!');
                }
            } catch (e) {
                // paused() function doesn't exist, that's fine
            }
        } else {
            console.log('[GOOD] Pause function: NOT FOUND');
        }
    } catch (error) {
        console.log('[GOOD] Pause function: NOT FOUND');
    }
    
    // -----------------------------------------
    // CHECK 4: Can owner BLACKLIST wallets?
    // -----------------------------------------
    // If yes, they can prevent you from selling (honeypot)
    try {
        const canBlacklist = await hasFunction(contract, 'blacklist');
        analysis.dangerousFunctions.canBlacklist = canBlacklist;
        
        if (canBlacklist) {
            console.log('[DANGER] Blacklist function: FOUND');
            console.log('         Owner can block wallets from selling');
            analysis.warnings.push('Owner can blacklist wallets');
        } else {
            console.log('[GOOD] Blacklist function: NOT FOUND');
        }
    } catch (error) {
        console.log('[GOOD] Blacklist function: NOT FOUND');
    }
    
    // -----------------------------------------
    // CHECK 5: Can owner CHANGE FEES/TAXES?
    // -----------------------------------------
    // If yes, they can set sell tax to 99%
    try {
        const canSetFee = await hasFunction(contract, 'setFee');
        const canSetTax = await hasFunction(contract, 'setTax');
        analysis.dangerousFunctions.canChangeFees = canSetFee || canSetTax;
        
        if (canSetFee || canSetTax) {
            console.log('[DANGER] Fee/Tax control: FOUND');
            console.log('         Owner can change transaction fees');
            analysis.warnings.push('Owner can modify fees/taxes');
        } else {
            console.log('[GOOD] Fee/Tax control: NOT FOUND');
        }
    } catch (error) {
        console.log('[GOOD] Fee/Tax control: NOT FOUND');
    }
    
    // -----------------------------------------
    // CALCULATE RISK LEVEL
    // -----------------------------------------
    // Based on what we found, assign a risk score
    
    const dangers = analysis.dangerousFunctions;
    const dangerCount = [
        dangers.canMint,
        dangers.canPause,
        dangers.canBlacklist,
        dangers.canChangeFees
    ].filter(Boolean).length;  // Count how many are true
    
    if (analysis.isRenounced && dangerCount === 0) {
        analysis.riskLevel = 'LOW';
    } else if (analysis.isRenounced && dangerCount > 0) {
        // Renounced but has dangerous functions - weird but possible
        analysis.riskLevel = 'MEDIUM';
    } else if (!analysis.isRenounced && dangerCount === 0) {
        // Has owner but no dangerous functions
        analysis.riskLevel = 'MEDIUM';
    } else if (dangerCount >= 3) {
        analysis.riskLevel = 'CRITICAL';
    } else if (dangerCount >= 1) {
        analysis.riskLevel = 'HIGH';
    }
    
    // -----------------------------------------
    // PRINT SUMMARY
    // -----------------------------------------
    console.log('\n========================================');
    console.log('SUMMARY');
    console.log('========================================');
    console.log('Risk Level:', analysis.riskLevel);
    console.log('Warnings:', analysis.warnings.length);
    analysis.warnings.forEach(w => console.log('  -', w));
    console.log('========================================\n');
    
    return analysis;
}


// ============================================
// SECTION 5: RUN THE SCRIPT
// ============================================
// This part runs when you execute the file directly

const TEST_TOKEN = process.argv[2];

if (!TEST_TOKEN) {
    console.log('Usage: node src/ownershipAnalysis.js <TOKEN_ADDRESS>');
    console.log('Example: node src/ownershipAnalysis.js 0x123...');
} else {
    analyzeOwnership(TEST_TOKEN);
}

// Export so other files can use this function
module.exports = { analyzeOwnership };

