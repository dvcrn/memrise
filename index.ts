import axios from "axios";
import type {
	AccessTokenResponse,
	AddLevelResponse,
	AddThingResponse,
	AuthWebResponse,
	BulkAddResponse,
	BulkThingRows,
	BulkWordDelimiter,
	CourseLevel,
	DashboardCourse,
	DeleteLevelResponse,
	DeleteThingResponse,
	EnsureCsrfResponse,
	GetDashboardCoursesResponse,
	GetLearnableResponse,
	GetPoolResponse,
	Learnable,
	LevelEditingHtmlResponse,
	LevelThing,
	PoolColumnConfig,
	SearchPoolResponse,
	SetLevelTitleResponse,
} from "./types";

const DEFAULT_CLIENT_ID = "1e739f5e77704b57a703";

const BULK_DELIMITER_CHARS: Record<BulkWordDelimiter, string> = {
	comma: ",",
	tab: "\t",
	semicolon: ";",
};

function orderedValuesFromRecord(row: Record<string, string>): string[] {
	const numericKeys = Object.keys(row)
		.filter((key) => /^\d+$/.test(key))
		.map(Number)
		.sort((a, b) => a - b);

	if (numericKeys.length === 0) {
		return [];
	}

	const maxKey = numericKeys[numericKeys.length - 1];
	if (maxKey == null) {
		return [];
	}

	const values: string[] = [];
	for (let i = 1; i <= maxKey; i++) {
		values.push(row[String(i)] ?? "");
	}
	return values;
}

export function formatBulkThingData(
	rows: BulkThingRows,
	delimiter: BulkWordDelimiter = "comma",
): string {
	if (typeof rows === "string") {
		return rows;
	}

	const sep = BULK_DELIMITER_CHARS[delimiter];
	return rows
		.map((row) => {
			const values = Array.isArray(row) ? row : orderedValuesFromRecord(row);
			for (const value of values) {
				if (value.includes(sep) || /[\r\n]/.test(value)) {
					throw new Error(
						`Bulk row value contains the '${delimiter}' delimiter or a newline: ${JSON.stringify(value)}`,
					);
				}
			}
			return values.join(sep);
		})
		.join("\n");
}

const HTML_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: "\u00a0",
	"#39": "'",
};

function decodeHtml(value: string): string {
	return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
		const named = HTML_ENTITIES[entity];
		if (named !== undefined) return named;
		if (entity.startsWith("#x") || entity.startsWith("#X")) {
			return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
		}
		if (entity.startsWith("#")) {
			return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
		}
		return match;
	});
}

/**
 * Extract the things listed in a rendered level editing table.
 *
 * Exported so the parsing can be unit tested without hitting the network.
 */
export function parseLevelThings(html: string): LevelThing[] {
	const things: LevelThing[] = [];
	const rowRe =
		/<tr[^>]*\bclass="[^"]*\bthing\b[^"]*"[^>]*\bdata-thing-id="(\d+)"[^>]*>([\s\S]*?)<\/tr>/g;

	for (const row of html.matchAll(rowRe)) {
		const id = Number(row[1]);
		const body = row[2] ?? "";
		const columns: Record<string, string> = {};
		const attributes: Record<string, string> = {};

		const cellRe = /<td([^>]*)>([\s\S]*?)<\/td>/g;
		for (const cell of body.matchAll(cellRe)) {
			const attrs = cell[1] ?? "";
			const content = cell[2] ?? "";
			const key = /\bdata-key="([^"]+)"/.exec(attrs)?.[1];
			const kind = /\bdata-cell-type="([^"]+)"/.exec(attrs)?.[1];
			if (!key || !kind) continue;

			const text = /<div class="text">([\s\S]*?)<\/div>/.exec(content)?.[1];
			if (text === undefined) continue;

			const value = decodeHtml(text).trim();
			if (kind === "column") columns[key] = value;
			else if (kind === "attribute") attributes[key] = value;
		}

		things.push({ id, columns, attributes });
	}

	return things;
}

export class MemriseClient {
	private client = axios.create({
		baseURL: "https://community-courses.memrise.com",
		headers: {
			origin: "https://community-courses.memrise.com",
			"user-agent":
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
			"x-requested-with": "XMLHttpRequest",
		},
	});
	private cookie: string;
	private csrfToken: string | null;
	private accessToken: string | null;
	private cookieJar: Map<string, string>;
	private authReady: Promise<void>;

