import { describe, expect, it } from "vitest";
import { stripUndefined } from "../src/firebase/services.js";

describe("firebase services", () => {
  it("removes undefined values before writing to Firestore", () => {
    expect(stripUndefined({
      keep: 1,
      remove: undefined,
      shots: [
        { target: "launcher", handCount: 0, droppedPartsCount: 0 },
        { target: "point3", handCount: undefined, droppedPartsCount: undefined },
      ],
    })).toEqual({
      keep: 1,
      shots: [
        { target: "launcher", handCount: 0, droppedPartsCount: 0 },
        { target: "point3" },
      ],
    });
  });
});
