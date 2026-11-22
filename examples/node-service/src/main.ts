import { createStore } from "./notes.ts";
import { createService } from "./server.ts";

const port = Number(process.env["PORT"] ?? 3000);

createService(createStore()).listen(port, () => {
  process.stdout.write(`notes service listening on ${String(port)}\n`);
});
