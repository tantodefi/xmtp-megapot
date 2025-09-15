import OpenAI from "openai";
import { MegaPotManager } from "../managers/MegaPotManager.js";

export interface MessageIntent {
  type:
    | "buy_tickets"
    | "check_stats"
    | "jackpot_info"
    | "claim_winnings"
    | "help"
    | "greeting"
    | "general_inquiry"
    | "pooled_purchase"
    | "unknown";
  confidence: number;
  extractedData?: {
    ticketCount?: number;
    amount?: number;
    pooledRequest?: boolean;
  };
  response: string;
}

export class SmartHandler {
  private openai: OpenAI;
  private megaPotManager: MegaPotManager;

  constructor(openaiApiKey: string, megaPotManager: MegaPotManager) {
    this.openai = new OpenAI({ apiKey: openaiApiKey });
    this.megaPotManager = megaPotManager;
  }

  /**
   * Parse user message using LLM and determine intent with contextual response
   */
  async parseMessageIntent(
    message: string,
    userAddress?: string,
    isGroupChat: boolean = false,
  ): Promise<MessageIntent> {
    try {
      // Fetch current lottery data for context
      const lotteryStats = await this.megaPotManager.getStats(userAddress);
      const allTimeStats = await this.fetchAllTimeStats();

      // Create context for the LLM
      const contextPrompt = this.buildContextPrompt(
        lotteryStats,
        allTimeStats,
        isGroupChat,
      );

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: contextPrompt,
          },
          {
            role: "user",
            content: message,
          },
        ],
        temperature: 0.3,
        max_tokens: 500,
      });

      const response =
        completion.choices[0]?.message?.content ||
        "I'm here to help with MegaPot lottery! Try asking about buying tickets, checking stats, or jackpot info.";

      // Parse the LLM response to extract intent and data
      const intent = this.extractIntentFromResponse(response, message);

      return {
        ...intent,
        response: this.formatResponse(response, intent.type, lotteryStats),
      };
    } catch (error) {
      console.error("❌ Error parsing message intent:", error);

      // Fallback to rule-based parsing
      const fallbackIntent = this.fallbackIntentParsing(message);
      return {
        ...fallbackIntent,
        response:
          "I'm having trouble processing your request right now, but I can still help! " +
          fallbackIntent.response,
      };
    }
  }

  /**
   * Build context prompt for the LLM with current lottery data
   */
  private buildContextPrompt(
    lotteryStats: any,
    allTimeStats: any,
    isGroupChat: boolean,
  ): string {
    const groupChatInfo = isGroupChat
      ? "\n- This is a GROUP CHAT. Users can organize POOLED TICKET PURCHASES where multiple people contribute to buy tickets together."
      : "\n- This is a DIRECT MESSAGE conversation.";

    return `You are MegaPot, an AI assistant for a lottery system on Base blockchain. Your role is to:

1. ANALYZE user messages and determine their intent
2. PROVIDE helpful, concise responses (max 2-3 sentences)
3. GUIDE users toward appropriate actions
4. EXTRACT numerical data when users mention ticket quantities

CURRENT LOTTERY DATA:
- Jackpot: $${lotteryStats.jackpotPool || "0"}
- Ticket Price: $${lotteryStats.ticketPrice || "1.00"} USDC
- Tickets Sold: ${lotteryStats.ticketsSoldRound || 0}
- Active Players: ${lotteryStats.activePlayers || 0}
- User's Total Tickets: ${lotteryStats.totalTicketsPurchased || 0}
- User's Spending: ${lotteryStats.totalSpent || "$0"}

ALL-TIME STATS:
- Total Jackpots: $${allTimeStats?.JackpotsRunTotal_USD?.toLocaleString() || "179,816,793"}
- Total Players: ${allTimeStats?.total_players?.toLocaleString() || "14,418"}
- Total Tickets: ${allTimeStats?.total_tickets?.toLocaleString() || "282,495"}
- Total Winners: ${allTimeStats?.total_won || "19"}

${groupChatInfo}

RESPONSE RULES:
- Keep responses SHORT and actionable (2-3 sentences max)
- For ticket purchases, extract the number and confirm the action
- For stats requests, provide relevant current data
- For jackpot inquiries, give current pool and ticket price
- For greetings, welcome them and show key actions
- For pooled purchases in groups, explain how multiple people can contribute
- Always end with a clear next step or action button reference

INTENT CATEGORIES:
- buy_tickets: User wants to purchase tickets (extract quantity)
- check_stats: User wants to see their statistics
- jackpot_info: User wants jackpot/prize information  
- claim_winnings: User wants to claim prizes
- help: User needs assistance or commands
- greeting: User says hello/hi/gm
- pooled_purchase: User mentions group/pool/together ticket buying
- general_inquiry: Questions about lottery mechanics
- unknown: Unclear intent

Respond naturally but concisely, and I'll handle the specific actions.`;
  }

  /**
   * Extract intent from LLM response
   */
  private extractIntentFromResponse(
    response: string,
    originalMessage: string,
  ): Omit<MessageIntent, "response"> {
    const lowerResponse = response.toLowerCase();
    const lowerMessage = originalMessage.toLowerCase();

    // Extract ticket numbers from original message
    const ticketMatch = originalMessage.match(
      /(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty)\s*tickets?/i,
    );
    const numberMatch = originalMessage.match(/\b(\d+)\b/);

    let ticketCount: number | undefined;
    if (ticketMatch) {
      const ticketStr = ticketMatch[1].toLowerCase();
      ticketCount = this.parseNumberFromText(ticketStr);
    } else if (numberMatch) {
      ticketCount = parseInt(numberMatch[1]);
    }

    // Determine intent based on message content
    if (
      lowerMessage.includes("buy") &&
      (lowerMessage.includes("ticket") || ticketCount)
    ) {
      return {
        type: "buy_tickets",
        confidence: 0.9,
        extractedData: { ticketCount },
      };
    }

    if (
      lowerMessage.includes("pool") ||
      lowerMessage.includes("group") ||
      lowerMessage.includes("together")
    ) {
      return {
        type: "pooled_purchase",
        confidence: 0.8,
        extractedData: { pooledRequest: true, ticketCount },
      };
    }

    if (
      lowerMessage.includes("stat") ||
      (lowerMessage.includes("ticket") && lowerMessage.includes("my"))
    ) {
      return { type: "check_stats", confidence: 0.8 };
    }

    if (
      lowerMessage.includes("jackpot") ||
      lowerMessage.includes("prize") ||
      lowerMessage.includes("pool")
    ) {
      return { type: "jackpot_info", confidence: 0.8 };
    }

    if (lowerMessage.includes("claim") || lowerMessage.includes("winning")) {
      return { type: "claim_winnings", confidence: 0.8 };
    }

    if (lowerMessage.includes("help") || lowerMessage.includes("command")) {
      return { type: "help", confidence: 0.9 };
    }

    if (
      lowerMessage.includes("hi") ||
      lowerMessage.includes("hello") ||
      lowerMessage.includes("gm") ||
      lowerMessage.includes("hey")
    ) {
      return { type: "greeting", confidence: 0.9 };
    }

    if (
      lowerMessage.includes("how") ||
      lowerMessage.includes("what") ||
      lowerMessage.includes("?")
    ) {
      return { type: "general_inquiry", confidence: 0.7 };
    }

    return { type: "unknown", confidence: 0.3 };
  }

  /**
   * Format response based on intent type
   */
  private formatResponse(
    response: string,
    intentType: string,
    lotteryStats: any,
  ): string {
    const baseResponse =
      response.length > 200 ? response.substring(0, 197) + "..." : response;

    switch (intentType) {
      case "buy_tickets":
        return `${baseResponse}\n\n🎫 Current ticket price: $${lotteryStats.ticketPrice || "1.00"} USDC on Base network.`;

      case "jackpot_info":
        return `${baseResponse}\n\n🎰 Jackpot: $${lotteryStats.jackpotPool || "0"} | Tickets sold: ${lotteryStats.ticketsSoldRound || 0}`;

      case "pooled_purchase":
        return `${baseResponse}\n\n👥 In group chats, multiple members can contribute to buy tickets together!`;

      case "greeting":
        return `${baseResponse}\n\n🌐 Try the full experience: https://frame.megapot.io`;

      default:
        return baseResponse;
    }
  }

  /**
   * Fallback intent parsing using rule-based approach
   */
  private fallbackIntentParsing(
    message: string,
  ): Omit<MessageIntent, "response"> {
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes("buy") && lowerMessage.includes("ticket")) {
      const ticketMatch = message.match(/(\d+)/);
      return {
        type: "buy_tickets",
        confidence: 0.7,
        extractedData: {
          ticketCount: ticketMatch ? parseInt(ticketMatch[1]) : undefined,
        },
      };
    }

    if (lowerMessage.includes("stat") || lowerMessage.includes("my")) {
      return { type: "check_stats", confidence: 0.7 };
    }

    if (lowerMessage.includes("jackpot") || lowerMessage.includes("prize")) {
      return { type: "jackpot_info", confidence: 0.7 };
    }

    if (lowerMessage.includes("help")) {
      return { type: "help", confidence: 0.8 };
    }

    return { type: "unknown", confidence: 0.5 };
  }

  /**
   * Parse number from text (including word numbers)
   */
  private parseNumberFromText(text: string): number | undefined {
    const wordToNumber: { [key: string]: number } = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
      twenty: 20,
      thirty: 30,
      forty: 40,
      fifty: 50,
    };

    const lowerText = text.toLowerCase();
    if (wordToNumber[lowerText]) {
      return wordToNumber[lowerText];
    }

    const parsed = parseInt(text);
    return isNaN(parsed) ? undefined : parsed;
  }

  /**
   * Fetch all-time stats from the new API endpoint
   */
  private async fetchAllTimeStats(): Promise<any> {
    try {
      const response = await fetch(
        "https://api.megapot.io/api/v1/all-time-stats?apikey=7no84S4VwcXViFPjReUM",
      );
      if (response.ok) {
        const data = await response.json();
        return data.data;
      }
    } catch (error) {
      console.error("Failed to fetch all-time stats:", error);
    }

    // Return fallback data
    return {
      JackpotsRunTotal_USD: 179816793,
      total_players: 14418,
      total_tickets: 282495,
      total_won: 19,
    };
  }

  /**
   * Generate contextual help response based on current lottery state
   */
  async generateContextualHelp(
    userAddress?: string,
    isGroupChat: boolean = false,
  ): Promise<string> {
    try {
      const lotteryStats = await this.megaPotManager.getStats(userAddress);
      const allTimeStats = await this.fetchAllTimeStats();

      const groupInfo = isGroupChat
        ? "\n\n👥 **Group Chat Features:**\n• Organize pooled ticket purchases with friends\n• Split costs and share potential winnings"
        : "";

      return `🎰 **MegaPot Lottery Assistant**

**Current Round:**
• Jackpot: $${lotteryStats.jackpotPool || "0"}
• Ticket Price: $${lotteryStats.ticketPrice || "1.00"} USDC
• Your Tickets: ${lotteryStats.totalTicketsPurchased || 0}

**Commands:**
• "buy X tickets" - Purchase lottery tickets
• "stats" - View your statistics  
• "jackpot" - Current round info
• "claim" - Claim winnings

**All-Time Stats:**
• Total Jackpots: $${allTimeStats?.JackpotsRunTotal_USD?.toLocaleString() || "179M+"}
• Winners: ${allTimeStats?.total_won || "19"} lucky players!

${groupInfo}

🌐 Full experience: https://frame.megapot.io`;
    } catch (error) {
      console.error("Error generating contextual help:", error);
      return "🎰 MegaPot Lottery Assistant - I can help you buy tickets, check stats, view jackpot info, and claim winnings!";
    }
  }
}
