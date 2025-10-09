// Simple display name cache to avoid repeated API calls
const displayNameCache = new Map<string, { name: string; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Convert address to reverse node for ENS resolution (from Base tutorial)
 */
async function convertReverseNodeToBytes(
  address: string,
  chainId: number,
): Promise<`0x${string}`> {
  const { encodePacked, keccak256, namehash } = await import("viem");

  const addressFormatted = address.toLowerCase() as `0x${string}`;
  const addressNode = keccak256(encodePacked(["address"], [addressFormatted]));
  const chainCoinType = (0x80000000 | chainId) >>> 0;
  const baseReverseNode = namehash(
    `${chainCoinType.toString(16).toUpperCase()}.reverse`,
  );
  const addressReverseNode = keccak256(
    encodePacked(["bytes32", "bytes32"], [baseReverseNode, addressNode]),
  );
  return addressReverseNode;
}

/**
 * Get display name for a wallet address
 * Resolution chain: 1) Farcaster → 2) Basename → 3) ENS → 4) Abbreviated address
 */
export async function getDisplayName(address: string): Promise<string> {
  try {
    console.log(`🔍 Starting name resolution for address: ${address}`);

    // Check cache first
    const cached = displayNameCache.get(address.toLowerCase());
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      console.log(`📋 Using cached name for ${address}: ${cached.name}`);
      return cached.name;
    }

    let resolvedName = null;

    // Try Farcaster resolution first (preferred for social interactions)
    console.log(`🎭 Attempting Farcaster resolution for ${address}...`);
    try {
      resolvedName = await resolveFarcaster(address);
      if (resolvedName) {
        console.log(`✅ Resolved ${address} to Farcaster: ${resolvedName}`);
      } else {
        console.log(`⚠️ No Farcaster username found for ${address}`);
      }
    } catch (error) {
      console.log(`⚠️ Farcaster resolution failed for ${address}:`, error);
    }

    // If no Farcaster, try Basename resolution
    if (!resolvedName) {
      console.log(`🏷️ Attempting Basename resolution for ${address}...`);
      try {
        resolvedName = await resolveBasename(address);
        if (resolvedName) {
          console.log(`✅ Resolved ${address} to Basename: ${resolvedName}`);
        } else {
          console.log(`⚠️ No Basename found for ${address}`);
        }
      } catch (error) {
        console.log(`⚠️ Basename resolution failed for ${address}:`, error);
      }
    }

    // If no Basename, try ENS resolution
    if (!resolvedName) {
      console.log(`🌐 Attempting ENS resolution for ${address}...`);
      try {
        resolvedName = await resolveENS(address);
        if (resolvedName) {
          console.log(`✅ Resolved ${address} to ENS: ${resolvedName}`);
        } else {
          console.log(`⚠️ No ENS name found for ${address}`);
        }
      } catch (error) {
        console.log(`⚠️ ENS resolution failed for ${address}:`, error);
      }
    }

    // Fallback to formatted address
    const finalName = resolvedName || formatFallbackName(address);
    console.log(`🏁 Final resolved name for ${address}: ${finalName}`);

    // Cache the result
    displayNameCache.set(address.toLowerCase(), {
      name: finalName,
      timestamp: Date.now(),
    });

    return finalName;
  } catch (error) {
    console.warn(`Failed to resolve display name for ${address}:`, error);
    return formatFallbackName(address);
  }
}

/**
 * Resolve ENS name for a wallet address using public ENS resolver with timeout
 */
async function resolveENS(address: string): Promise<string | null> {
  try {
    // Use viem to resolve ENS from Ethereum mainnet
    const { createPublicClient, http } = await import("viem");
    const { mainnet } = await import("viem/chains");

    const mainnetClient = createPublicClient({
      chain: mainnet,
      transport: http("https://eth-mainnet.g.alchemy.com/v2/demo"), // Public endpoint
    });

    console.log(`🔍 Resolving ENS for address: ${address}`);

    // Create timeout promise (3 seconds)
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => {
        console.log(`⏱️ ENS resolution timeout for ${address}`);
        resolve(null);
      }, 3000);
    });

    // Race between ENS resolution and timeout
    const ensName = await Promise.race([
      mainnetClient.getEnsName({
        address: address as `0x${string}`,
      }),
      timeoutPromise,
    ]);

    if (ensName && ensName.endsWith(".eth")) {
      console.log(`✅ Resolved ${address} via ENS: ${ensName}`);
      return ensName;
    } else if (ensName) {
      console.log(`✅ Resolved ${address} via ENS (non-.eth): ${ensName}`);
      return ensName;
    }
  } catch (error) {
    console.log(`⚠️ ENS resolution error for ${address}:`, error);
  }

  return null;
}

