// SOURCE CODE SCANNER
// Fetches the actual Solidity source code from block explorer
// Then scans for dangerous PATTERNS in the code itself
// This catches obfuscated functions that keyword scanning misses

const https = require('https');

// ============================================
// SECTION 1: CONFIGURATION
// ============================================
// Same Etherscan V2 API - but fetching source code instead of ABI

const EXPLORER_API = 'https://api.etherscan.io/v2/api';
const CHAIN_ID = '1';
const API_KEY = 'K6K49AIR8VNA9WWMWZ1M9CZTV6BNRYETZ5';


// ============================================
// SECTION 2: DANGEROUS CODE PATTERNS
// ============================================
// These are patterns we look for IN THE CODE, not function names
// Regex patterns to match dangerous Solidity code

const DANGEROUS_PATTERNS = {
    // CRITICAL: Minting - creating tokens from nothing
    minting: {
        severity: 'CRITICAL',
        patterns: [
            /_mint\s*\(/gi,                          // _mint( call
            /totalSupply\s*\+=/gi,                   // totalSupply += (increasing supply)
            /totalSupply\s*=\s*totalSupply\s*\+/gi,  // totalSupply = totalSupply +
            /balances?\[.*\]\s*\+=/gi,               // balances[x] += (adding to balance)
        ],
        description: 'Can create new tokens out of thin air'
    },
    
    // CRITICAL: Owner can steal funds
    ownerWithdraw: {
        severity: 'CRITICAL',
        patterns: [
            /\.transfer\s*\(\s*owner/gi,             // .transfer(owner...)
            /\.call\{value:.*\}\s*\(\s*""\s*\)/gi,   // .call{value: x}("") - sending ETH
            /withdraw.*onlyOwner/gis,                // withdraw function with onlyOwner
            /emergencyWithdraw/gi,                   // Emergency withdraw pattern
        ],
        description: 'Owner can drain contract funds'
    },
    
    // HIGH: Pausing mechanism
    pausing: {
        severity: 'HIGH',
        patterns: [
            /whenNotPaused/gi,                       // OpenZeppelin pause modifier
            /require\s*\(\s*!?\s*paused/gi,          // require(!paused) or require(paused)
            /paused\s*=\s*true/gi,                   // paused = true
            /function\s+pause\s*\(/gi,               // function pause(
        ],
        description: 'Owner can freeze all trading'
    },
    
    // HIGH: Blacklisting wallets
    blacklisting: {
        severity: 'HIGH',
        patterns: [
            /blacklist/gi,                           // Any blacklist reference
            /blocklist/gi,                           // Blocklist variation
            /isBlacklisted\s*\[/gi,                  // isBlacklisted[address]
            /require\s*\(\s*!?\s*excluded/gi,        // require(!excluded[...])
            /banned\s*\[/gi,                         // banned[address]
            /require\s*\(\s*!?\s*_isBot/gi,          // Bot detection (often abused)
        ],
        description: 'Can block specific wallets from selling'
    },
    
    // HIGH: Modifiable fees/taxes
    feeManipulation: {
        severity: 'HIGH',
        patterns: [
            /buyTax\s*=/gi,                          // buyTax = 
            /sellTax\s*=/gi,                         // sellTax = 
            /fee\s*=\s*\d+/gi,                       // fee = number
            /taxFee\s*=/gi,                          // taxFee =
            /require\s*\(\s*.*fee.*<.*100/gi,        // fee cap check (shows fees exist)
            /_taxFee\s*=/gi,                         // _taxFee =
        ],
        description: 'Owner can change buy/sell taxes'
    },
    
    // MEDIUM: Trading controls
    tradingControls: {
        severity: 'MEDIUM',
        patterns: [
            /tradingEnabled/gi,                      // Trading toggle
            /tradingOpen/gi,                         // Trading open flag
            /canTrade/gi,                            // Can trade check
            /enableTrading/gi,                       // Enable trading function
            /require\s*\(\s*tradingActive/gi,        // require(tradingActive)
        ],
        description: 'Owner controls when trading is allowed'
    },
    
    // MEDIUM: Max transaction limits
    txLimits: {
        severity: 'MEDIUM',
        patterns: [
            /maxTxAmount/gi,                         // Max transaction amount
            /maxWalletSize/gi,                       // Max wallet size
            /_maxTxAmount\s*=/gi,                    // Setting max tx
            /require\s*\(\s*amount\s*<=\s*_maxTx/gi, // Max tx check
        ],
        description: 'Has transaction/wallet limits (can be changed)'
    },
    
    // INFO: Ownership patterns
    ownership: {
        severity: 'INFO',
        patterns: [
            /onlyOwner/gi,                           // onlyOwner modifier
            /require\s*\(\s*msg\.sender\s*==\s*owner/gi, // require(msg.sender == owner)
            /require\s*\(\s*_msgSender\s*\(\s*\)\s*==\s*owner/gi, // OpenZeppelin style
            /Ownable/gi,                             // Inherits Ownable
        ],
        description: 'Contract has owner-restricted functions'
    },
    
    // INFO: Proxy/Upgradeable patterns
    upgradeable: {
        severity: 'MEDIUM',
        patterns: [
            /upgradeTo/gi,                           // Upgrade function
            /implementation\s*\(\s*\)/gi,            // Proxy implementation
            /delegatecall/gi,                        // Delegatecall (proxy pattern)
            /Initializable/gi,                       // Upgradeable initializer
        ],
        description: 'Contract can be upgraded/changed after deployment'
    },
    
    // HIGH: Hidden transfer to owner
    hiddenTransfers: {
        severity: 'HIGH',
        patterns: [
            /balances?\[.*owner.*\]\s*\+=/gi,        // Adding to owner balance
            /balances?\[.*marketingWallet.*\]\s*\+=/gi, // Marketing wallet accumulation
            /balances?\[.*devWallet.*\]\s*\+=/gi,   // Dev wallet accumulation
            /_transfer\s*\(.*,\s*owner/gi,          // Transfer to owner
        ],
        description: 'Hidden token transfers to owner/team wallets'
    }
};


// ============================================
// SECTION 3: FETCH SOURCE CODE FROM EXPLORER
// ============================================

async function fetchSourceCode(contractAddress) {
    const url = `${EXPLORER_API}?chainid=${CHAIN_ID}&module=contract&action=getsourcecode&address=${contractAddress}&apikey=${API_KEY}`;
    
    console.log('Fetching source code from explorer...');
    
    return new Promise((resolve, reject) => {
        const request = https.get(url, (response) => {
            let data = '';
            
            response.on('data', chunk => {
                data += chunk;
            });
            
            response.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    
                    if (result.status === '1' && result.result && result.result[0]) {
                        const contractData = result.result[0];
                        
                        // Check if source code exists
                        if (contractData.SourceCode && contractData.SourceCode !== '') {
                            resolve({
                                success: true,
                                sourceCode: contractData.SourceCode,
                                contractName: contractData.ContractName,
                                compiler: contractData.CompilerVersion,
                                optimization: contractData.OptimizationUsed,
                                runs: contractData.Runs
                            });
                        } else {
                            resolve({
                                success: false,
                                reason: 'Contract source code not verified'
                            });
                        }
                    } else {
                        resolve({
                            success: false,
                            reason: 'Could not fetch contract data'
                        });
                    }
                } catch (error) {
                    resolve({
                        success: false,
                        reason: 'Failed to parse response'
                    });
                }
            });
        });
        
        request.on('error', (error) => {
            resolve({
                success: false,
                reason: error.message
            });
        });
        
        request.setTimeout(15000, () => {
            request.destroy();
            resolve({
                success: false,
                reason: 'Request timeout'
            });
        });
    });
}


// ============================================
// SECTION 4: SCAN SOURCE CODE FOR PATTERNS
// ============================================

function scanSourceCode(sourceCode) {
    const findings = {
        critical: [],
        high: [],
        medium: [],
        info: []
    };
    
    // Clean up the source code (handle multi-file format)
    let cleanedCode = sourceCode;
    
    // Some contracts return JSON with multiple files
    if (sourceCode.startsWith('{')) {
        try {
            const parsed = JSON.parse(sourceCode.slice(1, -1)); // Remove outer braces
            cleanedCode = Object.values(parsed.sources || parsed)
                .map(f => f.content || f)
                .join('\n');
        } catch (e) {
            // If parsing fails, use as-is
            cleanedCode = sourceCode;
        }
    }
    
    // Scan for each category of dangerous patterns
    for (const [category, config] of Object.entries(DANGEROUS_PATTERNS)) {
        for (const pattern of config.patterns) {
            const matches = cleanedCode.match(pattern);
            
            if (matches && matches.length > 0) {
                const finding = {
                    category: category,
                    pattern: pattern.toString(),
                    matches: matches.slice(0, 3), // Show first 3 matches
                    count: matches.length,
                    description: config.description
                };
                
                // Add to appropriate severity bucket
                switch (config.severity) {
                    case 'CRITICAL':
                        findings.critical.push(finding);
                        break;
                    case 'HIGH':
                        findings.high.push(finding);
                        break;
                    case 'MEDIUM':
                        findings.medium.push(finding);
                        break;
                    case 'INFO':
                        findings.info.push(finding);
                        break;
                }
                
                // Only report first match per category
                break;
            }
        }
    }
    
    return findings;
}


// ============================================
// SECTION 5: CALCULATE RISK SCORE
// ============================================

function calculateRisk(findings) {
    if (findings.critical.length > 0) {
        return 'CRITICAL';
    } else if (findings.high.length >= 2) {
        return 'HIGH';
    } else if (findings.high.length === 1 || findings.medium.length >= 3) {
        return 'MEDIUM';
    } else if (findings.medium.length > 0) {
        return 'LOW-MEDIUM';
    } else {
        return 'LOW';
    }
}


// ============================================
// SECTION 6: MAIN SCANNER FUNCTION
// ============================================

async function scanSourceCodeContract(contractAddress) {
    console.log('\n================================================');
    console.log('SOURCE CODE SCANNER - Deep Pattern Analysis');
    console.log('================================================');
    console.log('Target:', contractAddress);
    console.log('================================================\n');
    
    // Fetch the source code
    const result = await fetchSourceCode(contractAddress);
    
    if (!result.success) {
        console.log('[ERROR] Could not fetch source code');
        console.log('Reason:', result.reason);
        console.log('\nThis scanner requires verified contracts.');
        
        return {
            success: false,
            reason: result.reason
        };
    }
    
    console.log('[SUCCESS] Source code fetched');
    console.log('Contract Name:', result.contractName);
    console.log('Compiler:', result.compiler);
    console.log('Code Length:', result.sourceCode.length, 'characters\n');
    
    // Scan the source code
    console.log('Scanning for dangerous patterns...\n');
    const findings = scanSourceCode(result.sourceCode);
    
    // Print findings
    if (findings.critical.length > 0) {
        console.log('[CRITICAL] - Immediate Red Flags:');
        findings.critical.forEach(f => {
            console.log(`  ${f.category}: ${f.description}`);
            console.log(`    Found: "${f.matches[0]}"`);
        });
        console.log('');
    }
    
    if (findings.high.length > 0) {
        console.log('[HIGH] - Serious Concerns:');
        findings.high.forEach(f => {
            console.log(`  ${f.category}: ${f.description}`);
            console.log(`    Found: "${f.matches[0]}"`);
        });
        console.log('');
    }
    
    if (findings.medium.length > 0) {
        console.log('[MEDIUM] - Worth Noting:');
        findings.medium.forEach(f => {
            console.log(`  ${f.category}: ${f.description}`);
        });
        console.log('');
    }
    
    if (findings.info.length > 0) {
        console.log('[INFO] - Informational:');
        findings.info.forEach(f => {
            console.log(`  ${f.category}: ${f.description}`);
        });
        console.log('');
    }
    
    // Calculate risk
    const riskLevel = calculateRisk(findings);
    
    // Summary
    console.log('================================================');
    console.log('SUMMARY');
    console.log('================================================');
    console.log('Contract Verified: YES');
    console.log('Critical Patterns:', findings.critical.length);
    console.log('High Risk Patterns:', findings.high.length);
    console.log('Medium Risk Patterns:', findings.medium.length);
    console.log('Risk Level:', riskLevel);
    console.log('================================================\n');
    
    return {
        success: true,
        contractName: result.contractName,
        findings: findings,
        riskLevel: riskLevel
    };
}


// ============================================
// SECTION 7: RUN THE SCRIPT
// ============================================

const TARGET = process.argv[2];

if (!TARGET) {
    console.log('Usage: node src/sourceCodeScanner.js <CONTRACT_ADDRESS>');
    console.log('Example: node src/sourceCodeScanner.js 0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE');
} else {
    scanSourceCodeContract(TARGET);
}

module.exports = { scanSourceCodeContract, fetchSourceCode, scanSourceCode };

