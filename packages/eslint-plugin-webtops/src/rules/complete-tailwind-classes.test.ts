import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import rule from "./complete-tailwind-classes.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const incomplete = [{ messageId: "incomplete" as const }];

tester.run("complete-tailwind-classes", rule, {
  valid: [
    { name: "a whole class string", code: '<div className="bg-red-500 text-lg" />' },
    { name: "a lookup of complete strings", code: "<div className={COLORS[color]} />" },
    {
      name: "whole tokens chosen by a condition",
      code: '<div className={on ? "bg-red-500" : "bg-blue-500"} />',
    },
    { name: "interpolated tokens are whole", code: "<div className={`flex ${extra} p-2`} />" },
    { name: "an interpolation at the edges", code: "<div className={`${base} ${extra}`} />" },
    { name: "a single interpolation", code: "<div className={`${base}`} />" },
    {
      name: "a concatenation that keeps tokens whole",
      code: '<div className={"flex " + extra + " p-2"} />',
    },
    { name: "two static strings", code: '<div className={"bg-" + "red-500"} />' },
    { name: "the class attribute", code: '<div class="bg-red-500" />' },
    { name: "an attribute that is not a class list", code: "<div id={`bg-${color}`} />" },
    { name: "a name built outside a class list", code: "const id = `bg-${color}-500`;" },
    { name: "a call that is not a class helper", code: "other(`bg-${color}-500`);" },
    {
      name: "a helper given whole strings",
      code: 'clsx("flex", on && "bg-red-500", { "p-2": big });',
    },
    { name: "a helper given a spread", code: "cn(...list);" },
    { name: "a member callee that is not a helper", code: "styles.pick(`bg-${c}`);" },
    { name: "a concat that keeps tokens whole", code: 'const a = "flex ".concat(extra);' },
    {
      name: "an object key that is a plain string",
      code: 'clsx({ "bg-red-500": on, [name]: off });',
    },
    {
      name: "a custom helper list leaves clsx alone",
      code: "clsx(`bg-${c}`);",
      options: [{ functions: ["tw"] }],
    },
    { name: "a numeric addition", code: "<div className={a + 1} />" },
    { name: "a template in a computed member", code: "<div className={map[`${key}`]} />" },
  ],
  invalid: [
    {
      name: "interpolation inside a token",
      code: "<div className={`bg-${color}-500`} />",
      errors: incomplete,
    },
    {
      name: "an interpolation that ends a token",
      code: "<div className={`flex bg-${color}`} />",
      errors: incomplete,
    },
    {
      name: "an interpolation that starts a token",
      code: "<div className={`${size}-4 flex`} />",
      errors: incomplete,
    },
    {
      name: "two interpolations glued",
      code: "<div className={`${a}${b}`} />",
      errors: incomplete,
    },
    {
      name: "interpolation in the class attribute",
      code: "<div class={`text-${size}`} />",
      errors: incomplete,
    },
    {
      name: "concatenation of a prefix",
      code: '<div className={"bg-" + color} />',
      errors: incomplete,
    },
    {
      name: "concatenation of a suffix",
      code: '<div className={color + "-500"} />',
      errors: incomplete,
    },
    {
      name: "concatenation in the middle of a chain",
      code: '<div className={"flex " + "bg-" + color + " p-2"} />',
      errors: incomplete,
    },
    {
      name: "concatenation with a template prefix",
      code: "<div className={`bg-` + color} />",
      errors: incomplete,
    },
    {
      name: "interpolation in one branch",
      code: '<div className={on ? `bg-${c}-500` : "p-2"} />',
      errors: incomplete,
    },
    {
      name: "interpolation in the other branch",
      code: '<div className={on ? "p-2" : `bg-${c}-500`} />',
      errors: incomplete,
    },
    {
      name: "interpolation after &&",
      code: "<div className={on && `bg-${c}-500`} />",
      errors: incomplete,
    },
    {
      name: "interpolation before ||",
      code: '<div className={`bg-${c}-500` || "p-2"} />',
      errors: incomplete,
    },
    {
      name: "interpolation in an array",
      code: '<div className={["flex", `bg-${c}-500`].join(" ")} />',
      errors: incomplete,
    },
    {
      name: "interpolation nested in an interpolation",
      code: "<div className={`flex ${on ? `bg-${c}` : ''}`} />",
      errors: incomplete,
    },
    {
      name: "concatenation inside an interpolation",
      code: '<div className={`flex ${"bg-" + c}`} />',
      errors: incomplete,
    },
    { name: "a concat call", code: '<div className={"bg-".concat(color)} />', errors: incomplete },
    {
      name: "a concat call with a suffix",
      code: '<div className={color.concat("-500")} />',
      errors: incomplete,
    },
    {
      name: "clsx with an interpolated token",
      code: "clsx(`bg-${color}-500`);",
      errors: incomplete,
    },
    {
      name: "cn with a concatenated token",
      code: 'cn("flex", "bg-" + color);',
      errors: incomplete,
    },
    { name: "an array argument", code: "cva([`bg-${c}`]);", errors: incomplete },
    {
      name: "an object key built by interpolation",
      code: "clsx({ [`bg-${c}`]: on });",
      errors: incomplete,
    },
    { name: "a nested helper call", code: "twMerge(clsx(`bg-${c}`));", errors: incomplete },
    {
      name: "a member helper from the options",
      code: "ui.tw(`bg-${c}`);",
      options: [{ functions: ["ui.tw"] }],
      errors: incomplete,
    },
    { name: "a conditional argument", code: "cn(on ? `bg-${c}` : null);", errors: incomplete },
  ],
});