/**
 * Resolve Basename for a wallet address using viem ENS resolution
 */
async function resolveBasename(address: string): Promise<string | null> {
  try {
    // Use viem to resolve basename from Base blockchain
    const { createPublicClient, http } = await import("viem");
    const { base } = await import("viem/chains");

    const publicClient = createPublicClient({
      chain: base,
      transport: http("https://mainnet.base.org"),
    });

    console.log(`🔍 Resolving Basename for address: ${address}`);

    // Use Base L2 resolver with proper reverse node calculation (from Base tutorial)
    try {
      // Base L2 Resolver contract address - mainnet
      // From Base docs: https://docs.base.org/base-account/basenames/basenames-wagmi-tutorial
      const BASENAME_L2_RESOLVER_ADDRESS =
        "0xC6d566A56A1aFf6508b41f6c90ff131615583BCD"; // Mainnet L2Resolver

      // Convert address to reverse node (proper ENS reverse resolution)
      const addressReverseNode = await convertReverseNodeToBytes(
        address,
        base.id,
      );
      console.log(
        `🔍 Generated reverse node for ${address}: ${addressReverseNode}`,
      );

      const basename = await publicClient.readContract({
        abi: [
          {
            inputs: [{ name: "node", type: "bytes32" }],
            name: "name",
            outputs: [{ name: "", type: "string" }],
            stateMutability: "view",
            type: "function",
          },
        ],
        address: BASENAME_L2_RESOLVER_ADDRESS as `0x${string}`,
        functionName: "name",
        args: [addressReverseNode],
      });

      console.log(`🔍 L2Resolver response for ${address}:`, basename);

      if (basename && typeof basename === "string" && basename.length > 0) {
        console.log(`✅ Resolved ${address} via Base L2 resolver: ${basename}`);
        return basename;
      }
    } catch (resolverError) {
      console.log(`⚠️ Base L2 resolver failed for ${address}:`, resolverError);
    }

    // Try ReverseRegistrar approach with proper mainnet addresses
    try {
      // ReverseRegistrar from basenames repo (mainnet)
      const REVERSE_REGISTRAR = "0x79EA96012eEa67A83431F1701B3dFf7e37F9E282"; // Mainnet ReverseRegistrar
      const MAINNET_L2_RESOLVER = "0xC6d566A56A1aFf6508b41f6c90ff131615583BCD"; // Mainnet L2Resolver

      // Get the reverse record for this address
      const reverseRecord = await publicClient.readContract({
        address: REVERSE_REGISTRAR as `0x${string}`,
        abi: [
          {
            inputs: [{ name: "addr", type: "address" }],
            name: "node",
            outputs: [{ name: "", type: "bytes32" }],
            stateMutability: "pure",
            type: "function",
          },
        ],
        functionName: "node",
        args: [address as `0x${string}`],
      });

      if (reverseRecord) {
        console.log(`🔍 Got reverse record for ${address}: ${reverseRecord}`);

        // Now try to resolve this node to a name using the L2Resolver
        const resolvedName = await publicClient.readContract({
          address: MAINNET_L2_RESOLVER as `0x${string}`,
          abi: [
            {
              inputs: [{ name: "node", type: "bytes32" }],
              name: "name",
              outputs: [{ name: "", type: "string" }],
              stateMutability: "view",
              type: "function",
            },
          ],
          functionName: "name",
          args: [reverseRecord],
        });

        if (
          resolvedName &&
          typeof resolvedName === "string" &&
          resolvedName.length > 0
        ) {
          console.log(
            `✅ Resolved ${address} via ReverseRegistrar: ${resolvedName}`,
          );
          return resolvedName;
        }
      }
    } catch (reverseError) {
      console.log(
        `⚠️ ReverseRegistrar approach failed for ${address}:`,
        reverseError,
      );
    }

    // Try Base Registry contract for reverse resolution
    try {
      // Base Registry contract from basenames repo
      const BASE_REGISTRY = "0x1C8b7c5f8b9b1c1e5c8b1c1e5c8b1c1e5c8b1c1e"; // This would be the actual registry address

      // Try multiple Basename API endpoints
      const endpoints = [
        `https://resolver-api.basename.app/v1/reverse-lookup?address=${address}`,
        `https://api.basename.app/v1/reverse/${address}`,
        `https://basename.app/api/reverse/${address}`,
        `https://www.base.org/api/v1/reverse/${address}`,
        `https://base.org/api/names/reverse/${address}`,
      ];

      for (const endpoint of endpoints) {
        try {
          const response = await fetch(endpoint, {
            headers: {
              Accept: "application/json",
              "User-Agent": "MegaPot-Agent/1.0",
            },
          });

          if (response.ok) {
            const data = await response.json();
            console.log(
              `🔍 Response from ${endpoint}:`,
              JSON.stringify(data, null, 2),
            );

            // Check various possible response formats
            if (data.name && data.name.endsWith(".base.eth")) {
              console.log(
                `✅ Resolved ${address} via ${endpoint}: ${data.name}`,
              );
              return data.name;
            } else if (data.basename && data.basename.endsWith(".base.eth")) {
              console.log(
                `✅ Resolved ${address} via ${endpoint}: ${data.basename}`,
              );
              return data.basename;
            } else if (
              data.data &&
              data.data.name &&
              data.data.name.endsWith(".base.eth")
            ) {
              console.log(
                `✅ Resolved ${address} via ${endpoint}: ${data.data.name}`,
              );
              return data.data.name;
            } else if (data.result && data.result.endsWith(".base.eth")) {
              console.log(
                `✅ Resolved ${address} via ${endpoint}: ${data.result}`,
              );
              return data.result;
            } else if (typeof data === "string" && data.endsWith(".base.eth")) {
              console.log(`✅ Resolved ${address} via ${endpoint}: ${data}`);
              return data;
            }
          } else {
            console.log(
              `⚠️ ${endpoint} returned ${response.status} for ${address}`,
            );
          }
        } catch (endpointError) {
          console.log(`⚠️ ${endpoint} failed for ${address}:`, endpointError);
        }
      }
    } catch (apiError) {
      console.log(`⚠️ Basename API attempts failed for ${address}:`, apiError);
    }

    // Try Base.org API as final fallback
    try {
      const response = await fetch(
        `https://www.base.org/api/v1/reverse/${address}`,
        {
          headers: {
            Accept: "application/json",
            "User-Agent": "MegaPot-Agent/1.0",
          },
        },
      );

      if (response.ok) {
        const data = await response.json();
        if (data.name && data.name.endsWith(".base.eth")) {
          console.log(`✅ Resolved ${address} via Base.org API: ${data.name}`);
          return data.name;
        }
      } else {
        console.log(
          `⚠️ Base.org API returned ${response.status} for ${address}`,
        );
      }
    } catch (apiError) {
      console.log(`⚠️ Base.org API failed for ${address}:`, apiError);
    }

    console.log(`⚠️ No Basename found for ${address}`);
  } catch (error) {
    console.log(`⚠️ Basename resolution error for ${address}:`, error);
  }

  return null;
}

