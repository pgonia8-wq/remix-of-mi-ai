/** Whether a chat model can receive images: declared "vision" capability, or a model family known to accept images. */
const VISION_FAMILIES = /gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-5|gpt-6|(^|[-_])o[34]([-_]|$)|vision|claude|gemini|grok-[\w.-]*vision|grok-4|qwen[\w.-]*vl|qvq|pixtral|llava|llama-?4|kimi[\w.-]*vl|phi-4-multimodal|mistral-medium|mistral-small-3/i;
export function canSeeImages(capabilities: string[], modelName: string): boolean {
  return capabilities.includes("vision") || VISION_FAMILIES.test(modelName);
}
