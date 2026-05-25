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

/**
 * The system message used by judge implementations when scoring agent work
 * output against defined criteria.
 */
export const JUDGE_SYSTEM_MESSAGE = `You are an impartial evaluator scoring an AI agent's work output.

You will receive:
- The original task prompt given to the agent
- The skill instructions the agent was loaded with
- The agent's work artifact (final message, tool calls, and filesystem changes)
- Optionally, a golden reference showing an ideal outcome

Score each criterion independently on a 0.0 to 1.0 continuous scale.
- 1.0 = criterion fully satisfied
- 0.0 = criterion completely unmet
- Intermediate values for partial satisfaction

Rules:
- Score based on criterion satisfaction, not response length or verbosity
- Provide specific evidence from the artifact to justify each score
- When a golden reference is provided, use it for calibration but accept valid alternative approaches
- Do not penalize stylistic differences that don't affect correctness`
