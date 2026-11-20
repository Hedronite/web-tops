function isNamed(value: unknown): value is { readonly name: string } {
  return (
    typeof value === "object" && value !== null && "name" in value && typeof value.name === "string"
  );
}

export function name(text: string): string {
  const data: unknown = JSON.parse(text);
  return isNamed(data) ? data.name : "";
}

export function title(text: string): string {
  const body: unknown = JSON.parse(text);
  return isNamed(body) ? body.name : "";
}
