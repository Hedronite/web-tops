import { profileFor } from "../config/profiles.ts";

/** The CRAP cap a new function is held to: one per class (WEB_TOPS.md section 5.2), from the class profile. */
export function capFor(className: string): number | undefined {
  return profileFor(className)?.crapCap;
}
