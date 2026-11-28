import fc from "fast-check";
import { describe as suite, expect, it } from "vitest";
import { CustomerId, NEXT_ACTION, describe, ordersOf, parseOrder, type Order } from "./order.ts";

const customer = CustomerId.parse("cus_abcd1234");
const base = { id: "o1", customer: "cus_abcd1234", totalCents: 500 };

suite("parseOrder", () => {
  it("accepts each state with the fields that state needs", () => {
    const pending = parseOrder({ ...base, status: "pending" });
    const shipped = parseOrder({ ...base, status: "shipped", tracking: "1Z9" });
    const cancelled = parseOrder({ ...base, status: "cancelled", reason: "out of stock" });
    expect([pending, shipped, cancelled].map((r) => (r.ok ? describe(r.value) : r.error))).toEqual([
      `o1: ${NEXT_ACTION.pending}`,
      "o1: shipped, tracking 1Z9",
      "o1: cancelled, out of stock",
    ]);
  });

  it("refuses a state that lacks its own fields", () => {
    const result = parseOrder({ ...base, status: "shipped" });
    expect(result.ok ? [] : result.error).toEqual([
      "tracking: Invalid input: expected string, received undefined",
    ]);
  });

  it("names where each refusal happened", () => {
    const cases: readonly [unknown, string][] = [
      ["not an order", "(root)"],
      [{ ...base, status: "lost" }, "status"],
      [{ ...base, customer: "cus_SHOUT123", status: "pending" }, "customer"],
      [{ ...base, customer: "xcus_abcd1234", status: "pending" }, "customer"],
      [{ ...base, customer: "cus_abcd12345", status: "pending" }, "customer"],
      [{ ...base, totalCents: 1.5, status: "pending" }, "totalCents"],
      [{ ...base, totalCents: -1, status: "pending" }, "totalCents"],
      [{ ...base, id: "", status: "pending" }, "id"],
      [{ ...base, status: "cancelled", reason: "" }, "reason"],
      [{ ...base, status: "shipped", tracking: "" }, "tracking"],
    ];
    for (const [input, field] of cases) {
      const result = parseOrder(input);
      expect(result.ok ? "accepted" : result.error[0]?.split(":")[0]).toBe(field);
    }
  });

  it("returns every valid order it is given, unchanged", () => {
    const order = fc.record({
      id: fc.string({ minLength: 1 }),
      customer: fc.stringMatching(/^cus_[a-z0-9]{8}$/),
      totalCents: fc.nat(),
      status: fc.constant("cancelled"),
      reason: fc.string({ minLength: 1 }),
    });
    fc.assert(
      fc.property(order, (input) => {
        const result = parseOrder(input);
        expect(result).toEqual({ ok: true, value: input });
      }),
    );
  });
});

suite("ordersOf", () => {
  const orders: Order[] = [
    { id: "a", customer, totalCents: 1, status: "pending" },
    { id: "b", customer: CustomerId.parse("cus_zzzz9999"), totalCents: 2, status: "pending" },
  ];

  it("keeps the orders of one customer", () => {
    expect(ordersOf(customer, orders)).toEqual(["a"]);
  });

  it("will not take a plain string where a CustomerId belongs", () => {
    // @ts-expect-error -- a plain string is not a CustomerId; only CustomerId.parse makes one
    expect(ordersOf("cus_abcd1234", orders)).toEqual(["a"]);
  });
});
