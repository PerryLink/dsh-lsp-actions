/**
 * The sandbox-escalation API for `lsp_format`: per-call policy resolution, the advertised
 * escalation fields, and denial-marker mapping — delegating the vocabulary and the fail-closed
 * approval sequence to `@deepseek-ai/dsh-sandbox`, exactly as `dsh-tool-fs` does for `write`/`edit`,
 * so formatting escalates identically to the official mutation tools.
 * @module dsh-lsp-actions/sandbox
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SandboxExecutionPolicy, SandboxMode } from '@deepseek-ai/dsh-sandbox'
import { ESCALATION_TARGETS, approveEscalation, escalationHintMarker, sandboxDenialMarker, validateEscalationArgs } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

/** The two escalation arguments `lsp_format` may carry (advertised only under a confining backend). */
export interface FormatEscalationArgs {
  sandbox_permissions?: string
  justification?: string
}

/** The schema fields for the escalation arguments, spread into the tool's `parameters`. */
export interface EscalationSchemaFields {
  sandbox_permissions: { type: 'string'; enum: string[]; description: string }
  justification: { type: 'string'; description: string }
}

/**
 * The formatting escalation API: advertisement gating, per-call policy resolution, the one-approved
 * wider retry, and denial-marker mapping. A pure product of `ctx` at plugin apply time.
 */
export class FormatSandboxController {
  /** The escalation targets this composition advertises (`[]` when no confining backend is mounted). */
  readonly escalationModes: readonly SandboxMode[]
  /** Shared per-session policy resolver, required by a confining backend. */
  private readonly policy: SandboxPolicyService | undefined

  constructor(private readonly ctx: Context) {
    const defaultMode = ctx.fs.sandboxMode
    this.escalationModes = defaultMode === undefined ? [] : ESCALATION_TARGETS
    this.policy = defaultMode === undefined ? undefined : ctx.get('sandboxPolicy')
    if (defaultMode !== undefined && this.policy === undefined) {
      throw new Error('lsp-actions: the mounted filesystem confines but ctx.sandboxPolicy is missing')
    }
  }

  /**
   * The escalation schema fields for `lsp_format`'s `parameters`. Call it only under a confining
   * backend (guard on {@link escalationModes}); the enum pins the closed target vocabulary, the
   * strict-wider check happens per call at execution.
   * @returns the two escalation parameter specs.
   */
  schemaFields(): EscalationSchemaFields {
    return {
      sandbox_permissions: {
        type: 'string',
        enum: [...this.escalationModes],
        description: 'The wider sandbox mode this formatting needs. Only valid as a one-shot retry '
          + 'of an operation the sandbox just denied; requires justification and user approval.',
      },
      justification: {
        type: 'string',
        description: 'Required with sandbox_permissions: one sentence for the user explaining '
          + 'why this exact formatting needs the wider access.',
      },
    }
  }

  /**
   * The policy to stamp onto this formatting: an approved escalation grant (a strictly wider retry
   * resolved through `ctx.approval` before anything executes), else the session's standing mode.
   * The calling session's cwd is always carried as the workspace root. Validates the escalation
   * argument pairing first.
   * @param toolName - the tool's name, for the approval audit trail.
   * @param args - the call's escalation arguments.
   * @param exec - the tool-execution context (agent, callId, signal).
   * @returns the policy to pass to the write, or undefined for an unsandboxed backend.
   */
  async resolvePolicy(toolName: string, args: FormatEscalationArgs, exec: ToolExecution): Promise<SandboxExecutionPolicy | undefined> {
    validateEscalationArgs(args.sandbox_permissions, args.justification)
    const standingPolicy = this.policy?.resolve({ ...exec.agent ? { session: exec.agent.session } : {} })
    if (args.sandbox_permissions === undefined || args.justification === undefined) {
      return standingPolicy
    }
    if (this.escalationModes.length === 0) {
      throw new Error('sandbox_permissions is not available in this composition (no sandboxing filesystem to escalate)')
    }
    const policy = standingPolicy as SandboxExecutionPolicy
    const approvedMode = await approveEscalation(
      { requestedMode: args.sandbox_permissions, justification: args.justification, effectiveMode: policy.mode, subject: 'operation' },
      {
        approver: this.ctx.get('approval'),
        agent: exec.agent,
        callId: exec.callId,
        toolName,
        signal: exec.signal,
      },
    )
    return { ...policy, mode: approvedMode }
  }

  /**
   * Map a thrown provider error for the model: a `FS_SANDBOX_DENIED` becomes an `FsError` whose
   * text is the shared `[sandbox: …]` denial marker plus the same-turn escalation hint, so a policy
   * denial reads identically to bash's WHILE keeping the structured `FS_SANDBOX_DENIED` code.
   * @param error - the error thrown by the write.
   * @param policy - the policy stamped onto the call (names the mode in the marker).
   * @returns the error to throw — the marker `FsError` for a sandbox denial, else the original.
   */
  mapError(error: unknown, policy: SandboxExecutionPolicy | undefined): unknown {
    if (!(error instanceof FsError) || error.code !== 'FS_SANDBOX_DENIED') return error
    // A FS_SANDBOX_DENIED only arises under a confining backend, whose tool path always resolves a
    // policy before the write.
    const mode = (policy as SandboxExecutionPolicy).mode
    return new FsError(`${sandboxDenialMarker(mode)}\n${escalationHintMarker('operation')}`, 'FS_SANDBOX_DENIED', { cause: error })
  }
}
