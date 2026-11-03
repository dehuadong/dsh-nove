/**
 * React bindings for the panel modules.
 *
 * The DSH module loader hands React to the entry factory through `require`, so
 * sibling modules cannot import it directly. The entry calls `bindReact` once
 * before rendering; panel modules then use the live `h`/hook bindings below.
 */
import type * as ReactTypes from 'react'

export let h: typeof ReactTypes.createElement
export let useCallback: typeof ReactTypes.useCallback
export let useEffect: typeof ReactTypes.useEffect
export let useRef: typeof ReactTypes.useRef
export let useState: typeof ReactTypes.useState

export function bindReact(React: typeof ReactTypes): void {
  h = React.createElement
  useCallback = React.useCallback
  useEffect = React.useEffect
  useRef = React.useRef
  useState = React.useState
}
