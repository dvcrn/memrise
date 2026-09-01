/**
 * Memrise has two ID namespaces that are easy to confuse. These brands are
 * compile-time only (they erase to plain numbers at runtime), but they stop
 * a learnable ID being passed where a thing ID belongs.
 *
 * IDs handed back by this SDK are already branded. To brand a number from
 * elsewhere, use `asThingId` / `asLearnableId`, which is deliberately an
 * explicit act.
 */
declare const THING_ID: unique symbol;
declare const LEARNABLE_ID: unique symbol;

/** A row in a pool. What the mutation endpoints operate on. */
export type ThingId = number & { readonly [THING_ID]: true };

/** A thing plus the column pair being tested. What levels report. */
export type LearnableId = number & { readonly [LEARNABLE_ID]: true };

export function asThingId(id: number): ThingId {
	return id as ThingId;
}

export function asLearnableId(id: number): LearnableId {
	return id as LearnableId;
}

/**
 * An alternative answer, as Memrise stores it. The `id` is positional within
 * the cell and is reassigned on every write, so it is not a stable handle.
 */
export interface ThingAlt {
	id: number;
	val: string;
}

export interface MemriseColumn {
	val: string;
	kind: string;
	/** Every answer marked correct: the value plus its alternatives, with the hidden-alt `_` prefix stripped. */
	accepted: string[];
	alts: ThingAlt[];
	choices: string[];
	distractors: {
		typing: string[];
		tapping: string[];
		multiple_choice: string[];
		audio: string[];
		default: string[];
	};
	typing_corrects: Record<string, unknown>;
}

export interface MemriseThing {
	id: number;
	pool_id: number;
	columns: Record<string, MemriseColumn>;
	attributes: Record<string, unknown>;
}

export interface AddThingResponse {
	success: boolean;
	thing: MemriseThing;
	rendered_thing: string;
}

export type BulkWordDelimiter = "comma" | "tab" | "semicolon";

export type BulkThingRow = string[] | Record<string, string>;

export type BulkThingRows = string | BulkThingRow[];

export interface BulkAddResponse {
	success: boolean;
	things: MemriseThing[];
}

export interface AddLevelResponse {
	success: boolean;
	/** ID of the level just created, recovered from the redirect URL. */
	levelId?: number;
	redirect_url?: string;
	level?: CourseLevel;
	rendered_level?: string;
	[key: string]: unknown;
}

export interface SetLevelTitleResponse {
	success: boolean;
	[key: string]: unknown;
}

export interface DeleteLevelResponse {
	success: boolean;
	[key: string]: unknown;
}

export interface SetLevelColumnsResponse {
	success: boolean;
	[key: string]: unknown;
}

/** Which family of cell `/ajax/thing/cell/update/` should write to. */
export type ThingCellType = "column" | "attribute";

export interface UpdateThingCellResponse {
	/** Always `null` in practice. The endpoint reports nothing about the write. */
	success: boolean | null;
	[key: string]: unknown;
}

export interface UpdateThingCellOptions {
	/** Which family of cells to write. Defaults to `"column"`. */
	cellType?: ThingCellType;
	/** Pool the thing belongs to. Resolves cell names without a lookup. */
	poolId?: string | number;
}

export interface UpdateThingOptions extends UpdateThingCellOptions {
	/**
	 * Read the row back and confirm the new values are there.
	 *
	 * @default true
	 */
	verify?: boolean;
}

export interface UpdateThingResponse {
	success: boolean;
	thingId: ThingId;
	/** Cells written, in the order they were sent, keyed numerically. */
	updated: Record<string, string>;
	/** Whether the write was read back and confirmed. */
	verified: boolean;
}

export interface UpdateThingAltsResponse {
	/** Always `null` in practice. The endpoint reports nothing about the write. */
	success: boolean | null;
	[key: string]: unknown;
}

export interface SetThingAltsOptions {
	/** Pool the thing belongs to. Resolves a column name without a lookup. */
	poolId?: string | number;
	/**
	 * Read the column back and confirm the alternatives are there.
	 *
	 * @default true
	 */
	verify?: boolean;
}

export interface SetThingAltsResponse {
	success: boolean;
	thingId: ThingId;
	/** Numeric key of the column written. */
	columnKey: string;
	/** The alternatives the cell now holds, in order. */
	alts: string[];
	/** Whether the write was read back and confirmed. */
	verified: boolean;
}

export interface GetThingResponse {
	thing: MemriseThing;
	[key: string]: unknown;
}

/** Response to detaching a thing from a level. */
export interface DetachThingResponse {
	success: boolean;
	[key: string]: unknown;
}

/** Response to destroying a thing outright. */
export interface DeleteThingResponse {
	success: boolean;
	[key: string]: unknown;
}

export interface SearchPoolResultItem {
	id: number;
	columns: Record<string, { val: string }>;
}

export interface SearchPoolResponse {
	success: boolean;
	result: SearchPoolResultItem[];
}

/** A pair of pool columns: one prompts, the other answers. */
export interface ColumnPair {
	learningColumn: number;
	definitionColumn: number;
}

export interface LevelThing {
	/** Pool-authoring identity. This is what detachThingFromLevel needs. */
	thingId: ThingId;
	/** Course-facing identity the thing ID was derived from. */
	learnableId: LearnableId;
	learningElement: string;
	definitionElement: string;
	itemType: string;
	difficulty: string;
}

