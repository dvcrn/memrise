import axios from 'axios';
import type {
  AddThingResponse,
  SearchPoolResponse,
  GetPoolResponse,
  GetDashboardCoursesResponse,
  DashboardCourse,
  CourseLevel,
  Learnable,
  GetLearnableResponse,
  EnsureCsrfResponse,
  AccessTokenResponse,
  AuthWebResponse,
  PoolColumnConfig
} from './types';

const DEFAULT_CLIENT_ID = '1e739f5e77704b57a703';

export class MemriseClient {
  private client = axios.create({
    baseURL: 'https://community-courses.memrise.com',
    headers: {
      'origin': 'https://community-courses.memrise.com',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
      'x-requested-with': 'XMLHttpRequest',
    },
  });
  private cookie: string;
  private csrfToken: string | null;
  private accessToken: string | null;
  private cookieJar: Map<string, string>;
  private authReady: Promise<void>;

  constructor(username: string, password: string, clientId: string = DEFAULT_CLIENT_ID) {
    this.cookie = '';
    this.csrfToken = null;
    this.accessToken = null;
    this.cookieJar = new Map();

    this.authReady = this.authenticateWithCredentials(username, password, clientId);
  }

  private async authenticateWithCredentials(
    username: string,
    password: string,
    clientId: string
  ): Promise<void> {
    const csrf = await this.getCsrfToken();
    if (csrf) {
      this.csrfToken = csrf;
      this.client.defaults.headers.common['x-csrftoken'] = csrf;
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
      const firstPair = item.split(';')[0];
      const [name, ...rest] = firstPair.split('=');
      if (!name || rest.length === 0) continue;
      this.cookieJar.set(name, rest.join('='));
    }

    this.cookie = [...this.cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
    this.client.defaults.headers.common['cookie'] = this.cookie;
  }

  private extractFromCookie(cookieHeader: string, name: string): string | null {
    const match = cookieHeader.match(new RegExp(`${name}=([^;]+)`));
    return match ? match[1] : null;
  }

  private async ensureAuthenticated(): Promise<void> {
    await this.authReady;
  }

  async getCsrfToken(): Promise<string | null> {
    const response = await axios.get<EnsureCsrfResponse>(
      'https://community-courses.memrise.com/v1.25/web/ensure_csrf',
      {
        headers: {
          'accept': '*/*',
          'sec-fetch-site': 'same-origin',
          'cookie': this.cookie,
          'sec-fetch-dest': 'empty',
          'accept-language': 'en-US,en;q=0.9',
          'sec-fetch-mode': 'cors',
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.3 Safari/605.1.15',
          'accept-encoding': 'gzip, deflate, br, zstd',
          'referer': 'https://community-courses.memrise.com/signin?next=%2Fdashboard',
          'priority': 'u=3, i'
        },
      },
    );

    const setCookie = response.headers?.['set-cookie'];
    const setCookieValues = Array.isArray(setCookie)
      ? setCookie
      : typeof setCookie === 'string'
      ? [setCookie]
      : [];

    this.mergeSetCookieCookies(setCookieValues);
    const tokenFromPayload = typeof response.data?.csrf_token === 'string'
      ? response.data.csrf_token
      : null;
    const tokenFromCookie = this.extractFromCookie(this.cookie, 'csrftoken');

    return tokenFromPayload ?? tokenFromCookie;
  }

  async getAccessToken(
    username: string,
    password: string,
    clientId: string = DEFAULT_CLIENT_ID
  ): Promise<AccessTokenResponse> {
    const response = await axios.post<AccessTokenResponse>(
      'https://community-courses.memrise.com/v1.25/auth/access_token/',
      {
        username,
        password,
        grant_type: 'password',
        client_id: clientId,
      },
      {
        headers: {
          'referer': 'https://community-courses.memrise.com/signin?next=%2Fdashboard',
          'cookie': this.cookie,
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.3 Safari/605.1.15',
          'origin': 'https://community-courses.memrise.com',
          'sec-fetch-dest': 'empty',
          'sec-fetch-site': 'same-origin',
          'accept-language': 'en-US,en;q=0.9',
          'accept': '*/*',
          'content-type': 'application/json',
          'accept-encoding': 'gzip, deflate, br, zstd',
          'sec-fetch-mode': 'cors',
          'x-client-type': 'web',
          'x-correlation-id': 'df0e2b0d-c4de-4cb8-b976-7f807fbbc77c',
          'x-timezone': 'Asia/Phnom_Penh',
          'x-device-type': 'desktop',
          'x-os': 'mac_os',
          ...(this.csrfToken ? { 'x-csrftoken': this.csrfToken } : {}),
          ...(this.accessToken ? { 'authorization': `Bearer ${this.accessToken}` } : {}),
          'x-os-version': '10.15.7',
          'x-browser': 'Safari',
          'x-browser-version': '26.3'
        },
      },
    );

    const setCookie = response.headers?.['set-cookie'];
    const setCookieValues = Array.isArray(setCookie)
      ? setCookie
      : typeof setCookie === 'string'
      ? [setCookie]
      : [];

    this.mergeSetCookieCookies(setCookieValues);

    return response.data;
  }

  async authenticateWeb(token: string): Promise<AuthWebResponse> {
    const response = await axios.get<AuthWebResponse>(
      'https://community-courses.memrise.com/v1.25/auth/web/',
      {
        params: {
          invalidate_token_after: true,
          token
        },
        headers: {
          'accept': '*/*',
          'sec-fetch-site': 'same-origin',
          'sec-fetch-mode': 'cors',
          'accept-language': 'en-US,en;q=0.9',
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.3 Safari/605.1.15',
          'referer': 'https://community-courses.memrise.com/signin?next=%2Fdashboard',
          'accept-encoding': 'gzip, deflate, br, zstd',
          'cookie': this.cookie,
          'sec-fetch-dest': 'empty',
          'x-device-type': 'desktop',
          'x-correlation-id': crypto.randomUUID(),
          'x-os': 'mac_os',
          'x-timezone': 'Asia/Phnom_Penh',
          'priority': 'u=3, i',
          'x-browser': 'Safari',
          'x-browser-version': '26.3',
          'x-client-type': 'web',
          'x-os-version': '10.15.7'
        }
      }
    );

    const setCookie = response.headers?.['set-cookie'];
    const setCookieValues = Array.isArray(setCookie)
      ? setCookie
      : typeof setCookie === 'string'
      ? [setCookie]
      : [];

    this.mergeSetCookieCookies(setCookieValues);

    // Update CSRF token from the updated cookies
    const updatedCsrfToken = this.extractFromCookie(this.cookie, 'csrftoken');
    if (updatedCsrfToken) {
      this.csrfToken = updatedCsrfToken;
      this.client.defaults.headers.common['x-csrftoken'] = updatedCsrfToken;
    }

    return response.data;
  }

  async addThingToLevel(levelId: string, columns: Record<string, string>): Promise<AddThingResponse> {
    await this.ensureAuthenticated();

    const data = new URLSearchParams();
    data.append('columns', JSON.stringify(columns));
    data.append('level_id', levelId);

    const response = await this.client.post<AddThingResponse>('/ajax/level/thing/add/', data, {
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8'
      }
    });

    return response.data;
  }

