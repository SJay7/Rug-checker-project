// CONTRACT SCANNER
// Fetches the REAL contract ABI from block explorer
// Then scans all functions for dangerous patterns
// This is more accurate than guessing function names

const https = require('https');
const http = require('http');

// ============================================
// SECTION 1: CONFIGURATION
// ============================================
// Currently set to Ethereum mainnet for testing
// Change to Monad explorer URL when available

const EXPLORER_API = 'https://api.etherscan.io/v2/api';

// Chain ID (1 = Ethereum mainnet, change for other chains)
const CHAIN_ID = '1';

// Your Etherscan API key (free tier)
const API_KEY = 'K6K49AIR8VNA9WWMWZ1M9CZTV6BNRYETZ5';


// ============================================
// SECTION 2: DANGEROUS KEYWORDS
// ============================================
// These are words that appear in function names that could be risky
// We categorize them by risk type

const DANGEROUS_PATTERNS = {
    // CRITICAL: Direct rug pull mechanisms
    minting: ['mint', 'issue', 'create', 'generate', 'inflate'],
    
    // HIGH: Can trap your funds
    pausing: ['pause', 'freeze', 'stop', 'halt', 'suspend'],
    blacklisting: ['blacklist', 'blocklist', 'ban', 'exclude', 'block', 'restrict'],
    
    // MEDIUM: Can manipulate value
    fees: ['fee', 'tax', 'setfee', 'settax', 'updatefee', 'updatetax', 'slippage'],
    
    // INFO: Ownership patterns (not always bad, but good to know)
    ownership: ['owner', 'admin', 'governance', 'controller', 'authority', 'manager'],
    
    // WARNING: Upgrade/change mechanisms
    upgrades: ['upgrade', 'migrate', 'setimplementation', 'proxy'],
    
    // WARNING: Can drain liquidity
    liquidity: ['removeliquidity', 'withdrawliquidity', 'drainliquidity', 'skim']
};


// ============================================
// SECTION 3: FETCH CONTRACT ABI FROM EXPLORER
// ============================================
// Calls the block explorer API to get the contract's ABI
// ABI = list of all functions, events, and variables

async function fetchContractABI(contractAddress) {
    // Build the API URL (Etherscan V2 format with chainid)
    const url = `${EXPLORER_API}?chainid=${CHAIN_ID}&module=contract&action=getabi&address=${contractAddress}${API_KEY ? '&apikey=' + API_KEY : ''}`;
    
    console.log('Fetching ABI from explorer...');
    console.log('URL:', url);
    
    return new Promise((resolve, reject) => {
        // Determine if http or https based on URL
        const client = url.startsWith('https') ? https : http;
        
        const request = client.get(url, (response) => {
            let data = '';
            
            // Collect data chunks
            response.on('data', chunk => {
                data += chunk;
            });
            
            // When complete, parse the response
            response.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    
                    // Etherscan-style APIs return status "1" for success
                    if (result.status === '1' && result.result) {
                        // The ABI is a JSON string, need to parse it again
                        const abi = JSON.parse(result.result);
                        resolve(abi);
                    } else {
                        // Contract not verified or other error
                        resolve(null);
                    }
                } catch (error) {
                    resolve(null);
                }
            });
        });
        
        request.on('error', (error) => {
            console.log('API request failed:', error.message);
            resolve(null);
        });
        
        // Timeout after 10 seconds
        request.setTimeout(10000, () => {
            request.destroy();
            resolve(null);
        });
    });
}


// ============================================
// SECTION 4: EXTRACT FUNCTION NAMES FROM ABI
// ============================================
// ABI contains functions, events, constructors, etc.
// We only care about functions

function extractFunctions(abi) {
    if (!abi || !Array.isArray(abi)) {
        return [];
    }
    
    // Filter to only get functions
    const functions = abi
        .filter(item => item.type === 'function')
        .map(item => ({
            name: item.name,
            // Check if it changes state (non-view functions are more dangerous)
            mutability: item.stateMutability,
            // Get the input parameters
            inputs: item.inputs ? item.inputs.map(i => i.type).join(', ') : ''
        }));
    
    return functions;
}


// ============================================
// SECTION 5: SCAN FOR DANGEROUS FUNCTIONS
// ============================================
// Check each function name against our dangerous patterns

function scanForDangers(functions) {
    const findings = {
        critical: [],   // Immediate red flags
        high: [],       // Serious concerns
        medium: [],     // Worth noting
        info: []        // Informational
    };
    
    for (const func of functions) {
        const nameLower = func.name.toLowerCase();
        
        // Check against each category of dangerous patterns
        
        // CRITICAL: Minting capabilities
        if (DANGEROUS_PATTERNS.minting.some(keyword => nameLower.includes(keyword))) {
            findings.critical.push({
                function: func.name,
                risk: 'MINTING',
                reason: 'Can create new tokens, diluting holders',
                mutability: func.mutability
            });
        }
        
        // HIGH: Pausing capabilities
        if (DANGEROUS_PATTERNS.pausing.some(keyword => nameLower.includes(keyword))) {
            findings.high.push({
                function: func.name,
                risk: 'PAUSING',
                reason: 'Can freeze all trading',
                mutability: func.mutability
            });
        }
        
        // HIGH: Blacklisting capabilities
        if (DANGEROUS_PATTERNS.blacklisting.some(keyword => nameLower.includes(keyword))) {
            findings.high.push({
                function: func.name,
                risk: 'BLACKLISTING',
                reason: 'Can block wallets from selling (honeypot)',
                mutability: func.mutability
            });
        }
        
        // MEDIUM: Fee manipulation
        if (DANGEROUS_PATTERNS.fees.some(keyword => nameLower.includes(keyword))) {
            findings.medium.push({
                function: func.name,
                risk: 'FEE CONTROL',
                reason: 'Can change transaction fees',
                mutability: func.mutability
            });
        }
        
        // INFO: Ownership functions
        if (DANGEROUS_PATTERNS.ownership.some(keyword => nameLower.includes(keyword))) {
            findings.info.push({
                function: func.name,
                risk: 'OWNERSHIP',
                reason: 'Ownership/admin related function',
                mutability: func.mutability
            });
        }
        
        // MEDIUM: Upgrade mechanisms
        if (DANGEROUS_PATTERNS.upgrades.some(keyword => nameLower.includes(keyword))) {
            findings.medium.push({
                function: func.name,
                risk: 'UPGRADEABLE',
                reason: 'Contract can be modified after deployment',
                mutability: func.mutability
            });
        }
        
        // HIGH: Liquidity drain
        if (DANGEROUS_PATTERNS.liquidity.some(keyword => nameLower.includes(keyword))) {
            findings.high.push({
                function: func.name,
                risk: 'LIQUIDITY DRAIN',
                reason: 'Can remove liquidity',
                mutability: func.mutability
            });
        }
    }
    
    return findings;
}


