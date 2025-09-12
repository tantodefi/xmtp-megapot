import {
  ContentTypeId,
  type ContentCodec,
  type EncodedContent,
} from "@xmtp/content-type-primitives";

/**
 * Content Type ID for Intent messages
 * Used for handling inline action responses
 */
export const ContentTypeIntent = new ContentTypeId({
  authorityId: "coinbase.com",
  typeId: "intent",
  versionMajor: 1,
  versionMinor: 0,
});

/**
 * Intent content structure for handling action responses
 */
export type IntentContent = {
  /** ID of the actions message this intent is responding to */
  id: string;
  /** ID of the action that was selected */
  actionId: string;
};

/**
 * Intent codec for encoding/decoding Intent messages
 */
export class IntentCodec implements ContentCodec<IntentContent> {
  get contentType(): ContentTypeId {
    return ContentTypeIntent;
  }

  encode(content: IntentContent): EncodedContent {
    this.validateContent(content);

    return {
      type: ContentTypeIntent,
      parameters: { encoding: "UTF-8" },
      content: new TextEncoder().encode(JSON.stringify(content)),
    };
  }

  decode(content: EncodedContent): IntentContent {
    const encoding = content.parameters.encoding;
    if (encoding && encoding !== "UTF-8") {
      throw new Error(`unrecognized encoding ${encoding}`);
    }

    const decodedContent = new TextDecoder().decode(content.content);
    try {
      const parsed = JSON.parse(decodedContent) as IntentContent;
      this.validateContent(parsed);
      return parsed;
    } catch (error) {
      throw new Error(`Failed to decode Intent content: ${error}`);
    }
  }

  fallback(content: IntentContent): string {
    return `Action selected: ${content.actionId} from actions ${content.id}`;
  }

  shouldPush(): boolean {
    return true;
  }

  /**
   * Validates Intent content
   */
  private validateContent(content: IntentContent): void {
    if (!content.id || typeof content.id !== "string") {
      throw new Error("Intent.id is required and must be a string");
    }

    if (!content.actionId || typeof content.actionId !== "string") {
      throw new Error("Intent.actionId is required and must be a string");
    }
  }
}
