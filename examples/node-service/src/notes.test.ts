import { describe, expect, it } from "vitest";
import { createStore } from "./notes.ts";

describe("createStore", () => {
  it("numbers the notes from 1 in the order they were added", () => {
    const store = createStore();
    expect(store.add("first")).toEqual({ id: 1, text: "first" });
    expect(store.add("second")).toEqual({ id: 2, text: "second" });
  });

  it("gives a note by its id, and nothing for an id it has not given", () => {
    const store = createStore();
    store.add("first");
    expect(store.get(1)).toEqual({ id: 1, text: "first" });
    expect(store.get(2)).toBeUndefined();
  });

  it("lists a copy, so the caller cannot change the store", () => {
    const store = createStore();
    store.add("first");
    const listed = [...store.list()];
    listed.pop();
    expect(store.list()).toHaveLength(1);
  });
});
