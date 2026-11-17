# Recorded output

Each file here is the real output of the tool at the pin, captured once and scrubbed of absolute paths. The gate 1 tests feed them to the layer through a fake process runner, so the parsers meet the tools' real shapes without installing every tool in CI.

| File | Tool and case |
|---|---|
| `tsc-errors.txt` | `tsc -b --noEmit` 6.0.3, two type errors, exit 1 |
| `audit-clean.json`, `audit-vulnerable.json`, `audit-unreachable.stderr` | `bun audit --prod --json` 1.4.4: clean (`{}`), `lodash@4.17.15`, registry refused |
| `prettier-check.txt` | `prettier --check .` 3.10, unformatted files, exit 1 |
| `depcruise-circular.json` | `depcruise src --output-type json` 18, one circular import under an `error` rule |
| `stylelint-errors.json` | `stylelint --formatter json --output-file` 18, one `color-named` error |
| `publint-clean.txt`, `publint-dual-broken.txt` | `publint run <tarball>` 0.3: clean; a package whose `require` entries name missing files |
| `attw-esm-only-profile.json` | `attw <tarball> --format json --profile esm-only` 0.18 on `../pkg-esm-only`, exit 0 |
| `attw-esm-only-plain.json` | the same tarball without the profile, exit 1 (`CJSResolvesToESM`) |
| `attw-dual-broken-plain.json` | `attw <tarball> --format json` on `../pkg-dual-broken`, exit 1 |

The exit codes above are what the layer reads; the JSON still lists ignored problems under a profile, so the layer trusts the exit code.
