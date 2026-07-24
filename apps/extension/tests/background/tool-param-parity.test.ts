/**
 * Tool parameter-name parity across the three layers (issue #43).
 *
 * A tool's parameter names must match across:
 *   1. the ToolDefinition JSON schema the LLM sees (background/tools/definitions.ts),
 *   2. the TypeScript args interface (packages/shared-types/src/tools.ts),
 *   3. the content-script executor dispatch (content/actions/index.ts).
 *
 * A mismatch (the historical `tag` vs `id`) is silent at runtime: the model
 * emits one name, the executor reads another, and the action no-ops. Layers 2↔3
 * are only as sound as the `args as unknown as XxxArgs` cast in the dispatch,
 * and layer 1 is plain data — so neither seam is compiler-checked. This test
 * closes both by comparing the runtime schemas against the parsed interface
 * declarations and the parsed dispatch casts.
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import "../setup";
import * as toolDefs from "../../src/background/tools/definitions";
// The ServiceNow adapter owns its own definitions; without this import the two
// most complex schemas in the system would silently skip every parity check.
import * as servicenowDefs from "../../src/background/tools/servicenow/definitions";
import { ToolName, type ToolDefinition } from "../../src/types";

const here = dirname(fileURLToPath(import.meta.url));
const SHARED_TYPES_TOOLS = resolve(
  here,
  "../../../../packages/shared-types/src/tools.ts",
);
const CONTENT_DISPATCH = resolve(here, "../../src/content/actions/index.ts");

/** Tools whose dispatch case is intentionally untyped or argument-free. */
const DISPATCH_EXEMPT = new Set<string>([
  "READ_PAGE", // takes no arguments
  "UPLOAD_FILE", // dispatched as Record<string, unknown>; validated in the handler
]);

interface Member {
  name: string;
  optional: boolean;
}

function isToolDefinition(value: unknown): value is ToolDefinition {
  return (
    !!value &&
    typeof value === "object" &&
    (value as ToolDefinition).type === "function" &&
    typeof (value as ToolDefinition).function?.name === "string"
  );
}

/** All runtime definitions, keyed by wire name (`def.function.name`). */
const defsByWireName = new Map<string, ToolDefinition>(
  [...Object.values(toolDefs), ...Object.values(servicenowDefs)]
    .filter(isToolDefinition)
    .map((def) => [def.function.name, def]),
);

/** Wire name -> ToolName enum member name (CLICK_ELEMENT, ...). */
const enumMemberByWireName = new Map<string, string>(
  Object.entries(ToolName).map(([member, wire]) => [wire, member]),
);

/** CLICK_ELEMENT -> "clickelementargs": tolerant of ServiceNow-style casing. */
function expectedInterfaceKey(enumMember: string): string {
  return `${enumMember.replace(/_/g, "").toLowerCase()}args`;
}

function schemaProps(def: ToolDefinition): {
  properties: Record<string, { type?: string }>;
  required: string[];
} {
  const parameters = def.function.parameters as {
    properties?: Record<string, { type?: string }>;
    required?: string[];
  };
  return {
    properties: parameters.properties ?? {},
    required: parameters.required ?? [],
  };
}

function propertyName(node: ts.PropertyName, source: ts.SourceFile): string {
  return ts.isIdentifier(node) || ts.isStringLiteral(node)
    ? node.text
    : node.getText(source);
}

function typeLiteralMembers(
  node: ts.TypeLiteralNode,
  source: ts.SourceFile,
): Member[] {
  return node.members.filter(ts.isPropertySignature).map((member) => ({
    name: propertyName(member.name, source),
    optional: member.questionToken !== undefined,
  }));
}