/**
 * Resolve Farcaster username for a wallet address via Neynar SDK
 */
async function resolveFarcaster(address: string): Promise<string | null> {
  try {
    const neynarApiKey = process.env.NEYNAR_API_KEY;
    if (!neynarApiKey) {
      console.log(`⚠️ No NEYNAR_API_KEY set for Farcaster resolution`);
      return null;
    }

    // Use the working Neynar SDK pattern
    const { NeynarAPIClient, Configuration } = await import(
      "@neynar/nodejs-sdk"
    );

    const config = new Configuration({
      apiKey: neynarApiKey,
    });
    const client = new NeynarAPIClient(config);

    console.log(`🔍 Neynar SDK: Looking up user by address ${address}`);

    // Try fetchBulkUsersByEthOrSolAddress first
    let response;
    try {
      response = await client.fetchBulkUsersByEthOrSolAddress({
        addresses: [address],
      });
      console.log(
        `🔍 Neynar bulk response for ${address}: Found ${Object.keys(response).length} address entries`,
      );

      // Log the actual response structure for debugging
      if (Object.keys(response).length > 0) {
        console.log(`🔍 Response keys:`, Object.keys(response));
        console.log(`🔍 Full response:`, JSON.stringify(response, null, 2));
      }
    } catch (bulkError) {
      console.log(
        `⚠️ Bulk lookup failed for ${address}:`,
        bulkError instanceof Error ? bulkError.message : String(bulkError),
      );

      // Check if it's a 404 (user not found) vs other errors
      if (
        bulkError &&
        typeof bulkError === "object" &&
        "status" in bulkError &&
        bulkError.status === 404
      ) {
        console.log(
          `📝 Address ${address} not found in Farcaster (404) - likely not a Farcaster user`,
        );
        return null; // Skip fallback attempts for confirmed non-users
      }

      // For other errors, try direct API call
      try {
        const directResponse = await fetch(
          `https://api.neynar.com/v2/farcaster/user/bulk-by-address?addresses=${address}`,
          {
            headers: {
              accept: "application/json",
              "x-api-key": neynarApiKey,
            },
          },
        );

        if (directResponse.ok) {
          const directData = await directResponse.json();
          console.log(
            `🔍 Neynar direct API success:`,
            JSON.stringify(directData, null, 2),
          );
          response = directData;
        } else if (directResponse.status === 404) {
          console.log(
            `📝 Direct API confirms: ${address} not a Farcaster user (404)`,
          );
          return null;
        } else {
          console.log(
            `⚠️ Direct API call failed with status ${directResponse.status}`,
          );
          return null;
        }
      } catch (directError) {
        console.log(`⚠️ Direct API call also failed:`, directError);
        return null;
      }
    }

    // Check response structure - fetchBulkUsersByEthOrSolAddress returns object with address as key
    if (response && response[address.toLowerCase()]) {
      const users = response[address.toLowerCase()];
      if (users && users.length > 0) {
        const user = users[0];
        console.log(`👤 Found user data:`, JSON.stringify(user, null, 2));

        if (user.display_name && user.display_name.trim()) {
          console.log(`✅ Using Farcaster display_name: ${user.display_name}`);
          return user.display_name;
        } else if (user.username && user.username.trim()) {
          console.log(`✅ Using Farcaster username: ${user.username}`);
          return user.username;
        } else {
          console.log(
            `⚠️ User found but no display_name or username available`,
          );
        }
      }
    }

    // Also try the address as-is (case sensitive)
    if (response && response[address]) {
      const users = response[address];
      if (users && users.length > 0) {
        const user = users[0];
        if (user.display_name && user.display_name.trim()) {
          return user.display_name;
        } else if (user.username && user.username.trim()) {
          return user.username;
        }
      }
    }

    console.log(`❌ No users found in Neynar response for address: ${address}`);
  } catch (error) {
    console.log(`⚠️ Neynar SDK error for ${address}:`, error);
  }

  return null;
}

