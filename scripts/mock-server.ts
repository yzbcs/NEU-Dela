import { createServer, type IncomingMessage } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import type { ModelOption } from '../src/shared/types';

export interface MockRequest {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  body: any;
}
export function fixtureToolResults(body: any): { name: string; payload: any }[] {
  const names = new Map<string, string>();
  const results: { name: string; payload: any }[] = [];
  const add = (id: string, value: string) => {
    results.push({ name: names.get(id) ?? '', payload: JSON.parse(value) });
  };
  for (const turn of body.input ?? body.messages ?? []) {
    if (turn.type === 'function_call') names.set(turn.call_id, turn.name);
    if (turn.type === 'function_call_output') add(turn.call_id, turn.output);
    for (const call of turn.tool_calls ?? []) names.set(call.id, call.function.name);
    if (turn.role === 'tool') add(turn.tool_call_id, turn.content);
    if (Array.isArray(turn.content))
      for (const block of turn.content) {
        if (block.type === 'tool_use') names.set(block.id, block.name);
        if (block.type === 'tool_result') add(block.tool_use_id, block.content);
      }
  }
  return results;
}
function workspacePlan(body: any, prompt: string) {
  if (/\[(?:create-workspace|repeat-write|write-then-fail|write-slow)\]/.test(prompt)) {
    const results = fixtureToolResults(body);
    const call = (name: string, args: object) => ({ name, arguments: JSON.stringify(args) });
    if (!body.tools?.length && !results.length) return null;
    if (!results.length) {
      if (prompt.includes('[create-workspace]'))
        return {
          calls: [
            call('create_todo', {
              title: '人工提醒',
              dueAt: '2026-12-01T19:30:00+08:00',
              reminder: true,
            }),
            call('add_courses', {
              courses: [
                {
                  name: '人工新增课程',
                  day: 3,
                  start: 3,
                  end: 4,
                  weeks: '11-16',
                  location: 'A201',
                },
              ],
            }),
            call('create_note', {
              title: '人工笔记',
              body: '正文\n- [ ] 待办',
              category: '课程笔记',
            }),
          ],
        };
      return {
        calls: [
          call('create_todo', {
            title: '人工提醒',
            dueAt: '2026-12-01T19:30:00+08:00',
            reminder: true,
          }),
        ],
      };
    }
    if (prompt.includes('[repeat-write]') && results.length === 1 && body.tools?.length)
      return {
        calls: [
          call('create_todo', {
            repeat: 'none',
            reminder: true,
            color: 'yellow',
            dueAt: '2026-12-01T11:30:00Z',
            detail: '',
            title: '人工提醒',
          }),
        ],
      };
    return {
      text:
        '本地模拟写入核对：以下为工具实际返回的保存结果，不代表真实模型理解能力。\n\n' +
        results.map((result) => JSON.stringify(result.payload)).join('\n\n'),
    };
  }
  if (prompt.includes('[study-check]')) {
    const results = fixtureToolResults(body);
    const call = (name: string, args: object) => ({ name, arguments: JSON.stringify(args) });
    if (!body.tools?.length && !results.length) return null;
    if (!results.length)
      return {
        calls: [
          call('query_workspace', {
            module: 'timetable',
            date: prompt.match(/\d{4}-\d{2}-\d{2}/)?.[0],
          }),
          call('query_workspace', { module: 'todos', status: 'pending' }),
          call('query_workspace', { module: 'notes' }),
        ],
      };
    const notes = results
      .flatMap((result) => result.payload.data?.items ?? [])
      .filter((item) => typeof item.bodyCharacters === 'number');
    if (
      body.tools?.length &&
      notes.length &&
      !results.some((result) => result.name === 'read_workspace_item')
    )
      return {
        calls: notes
          .slice(0, 3)
          .map((note) => call('read_workspace_item', { kind: 'note', id: note.id })),
      };
    return {
      text:
        '本地模拟核对：以下来自刚刚读取的工作台数据，不代表真实模型理解能力。\n\n' +
        results
          .map((result) => {
            const data = result.payload.data;
            return (
              (result.payload.citation ?? '') +
              ' ' +
              (data?.text ?? JSON.stringify(data ?? result.payload.error))
            );
          })
          .join('\n\n'),
    };
  }
  if (!/\[(?:workbench|tool-error|tool-loop)\]/.test(prompt)) return null;
  const results = fixtureToolResults(body);
  const finalText =
    '这是本地模拟的工具联动验证，以下文字来自实际读取结果，不代表真实模型理解能力。\n\n' +
    results
      .filter((r) => r.payload.data?.text || r.payload.error)
      .map((r) => `${r.payload.citation ?? ''} ${r.payload.data?.text ?? r.payload.error}`)
      .join('\n\n');
  if (!body.tools?.length) return results.length ? { text: finalText } : null;
  const call = (name: string, args: object) => ({ name, arguments: JSON.stringify(args) });
  if (prompt.includes('[tool-loop]'))
    return { calls: [call('query_workspace', { module: 'overview' })] };
  if (prompt.includes('[tool-error]'))
    return results.length
      ? { text: '本地模拟读取失败：' + JSON.stringify(results.at(-1)?.payload) }
      : { calls: [call('read_file', { resourceId: 'fixture-missing-file' })] };
  if (!results.length)
    return {
      calls: ['timetable', 'todos', 'notes', 'resources', 'mail'].map((module) =>
        call('query_workspace', { module }),
      ),
    };
  if (
    !results.some((r) =>
      ['read_workspace_item', 'read_file', 'list_files', 'list_mail'].includes(r.name),
    )
  ) {
    const items = results.flatMap((r) => r.payload.data?.items ?? []);
    const note = items.find((i) => typeof i.bodyCharacters === 'number');
    const todo = items.find((i) => typeof i.detailCharacters === 'number');
    const file = items.find((i) => i.kind === 'file');
    const folder = items.find((i) => i.kind === 'folder');
    const account = items.find((i) => typeof i.email === 'string');
    const calls = [
      ...(note ? [call('read_workspace_item', { kind: 'note', id: note.id })] : []),
      ...(todo ? [call('read_workspace_item', { kind: 'todo', id: todo.id })] : []),
      ...(file ? [call('read_file', { resourceId: file.id })] : []),
      ...(folder ? [call('list_files', { resourceId: folder.id })] : []),
      ...(account ? [call('list_mail', { accountId: account.id })] : []),
    ];
    if (calls.length) return { calls };
  }
  if (
    !results.some(
      (r) =>
        r.name === 'read_mail' || (r.name === 'read_file' && r.payload.data?.name?.endsWith('.md')),
    )
  ) {
    const items = results.flatMap((r) => r.payload.data?.items ?? []);
    const folder = items.find((i) => i.kind === 'folder');
    const entry = results
      .find((r) => r.name === 'list_files')
      ?.payload.data?.entries.find((e: any) => e.kind === 'file' && e.name.endsWith('.md'));
    const inbox = results.find((r) => r.name === 'list_mail')?.payload.data;
    const mail = inbox?.messages[0];
    const calls = [
      ...(folder && entry ? [call('read_file', { resourceId: folder.id, path: entry.path })] : []),
      ...(mail
        ? [
            call('read_mail', {
              accountId: inbox.accountId,
              folder: inbox.folder,
              uid: mail.uid,
              uidValidity: inbox.uidValidity,
            }),
          ]
        : []),
    ];
    if (calls.length) return { calls };
  }
  return { text: finalText };
}

