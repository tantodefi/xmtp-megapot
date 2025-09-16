// Simple display name cache to avoid repeated API calls
const displayNameCache = new Map<string, { name: string; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Get display name for a wallet address
 * Tries multiple resolution methods: Basename, Farcaster, then fallback
 */
export async function getDisplayName(address: string): Promise<string> {
  try {
    // Check cache first
    const cached = displayNameCache.get(address.toLowerCase());
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.name;
    }

    let resolvedName = null;

    // Try Basename resolution first
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

    // If no Basename, try Farcaster
    if (!resolvedName) {
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
    }

    // Fallback to formatted address
    const finalName = resolvedName || formatFallbackName(address);

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
 * Resolve Basename for a wallet address
 */
async function resolveBasename(address: string): Promise<string | null> {
  try {
    // Use Base's public resolver to check for Basename
    const response = await fetch(
      `https://api.basenames.org/v1/name/${address}`,
      {
        headers: {
          Accept: "application/json",
        },
      },
    );

    if (response.ok) {
      const data = await response.json();
      if (data.name && data.name.endsWith(".base.eth")) {
        return data.name;
      }
    }
  } catch (error) {
    // Basename resolution failed, will fallback
  }

  return null;
}

/**
 * Resolve Farcaster username for a wallet address via Neynar API
 */
async function resolveFarcaster(address: string): Promise<string | null> {
  try {
    const neynarApiKey = process.env.NEYNAR_API_KEY;
    if (!neynarApiKey) {
      return null; // No API key available
    }

    const response = await fetch(
      `https://api.neynar.com/v2/farcaster/user/bulk-by-address?addresses=${address}`,
      {
        headers: {
          Accept: "application/json",
          api_key: neynarApiKey,
        },
      },
    );

    if (response.ok) {
      const data = await response.json();
      // Neynar returns an object with address as key
      const userList = data[address.toLowerCase()];
      if (userList && userList.length > 0 && userList[0].username) {
        return userList[0].username;
      }
    }
  } catch (error) {
    // Farcaster resolution failed, will fallback
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

  // Try to create a Basename-style name or use truncated address
  // Future: Integrate with Basename API and Neynar for real display names
  const shortAddress = address.slice(2, 6).toLowerCase(); // Remove 0x and take next 4 chars

  // Create a more friendly format: first 4 + last 4 chars
  const friendlyAddress = `${address.slice(0, 6)}...${address.slice(-4)}`;
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