// ============================================
// SECTION 6: CALCULATE RISK SCORE
// ============================================
// Based on findings, calculate overall risk

function calculateRisk(findings) {
    const criticalCount = findings.critical.length;
    const highCount = findings.high.length;
    const mediumCount = findings.medium.length;
    
    if (criticalCount > 0) {
        return 'CRITICAL';
    } else if (highCount >= 2) {
        return 'HIGH';
    } else if (highCount === 1 || mediumCount >= 2) {
        return 'MEDIUM';
    } else {
        return 'LOW';
    }
}


// ============================================
// SECTION 7: MAIN SCANNER FUNCTION
// ============================================
// Puts it all together

async function scanContract(contractAddress) {
    console.log('\n================================================');
    console.log('CONTRACT SCANNER - Dynamic ABI Analysis');
    console.log('================================================');
    console.log('Target:', contractAddress);
    console.log('================================================\n');
    
    // Step 1: Fetch ABI from explorer
    const abi = await fetchContractABI(contractAddress);
    
    if (!abi) {
        console.log('[WARNING] Could not fetch ABI');
        console.log('Possible reasons:');
        console.log('  - Contract is not verified on explorer');
        console.log('  - Explorer API is different than expected');
        console.log('  - Network issues');
        console.log('\nFalling back to basic analysis...\n');
        
        return {
            success: false,
            verified: false,
            message: 'Contract not verified or API unavailable',
            recommendation: 'Use ownershipAnalysis.js for basic checks'
        };
    }
    
    console.log('[SUCCESS] ABI fetched successfully');
    console.log('Contract is VERIFIED on explorer\n');
    
    // Step 2: Extract function names
    const functions = extractFunctions(abi);
    console.log(`Found ${functions.length} functions in contract\n`);
    
    // Step 3: List all functions
    console.log('ALL FUNCTIONS:');
    console.log('--------------');
    functions.forEach(f => {
        const stateTag = f.mutability === 'view' || f.mutability === 'pure' ? '[READ]' : '[WRITE]';
        console.log(`  ${stateTag} ${f.name}(${f.inputs})`);
    });
    
    // Step 4: Scan for dangers
    console.log('\n\nSECURITY SCAN:');
    console.log('--------------');
    
    const findings = scanForDangers(functions);
    
    // Print findings by severity
    if (findings.critical.length > 0) {
        console.log('\n[CRITICAL] - Immediate Red Flags:');
        findings.critical.forEach(f => {
            console.log(`  ${f.function}() - ${f.reason}`);
        });
    }
    
    if (findings.high.length > 0) {
        console.log('\n[HIGH] - Serious Concerns:');
        findings.high.forEach(f => {
            console.log(`  ${f.function}() - ${f.reason}`);
        });
    }
    
    if (findings.medium.length > 0) {
        console.log('\n[MEDIUM] - Worth Noting:');
        findings.medium.forEach(f => {
            console.log(`  ${f.function}() - ${f.reason}`);
        });
    }
    
    if (findings.info.length > 0) {
        console.log('\n[INFO] - Ownership/Admin Functions:');
        findings.info.forEach(f => {
            console.log(`  ${f.function}()`);
        });
    }
    
    // Step 5: Calculate risk
    const riskLevel = calculateRisk(findings);
    
    // Step 6: Print summary
    console.log('\n================================================');
    console.log('SUMMARY');
    console.log('================================================');
    console.log('Contract Verified: YES');
    console.log('Total Functions:', functions.length);
    console.log('Critical Issues:', findings.critical.length);
    console.log('High Issues:', findings.high.length);
    console.log('Medium Issues:', findings.medium.length);
    console.log('Risk Level:', riskLevel);
    console.log('================================================\n');
    
    return {
        success: true,
        verified: true,
        functions: functions,
        findings: findings,
        riskLevel: riskLevel
    };
}


// ============================================
// SECTION 8: RUN THE SCRIPT
// ============================================

const TARGET = process.argv[2];

if (!TARGET) {
    console.log('Usage: node src/contractScanner.js <CONTRACT_ADDRESS>');
    console.log('Example: node src/contractScanner.js 0x350035555E10d9AfAF1566AaebfCeD5BA6C27777');
} else {
    scanContract(TARGET);
}

// Export for use by other modules
module.exports = { scanContract, fetchContractABI, scanForDangers };

