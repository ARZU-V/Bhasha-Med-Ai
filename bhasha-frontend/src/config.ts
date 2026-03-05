export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';
export const DEMO_USER_ID = 'demo-user-123';
export const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY || '';

// Bedrock Agent invoker — use Lambda Function URL to bypass API GW 29s timeout
// Set VITE_BEDROCK_AGENT_URL to your Lambda Function URL after running deploy.sh
// Falls back to API_BASE/bedrock-agent if not set
export const BEDROCK_AGENT_URL = import.meta.env.VITE_BEDROCK_AGENT_URL || `${API_BASE}/bedrock-agent`;
