#!/usr/bin/env bash
# The planted build-output defects (milestone M4): each patch is laid over its green example, the example's gate must
# be red for the planted reason and for no other, and the patch is taken off again.
#
#   bash fixtures/plants/run.sh [plant...]        from anywhere in the kit, with the examples installed
#
# A plant that leaves the gate green, or turns it red for something else, fails this script.
set -euo pipefail

cd "$(dirname "$0")/../.."
ALL="w20-invalid-html broken-link w29-page-script a11y-contrast-target"

# plant -> the example it is laid over | the laws the gate must refuse, and no other | a rule gate 6 must fail
plant() {
  case "$1" in
    w20-invalid-html) echo "astro-site|W-20|html-validate:element-permitted-content" ;;
    broken-link) echo "astro-site||links" ;; # section 8.2 has no law for links: the layer's rule alone is red
    w29-page-script) echo "astro-site|W-29|W-29" ;;
    # W-22 reads axe on built pages too (section 8.2), so it is refused beside W-21.
    a11y-contrast-target) echo "web-app|W-21 W-22 W-44|axe:target-size" ;;
    *) echo "unknown plant: $1 (one of: $ALL)" >&2; return 2 ;;
  esac
}

# Reads the example's report: gates 1 to 4 green, exactly the expected laws refused, the expected rule failed.
CHECK='
const { REPORT, WANT_LAWS, WANT_RULE } = process.env;
const report = await Bun.file(REPORT).json();
const layer = (id) => report.layers.find((entry) => entry.id === id);
const problems = ["hygiene", "tests", "coverage", "crap"]
  .filter((id) => layer(id)?.verdict !== "pass")
  .map((id) => `${id} is ${layer(id)?.verdict}, and the plant should leave it green`);
const refused = (layer("laws")?.findings ?? [])
  .filter((found) => found.rule.startsWith("law/") && found.verdict === "refuse")
  .map((found) => found.law)
  .sort()
  .join(" ");
if (refused !== WANT_LAWS) problems.push(`laws refused: [${refused}], expected [${WANT_LAWS}]`);
const failed = (layer("build-output")?.findings ?? []).filter(
  (found) => found.verdict === "fail" && found.rule === WANT_RULE,
);
if (failed.length === 0) problems.push(`build-output has no failing ${WANT_RULE} finding`);
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`laws refused: [${refused}]; build-output ${WANT_RULE}: ${failed[0].message}`);
'

applied=""
restore() {
  if [ -n "$applied" ]; then git apply -R "$applied"; applied=""; fi
}
trap restore EXIT

for name in ${@:-$ALL}; do
  row=$(plant "$name")
  IFS='|' read -r example laws rule <<<"$row"
  report="examples/$example/.web-tops/report.json"
  echo "=== plant $name over examples/$example"
  git apply "fixtures/plants/$name.patch"
  applied="fixtures/plants/$name.patch"
  rm -f "$report"
  code=0
  (cd "examples/$example" && bun ../../src/cli/main.ts gate --max-tier 1 --keep-going) || code=$?
  restore
  if [ "$code" -ne 1 ]; then
    echo "plant $name: the gate exited $code, and a planted defect must make it exit 1" >&2
    exit 1
  fi
  REPORT="$report" WANT_LAWS="$laws" WANT_RULE="$rule" bun -e "$CHECK"
  echo "=== plant $name: red, as planted"
done
