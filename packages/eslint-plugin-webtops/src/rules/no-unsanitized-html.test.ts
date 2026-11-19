import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import rule from "./no-unsanitized-html.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const DEFAULT = "sanitize, sanitizeHtml, DOMPurify.sanitize";
const unsanitized = (sink: string, sanitizers = DEFAULT) => [
  { messageId: "unsanitized" as const, data: { sink, sanitizers } },
];

tester.run("no-unsanitized-html", rule, {
  valid: [
    {
      name: "a static HTML object",
      code: '<div dangerouslySetInnerHTML={{ __html: "<b>x</b>" }} />',
    },
    {
      name: "a template with no interpolation",
      code: "<div dangerouslySetInnerHTML={{ __html: `<b>x</b>` }} />",
    },
    {
      name: "a sanitized value",
      code: "<div dangerouslySetInnerHTML={{ __html: sanitize(html) }} />",
    },
    {
      name: "DOMPurify",
      code: "<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />",
    },
    {
      name: "sanitizeHtml",
      code: "<div dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />",
    },
    { name: "an empty object sets nothing", code: "<div dangerouslySetInnerHTML={{}} />" },
    {
      name: "an object with only another key",
      code: "<div dangerouslySetInnerHTML={{ other: html }} />",
    },
    { name: "a static set:html", code: '<div set:html="<b>x</b>" />' },
    { name: "a sanitized set:html", code: "<div set:html={sanitize(html)} />" },
    { name: "both branches safe", code: '<div set:html={on ? sanitize(a) : "<i></i>"} />' },
    { name: "textContent is not a sink", code: "el.textContent = value;" },
    { name: "a static innerHTML", code: 'el.innerHTML = "<b>x</b>";' },
    { name: "a sanitized innerHTML", code: "el.innerHTML = sanitize(html);" },
    { name: "a sanitized outerHTML", code: "el.outerHTML = DOMPurify.sanitize(html);" },
    {
      name: "a sanitized insertAdjacentHTML",
      code: 'el.insertAdjacentHTML("beforeend", sanitize(html));',
    },
    { name: "a static document.write", code: 'document.write("<p></p>");' },
    { name: "a call that is not a sink", code: "el.append(html);" },
    { name: "a plain call", code: "run(html);" },
    { name: "an attribute that is not a sink", code: "<div title={html} />" },
    { name: "a computed property that is not a sink", code: "el[name] = html;" },
    {
      name: "a custom sanitizer",
      code: "el.innerHTML = clean(html);",
      options: [{ sanitizers: ["clean"] }],
    },
    { name: "an assignment to a variable", code: "let x; x = html;" },
    { name: "a computed innerHTML with a literal", code: 'el["innerHTML"] = "<b></b>";' },
  ],
  invalid: [
    {
      name: "a variable in dangerouslySetInnerHTML",
      code: "<div dangerouslySetInnerHTML={{ __html: html }} />",
      errors: unsanitized("dangerouslySetInnerHTML"),
    },
    {
      name: "a template with interpolation",
      code: "<div dangerouslySetInnerHTML={{ __html: `<b>${x}</b>` }} />",
      errors: unsanitized("dangerouslySetInnerHTML"),
    },
    {
      name: "a props object that is not a literal",
      code: "<div dangerouslySetInnerHTML={markup} />",
      errors: unsanitized("dangerouslySetInnerHTML"),
    },
    {
      name: "a call that is not a sanitizer",
      code: "<div dangerouslySetInnerHTML={{ __html: render(x) }} />",
      errors: unsanitized("dangerouslySetInnerHTML"),
    },
    {
      name: "a member call that is not a sanitizer",
      code: "<div dangerouslySetInnerHTML={{ __html: marked.parse(x) }} />",
      errors: unsanitized("dangerouslySetInnerHTML"),
    },
    {
      name: "one unsafe branch",
      code: "<div dangerouslySetInnerHTML={{ __html: on ? sanitize(a) : b }} />",
      errors: unsanitized("dangerouslySetInnerHTML"),
    },
    {
      name: "a variable in set:html",
      code: "<div set:html={html} />",
      errors: unsanitized("set:html"),
    },
    {
      name: "set:html with an attribute string that is an expression",
      code: "<div set:html={`<b>${x}</b>`} />",
      errors: unsanitized("set:html"),
    },
    {
      name: "innerHTML with a variable",
      code: "el.innerHTML = html;",
      errors: unsanitized("innerHTML"),
    },
    {
      name: "innerHTML appended to",
      code: "el.innerHTML += html;",
      errors: unsanitized("innerHTML"),
    },
    {
      name: "outerHTML with a variable",
      code: "el.outerHTML = html;",
      errors: unsanitized("outerHTML"),
    },
    {
      name: "innerHTML set by a computed string key",
      code: 'el["innerHTML"] = html;',
      errors: unsanitized("innerHTML"),
    },
    {
      name: "innerHTML with a template",
      code: "el.innerHTML = `<b>${x}</b>`;",
      errors: unsanitized("innerHTML"),
    },
    {
      name: "insertAdjacentHTML with a variable",
      code: 'el.insertAdjacentHTML("beforeend", html);',
      errors: unsanitized("insertAdjacentHTML"),
    },
    {
      name: "insertAdjacentHTML with no markup argument",
      code: 'el.insertAdjacentHTML("beforeend");',
      errors: unsanitized("insertAdjacentHTML"),
    },
    {
      name: "document.write with a variable",
      code: "document.write(html);",
      errors: unsanitized("document.write"),
    },
    {
      name: "document.writeln with a variable",
      code: "document.writeln(html);",
      errors: unsanitized("document.writeln"),
    },
    {
      name: "a sanitizer the options replaced",
      code: "el.innerHTML = sanitize(html);",
      options: [{ sanitizers: ["clean"] }],
      errors: unsanitized("innerHTML", "clean"),
    },
  ],
});
