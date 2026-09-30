import { getApiBaseUrl } from '../config/api';
import type { ApiResponse } from './api-contract';
import { getDeviceToken } from './device-auth';

export interface RequestOptions {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly data?: unknown;
  readonly header?: Record<string, string>;
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
  UNDO_NOT_AVAILABLE: '当前没有可悔的棋步',
  OPERATION_REQUEST_CONFLICT: '操作编号已被使用，请刷新棋局',
  OPERATION_ALREADY_PENDING: '已有待处理申请',
  REMOTE_UNDO_PENDING: '已有待处理的悔棋申请',
  OPERATION_NOT_ALLOWED: '无权处理此操作',
  INVALID_GAME_RESPONSE: '棋局数据异常，请刷新重试',
  NODE_NOT_FOUND: '棋盘位置无效',
  INSUFFICIENT_RESERVE: '备用棋不足',
  GAME_NOT_FINISHED: '棋局尚未结束，暂不能生成复盘',
  REVIEW_INCOMPLETE: '复盘搜索未完成，请稍后重试',
  REVIEW_NOT_FOUND: '尚未生成复盘',
  REVIEW_REQUIRED: '请先生成棋局复盘',
  TRAINING_NOT_FOUND: '训练题不存在，请返回题目列表',
  TRAINING_ATTEMPT_CONFLICT: '本次提交编号已使用，请重新选择题目',
  TRAINING_SCORING_INCOMPLETE: '本题评分未完成，请稍后重试',
  REMOTE_ACCESS_DENIED: '本机没有此房间的席位凭证',
  REMOTE_ROOM_NOT_FOUND: '房间不存在，请核对房间码',
  REMOTE_ROOM_UNAVAILABLE: '房间已关闭或已有两位玩家',
  REMOTE_SELF_JOIN: '请用另一台设备加入房间',
  REMOTE_CODE_CONFLICT: '房间码暂时无法生成，请重试',
  REMOTE_REQUEST_CONFLICT: '落子编号冲突，请刷新棋局',
  NOT_YOUR_TURN: '还未轮到你落子',
  REMOTE_ACTION_REQUIRED: '请从远程双人房间进入棋局',
  AUTH_REQUIRED: '请先连接网络创建本机账号',
  AUTH_INVALID: '本机账号已失效，请联系客服处理',
  AUTH_FORBIDDEN: '这条记录不属于当前设备账号',
};

export function messageForApiError(error: unknown): string {
  return error instanceof ApiError
    ? publicMessages[error.code] ?? '服务暂时不可用，请稍后重试'
    : '服务暂时不可用，请稍后重试';
}

const wxRequest: RequestAdapter = options => {
  wx.request({
    url: options.url, method: options.method, data: options.data as never,
    header: options.header,
    timeout: options.timeout,
    success: response => options.success({ statusCode: response.statusCode, data: response.data }),
    fail: error => options.fail(error),
  });
};

export interface ApiClient {
  request<T>(method: 'GET' | 'POST', path: string, data?: unknown, timeout?: number,
             header?: Record<string, string>): Promise<T>;
}

export function createApiClient({ baseUrl, request = wxRequest, deviceTokenProvider }: {
  baseUrl?: string; request?: RequestAdapter;
  deviceTokenProvider?: () => Promise<string>;
} = {}): ApiClient {
  const root = (baseUrl ?? getApiBaseUrl()).replace(/\/$/, '');
  return {
    async request<T>(method: 'GET' | 'POST', path: string, data?: unknown, timeout = 10000,
               header?: Record<string, string>): Promise<T> {
      const provider = deviceTokenProvider ?? (request === wxRequest
        ? () => getDeviceToken(root) : null);
      const token = provider && path !== '/api/v1/auth/device'
        ? await provider() : null;
      return new Promise<T>((resolve, reject) => {
        const options: RequestOptions = {
          url: `${root}${path}`, method, timeout,
          ...(data === undefined ? {} : { data }),
          ...(!token && header === undefined ? {} : {
            header: { ...(header ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          }),
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