/** Parse every `interface XxxArgs { ... }` in shared-types/src/tools.ts. */
function parseArgsInterfaces(): Map<string, Member[]> {
  const source = ts.createSourceFile(
    SHARED_TYPES_TOOLS,
    readFileSync(SHARED_TYPES_TOOLS, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const interfaces = new Map<string, Member[]>();
  for (const statement of source.statements) {
    if (ts.isInterfaceDeclaration(statement) && statement.name.text.endsWith("Args")) {
      interfaces.set(
        statement.name.text.toLowerCase(),
        statement.members.filter(ts.isPropertySignature).map((member) => ({
          name: propertyName(member.name, source),
          optional: member.questionToken !== undefined,
        })),
      );
      continue;
    }
    // Argless tools use `type XxxArgs = Record<string, never>` — zero members.
    if (
      ts.isTypeAliasDeclaration(statement) &&
      statement.name.text.endsWith("Args") &&
      statement.type.getText(source).replace(/\s/g, "") === "Record<string,never>"
    ) {
      interfaces.set(statement.name.text.toLowerCase(), []);
    }
  }
  return interfaces;
}

interface DispatchCase {
  enumMember: string;
  /** Named interface the args are cast to, lowercased; null for a literal. */
  castInterface: string | null;
  /** Members of an inline `args as unknown as { ... }` literal cast. */
  literalMembers: Member[] | null;
  /** True when the case body contains no `as` cast at all. */
  uncast: boolean;
}

/** Parse the `switch (toolName)` cases out of content/actions/index.ts. */
function parseDispatchCases(): DispatchCase[] {
  const source = ts.createSourceFile(
    CONTENT_DISPATCH,
    readFileSync(CONTENT_DISPATCH, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const cases: DispatchCase[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCaseClause(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(source) === "ToolName"
    ) {
      const enumMember = node.expression.name.text;
      // The outermost non-`unknown` As-cast is the executor's declared type.
      let castType: ts.TypeNode | undefined;
      const findCast = (inner: ts.Node): void => {
        if (
          ts.isAsExpression(inner) &&
          inner.type.kind !== ts.SyntaxKind.UnknownKeyword &&
          !castType
        ) {
          castType = inner.type;
        }
        ts.forEachChild(inner, findCast);
      };
      node.statements.forEach((statement) => findCast(statement));
      cases.push({
        enumMember,
        castInterface:
          castType && ts.isTypeReferenceNode(castType)
            ? castType.typeName.getText(source).toLowerCase()
            : null,
        literalMembers:
          castType && ts.isTypeLiteralNode(castType)
            ? typeLiteralMembers(castType, source)
            : null,
        uncast: !castType,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return cases;
}

const argsInterfaces = parseArgsInterfaces();
const dispatchCases = parseDispatchCases();

const sorted = (names: string[]): string[] => [...names].sort();
const memberNames = (members: Member[]): string[] =>
  sorted(members.map((m) => m.name));
const requiredNames = (members: Member[]): string[] =>
  sorted(members.filter((m) => !m.optional).map((m) => m.name));

describe("tool parameter parity (schema ↔ args interface)", () => {
  const paired = [...defsByWireName.entries()].flatMap(([wire, def]) => {
    const enumMember = enumMemberByWireName.get(wire);
    if (!enumMember) return [];
    const members = argsInterfaces.get(expectedInterfaceKey(enumMember));
    return members ? [{ wire, enumMember, def, members }] : [];
  });

  test("EVERY tool definition is paired with an args interface", () => {
    // A tool that falls out of the CLICK_ELEMENT -> ClickElementArgs naming
    // convention silently loses its per-tool parity tests. Exact coverage
    // makes that failure loud: adding a tool without an args interface (or
    // renaming one) must fail here, not vanish.
    const unpaired = [...defsByWireName.keys()].filter(
      (wire) => !paired.some((p) => p.wire === wire),
    );
    expect(unpaired).toEqual([]);
    expect(paired.length).toBe(defsByWireName.size);
  });

  test.each(paired.map((p) => [p.wire, p] as const))(
    "%s: schema property names match its args interface",
    (_wire, { def, members }) => {
      const { properties } = schemaProps(def);
      expect(sorted(Object.keys(properties))).toEqual(memberNames(members));
    },
  );

  test.each(paired.map((p) => [p.wire, p] as const))(
    "%s: schema `required` matches the interface's non-optional members",
    (_wire, { def, members }) => {
      const { required } = schemaProps(def);
      expect(sorted(required)).toEqual(requiredNames(members));
    },
  );
});

describe("tool parameter parity (dispatch ↔ schema)", () => {
  // A case "opts out" of typed parity when it has no cast at all, or casts to
  // something that is not an args interface (UPLOAD_FILE's Record cast).
  const optsOut = (c: DispatchCase): boolean =>
    !c.literalMembers && !c.castInterface?.endsWith("args");

  test("every dispatch case is typed, exempted, or an inline literal", () => {
    const uncast = dispatchCases.filter(optsOut).map((c) => c.enumMember);
    expect(sorted(uncast)).toEqual(sorted([...DISPATCH_EXEMPT]));
  });

  test.each(
    dispatchCases
      .filter((c) => c.castInterface?.endsWith("args"))
      .map((c) => [c.enumMember, c] as const),
  )("%s: dispatch casts to the tool's own args interface", (_m, dispatch) => {
    expect(dispatch.castInterface).toBe(
      expectedInterfaceKey(dispatch.enumMember),
    );
    // ...and that interface really exists in shared-types.
    expect(argsInterfaces.has(dispatch.castInterface!)).toBe(true);
  });

  test.each(
    dispatchCases
      .filter((c) => c.literalMembers)
      .map((c) => [c.enumMember, c] as const),
  )("%s: inline literal cast matches the tool's schema", (_m, dispatch) => {
    const wire = ToolName[dispatch.enumMember as keyof typeof ToolName];
    const def = defsByWireName.get(wire);
    expect(def, `no ToolDefinition found for ${dispatch.enumMember}`).toBeDefined();
    const { properties, required } = schemaProps(def!);
    expect(sorted(Object.keys(properties))).toEqual(
      memberNames(dispatch.literalMembers!),
    );
    expect(sorted(required)).toEqual(requiredNames(dispatch.literalMembers!));
  });
});

describe("tool parameter conventions", () => {
  test("no tool schema uses `tag` — element references are `id` (integer)", () => {
    for (const [wire, def] of defsByWireName) {
      const { properties } = schemaProps(def);
      expect(
        Object.keys(properties).includes("tag"),
        `${wire} declares a \`tag\` parameter`,
      ).toBe(false);
      if (properties.id) {
        expect(properties.id.type, `${wire}'s \`id\` must be integer`).toBe(
          "integer",
        );
      }
    }
  });
});
