export default [
  {
    files: ["**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "error" },
  },
  {
    files: ["src/legacy/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
];
