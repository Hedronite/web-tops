/* eslint-disable no-console */
export function first(): void {
  console.log("first");
}

export function second(): void {
  // eslint-disable-next-line no-alert -- reason: the prompt is the point
  alert("second");
  confirm("third"); // eslint-disable-line no-restricted-globals -- reason: legacy
}
