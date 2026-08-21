import { expect, test } from "bun:test";
import {
	formatBulkThingData,
	MemriseClient,
	thingIdFromLearnableId,
} from "./index";

test("MemriseClient instantiation", () => {
	const cookie = "csrftoken=testtoken; sessionid=123";
	const client = new MemriseClient(cookie);
	expect(client).toBeDefined();
});

test("MemriseClient extractCsrfToken", () => {
	const cookie = "csrftoken=testtoken; sessionid=123";
	const client = new MemriseClient(cookie);
	// @ts-ignore - accessing private property for testing
	expect(client.csrfToken).toBe("testtoken");
});

test("formatBulkThingData passes through a raw string", () => {
	expect(formatBulkThingData("foo,bar\nfoo2,bar2")).toBe("foo,bar\nfoo2,bar2");
});

test("formatBulkThingData joins array rows with commas", () => {
	expect(
		formatBulkThingData([
			["foo", "bar"],
			["foo2", "bar2"],
		]),
	).toBe("foo,bar\nfoo2,bar2");
});

test("formatBulkThingData maps column records by numeric key order", () => {
	expect(
		formatBulkThingData([
			{ "2": "bar", "1": "foo" },
			{ "1": "foo2", "2": "bar2" },
		]),
	).toBe("foo,bar\nfoo2,bar2");
});

test("formatBulkThingData fills missing column indexes", () => {
	expect(formatBulkThingData([{ "1": "foo", "3": "baz" }])).toBe("foo,,baz");
});

test("formatBulkThingData supports tab and semicolon delimiters", () => {
	expect(formatBulkThingData([["foo", "bar"]], "tab")).toBe("foo\tbar");
	expect(formatBulkThingData([["foo", "bar"]], "semicolon")).toBe("foo;bar");
});

test("formatBulkThingData rejects values that contain the delimiter", () => {
	expect(() => formatBulkThingData([["foo,bar", "baz"]])).toThrow(
		"delimiter or a newline",
	);
	expect(() => formatBulkThingData([["foo\nbar", "baz"]])).toThrow(
		"delimiter or a newline",
	);
});

test("searchPool rejects an empty column filter instead of hitting the API", async () => {
	const client = new MemriseClient("csrftoken=testtoken; sessionid=123");
	expect(client.searchPool(1, {})).rejects.toThrow(
		/at least one non-empty column value/,
	);
	expect(client.searchPool(1, { "1": "" })).rejects.toThrow(
		/at least one non-empty column value/,
	);
});

// Recorded from live courses. A learnable ID packs the thing it was built from
// into the high bits and the column pair it tests into the low 16.
const LEARNABLE_TO_THING: Array<[number, number, number]> = [
	// [learnableId, thingId, columnPair]
	[33075772588290, 504696237, 0x0102],
	[33075772653826, 504696238, 0x0102],
	[33075772719362, 504696239, 0x0102],
	[31330446672130, 478064677, 0x0102],
	[32690739282178, 498821095, 0x0102],
];

test("thingIdFromLearnableId recovers the thing ID", () => {
	for (const [learnableId, thingId] of LEARNABLE_TO_THING) {
		expect(thingIdFromLearnableId(learnableId)).toBe(thingId);
	}
});

test("consecutive things step the learnable ID by one column-pair block", () => {
	expect(33075772653826 - 33075772588290).toBe(65536);
	expect(thingIdFromLearnableId(33075772653826)).toBe(
		thingIdFromLearnableId(33075772588290) + 1,
	);
});

test("the low bits are the column pair, not part of the thing ID", () => {
	for (const [learnableId, , pair] of LEARNABLE_TO_THING) {
		expect(learnableId % 65536).toBe(pair);
	}
	// Same thing, different column pairing -> different learnable, same thing ID.
	const thing = 504696237;
	expect(thingIdFromLearnableId(thing * 65536 + 0x0102)).toBe(thing);
	expect(thingIdFromLearnableId(thing * 65536 + 0x0302)).toBe(thing);
});

test("thing IDs stay inside the safe integer range", () => {
	for (const [learnableId] of LEARNABLE_TO_THING) {
		expect(Number.isSafeInteger(learnableId)).toBe(true);
	}
});
