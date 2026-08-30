/**
 * Dual-ruler call-id brand: host master renamed the dsh-llm `CallId`
 * brand to `ToolCallId` (and dropped the old value export), while the
 * published 0.1.1-rc.2 line still exports `CallId`. Derive the brand
 * from the dsh-tools execution contract so the package stays green on
 * both rulers without naming either brand name.
 * @module dsh-lsp-actions/call-id
 */

import type { ToolExecution } from '@deepseek-ai/dsh-tools'

export type CallId = ToolExecution['callId']
export const CallId = ((id: string) => id) as unknown as (id: string) => ToolExecution['callId']
