/**
 * One word list for machine-flavoured prose.
 *
 * The checker and the deterministic polish rules read the same list: if they
 * drift, a chapter can be "clean" for one and "no work" for the other — which is
 * exactly the bug this module prevents.
 */

/** Openers that can be deleted mechanically at a sentence start. */
export const OPENERS = ['综上所述', '值得注意的是', '不可否认', '不难看出'] as const

/** Everything the checker counts as machine flavour; the openers are a subset. */
export const MACHINE_PHRASES = [
  ...OPENERS,
  '不禁',
  '仿佛',
  '空气仿佛凝固',
  '心中五味杂陈',
  '如同一场梦',
  '在这个瞬间',
  '与此同时',
  '无声地诉说',
  '不易察觉',
  '缓缓地',
  '微微',
  '轻轻地',
  '深深地',
  '不由自主',
  '若有所思',
  '意味深长',
  '难以言喻',
  '不知为何',
  '毫无疑问',
  '一时间',
] as const
