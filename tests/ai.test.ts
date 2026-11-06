import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  streamReply,
  describeError,
  listModels,
  createPiRuntime,
  buildSystemPrompt,
} from '../src/main/ai';
import { startMockServer } from '../scripts/mock-server';
import { sdkBaseUrl } from '../src/shared/validation';
import type { Protocol, Provider } from '../src/shared/types';

let mock: Awaited<ReturnType<typeof startMockServer>>;
beforeAll(async () => {
  mock = await startMockServer({ delayMs: 0 });
});
afterAll(async () => {
  await mock.close();
});
const protocols: Protocol[] = ['openai-responses', 'openai-chat', 'anthropic'];
function textContent(content: string | { text?: string }[]): string {
  return typeof content === 'string' ? content : content.map((block) => block.text ?? '').join('');
}
function provider(protocol: Protocol): Provider {
  return {
    id: 'fixture',
    name: '协议测试',
    protocol,
    baseUrl: mock.url + '/v1',
    model: 'dola-mock-model',
    hasKey: true,
  };
}

describe.each(protocols)('%s HTTP 集成', (protocol) => {
  it('通过实际 HTTP 流接收完整中文回复，并发送当前协议的鉴权与历史', async () => {
    const chunks: string[] = [];
    const result = await streamReply(
      provider(protocol),
      'fixture-secret',
      [
        { role: 'user', text: '上一轮问题' },
        { role: 'assistant', text: '上一轮回答' },
        { role: 'user', text: '解释梯度下降' },
      ],
      new AbortController().signal,
      (text) => chunks.push(text),
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toContain('解释梯度下降');
    expect(chunks.join('')).not.toContain('\uFFFD');
    expect(result).toEqual({ incomplete: false, usage: { input: 42, output: 80 } });
    const request = mock.requests.at(-1)!;
    expect(request.body.stream).toBe(true);
    const systemInstructions =
      protocol === 'anthropic'
        ? textContent(request.body.system)
        : protocol === 'openai-responses'
          ? request.body.input
              .filter((message: any) => message.role === 'system')
              .map((message: any) => textContent(message.content))
              .join('\n')
          : textContent(request.body.messages[0].content);
    expect(systemInstructions).toContain('始终使用简体中文回复');
    expect(systemInstructions).toContain('无论用户用哪种语言提问');
    if (protocol === 'anthropic') {
      expect(request.path.split('?')[0]).toBe('/v1/messages');
      expect(request.headers['anthropic-version']).toBe('2023-06-01');
      expect(request.headers['x-api-key']).toBe('fixture-secret');
      expect(request.headers.authorization).toBeUndefined();
      expect(systemInstructions).toContain('NEU-Dela');
      expect(request.body.messages).toHaveLength(3);
      expect(request.body.max_tokens).toBe(4096);
    } else {
      expect(request.headers.authorization).toBe('Bearer fixture-secret');
      expect(request.body.max_tokens).toBeUndefined();
      expect(request.body.max_completion_tokens).toBeUndefined();
      expect(request.body.max_output_tokens).toBeUndefined();
      if (protocol === 'openai-responses') {
        expect(request.path).toBe('/v1/responses');
        expect(request.body.store).toBe(false);
        expect(request.body.input).toHaveLength(4);
      } else {
        expect(request.path).toBe('/v1/chat/completions');
        expect(request.body.messages).toHaveLength(4);
      }
    }
    const history = (request.body.input ?? request.body.messages)
      .filter((message: any) => message.role === 'user' || message.role === 'assistant')
      .map((message: any) => ({ role: message.role, text: textContent(message.content) }));
    expect(history).toEqual([
      { role: 'user', text: '上一轮问题' },
      { role: 'assistant', text: '上一轮回答' },
      { role: 'user', text: '解释梯度下降' },
    ]);
  });

  it('会话可直接使用原生 ModelRuntime，协议映射与连接凭据保持独立', async () => {
    const first = await createPiRuntime(provider(protocol), 'fixture-first-key');
    const second = await createPiRuntime(provider(protocol), 'fixture-second-key');
    expect(first.model.api).toBe(
      {
        'openai-responses': 'openai-responses',
        'openai-chat': 'openai-completions',
        anthropic: 'anthropic-messages',
      }[protocol],
    );
    expect(first.model.contextWindow).toBe(32768);
    expect(first.model.maxTokens).toBe(4096);
    const response = await first.modelRuntime.completeSimple(
      first.model,
      {
        systemPrompt: buildSystemPrompt(),
        messages: [{ role: 'user', content: '原生会话请求', timestamp: Date.now() }],
      },
      { maxRetries: 0 },
    );
    expect(response.stopReason).toBe('stop');
    expect(
      response.content.some(
        (block) => block.type === 'text' && block.text.includes('原生会话请求'),
      ),
    ).toBe(true);
    expect(
      mock.requests.at(-1)?.headers[protocol === 'anthropic' ? 'x-api-key' : 'authorization'],
    ).toBe(protocol === 'anthropic' ? 'fixture-first-key' : 'Bearer fixture-first-key');
    expect((await second.modelRuntime.getAuth(second.model))?.auth.apiKey).toBe(
      'fixture-second-key',
    );
  });

  it('未选择模型时也能通过 GET 获取模型列表，使用当前协议的鉴权', async () => {
    const models = await listModels({ protocol, baseUrl: mock.url + '/v1' }, 'fixture-secret');
    expect(models.map((model) => model.id)).toEqual([
      'dola-mock-openai',
      'dola-mock-claude',
      'dola-mock-compatible',
    ]);
    const request = mock.requests.at(-1)!;
    expect(request.method).toBe('GET');
    expect(request.path.split('?')[0]).toBe('/v1/models');
    if (protocol === 'anthropic') {
      expect(request.headers['x-api-key']).toBe('fixture-secret');
      expect(request.headers['anthropic-version']).toBe('2023-06-01');
      expect(request.headers.authorization).toBeUndefined();
      expect(models[1].name).toBe('本地模拟 Claude');
    } else expect(request.headers.authorization).toBe('Bearer fixture-secret');
  });

  it('取消生成时中止 HTTP 流，不返回伪成功', async () => {
    const controller = new AbortController();
    let text = '';
    await expect(
      streamReply(
        provider(protocol),
        'fixture-secret',
        [{ role: 'user', text: '[slow]' }],
        controller.signal,
        (delta) => {
          text += delta;
          controller.abort();
        },
      ),
    ).rejects.toThrow();
    expect(text.length).toBeGreaterThan(0);
  });

  it('连接提前结束时报告中断并保留已接收内容', async () => {
    let text = '';
    await expect(
      streamReply(
        provider(protocol),
        'fixture-secret',
        [{ role: 'user', text: '[disconnect]' }],
        new AbortController().signal,
        (delta) => {
          text += delta;
        },
      ),
    ).rejects.toThrow('结束标记');
    expect(text.length).toBeGreaterThan(0);
  });

  it('输出达到上限时返回 incomplete', async () => {
    const result = await streamReply(
      provider(protocol),
      'fixture-secret',
      [{ role: 'user', text: '[limit]' }],
      new AbortController().signal,
      () => {},
    );
    expect(result.incomplete).toBe(true);
  });

  it('HTTP 401 返回可操作的错误，不自动重复请求', async () => {
    const before = mock.requests.length;
    let caught: unknown;
    try {
      await streamReply(
        provider(protocol),
        'fixture-secret',
        [{ role: 'user', text: '[http401]' }],
        new AbortController().signal,
        () => {},
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(describeError(caught)).toContain('API Key');
    expect(mock.requests.length - before).toBe(1);
  });

  it('HTTP 500 不触发底层默认重试', async () => {
    const before = mock.requests.length;
    await expect(
      streamReply(
        provider(protocol),
        'fixture-secret',
        [{ role: 'user', text: '[http500]' }],
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow('500');
    expect(mock.requests.length - before).toBe(1);
  });

  it('HTTP 错误回显连接密钥时，调用方收到的错误已隐藏该密钥', async () => {
    let caught: unknown;
    try {
      await streamReply(
        provider(protocol),
        'fixture-echo-key',
        [{ role: 'user', text: '[http401-echo-key]' }],
        new AbortController().signal,
        () => {},
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).toContain('[已隐藏密钥]');
    expect(String(caught)).not.toContain('fixture-echo-key');
    expect(describeError(caught)).toContain('API Key');
  });

  it('连接测试保留既有协议输出长度参数，Chat 网关不增加不兼容字段', async () => {
    await streamReply(
      provider(protocol),
      'fixture-secret',
      [{ role: 'user', text: '请只回复“连接正常”。' }],
      new AbortController().signal,
      () => {},
      64,
    );
    const body = mock.requests.at(-1)!.body;
    if (protocol === 'anthropic') expect(body.max_tokens).toBe(64);
    else if (protocol === 'openai-responses') expect(body.max_output_tokens).toBe(64);
    else {
      expect(body.max_tokens).toBeUndefined();
      expect(body.max_completion_tokens).toBeUndefined();
    }
  });

  it('流内 error 事件作为失败处理', async () => {
    await expect(
      streamReply(
        provider(protocol),
        'fixture-secret',
        [{ role: 'user', text: '[stream-error]' }],
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow();
  });
});

it('Anthropic 模型列表读取后续分页，完整消息端点也能用于获取列表', async () => {
  const paginated = await startMockServer({ paginateModels: true });
  try {
    const models = await listModels(
      { protocol: 'anthropic', baseUrl: paginated.url + '/v1/messages' },
      'fixture-secret',
    );
    expect(models).toHaveLength(3);
    expect(paginated.requests).toHaveLength(2);
    expect(paginated.requests[1].path).toContain('after_id=dola-mock-openai');
  } finally {
    await paginated.close();
  }
});

it('模型接口返回空列表时不编造模型', async () => {
  const empty = await startMockServer({ models: [] });
  try {
    expect(
      await listModels({ protocol: 'openai-chat', baseUrl: empty.url }, 'fixture-secret'),
    ).toEqual([]);
  } finally {
    await empty.close();
  }
});

it.each([
  ['fixture-denied-key', '/v1', 401],
  ['fixture-secret', '/missing/v1', 404],
] as const)('获取模型失败时返回 HTTP 错误，不自动重试：%s %s', async (key, path, status) => {
  const before = mock.requests.length;
  await expect(
    listModels({ protocol: 'openai-chat', baseUrl: mock.url + path }, key),
  ).rejects.toMatchObject({ status });
  expect(mock.requests.length - before).toBe(1);
});

it('支持设置页常见的根地址、v1 地址、完整端点及网关路径前缀', () => {
  expect(sdkBaseUrl('https://example.com', 'openai-responses')).toBe('https://example.com/v1');
  expect(sdkBaseUrl('https://example.com/v1/chat/completions', 'openai-chat')).toBe(
    'https://example.com/v1',
  );
  expect(sdkBaseUrl('https://example.com/proxy/v1/messages', 'anthropic')).toBe(
    'https://example.com/proxy',
  );
});

it('供应商错误回显已知密钥时不写回界面', () => {
  expect(describeError(new Error('denied fixture-secret'), 'fixture-secret')).not.toContain(
    'fixture-secret',
  );
});

it('服务用 429 返回套餐模型权限错误时，提示切换已开通模型', () => {
  const error = Object.assign(new Error('当前订阅套餐暂未开放GLM-5.3-FlashX权限'), { status: 429 });
  expect(describeError(error)).toContain('请切换到已开通的模型');
  expect(describeError(error)).not.toContain('服务限流');
});

it.each([
  'OpenAI Responses stream ended without a stop reason',
  'Stream ended without finish_reason',
  'Anthropic stream ended before message_stop',
])('Pi 原生会话的断流错误使用同一中文提示：%s', (message) => {
  expect(describeError(new Error(message))).toContain('结束标记');
  expect(describeError(new Error(message))).toContain('已收到的文字已保留');
});
