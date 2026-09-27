import { getApiBaseUrl } from '../config/api';
import type { ApiResponse } from './api-contract';

export interface RequestOptions {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly data?: unknown;
  readonly timeout: number;
  readonly success: (response: { statusCode: number; data: unknown }) => void;
  readonly fail: (error: { errMsg?: string }) => void;
}

export type RequestAdapter = (options: RequestOptions) => void;

export class ApiError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, statusCode: number, detail = code) {
    super(detail);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const publicMessages: Readonly<Record<string, string>> = {
  GAME_NOT_FOUND: '棋局不存在，请重新开始',
  GAME_STATE_CONFLICT: '棋局状态已更新',
  NOT_AI_TURN: '当前轮到玩家落子',
  NOT_HUMAN_TURN: 'AI 正在进行本回合',
  AI_MODE_REQUIRED: '此棋局未开启 AI 对战',
  ENGINE_UNAVAILABLE: '棋局服务暂时不可用，请稍后重试',
  DATABASE_UNAVAILABLE: '棋局服务暂时不可用，请稍后重试',
  NETWORK_ERROR: '网络连接失败，请检查网络后重试',
  INVALID_MOVE: '落子无效，请重新选择',
  NOT_PLAYER_TURN: '还未轮到这方落子',
  PATH_BLOCKED: '移动路线被阻挡',
  TARGET_OCCUPIED: '目标位置已有棋子',
  GAME_ALREADY_FINISHED: '本局已结束',
  NODE_NOT_FOUND: '棋盘位置无效',
  INSUFFICIENT_RESERVE: '备用棋不足',
  GAME_NOT_FINISHED: '棋局尚未结束，暂不能生成复盘',
  REVIEW_INCOMPLETE: '复盘搜索未完成，请稍后重试',
  REVIEW_NOT_FOUND: '尚未生成复盘',
  REVIEW_REQUIRED: '请先生成棋局复盘',
  TRAINING_NOT_FOUND: '训练题不存在，请返回题目列表',
  TRAINING_ATTEMPT_CONFLICT: '本次提交编号已使用，请重新选择题目',
  TRAINING_SCORING_INCOMPLETE: '本题评分未完成，请稍后重试',
};

export function messageForApiError(error: unknown): string {
  return error instanceof ApiError
    ? publicMessages[error.code] ?? '服务暂时不可用，请稍后重试'
    : '服务暂时不可用，请稍后重试';
}

const wxRequest: RequestAdapter = options => {
  wx.request({
    url: options.url, method: options.method, data: options.data as never,
    timeout: options.timeout,
    success: response => options.success({ statusCode: response.statusCode, data: response.data }),
    fail: error => options.fail(error),
  });
};

export interface ApiClient {
  request<T>(method: 'GET' | 'POST', path: string, data?: unknown, timeout?: number): Promise<T>;
}

export function createApiClient({ baseUrl, request = wxRequest }: {
  baseUrl?: string; request?: RequestAdapter;
} = {}): ApiClient {
  const root = (baseUrl ?? getApiBaseUrl()).replace(/\/$/, '');
  return {
    request<T>(method: 'GET' | 'POST', path: string, data?: unknown, timeout = 10000): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const options: RequestOptions = {
          url: `${root}${path}`, method, timeout,
          ...(data === undefined ? {} : { data }),
          success: response => {
            const envelope = response.data as Partial<ApiResponse<T>> | null;
            if (envelope && typeof envelope === 'object' &&
                (typeof envelope.code === 'string' || typeof envelope.code === 'number') &&
                envelope.code !== 0) {
              reject(new ApiError(String(envelope.code), response.statusCode,
                                  typeof envelope.message === 'string' ? envelope.message : undefined));
              return;
            }
            if (response.statusCode >= 200 && response.statusCode < 300 &&
                envelope?.code === 0 && envelope.data != null) {
              resolve(envelope.data);
              return;
            }
            reject(new ApiError('SERVER_UNAVAILABLE', response.statusCode));
          },
          fail: error => reject(new ApiError('NETWORK_ERROR', 0, error.errMsg)),
        };
        try { request(options); }
        catch { reject(new ApiError('NETWORK_ERROR', 0)); }
      });
    },
  };
}