  async addThingToCourse(
    courseId: string | number,
    columns: Record<string, string>,
    levelIndex: number = 0
  ): Promise<AddThingResponse> {
    await this.ensureAuthenticated();

    const levels = await this.getCourseLevels(courseId);

    if (levels.length === 0) {
      throw new Error(`No levels found for course ${courseId}`);
    }

    if (levelIndex < 0 || levelIndex >= levels.length) {
      throw new Error(`Level index ${levelIndex} out of range. Course has ${levels.length} levels.`);
    }

    const levelId = String(levels[levelIndex].id);
    return this.addThingToLevel(levelId, columns);
  }

  async searchPool(
    poolId: string | number,
    columns: Record<string, string>,
    excludeThingIds: string[] = [],
    originalOnly: boolean = false
  ): Promise<SearchPoolResponse> {
    await this.ensureAuthenticated();

    const params = {
      pool_id: poolId,
      original_only: originalOnly,
      columns: JSON.stringify(columns),
      exclude_thing_ids: JSON.stringify(excludeThingIds),
      _: Date.now()
    };

    const response = await this.client.get<SearchPoolResponse>('/ajax/pool/search/', {
      params
    });

    return response.data;
  }

  async getPool(poolId: string | number): Promise<GetPoolResponse> {
    await this.ensureAuthenticated();

    const params = {
      pool_id: poolId,
      _: Date.now()
    };

    const response = await this.client.get<GetPoolResponse>('/ajax/pool/get/', {
      params
    });

    return response.data;
  }

  async getMyCourses(
    limit: number = 9,
    offset: number = 0
  ): Promise<GetDashboardCoursesResponse> {
    await this.ensureAuthenticated();

    const params = {
      filter: 'teaching',
      limit,
      offset
    };

    const response = await this.client.get<GetDashboardCoursesResponse>('/v1.25/dashboard/courses/', {
      params
    });

    return response.data;
  }

  async getCourseById(courseId: string | number): Promise<DashboardCourse | null> {
    let offset = 0;
    const limit = 9;
    
    while (true) {
      const response = await this.getMyCourses(limit, offset);
      const course = response.courses.find(c => String(c.id) === String(courseId));
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
      const course = response.courses.find(c => c.slug === slug);
      if (course) return course;
      
      if (!response.has_more_pages) return null;
      offset += limit;
    }
  }

  async getCourseLevels(courseId: string | number, slug?: string): Promise<CourseLevel[]> {
    await this.ensureAuthenticated();

    const response = await this.client.get<{ levels: CourseLevel[] }>(`/v1.25/courses/${courseId}/levels/`);
    
    return response.data.levels;
  }

  async getLearnable(learnableId: string | number): Promise<Learnable | null> {
    await this.ensureAuthenticated();

    try {
      const response = await this.client.get<GetLearnableResponse>(`/v1.25/learnables/${learnableId}/`);
      return response.data.learnables[String(learnableId)] || null;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async getCourseItems(courseId: string | number): Promise<Learnable[]> {
    const levels = await this.getCourseLevels(courseId);
    const learnableIds = levels.flatMap(level => level.learnable_ids || []);
    const uniqueIds = [...new Set(learnableIds)];

    // Fetch in batches (concurrently) to avoid overloading but speed up
    // Since we don't have a batch API, we do parallel requests with a limit
    const items: Learnable[] = [];
    const concurrency = 5;

    for (let i = 0; i < uniqueIds.length; i += concurrency) {
      const batch = uniqueIds.slice(i, i + concurrency);
      const promises = batch.map(id => this.getLearnable(id));
      const results = await Promise.all(promises);

      results.forEach(item => {
        if (item) items.push(item);
      });
    }

    return items;
  }

  async getCourseColumns(courseId: string | number): Promise<Record<string, PoolColumnConfig>> {
    const levels = await this.getCourseLevels(courseId);

    if (levels.length === 0) {
      throw new Error(`No levels found for course ${courseId}`);
    }

    const poolInfo = await this.getPool(levels[0].pool_id);
    return poolInfo.pool.columns;
  }
}