/** A pool row as the editor's database pages report it. */
export interface PoolThing {
	thingId: ThingId;
	/** Column values in column order, as displayed. Text only. */
	values: string[];
	/** Levels of the course this row is attached to. Empty means orphaned. */
	levelIds: number[];
}

export interface PoolColumnConfig {
	kind: string;
	label: string;
	typing_disabled: boolean;
	typing_strict: boolean;
	show_after_tests: boolean;
	always_show: boolean;
	keyboard: string;
	tapping_disabled: boolean;
	classes: string[];
}

export interface PoolAttributeConfig {
	kind: string;
	label: string;
	show_at_tests: boolean;
}

/**
 * Per-column learning settings, as `/ajax/pool/columns/set/` accepts them.
 *
 * Every field is optional; anything omitted keeps the column's current value.
 */
export interface PoolColumnSettings {
	/** Column heading shown in the editor and the learning experience. */
	label?: string;
	/**
	 * Characters forming the on-screen keyboard. A space wraps to a new row.
	 * Empty means the learner's own keyboard.
	 */
	keyboard?: string;
	/** Render the text slightly larger, e.g. for Chinese. */
	showBigger?: boolean;
	/** Keep the text upright in contexts that would otherwise italicize it. */
	neverItalicize?: boolean;
	/** Suppress typing tests for this column. */
	typingDisabled?: boolean;
	/** Suppress tapping ('rearrange the words') tests for this column. */
	tappingDisabled?: boolean;
	/** Mark typing without ignoring spacing, capitalization or accents. */
	typingStrict?: boolean;
	/** Display the column even when it is not being tested on. */
	alwaysShow?: boolean;
	/** Display the column after a test. */
	showAfterTests?: boolean;
}

export interface SetPoolColumnSettingsResponse {
	/**
	 * Whether the write was accepted. Named `saved`, so a caller checking
	 * `success` here reads `undefined`.
	 */
	saved: boolean;
	[key: string]: unknown;
}

export interface Pool {
	id: number;
	name: string;
	columns: Record<string, PoolColumnConfig>;
	attributes: Record<string, PoolAttributeConfig>;
	can_curate: boolean;
	can_moderate: boolean;
}

export interface GetPoolResponse {
	pool: Pool;
}

export interface DashboardCategory {
	id: string;
	name: string;
	photo_url: string;
	slug: string;
}

export interface DashboardCourseProgress {
	id: number;
	name: string;
	size: number;
	due_review: number;
	learned: number;
	ignored: number;
	difficult: number;
	completed_this_session: boolean;
	percent_complete: number;
}

export interface DashboardCourse {
	id: string;
	name: string;
	slug: string;
	is_official: boolean;
	photo_url: string;
	progress: DashboardCourseProgress;
}

export interface GetDashboardCoursesResponse {
	applied_filter: string;
	applied_category: string | null;
	categories: DashboardCategory[];
	courses: DashboardCourse[];
	has_more_pages: boolean;
}

export interface CourseLevel {
	course_id: number;
	id: number;
	index: number;
	kind: number;
	learnable_ids?: number[];
	pool_id: number;
	title: string;
}

export interface Learnable {
	id: number;
	learning_element: string;
	definition_element: string;
	item_type: string;
	difficulty: string;
}

/**
 * A learnable as this SDK hands it out: the raw fields plus the thing ID it
 * was built from, so callers never have to unpack the ID themselves.
 */
export interface CourseItem {
	learnableId: LearnableId;
	thingId: ThingId;
	/** Levels this item appears in. Normally one, but the API permits more. */
	levelIds: number[];
	learningElement: string;
	definitionElement: string;
	itemType: string;
	difficulty: string;
}

export interface GetLearnableResponse {
	learnables: Record<string, Learnable>;
}

export interface EnsureCsrfResponse {
	csrf_token: string;
}

export interface AccessTokenPayload {
	access_token: string;
	token_type: string;
	expires_in: number;
	refresh_token?: string;
	scope: string;
	[key: string]: unknown;
}

export interface AccessTokenUser {
	id: number;
	username: string;
	is_new: boolean;
}

export interface AccessTokenResponse {
	access_token: AccessTokenPayload;
	user: AccessTokenUser;
}

export interface AuthWebResponse {
	success?: boolean;
	[key: string]: unknown;
}

export interface ProfileSubscription {
	expiry: string;
	is_active: boolean;
	is_on_hold: boolean;
	subscription_type: number;
}

export interface ProfileAvatar {
	normal: string;
	small: string;
	large: string;
}

export interface ProfileStatistics {
	points: number;
	longest_streak: number;
	num_things_flowered: number;
}

/** The signed-in account. */
export interface Profile {
	id: number;
	username: string;
	email: string;
	date_joined: string;
	language: string;
	timezone: string;
	is_staff: boolean;
	is_pro: boolean;
	is_guest: boolean;
	has_facebook: boolean;
	has_password_set: boolean;
	has_lapsed_pro: boolean;
	pro_trial_ended: string | null;
	subscription: ProfileSubscription;
	avatar: ProfileAvatar;
	statistics: ProfileStatistics;
	[key: string]: unknown;
}

export interface GetMeResponse {
	profile: Profile;
}
