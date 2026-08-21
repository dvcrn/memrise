import { expect, test } from "bun:test";
import {
	formatBulkThingData,
	MemriseClient,
	parseLevelThings,
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

const LEVEL_HTML = `<table><tbody class="things"><tr class="thing" data-thing-id="504696237"><td><i class="ico ico-close" data-role="remove"></i></td><td class="cell text column"
	data-key="1"
	data-cell-type="column"><div class="wrapper"><button class="edit-alts">Alts</button><div class="text">&#3605;&#3638;&#3585; (tuk)</div></div></td><td class="cell text column"
	data-key="2"
	data-cell-type="column"><div class="wrapper"><div class="text">building &amp; hall</div></div></td><td class="cell audio column"
	data-key="3"
	data-cell-type="column"><div class="btn-group">no audio file</div></td><td class="cell text attribute"
	data-key="1"
	data-cell-type="attribute"><div class="wrapper"><div class="text">tʉ̀k</div></div></td></tr><tr class="thing" data-thing-id="504696238"><td class="cell text column"
	data-key="1"
	data-cell-type="column"><div class="wrapper"><div class="text">maybe</div></div></td></tr></tbody></table>`;

test("parseLevelThings extracts thing ids, columns and attributes", () => {
	const things = parseLevelThings(LEVEL_HTML);

	expect(things).toHaveLength(2);
	expect(things[0]).toEqual({
		id: 504696237,
		columns: { "1": "ตึก (tuk)", "2": "building & hall" },
		attributes: { "1": "tʉ̀k" },
	});
	expect(things[1]?.id).toBe(504696238);
	expect(things[1]?.columns).toEqual({ "1": "maybe" });
});

test("parseLevelThings returns an empty list for a level with no things", () => {
	expect(parseLevelThings('<tbody class="things"></tbody>')).toEqual([]);
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