	constructor(
		username: string,
		password: string,
		clientId: string = DEFAULT_CLIENT_ID,
	) {
		this.cookie = "";
		this.csrfToken = null;
		this.accessToken = null;
		this.cookieJar = new Map();

		this.authReady = this.authenticateWithCredentials(
			username,
			password,
			clientId,
		);
	}

	private async authenticateWithCredentials(
		username: string,
		password: string,
		clientId: string,
	): Promise<void> {
		const csrf = await this.getCsrfToken();
		if (csrf) {
			this.csrfToken = csrf;
			this.client.defaults.headers.common["x-csrftoken"] = csrf;
		}

		const access = await this.getAccessToken(username, password, clientId);
		this.accessToken = access.access_token.access_token;
		// Don't set authorization header globally - v1.25 endpoints use session cookies only
		// this.client.defaults.headers.common['authorization'] = `Bearer ${this.accessToken}`;

		await this.authenticateWeb(this.accessToken);
	}

	private mergeSetCookieCookies(setCookieValues: string[]): void {
		if (setCookieValues.length === 0) return;

		for (const item of setCookieValues) {
			const firstPair = item.split(";")[0];
			if (!firstPair) continue;
			const [name, ...rest] = firstPair.split("=");
			if (!name || rest.length === 0) continue;
			this.cookieJar.set(name, rest.join("="));
		}

		this.cookie = [...this.cookieJar.entries()]
			.map(([name, value]) => `${name}=${value}`)
			.join("; ");
		this.client.defaults.headers.common["cookie"] = this.cookie;
	}

	private extractFromCookie(cookieHeader: string, name: string): string | null {
		const match = cookieHeader.match(new RegExp(`${name}=([^;]+)`));
		return match?.[1] ?? null;
	}

	private async ensureAuthenticated(): Promise<void> {
		await this.authReady;
	}

	private parseEditorLevelMetadata(
		editHtml: string,
	): Array<{ id: number; pool_id: number; index: number; title: string }> {
		const levels: Array<{
			id: number;
			pool_id: number;
			index: number;
			title: string;
		}> = [];
		const seen = new Set<number>();

		const startTagRegex =
			/<div id="l_(\d+)"\s+class="level[^"]*"\s+data-level-id="(\d+)"\s+data-pool-id="(\d+)">/g;

		for (const match of editHtml.matchAll(startTagRegex)) {
			const fromIdAttr = Number(match[2]);
			const fromStartTag = Number(match[1]);
			const poolId = Number(match[3]);
			const id = Number.isFinite(fromIdAttr) ? fromIdAttr : fromStartTag;

			if (!Number.isFinite(id) || !Number.isFinite(poolId) || seen.has(id)) {
				continue;
			}

			const startIndex = match.index ?? 0;
			const snippet = editHtml.slice(startIndex, startIndex + 3500);
			const indexMatch = snippet.match(
				/<div class="level-handle">(\d+)<\/div>/,
			);
			const titleMatch = snippet.match(
				/<h3 class="level-name"[^>]*>\s*([\s\S]*?)\s*<\/h3>/,
			);

			const parsedIndex = Number(indexMatch?.[1]);
			const index = Number.isFinite(parsedIndex)
				? parsedIndex
				: levels.length + 1;
			const titleRaw = (titleMatch?.[1] ?? "").replace(/<[^>]*>/g, "").trim();
			const title = titleRaw || `Level ${index}`;

			levels.push({
				id,
				pool_id: poolId,
				index,
				title,
			});
			seen.add(id);
		}

