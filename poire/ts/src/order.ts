/**
 * TS-01 laundering at the boundary, TS-04 primitive soup, TS-05 optional-flag
 * soup, TS-12 non-erasable syntax, TS-14 widened literals.
 *
 * External data is parsed once, at the boundary, by a schema. The static type
 * is derived from that schema, so the check and the type cannot drift apart,
 * and no `as` appears anywhere.
 */
import { z } from "zod";
import { err, ok, type Result } from "./result.ts";

/** An order's states, as an erasable enum: the object holds the values, the type is their union. */
export const OrderStatus = {
  Pending: "pending",
  Shipped: "shipped",
  Cancelled: "cancelled",
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

/** A customer id. The brand makes it a type of its own: a plain string is not one. */
export const CustomerId = z
  .string()
  .regex(/^cus_[a-z0-9]{8}$/)
  .brand<"CustomerId">();
export type CustomerId = z.infer<typeof CustomerId>;

const base = {
  id: z.string().min(1),
  customer: CustomerId,
  totalCents: z.int().nonnegative(),
};

/**
 * One shape per state. A shipped order always has a tracking number and a
 * cancelled one always has a reason; no combination of optional fields can say
 * otherwise.
 */
export const OrderSchema = z.discriminatedUnion("status", [
  z.object({ ...base, status: z.literal(OrderStatus.Pending) }),
  z.object({ ...base, status: z.literal(OrderStatus.Shipped), tracking: z.string().min(1) }),
  z.object({ ...base, status: z.literal(OrderStatus.Cancelled), reason: z.string().min(1) }),
]);
export type Order = z.infer<typeof OrderSchema>;

/** Parses untrusted input into an [Order], or returns where it went wrong. */
export function parseOrder(raw: unknown): Result<Order, readonly string[]> {
  const parsed = OrderSchema.safeParse(raw);
  if (parsed.success) {
    return ok(parsed.data);
  }
  return err(
    parsed.error.issues.map((issue) => `${String(issue.path[0] ?? "(root)")}: ${issue.message}`),
  );
}

/** What to do next for each state. `satisfies` checks every state is covered and keeps the literal values. */
export const NEXT_ACTION = {
  pending: "collect payment",
  shipped: "wait for delivery",
  cancelled: "refund the payment",
} as const satisfies Record<OrderStatus, string>;

/** One line about an order. The switch is exhaustive: a fourth state is a compile error here. */
export function describe(order: Order): string {
  switch (order.status) {
    case "pending":
      return `${order.id}: ${NEXT_ACTION.pending}`;
    case "shipped":
      return `${order.id}: shipped, tracking ${order.tracking}`;
    case "cancelled":
      return `${order.id}: cancelled, ${order.reason}`;
  }
}

/** The ids of orders placed by one customer. The parameter type refuses a plain string. */
export function ordersOf(customer: CustomerId, orders: readonly Order[]): string[] {
  return orders.filter((order) => order.customer === customer).map((order) => order.id);
}
