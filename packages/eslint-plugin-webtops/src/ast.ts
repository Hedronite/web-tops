/**
 * A syntax node as the parser hands it over. ESLint's typings leave out JSX and Astro nodes, so the
 * rules read every node by its shape: `type`, then the fields they care about.
 */
export type Loose = Readonly<Record<string, unknown>>;

const isLoose = (value: unknown): value is Loose => typeof value === "object" && value !== null;

/** The node's `type`, or undefined for anything that is not a node. */
export function kind(node: unknown): string | undefined {
  const type = isLoose(node) ? node["type"] : undefined;
  return typeof type === "string" ? type : undefined;
}

/** One field of a node, or undefined. */
export const child = (node: unknown, key: string): unknown =>
  isLoose(node) ? node[key] : undefined;

/** A list field of a node: empty when the field is absent or not a list. */
export function children(node: unknown, key: string): readonly unknown[] {
  const value = child(node, key);
  return Array.isArray(value) ? value : [];
}

/** The cooked text of a template element. */
const cooked = (quasi: unknown): string | undefined => {
  const text = child(child(quasi, "value"), "cooked");
  return typeof text === "string" ? text : undefined;
};

/** The static text of a template literal's parts: one string per quasi, `""` for a part the parser could not cook. */
export const quasisOf = (template: unknown): readonly string[] =>
  children(template, "quasis").map((quasi) => cooked(quasi) ?? "");

const literalText = (node: unknown): string | undefined => {
  const value = child(node, "value");
  return typeof value === "string" ? value : undefined;
};

const plainTemplateText = (node: unknown): string | undefined =>
  children(node, "expressions").length === 0 ? quasisOf(node)[0] : undefined;

// Tables are built where they are used, not at module level: a mutant in module-level data runs
// the whole suite again (a static mutant), one in a function runs only the tests that reach it.
const textReaders = (): ReadonlyMap<string, (node: unknown) => string | undefined> =>
  new Map([
    ["Literal", literalText],
    ["TemplateLiteral", plainTemplateText],
  ]);

/** The entry of a table keyed by node type, for the node's own type. */
export function byKind<T>(table: ReadonlyMap<string, T>, node: unknown): T | undefined {
  const type = kind(node);
  return type === undefined ? undefined : table.get(type);
}

/** The entry of a table for a name that may be missing. */
export const lookup = <T>(
  table: ReadonlyMap<string, T>,
  name: string | undefined,
): T | undefined => (name === undefined ? undefined : table.get(name));

/** The text of a string literal or of a template literal with no interpolation; undefined for anything else. */
export const staticText = (node: unknown): string | undefined =>
  byKind(textReaders(), node)?.(node);

const joined = (object: string | undefined, property: string | undefined): string | undefined =>
  object !== undefined && property !== undefined ? `${object}.${property}` : undefined;

const memberName = (node: unknown): string | undefined =>
  kind(node) === "MemberExpression" && child(node, "computed") !== true
    ? joined(dottedName(child(node, "object")), nameOf(child(node, "property")))
    : undefined;

/** `name` for an identifier, `a.b.c` for a chain of member accesses, else undefined. */
export const dottedName = (node: unknown): string | undefined =>
  kind(node) === "Identifier" ? nameOf(node) : memberName(node);

/** The `name` field of an identifier-like node. */
export function nameOf(node: unknown): string | undefined {
  const name = child(node, "name");
  return typeof name === "string" ? name : undefined;
}

/** The name a property is read by: `a.b` and `a["b"]`; undefined for a computed key that is not a string literal. */
export const propertyName = (member: unknown): string | undefined =>
  child(member, "computed") === true
    ? staticText(child(member, "property"))
    : nameOf(child(member, "property"));

const namespaced = (name: unknown): string =>
  `${nameOf(child(name, "namespace")) ?? ""}:${nameOf(child(name, "name")) ?? ""}`;

/** The attribute's name: `className`, or `set:html` for a namespaced one. */
export function attributeName(attribute: unknown): string | undefined {
  const name = child(attribute, "name");
  return kind(name) === "JSXNamespacedName" ? namespaced(name) : nameOf(name);
}

/** The expression inside `attr={...}`, or the literal of `attr="..."`. */
export function attributeValue(attribute: unknown): unknown {
  const value = child(attribute, "value");
  return kind(value) === "JSXExpressionContainer" ? child(value, "expression") : value;
}

/** Strings from a rule option that should be a list of them: anything else is dropped. */
export function stringList(option: unknown, key: string, fallback: readonly string[]): string[] {
  const value = child(option, key);
  if (!Array.isArray(value)) return [...fallback];
  return value.filter((entry): entry is string => typeof entry === "string");
}
