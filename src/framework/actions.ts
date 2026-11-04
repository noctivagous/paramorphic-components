/** Named actions refer to registered operations and optional parameters. */
export type ActionSpec = { id: string; do: string; target?: string; value?: unknown };
export type ActionContext = {
  openDialog?: (target: string) => void | Promise<void>;
  closeDialog?: (target: string) => void | Promise<void>;
  chooseFolder?: (target: string) => void | Promise<void>;
  useSample?: (target: string) => void | Promise<void>;
  select?: (target: string) => void | Promise<void>;
  navigate?: (target: string) => void | Promise<void>;
  setState?: (target: string, value: unknown) => void | Promise<void>;
  /** App- or platform-provided capabilities for custom operations. */
  capabilities?: Record<string, (target: string | undefined, value: unknown) => void | Promise<void>>;
};
export type ActionOperation = {
  name: string;
  validate: (action: ActionSpec) => string[];
  run: (action: ActionSpec, context: ActionContext) => void | Promise<void>;
};

/** Scoped registry: custom operations may be registered without changing core. */
export function createActionRegistry() {
  const operations = new Map<string, ActionOperation>();
  const register = (operation: ActionOperation) => {
    if (!operation.name || operations.has(operation.name)) throw new Error(`Action operation "${operation.name}" is already registered or empty`);
    operations.set(operation.name, operation);
  };
  const requiredTarget = (a: ActionSpec) => typeof a.target === 'string' && a.target.trim() ? [] : ['target must be a non-empty string'];
  const add = (name: string, port: keyof ActionContext) => register({
    name, validate: requiredTarget,
    run: (action, context) => {
      const fn = context[port];
      if (!fn) throw new Error(`Action operation "${name}" is unavailable in this app`);
      return (fn as (target: string, value?: unknown) => void | Promise<void>)(action.target!, action.value);
    },
  });
  add('dialog.open', 'openDialog');
  add('dialog.close', 'closeDialog');
  add('storage.chooseFolder', 'chooseFolder');
  add('storage.useSample', 'useSample');
  add('selection.select', 'select');
  add('navigation.open', 'navigate');
  register({ name: 'state.set', validate: a => [...requiredTarget(a), ...(Object.prototype.hasOwnProperty.call(a, 'value') ? [] : ['value is required'])], run: (a, c) => {
    if (!c.setState) throw new Error('Action operation "state.set" is unavailable in this app');
    return c.setState(a.target!, a.value);
  } });
  return {
    register,
    list: () => [...operations.keys()],
    validate(action: ActionSpec): string[] {
      if (!action || typeof action !== 'object' || typeof action.id !== 'string' || !action.id || typeof action.do !== 'string' || !action.do) return ['action needs a non-empty id and operation'];
      const op = operations.get(action.do);
      return op ? op.validate(action) : [`unknown action operation "${action.do}"`];
    },
    async execute(action: ActionSpec, context: ActionContext): Promise<{ ok: true } | { ok: false; errors: string[] }> {
      const errors = this.validate(action);
      if (errors.length) return { ok: false, errors };
      try { await operations.get(action.do)!.run(action, context); return { ok: true }; }
      catch (e) { return { ok: false, errors: [e instanceof Error ? e.message : String(e)] }; }
    },
  };
}
export type ActionRegistry = ReturnType<typeof createActionRegistry>;
export const actionRegistry = createActionRegistry();

export async function runAction(id: string, actions: ActionSpec[], context: ActionContext, registry: ActionRegistry = actionRegistry) {
  const action = actions.find(a => a.id === id);
  return action ? registry.execute(action, context) : { ok: false as const, errors: [`unknown action "${id}"`] };
}

/** Any component can map named events to plan-defined actions. */
export type ActionBindings = Record<string, string>;
export function validateActionBindings(bindings: ActionBindings, actions: ActionSpec[]): string[] {
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) return ['action bindings must be an object'];
  return Object.entries(bindings).flatMap(([event, id]) =>
    !event || typeof id !== 'string' || !id ? [`invalid action binding for "${event}"`] :
    actions.some(a => a.id === id) ? [] : [`event "${event}" references unknown action "${id}"`]);
}
export async function dispatchActionEvent(event: string, bindings: ActionBindings, actions: ActionSpec[], context: ActionContext, registry: ActionRegistry = actionRegistry) {
  if (!Object.prototype.hasOwnProperty.call(bindings, event)) return { ok: false as const, errors: [`event "${event}" has no action binding`] };
  return runAction(bindings[event], actions, context, registry);
}
