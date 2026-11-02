/** Architect submission schema: exact payload keys per stage. */

export const ARCHITECT_STAGE_SPEC: Record<string, { keys: string[], label: string }> = {
  design: { keys: ['storyFrame', 'volumeMap', 'currentFocus', 'bookRules', 'rolesIndex'], label: 'design' },
  outline: { keys: ['storyFrame', 'volumeMap', 'currentFocus'], label: 'outline' },
  details: { keys: ['bookRules', 'pendingHooks'], label: 'details' },
  cast_index: { keys: ['rolesIndex'], label: 'cast_index' },
  frame: { keys: ['storyFrame', 'volumeMap', 'currentFocus'], label: 'frame' },
  rules: { keys: ['bookRules'], label: 'rules' },
  hooks: { keys: ['pendingHooks'], label: 'hooks' },
  roles: { keys: ['rolesIndex'], label: 'roles' },
  cards: { keys: ['roleCards'], label: 'cards' },
}
