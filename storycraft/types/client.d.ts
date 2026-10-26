/**
 * Browser globals the client entry relies on.
 *
 * The Client bundle is not an ES module: DSH loads it through its own module
 * loader, which hands the entry a `require` for the React build it already
 * carries. Only the pieces this bundle touches are declared.
 */

/** Host module loader entry this bundle registers itself with. */
interface DshClientModuleLoader {
  /**
   * Register one client module.
   * @param entry - module id plus the factory that mounts it.
   */
  load(entry: { id: string, factory(require: (name: string) => any): void }): void
}

interface Window {
  /** Harness-provided module loader. */
  __ModuleLoader__: DshClientModuleLoader
}
