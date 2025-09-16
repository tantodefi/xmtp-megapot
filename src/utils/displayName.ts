// Simple display name cache to avoid repeated API calls
const displayNameCache = new Map<string, { name: string; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Get display name for a wallet address
 * Tries multiple resolution methods: Farcaster first, then Basename, then ENS, then fallback
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

    // If no Farcaster, try Basename
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

    // If no Basename, try ENS reverse resolution
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
 * Resolve ENS name for a wallet address using public ENS resolver
 */
async function resolveENS(address: string): Promise<string | null> {
  try {
    // Try Ethereum mainnet ENS resolution using public APIs
    const endpoints = [
      `https://api.ensdata.net/${address}`,
      `https://api.ens.domains/name/${address}/reverse`,
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          headers: {
            Accept: "application/json",
          },
        });

        if (response.ok) {
          const data = await response.json();
          const ensName = data.name || data.ens || data.reverse;
          if (ensName && ensName.endsWith(".eth")) {
            console.log(
              `✅ Resolved ${address} to ENS: ${ensName} via ${endpoint}`,
            );
            return ensName;
          }
        }
      } catch (endpointError) {
        console.log(`⚠️ ENS endpoint ${endpoint} failed:`, endpointError);
        continue; // Try next endpoint
      }
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

    // Try direct Basename API (more reliable than viem ENS on Base)
    try {
      const basenameResponse = await fetch(
        `https://api.basename.app/v1/name/${address}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        },
      );

      if (basenameResponse.ok) {
        const basenameData = await basenameResponse.json();
        if (basenameData.name && basenameData.name.endsWith(".base.eth")) {
          console.log(
            `✅ Resolved ${address} via Basename API: ${basenameData.name}`,
          );
          return basenameData.name;
        }
      } else {
        console.log(
          `⚠️ Basename API returned ${basenameResponse.status}: ${basenameResponse.statusText}`,
        );
      }
    } catch (apiError) {
      console.log(`⚠️ Basename API failed for ${address}:`, apiError);
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

    // Use the correct Neynar SDK configuration pattern
    const { NeynarAPIClient, Configuration } = await import(
      "@neynar/nodejs-sdk"
    );

    const config = new Configuration({
      apiKey: neynarApiKey,
    });
    const client = new NeynarAPIClient(config);

    console.log(`🔍 Neynar SDK: Looking up user by address ${address}`);

    // Use fetchBulkUsersByEthOrSolAddress as documented
    const response = await client.fetchBulkUsersByEthOrSolAddress({
      addresses: [address],
    });

    console.log(
      `🔍 Neynar SDK response for ${address}:`,
      JSON.stringify(response, null, 2),
    );

    // Check response structure - it should be an object with address as key
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
 * Creates a more friendly representation of wallet addresses
 */
function formatFallbackName(address: string): string {
  if (!address || address.length < 8) {
    return "User";
  }

  // Create a more friendly format: first 6 + last 4 chars
  const friendlyAddress = `${address.slice(0, 6)}...${address.slice(-4)}`;

  // No hardcoded mappings - let the real API resolution work

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

    // Format as mention
    if (displayName && displayName !== "User") {
      return `@${displayName}`;
    } else {
      // Use formatted address for mention
      return `@${formatFallbackName(address)}`;
    }
  } catch (error) {
    console.warn("Error getting mention name:", error);
    return `@${formatFallbackName(address)}`;
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
