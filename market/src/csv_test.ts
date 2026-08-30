import { assertEquals } from "@std/assert";
import { csvLine } from "./csv.ts";

Deno.test("csvLine joins values and ends the line", () => {
  assertEquals(csvLine(["B1", "Cable", 12.99]), "B1,Cable,12.99\n");
});

Deno.test("csvLine leaves an absent value as an empty cell", () => {
  assertEquals(csvLine([undefined, null, ""]), ",,\n");
});

Deno.test("csvLine writes a boolean as a word a spreadsheet reads", () => {
  assertEquals(csvLine([true, false]), "true,false\n");
});

Deno.test("csvLine quotes a cell that would otherwise break the format", () => {
  assertEquals(
    csvLine(['He said "hi", loudly\nagain']),
    '"He said ""hi"", loudly\nagain"\n',
  );
});
