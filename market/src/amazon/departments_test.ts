import { assertEquals, assertThrows } from "@std/assert";
import { DEPARTMENTS, selectDepartments } from "./departments.ts";

Deno.test("every department has a unique slug and a browse node", () => {
  assertEquals(
    new Set(DEPARTMENTS.map((d) => d.slug)).size,
    DEPARTMENTS.length,
  );
  for (const department of DEPARTMENTS) {
    assertEquals(/^\d+$/.test(department.node), true, department.slug);
    assertEquals(department.name.length > 0, true, department.slug);
  }
});

Deno.test("selectDepartments keeps the order asked for", () => {
  assertEquals(
    selectDepartments(["books", "electronics"]).map((d) => d.slug),
    ["books", "electronics"],
  );
});

Deno.test("selectDepartments ignores spacing and case", () => {
  assertEquals(selectDepartments([" Books "]).map((d) => d.slug), ["books"]);
});

Deno.test("selectDepartments names the offender and the alternatives", () => {
  assertThrows(
    () => selectDepartments(["gadgets"]),
    Error,
    "gadgets",
  );
  assertThrows(() => selectDepartments(["gadgets"]), Error, "electronics");
});
