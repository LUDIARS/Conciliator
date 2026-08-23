import { afterEach, describe, expect, it } from "vitest";
import { closeDb, openDb } from "../src/db/index.js";

describe("SQLite native addon", () => {
  afterEach(() => closeDb());

  it("opens and closes an in-memory database", () => {
    const db = openDb(":memory:");

    expect(db.open).toBe(true);
    closeDb();
    expect(db.open).toBe(false);
  });
});
