import { z } from 'zod';
import type { Protocol } from './types';

export const providerConnectionInput = z.object({
  id: z.string().uuid().optional(),
  protocol: z.enum(['openai-responses', 'openai-chat', 'anthropic']),
  baseUrl: z
    .string()
    .trim()
    .url('请填写完整的服务地址')
    .refine((value) => {
      const url = new URL(value);
      return (
        ['https:', 'http:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    }, '服务地址需为 HTTP/HTTPS 地址，不包含查询参数或账号密码'),
  apiKey: z.string().trim().max(8192).optional(),
});

export const providerInput = providerConnectionInput.extend({
  name: z.string().trim().min(1, '请填写服务名称').max(80),
  model: z.string().trim().min(1, '请填写模型 ID').max(200),
  models: z.array(z.object({ id: z.string().min(1), name: z.string() })).optional(),
});

/** 设置页支持服务根地址、/v1 地址及完整端点；统一成各官方 SDK 所需的 baseURL。 */
export function sdkBaseUrl(raw: string, protocol: Protocol): string {
  const url = new URL(raw);
  let path = url.pathname.replace(/\/+$/, '');
  path = path.replace(/\/(?:chat\/completions|responses|messages|models)$/, '');
  if (protocol === 'anthropic') path = path.replace(/\/v1$/, '');
  else if (!path) path = '/v1';
  return url.origin + path;
}
