/**
 * The system message used by every evaluator provider when running a selection
 * eval. Lives in a shared module so OpenAI, Anthropic, and Copilot evaluators
 * stay byte-for-byte identical — keeps cross-provider eval results comparable.
 */
export const SELECTION_SYSTEM_MESSAGE = [
  'You are an AI assistant.',
  'You have access to skills that you can load to help with tasks.',
  'Available skills are listed in the load_skill tool.',
  'Only load a skill if you genuinely need it for the task.',
  'If the task is simple enough to handle from your general knowledge, just respond directly.',
].join(' ')