		return levels;
	}

	async getCsrfToken(): Promise<string | null> {
		const response = await axios.get<EnsureCsrfResponse>(
			"https://community-courses.memrise.com/v1.25/web/ensure_csrf",
			{
				headers: {
					accept: "*/*",
					"sec-fetch-site": "same-origin",
					cookie: this.cookie,
					"sec-fetch-dest": "empty",
					"accept-language": "en-US,en;q=0.9",
					"sec-fetch-mode": "cors",
					"user-agent":
						"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.3 Safari/605.1.15",
					"accept-encoding": "gzip, deflate, br, zstd",
					referer:
						"https://community-courses.memrise.com/signin?next=%2Fdashboard",
					priority: "u=3, i",
				},
			},
		);

		const setCookie = response.headers?.["set-cookie"];
		const setCookieValues = Array.isArray(setCookie)
			? setCookie
			: typeof setCookie === "string"
				? [setCookie]
				: [];

		this.mergeSetCookieCookies(setCookieValues);
		const tokenFromPayload =
			typeof response.data?.csrf_token === "string"
				? response.data.csrf_token
				: null;
		const tokenFromCookie = this.extractFromCookie(this.cookie, "csrftoken");

		return tokenFromPayload ?? tokenFromCookie;
	}

	async getAccessToken(
		username: string,
		password: string,
		clientId: string = DEFAULT_CLIENT_ID,
	): Promise<AccessTokenResponse> {
		const response = await axios.post<AccessTokenResponse>(
			"https://community-courses.memrise.com/v1.25/auth/access_token/",
			{
				username,
				password,
				grant_type: "password",
				client_id: clientId,
			},
			{
				headers: {
					referer:
						"https://community-courses.memrise.com/signin?next=%2Fdashboard",
					cookie: this.cookie,
					"user-agent":
						"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.3 Safari/605.1.15",
					origin: "https://community-courses.memrise.com",
					"sec-fetch-dest": "empty",
					"sec-fetch-site": "same-origin",
					"accept-language": "en-US,en;q=0.9",
					accept: "*/*",
					"content-type": "application/json",
					"accept-encoding": "gzip, deflate, br, zstd",
					"sec-fetch-mode": "cors",
					"x-client-type": "web",
					"x-correlation-id": "df0e2b0d-c4de-4cb8-b976-7f807fbbc77c",
					"x-timezone": "Asia/Phnom_Penh",
					"x-device-type": "desktop",
					"x-os": "mac_os",
					...(this.csrfToken ? { "x-csrftoken": this.csrfToken } : {}),
					...(this.accessToken
						? { authorization: `Bearer ${this.accessToken}` }
						: {}),
					"x-os-version": "10.15.7",
					"x-browser": "Safari",
					"x-browser-version": "26.3",
				},
			},
		);

		const setCookie = response.headers?.["set-cookie"];
		const setCookieValues = Array.isArray(setCookie)
			? setCookie
			: typeof setCookie === "string"
				? [setCookie]
				: [];

		this.mergeSetCookieCookies(setCookieValues);

		return response.data;
	}

	async authenticateWeb(token: string): Promise<AuthWebResponse> {
		const response = await axios.get<AuthWebResponse>(
			"https://community-courses.memrise.com/v1.25/auth/web/",
			{
				params: {
					invalidate_token_after: true,
					token,
				},
				headers: {
					accept: "*/*",
					"sec-fetch-site": "same-origin",
					"sec-fetch-mode": "cors",
					"accept-language": "en-US,en;q=0.9",
					"user-agent":
						"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.3 Safari/605.1.15",
					referer:
						"https://community-courses.memrise.com/signin?next=%2Fdashboard",
					"accept-encoding": "gzip, deflate, br, zstd",
					cookie: this.cookie,
					"sec-fetch-dest": "empty",
					"x-device-type": "desktop",
					"x-correlation-id": crypto.randomUUID(),
					"x-os": "mac_os",
					"x-timezone": "Asia/Phnom_Penh",
					priority: "u=3, i",
					"x-browser": "Safari",
					"x-browser-version": "26.3",
					"x-client-type": "web",
					"x-os-version": "10.15.7",
				},
			},
		);

		const setCookie = response.headers?.["set-cookie"];
		const setCookieValues = Array.isArray(setCookie)
			? setCookie
			: typeof setCookie === "string"
				? [setCookie]
				: [];

		this.mergeSetCookieCookies(setCookieValues);

		// Update CSRF token from the updated cookies
		const updatedCsrfToken = this.extractFromCookie(this.cookie, "csrftoken");
		if (updatedCsrfToken) {
			this.csrfToken = updatedCsrfToken;
			this.client.defaults.headers.common["x-csrftoken"] = updatedCsrfToken;
		}

		return response.data;
	}

	async addThingToLevel(
		levelId: string,
		columns: Record<string, string>,
	): Promise<AddThingResponse> {
		await this.ensureAuthenticated();

		const data = new URLSearchParams();
		data.append("columns", JSON.stringify(columns));
		data.append("level_id", levelId);

		const response = await this.client.post<AddThingResponse>(
			"/ajax/level/thing/add/",
			data,
			{
				headers: {
					"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
				},
			},
		);

		return response.data;
	}

	async addLevelToCourse(
		courseId: string | number,
		poolId?: string | number,
		kind: string = "things",
	): Promise<AddLevelResponse> {
		await this.ensureAuthenticated();

		let resolvedPoolId = poolId;
		if (resolvedPoolId == null) {
			const levels = await this.getCourseLevels(courseId);
			const firstLevel = levels[0];
			if (!firstLevel) {
				throw new Error(
					`No levels found for course ${courseId}. Provide poolId explicitly.`,
				);
			}
			resolvedPoolId = firstLevel.pool_id;
		}

		const data = new URLSearchParams();
		data.append("course_id", String(courseId));
		data.append("kind", kind);
		data.append("pool_id", String(resolvedPoolId));

		const response = await this.client.post<AddLevelResponse>(
			"/ajax/level/add/",
			data,
			{
				headers: {
					"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
				},
			},
		);

		return response.data;
	}

	async setLevelTitle(
		levelId: string | number,
		newTitle: string,
	): Promise<SetLevelTitleResponse> {
		await this.ensureAuthenticated();

		const data = new URLSearchParams();
		data.append("level_id", String(levelId));
		data.append("new_val", newTitle);

		const response = await this.client.post<SetLevelTitleResponse>(
			"/ajax/level/set_title/",
			data,
			{
				headers: {
					"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
				},
			},
		);

		return response.data;
	}

	async deleteLevel(levelId: string | number): Promise<DeleteLevelResponse> {
		await this.ensureAuthenticated();

		const data = new URLSearchParams();
		data.append("level_id", String(levelId));

		const response = await this.client.post<DeleteLevelResponse>(
			"/ajax/level/delete/",
			data,
			{
				headers: {
					"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
				},
			},
		);

		return response.data;
	}

	async deleteThingFromLevel(
		levelId: string | number,
		thingId: string | number,
	): Promise<DeleteThingResponse> {
		await this.ensureAuthenticated();

		const data = new URLSearchParams();
		data.append("level_id", String(levelId));
		data.append("thing_id", String(thingId));

		const response = await this.client.post<DeleteThingResponse>(
			"/ajax/level/thing_remove/",
			data,
			{
				headers: {
					"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
				},
			},
		);

		return response.data;
	}

	async addThingToCourse(
		courseId: string | number,
		columns: Record<string, string>,
		levelIndex: number = 0,
	): Promise<AddThingResponse> {
		await this.ensureAuthenticated();

		const levels = await this.getCourseLevels(courseId);

		if (levels.length === 0) {
			throw new Error(`No levels found for course ${courseId}`);
		}

		if (levelIndex < 0 || levelIndex >= levels.length) {
			throw new Error(
				`Level index ${levelIndex} out of range. Course has ${levels.length} levels.`,
			);
		}

		const level = levels[levelIndex];
		if (!level) {
			throw new Error(`Level at index ${levelIndex} not found`);
		}

		const levelId = String(level.id);
		return this.addThingToLevel(levelId, columns);
	}

	async bulkAddToPool(
		poolId: string | number,
		rows: BulkThingRows,
		delimiter: BulkWordDelimiter = "comma",
	): Promise<BulkAddResponse> {
		await this.ensureAuthenticated();

		const payload = formatBulkThingData(rows, delimiter);
		if (payload.trim() === "") {
			throw new Error("No rows provided for bulk add");
		}

		const data = new URLSearchParams();
		data.append("word_delimiter", delimiter);
		data.append("data", payload);
		data.append("pool_id", String(poolId));

		const response = await this.client.post<BulkAddResponse>(
			"/ajax/pool/add_things_in_bulk/",
			data,
			{
				headers: {
					"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
				},
			},
		);

		return response.data;
	}

	async bulkAddToLevel(
		levelId: string | number,
		rows: BulkThingRows,
		delimiter: BulkWordDelimiter = "comma",
	): Promise<BulkAddResponse> {
		await this.ensureAuthenticated();

		const payload = formatBulkThingData(rows, delimiter);
		if (payload.trim() === "") {
			throw new Error("No rows provided for bulk add");
		}

		const data = new URLSearchParams();
		data.append("word_delimiter", delimiter);
		data.append("data", payload);
		data.append("level_id", String(levelId));

		const response = await this.client.post<BulkAddResponse>(
			"/ajax/level/add_things_in_bulk/",
			data,
			{
				headers: {
					"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
				},
			},
		);

		return response.data;
	}

	async bulkAddToCourse(
		courseId: string | number,
		rows: BulkThingRows,
		levelIndex: number = 0,
		delimiter: BulkWordDelimiter = "comma",
	): Promise<BulkAddResponse> {
		await this.ensureAuthenticated();

		const levels = await this.getCourseLevels(courseId);

		if (levels.length === 0) {
			throw new Error(`No levels found for course ${courseId}`);
		}

		if (levelIndex < 0 || levelIndex >= levels.length) {
			throw new Error(
				`Level index ${levelIndex} out of range. Course has ${levels.length} levels.`,
			);
		}

		const level = levels[levelIndex];
		if (!level) {
			throw new Error(`Level at index ${levelIndex} not found`);
		}

		return this.bulkAddToLevel(level.id, rows, delimiter);
	}

	async searchPool(
		poolId: string | number,
		columns: Record<string, string>,
		excludeThingIds: string[] = [],
		originalOnly: boolean = false,
	): Promise<SearchPoolResponse> {
		const terms = Object.values(columns).filter(
			(value) => typeof value === "string" && value.length > 0,
		);
		if (terms.length === 0) {
			throw new Error(
				"searchPool requires at least one non-empty column value. Memrise's /ajax/pool/search/ endpoint has no 'return everything' mode and responds with HTTP 500 for an empty filter. Use getLevelThings(levelId) to enumerate a level's things instead.",
			);
		}

		await this.ensureAuthenticated();

		const params = {
			pool_id: poolId,
			original_only: originalOnly,
			columns: JSON.stringify(columns),
			exclude_thing_ids: JSON.stringify(excludeThingIds),
			_: Date.now(),
		};

		const response = await this.client.get<SearchPoolResponse>(
			"/ajax/pool/search/",
			{
				params,
			},
		);

		return response.data;
	}

	async getPool(poolId: string | number): Promise<GetPoolResponse> {
		await this.ensureAuthenticated();

		const params = {
			pool_id: poolId,
			_: Date.now(),
		};

		const response = await this.client.get<GetPoolResponse>("/ajax/pool/get/", {
			params,
		});

		return response.data;
	}

	async getMyCourses(
		limit: number = 9,
		offset: number = 0,
	): Promise<GetDashboardCoursesResponse> {
		await this.ensureAuthenticated();

		const params = {
			filter: "teaching",
			limit,
			offset,
		};

		const response = await this.client.get<GetDashboardCoursesResponse>(
			"/v1.25/dashboard/courses/",
			{
				params,
			},
		);

		return response.data;
	}

	async getCourseById(
		courseId: string | number,
	): Promise<DashboardCourse | null> {
		let offset = 0;
		const limit = 9;

		while (true) {
			const response = await this.getMyCourses(limit, offset);
			const course = response.courses.find(
				(c) => String(c.id) === String(courseId),
			);
			if (course) return course;

			if (!response.has_more_pages) return null;
			offset += limit;
		}
	}

	async getCourseBySlug(slug: string): Promise<DashboardCourse | null> {
		let offset = 0;
		const limit = 9;

		while (true) {
			const response = await this.getMyCourses(limit, offset);
			const course = response.courses.find((c) => c.slug === slug);
			if (course) return course;

			if (!response.has_more_pages) return null;
			offset += limit;
		}
	}

	async getCourseLevels(
		courseId: string | number,
		slug?: string,
	): Promise<CourseLevel[]> {
		await this.ensureAuthenticated();

		const response = await this.client.get<{ levels: CourseLevel[] }>(
			`/v1.25/courses/${courseId}/levels/`,
		);

		return response.data.levels;
	}

	async getCourseLevelsIncludingEmpty(
		courseId: string | number,
		slug?: string,
	): Promise<CourseLevel[]> {
		await this.ensureAuthenticated();

		const apiLevels = await this.getCourseLevels(courseId, slug);
		const byId = new Map<string, CourseLevel>();

		for (const level of apiLevels) {
			byId.set(String(level.id), level);
		}

		let resolvedSlug = slug;
		if (!resolvedSlug) {
			const course = await this.getCourseById(courseId);
			if (!course) {
				throw new Error(`Course ${courseId} not found`);
			}
			resolvedSlug = course.slug;
		}

		const response = await this.client.get<string>(
			`/course/${courseId}/${resolvedSlug}/edit/`,
		);
		const editorLevels = this.parseEditorLevelMetadata(response.data);

		for (const editorLevel of editorLevels) {
			const existing = byId.get(String(editorLevel.id));
			if (existing) {
				continue;
			}

			byId.set(String(editorLevel.id), {
				course_id: Number(courseId),
				id: editorLevel.id,
				index: editorLevel.index,
				kind: 1,
				learnable_ids: [],
				pool_id: editorLevel.pool_id,
				title: editorLevel.title,
			});
		}

		return [...byId.values()].sort((a, b) => {
			if (a.index !== b.index) return a.index - b.index;
			return a.id - b.id;
		});
	}

	async getLearnable(learnableId: string | number): Promise<Learnable | null> {
		await this.ensureAuthenticated();

		try {
			const response = await this.client.get<GetLearnableResponse>(
				`/v1.25/learnables/${learnableId}/`,
			);
			return response.data.learnables[String(learnableId)] || null;
		} catch (error) {
			if (axios.isAxiosError(error) && error.response?.status === 404) {
				return null;
			}
			throw error;
		}
	}

	async getCourseItems(
		courseId: string | number,
		limit?: number,
	): Promise<Learnable[]> {
		const levels = await this.getCourseLevels(courseId);
		const learnableIds = levels.flatMap((level) => level.learnable_ids || []);
		const uniqueIds = [...new Set(learnableIds)];

		// Apply limit if specified
		const idsToFetch = limit ? uniqueIds.slice(0, limit) : uniqueIds;

		// Fetch in batches (concurrently) to avoid overloading but speed up
		// Since we don't have a batch API, we do parallel requests with a limit
		const items: Learnable[] = [];
		const concurrency = 5;

		for (let i = 0; i < idsToFetch.length; i += concurrency) {
			const batch = idsToFetch.slice(i, i + concurrency);
			const promises = batch.map((id) => this.getLearnable(id));
			const results = await Promise.all(promises);

			results.forEach((item) => {
				if (item) items.push(item);
			});
		}

		return items;
	}

	async getLevelItems(
		courseId: string | number,
		levelIndex: number = 0,
		limit?: number,
	): Promise<Learnable[]> {
		const levels = await this.getCourseLevels(courseId);

		if (levels.length === 0) {
			throw new Error(`No levels found for course ${courseId}`);
		}

		if (levelIndex < 0 || levelIndex >= levels.length) {
			throw new Error(
				`Level index ${levelIndex} out of range. Course has ${levels.length} levels.`,
			);
		}

		const level = levels[levelIndex];
		if (!level) {
			throw new Error(`Level at index ${levelIndex} not found`);
		}

		const learnableIds = level.learnable_ids || [];
		const idsToFetch = limit ? learnableIds.slice(0, limit) : learnableIds;

		// Fetch in batches (concurrently)
		const items: Learnable[] = [];
		const concurrency = 5;

		for (let i = 0; i < idsToFetch.length; i += concurrency) {
			const batch = idsToFetch.slice(i, i + concurrency);
			const promises = batch.map((id) => this.getLearnable(id));
			const results = await Promise.all(promises);

			results.forEach((item) => {
				if (item) items.push(item);
			});
		}

		return items;
	}

	async getLevelEditingHtml(levelId: string | number): Promise<string> {
		await this.ensureAuthenticated();

		const response = await this.client.get<LevelEditingHtmlResponse>(
			"/ajax/level/editing_html/",
			{
				params: { level_id: levelId, _: Date.now() },
			},
		);

		if (!response.data?.success || typeof response.data.rendered !== "string") {
			throw new Error(`Could not load editing HTML for level ${levelId}.`);
		}

		return response.data.rendered;
	}

	/**
	 * List every thing currently attached to a level, with its column and
	 * attribute values. Backed by the level editing page, which is the only
	 * endpoint that enumerates a level's things -- /ajax/pool/search/ always
	 * needs a search term.
	 */
	async getLevelThings(levelId: string | number): Promise<LevelThing[]> {
		const html = await this.getLevelEditingHtml(levelId);
		return parseLevelThings(html);
	}

	async getCourseColumns(
		courseId: string | number,
	): Promise<Record<string, PoolColumnConfig>> {
		const levels = await this.getCourseLevels(courseId);

		if (levels.length === 0) {
			throw new Error(`No levels found for course ${courseId}`);
		}

		const firstLevel = levels[0];
		if (!firstLevel) {
			throw new Error(`No levels found for course ${courseId}`);
		}

		const poolInfo = await this.getPool(firstLevel.pool_id);
		return poolInfo.pool.columns;
	}
}
