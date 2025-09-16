// Simple display name cache to avoid repeated API calls
const displayNameCache = new Map<string, { name: string; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Get display name for a wallet address
 * For now, uses a simple fallback approach until Neynar integration is properly configured
 * Falls back to formatted address
 */
export async function getDisplayName(address: string): Promise<string> {
  try {
    // Check cache first
    const cached = displayNameCache.get(address.toLowerCase());
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.name;
    }

    // TODO: Implement Neynar API integration when properly configured
    // For now, try to create a more friendly name from the address
    const formattedName = formatFallbackName(address);

    // Cache the result
    displayNameCache.set(address.toLowerCase(), {
      name: formattedName,
      timestamp: Date.now(),
    });

    return formattedName;
  } catch (error) {
    console.warn(`Failed to resolve display name for ${address}:`, error);
    return formatFallbackName(address);
  }
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