/**
 * Format address as fallback display name
 * Creates a more friendly representation of wallet addresses with @ mention
 */
function formatFallbackName(address: string): string {
  if (!address || address.length < 8) {
    return "User";
  }

  // Create a mention-style format: @first6...last4
  const friendlyAddress = `@${address.slice(0, 6)}...${address.slice(-4)}`;

  console.log(
    `📝 Using fallback address format for ${address}: ${friendlyAddress}`,
  );

  return friendlyAddress;
}

/**
 * Get greeting with display name
 */
export async function getPersonalizedGreeting(
  address: string,
): Promise<string> {
  try {
    const displayName = await getDisplayName(address);

    // Use the friendly display name for greeting
    if (displayName && displayName !== "User") {
      return `Good morning, ${displayName}!`;
    } else {
      return "Good morning!";
    }
  } catch (error) {
    console.warn("Error getting personalized greeting:", error);
    return "Good morning!";
  }
}

/**
 * Create mention-style name for group messages
 */
export async function getMentionName(address: string): Promise<string> {
  try {
    const displayName = await getDisplayName(address);

    // Format as mention - fallback already includes @
    if (displayName && displayName !== "User" && !displayName.startsWith("@")) {
      return `@${displayName}`;
    } else {
      // Fallback already includes @ prefix
      return displayName;
    }
  } catch (error) {
    console.warn("Error getting mention name:", error);
    return formatFallbackName(address);
  }
}

/**
 * Batch resolve multiple addresses to display names
 */
export async function getDisplayNames(
  addresses: string[],
): Promise<Map<string, string>> {
  const nameMap = new Map<string, string>();

  // Resolve names in parallel for better performance
  const promises = addresses.map(async (address) => {
    const name = await getDisplayName(address);
    nameMap.set(address.toLowerCase(), name);
  });

  await Promise.all(promises);
  return nameMap;
}