/** 只监听 loopback 的协议夹具，不代理到外部服务，也不接收真实凭据。 */
export async function startMockServer(
  options: { delayMs?: number; models?: ModelOption[]; paginateModels?: boolean } = {},
) {
  const requests: MockRequest[] = [];
  const server = createServer(async (req, res) => {
    try {
      let raw = '';
      for await (const chunk of req) raw += chunk.toString();
      const body = raw ? JSON.parse(raw) : {};
      requests.push({ method: req.method ?? '', path: req.url ?? '', headers: req.headers, body });
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const path = url.pathname;
      if (req.method === 'GET' && path === '/v1/models') {
        if (
          req.headers.authorization === 'Bearer fixture-denied-key' ||
          req.headers['x-api-key'] === 'fixture-denied-key'
        ) {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              error: { message: '模拟：fixture-denied-key 无效', type: 'authentication_error' },
            }),
          );
          return;
        }
        const available = options.models ?? [
          { id: 'dola-mock-openai', name: '本地模拟 OpenAI' },
          { id: 'dola-mock-claude', name: '本地模拟 Claude' },
          { id: 'dola-mock-compatible', name: '本地模拟兼容接口' },
        ];
        const isAnthropic = Boolean(req.headers['x-api-key']);
        const paginated = isAnthropic && options.paginateModels && available.length > 1;
        const hasMore = Boolean(paginated && !url.searchParams.has('after_id'));
        const page = paginated ? (hasMore ? available.slice(0, 1) : available.slice(1)) : available;
        const data = page.map((model) =>
          isAnthropic
            ? {
                id: model.id,
                display_name: model.name,
                type: 'model',
                created_at: '2026-11-03T00:00:00Z',
              }
            : { id: model.id, object: 'model', created: 1, owned_by: 'dola-fixture' },
        );
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            object: 'list',
            data,
            has_more: hasMore,
            first_id: page[0]?.id ?? null,
            last_id: page.at(-1)?.id ?? null,
          }),
        );
        return;
      }
      const anthropic = path.endsWith('/messages');
      const responses = path.endsWith('/responses');
      const content = responses ? body.input : body.messages;
      const last =
        content?.findLast((m: any) => m.role === 'user' && typeof m.content === 'string')
          ?.content ?? '';
      const prompt = typeof last === 'string' ? last : '';
      if (!['/v1/messages', '/v1/responses', '/v1/chat/completions'].includes(path)) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: '模拟服务没有这个端点', type: 'not_found' } }));
        return;
      }
      if (prompt.includes('[http401]')) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            type: 'error',
            error: { message: '模拟：密钥无效', type: 'authentication_error' },
          }),
        );
        return;
      }
      if (prompt.includes('[tools-unsupported]') && body.tools?.length) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'tools unsupported by fixture model' } }));
        return;
      }
      if (prompt.includes('[write-then-fail]') && fixtureToolResults(body).length) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: '模拟：记录保存后模型续接失败' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      let closed = false;
      res.on('close', () => {
        closed = true;
      });
      const event = async (data: unknown, name?: string) => {
        if (closed) return;
        const frame = Buffer.from(
          (name ? 'event: ' + name + '\n' : '') + 'data: ' + JSON.stringify(data) + '\n\n',
        );
        // 将 UTF-8 字符和 SSE 行拆到多个 HTTP chunk，覆盖真实网络分块。
        const cut = Math.floor(frame.length / 2);
        res.write(frame.subarray(0, cut));
        await delay(1);
        if (!closed) res.write(frame.subarray(cut));
      };
      const kind = anthropic
        ? 'Anthropic Messages'
        : responses
          ? 'OpenAI Responses'
          : 'OpenAI Chat Completions';
      const plan = workspacePlan(body, prompt);
      if (plan && 'calls' in plan && plan.calls?.length) {
        const calls = plan.calls.map((call, index) => ({
          ...call,
          id: 'call_fixture_' + fixtureToolResults(body).length + '_' + index,
        }));
        if (prompt.includes('[slow]')) await delay(80);
        if (anthropic)
          await event(
            {
              type: 'message_start',
              message: {
                id: 'msg_tools',
                type: 'message',
                role: 'assistant',
                content: [],
                model: body.model,
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: 42, output_tokens: 0 },
              },
            },
            'message_start',
          );
        if (anthropic) {
          await event(
            {
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'thinking', thinking: '', signature: '' },
            },
            'content_block_start',
          );
          await event(
            {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'thinking_delta', thinking: 'fixture opaque continuation' },
            },
            'content_block_delta',
          );
          await event(
            {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'signature_delta', signature: 'fixture-signature' },
            },
            'content_block_delta',
          );
          await event({ type: 'content_block_stop', index: 0 }, 'content_block_stop');
        }
        if (responses)
          await event(
            {
              type: 'response.output_item.done',
              output_index: 0,
              item: {
                type: 'reasoning',
                id: 'rs_fixture_' + fixtureToolResults(body).length,
                summary: [],
                encrypted_content: 'fixture-opaque-reasoning',
              },
            },
            'response.output_item.done',
          );
        for (const [index, call] of calls.entries()) {
          const split = Math.floor(call.arguments.length / 2);
          const outputIndex = index + 1;
          if (anthropic) {
            await event(
              {
                type: 'content_block_start',
                index: outputIndex,
                content_block: { type: 'tool_use', id: call.id, name: call.name, input: {} },
              },
              'content_block_start',
            );
            for (const part of [call.arguments.slice(0, split), call.arguments.slice(split)])
              await event(
                {
                  type: 'content_block_delta',
                  index: outputIndex,
                  delta: { type: 'input_json_delta', partial_json: part },
                },
                'content_block_delta',
              );
            await event({ type: 'content_block_stop', index: outputIndex }, 'content_block_stop');
          } else if (responses) {
            await event(
              {
                type: 'response.output_item.added',
                output_index: outputIndex,
                item: {
                  type: 'function_call',
                  id: 'fc_' + call.id,
                  call_id: call.id,
                  name: call.name,
                  arguments: '',
                },
              },
              'response.output_item.added',
            );
            for (const delta of [call.arguments.slice(0, split), call.arguments.slice(split)])
              await event(
                {
                  type: 'response.function_call_arguments.delta',
                  item_id: 'fc_' + call.id,
                  output_index: outputIndex,
                  delta,
                },
                'response.function_call_arguments.delta',
              );
            await event(
              {
                type: 'response.output_item.done',
                output_index: outputIndex,
                item: {
                  type: 'function_call',
                  id: 'fc_' + call.id,
                  call_id: call.id,
                  name: call.name,
                  arguments: call.arguments,
                  status: 'completed',
                },
              },
              'response.output_item.done',
            );
          } else {
            await event({
              id: 'chat_tools',
              object: 'chat.completion.chunk',
              created: 1,
              model: body.model,
              choices: [
                {
                  index: 0,
                  delta: {
                    reasoning_content: index === 0 ? 'fixture opaque continuation' : '',
                    tool_calls: [
                      {
                        index,
                        id: call.id,
                        type: 'function',
                        function: { name: call.name, arguments: call.arguments.slice(0, split) },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            });
            await event({
              id: 'chat_tools',
              object: 'chat.completion.chunk',
              created: 1,
              model: body.model,
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [{ index, function: { arguments: call.arguments.slice(split) } }],
                  },
                  finish_reason: null,
                },
              ],
            });
          }
        }
        if (prompt.includes('[disconnect]')) {
          res.end();
          return;
        }
        if (anthropic) {
          await event(
            {
              type: 'message_delta',
              delta: { stop_reason: 'tool_use', stop_sequence: null },
              usage: { output_tokens: 80 },
            },
            'message_delta',
          );
          await event({ type: 'message_stop' }, 'message_stop');
        } else if (responses)
          await event(
            {
              type: 'response.completed',
              response: {
                id: 'resp_tools',
                status: 'completed',
                usage: { input_tokens: 42, output_tokens: 80, total_tokens: 122 },
              },
            },
            'response.completed',
          );
        else {
          await event({
            id: 'chat_tools',
            object: 'chat.completion.chunk',
            created: 1,
            model: body.model,
            choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
            usage: { prompt_tokens: 42, completion_tokens: 80, total_tokens: 122 },
          });
          res.write('data: [DONE]\n\n');
        }
        res.end();
        return;
      }
      const answer =
        plan && 'text' in plan
          ? (plan.text ?? '')
          : prompt === '请只回复“连接正常”。'
            ? '连接正常'
            : '这是一条来自 **本地模拟服务** 的回复，使用 ' +
              kind +
              ' 协议。\n\n' +
              '你刚才问的是：\n> ' +
              prompt.replaceAll('\n', '\n> ') +
              '\n\n' +
              '我们可以先把事情分成三个小步骤：\n\n' +
              '1. 说清楚想解决的问题。\n2. 整理已有材料和截止时间。\n3. 从今天可以完成的一件事开始。\n\n' +
              '模拟接口已完成请求和流式传输。连接真实模型后，这里会显示模型实际生成的内容。';
      if (anthropic) {
        await event(
          {
            type: 'message_start',
            message: {
              id: 'msg_fixture',
              type: 'message',
              role: 'assistant',
              content: [],
              model: body.model,
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 42, output_tokens: 0 },
            },
          },
          'message_start',
        );
        await event(
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          'content_block_start',
        );
      }
      const parts = Array.from(answer);
      for (let start = 0; start < parts.length && !closed; start += 12) {
        const text = parts.slice(start, start + 12).join('');
        if (anthropic)
          await event(
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
            'content_block_delta',
          );
        else if (responses)
          await event(
            {
              type: 'response.output_text.delta',
              delta: text,
              output_index: 0,
              content_index: 0,
              item_id: 'item_fixture',
            },
            'response.output_text.delta',
          );
        else
          await event({
            id: 'chat_fixture',
            object: 'chat.completion.chunk',
            created: 1,
            model: body.model,
            choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
          });
        if (prompt.includes('[stream-error]')) {
          await event(
            {
              type: 'error',
              error: { type: 'overloaded_error', message: '模拟流式服务错误' },
              message: '模拟流式服务错误',
              code: 'fixture_error',
              param: null,
            },
            'error',
          );
          res.end();
          return;
        }
        if (prompt.includes('[disconnect]')) {
          res.end();
          return;
        }
        await delay(/\[(?:slow|write-slow)\]/.test(prompt) ? 100 : (options.delayMs ?? 5));
      }
      if (closed) return;
      const limited = prompt.includes('[limit]');
      if (anthropic) {
        await event({ type: 'content_block_stop', index: 0 }, 'content_block_stop');
        await event(
          {
            type: 'message_delta',
            delta: {
              stop_reason: limited ? 'max_tokens' : 'end_turn',
              stop_sequence: null,
            },
            usage: { output_tokens: 80 },
          },
          'message_delta',
        );
        await event({ type: 'message_stop' }, 'message_stop');
      } else if (responses) {
        const type = limited ? 'response.incomplete' : 'response.completed';
        await event(
          {
            type,
            response: {
              id: 'resp_fixture',
              status: limited ? 'incomplete' : 'completed',
              usage: { input_tokens: 42, output_tokens: 80, total_tokens: 122 },
            },
          },
          type,
        );
      } else {
        await event({
          id: 'chat_fixture',
          object: 'chat.completion.chunk',
          created: 1,
          model: body.model,
          choices: [{ index: 0, delta: {}, finish_reason: limited ? 'length' : 'stop' }],
          usage: { prompt_tokens: 42, completion_tokens: 80, total_tokens: 122 },
        });
        res.write('data: [DONE]\n\n');
      }
      res.end();
    } catch {
      if (!res.headersSent) res.writeHead(400);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('模拟服务未能启动');
  return {
    url: 'http://127.0.0.1:' + address.port,
    requests,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
