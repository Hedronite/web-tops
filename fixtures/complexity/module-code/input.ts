const x = process.env.A ? 1 : 2;
if (x) { console.log(x); }
for (const i of [1, 2]) { while (i > 5) break; }
export const y = x || 3;
