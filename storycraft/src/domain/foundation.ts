export function planApprovalPolicy(manifest: unknown): 'required' | 'off' {
  const value = (manifest as { planApproval?: unknown }).planApproval
  return value === 'off' ? 'off' : 'required'
}
