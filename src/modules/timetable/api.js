/**
 * 课表识别接口适配层。
 * 浏览器只请求同源 `/api/schedule/recognize`，DeepSeek 密钥保存在服务端。
 */

export const DEFAULT_ENDPOINT = '/api/schedule/recognize';
const DEFAULT_TIMEOUT_MS = 180000;

function apiError(code, message, retryable = false) {
  return { ok: false, error: { code, message, retryable } };
}

/**
 * @param {string} imageDataUrl 压缩后的 base64 data URL
 * @returns {Promise<{ok:true,data:{courses:object[],warnings:string[]}}|{ok:false,error:{code:string,message:string,retryable:boolean}}>}
 */
export async function recognizeSchedule(imageDataUrl, options = {}) {
  const {
    endpoint = DEFAULT_ENDPOINT,
    fetchImpl = globalThis.fetch,
    signal: externalSignal,
    timeoutMs = DEFAULT_TIMEOUT_MS
  } = options;

  if (!imageDataUrl) {
    return apiError('NO_IMAGE', '请先上传课表截图');
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ image: imageDataUrl }),
      signal: controller.signal,
      cache: 'no-store'
    });

    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return apiError('BAD_RESPONSE', '识别服务返回了无法解析的内容，请稍后重试', true);
    }

    if (!json || typeof json.ok !== 'boolean') {
      return apiError('BAD_RESPONSE', '识别服务返回结构异常，请稍后重试', true);
    }
    if (json.ok === false) {
      const error = json.error || {};
      return apiError(
        typeof error.code === 'string' ? error.code : 'UNKNOWN',
        typeof error.message === 'string' ? error.message : '识别失败，请稍后重试',
        Boolean(error.retryable)
      );
    }

    const data = json.data;
    if (!data || !Array.isArray(data.courses)) {
      return apiError('BAD_RESPONSE', '识别结果缺少课程列表，请稍后重试', true);
    }
    return {
      ok: true,
      data: {
        courses: data.courses,
        warnings: Array.isArray(data.warnings) ? data.warnings.filter((item) => typeof item === 'string') : []
      }
    };
  } catch {
    if (timedOut) {
      return apiError('TIMEOUT', '识别超时，请裁剪图片后在网络较好时重试', true);
    }
    if (externalSignal?.aborted) {
      return apiError('ABORTED', '已取消识别', false);
    }
    return apiError(
      'NETWORK',
      '无法连接识别服务，请确认本地服务已启动（npm run dev）后重试',
      true
    );
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  }
}

export function mapErrorHint(code) {
  switch (code) {
    case 'MODEL_NOT_CONFIGURED':
      return '服务端未配置 DeepSeek 密钥，请检查 .env.local 中的 DEEPSEEK_API_KEY。';
    case 'AI_AUTH_FAILED':
      return 'DeepSeek 密钥无效或已过期，请更新服务端配置。';
    case 'AI_RATE_LIMITED':
      return '识别请求过于频繁，请等待片刻后重试。';
    case 'NO_COURSES':
      return '未识别出课程：请裁剪到课表主体，或上传更清晰的截图。';
    case 'INVALID_IMAGE':
      return '图片格式不受支持，请使用 PNG/JPG/WebP。';
    case 'AI_TIMEOUT':
      return '识别超时，可裁剪掉无关区域后重试。';
    default:
      return '';
  }
}
