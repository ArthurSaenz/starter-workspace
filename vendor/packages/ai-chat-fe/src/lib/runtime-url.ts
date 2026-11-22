// Single-sourced for every chat surface. Same-origin: CloudFront /api/v1* → REST API GW →
// the ai-api copilotkit Lambda, which admits only a signed-in traveller (session cookie).
export const AI_CHAT_RUNTIME_URL = '/api/v1/ai/copilotkit'
