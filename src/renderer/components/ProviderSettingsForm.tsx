import { useState, type FormEvent } from 'react';
import { Check, Eye, EyeOff, RefreshCw, Trash2, Zap } from 'lucide-react';
import type { ModelOption, Protocol, Provider, ProviderInput } from '../../shared/types';
import { providerDefaults } from '../../shared/types';
import { SelectMenu } from './SelectMenu';

export function ProviderSettingsForm({
  provider,
  kind,
  busy,
  setBusy,
  onSaved,
  onCancel,
  onError,
  onNotice,
}: {
  provider?: Provider;
  kind: 'openai' | 'anthropic';
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onSaved: () => void;
  onCancel: () => void;
  onError: (error: unknown) => void;
  onNotice: (notice: string) => void;
}) {
  const [draft, setDraft] = useState<ProviderInput>(
    provider ? { ...provider, apiKey: '' } : { ...providerDefaults[kind], apiKey: '' },
  );
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<ModelOption[]>(provider?.models || []);
  const [manual, setManual] = useState(!provider?.models?.length);
  const [status, setStatus] = useState('');
  const [action, setAction] = useState('');
  function update<K extends keyof ProviderInput>(field: K, value: ProviderInput[K]) {
    setDraft((previous) => ({ ...previous, [field]: value }));
    setStatus('');
    if (['protocol', 'baseUrl', 'apiKey'].includes(field)) {
      setModels([]);
      setManual(true);
    }
  }
  function input(): ProviderInput {
    return {
      id: provider?.id,
      name: draft.name,
      protocol: draft.protocol,
      baseUrl: draft.baseUrl,
      model: draft.model,
      models,
      apiKey: draft.apiKey || undefined,
    };
  }
  async function run(name: string, task: () => Promise<void>) {
    setBusy(true);
    setAction(name);
    setStatus('');
    try {
      await task();
    } catch (error) {
      const detail = (error instanceof Error ? error.message : String(error)).replace(
        /^Error invoking remote method '[^']+': (?:Error: )?/,
        '',
      );
      setStatus(
        name === 'models'
          ? `获取失败：${detail} 可以继续手动填写模型 ID。`
          : name === 'test'
            ? `连接测试失败：${detail}`
            : detail,
      );
      onError(error);
    } finally {
      setBusy(false);
      setAction('');
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (target?.value === 'test')
      void run('test', async () => {
        const result = await window.dola.probeProviderInput(input());
        setStatus(`连接测试通过，用时 ${result.milliseconds} ms。测试不会保存配置。`);
      });
    else
      void run('save', async () => {
        await window.dola.saveProvider(input());
        onNotice('模型服务已保存。');
        onSaved();
      });
  }
  return (
    <form
      className="provider-form settings-editor"
      data-settings-page="model-editor"
      onSubmit={submit}
    >
      <div className="settings-editor-heading">
        <div>
          <h2>{provider ? '编辑模型服务' : '添加模型服务'}</h2>
          <p>填写服务提供方给出的连接信息。</p>
        </div>
        {provider && (
          <button
            type="button"
            className="icon-button danger"
            aria-label="删除此服务"
            disabled={busy}
            onClick={() => {
              if (window.confirm('删除这个模型服务？已有对话会保留。'))
                void run('remove', async () => {
                  await window.dola.removeProvider(provider.id);
                  onNotice('模型服务已移除。');
                  onSaved();
                });
            }}
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
      <fieldset disabled={busy}>
        <label>
          服务名称
          <input
            name="providerName"
            required
            maxLength={80}
            value={draft.name}
            onChange={(event) => update('name', event.target.value)}
            placeholder="例如：我的模型服务"
          />
        </label>
        <label htmlFor="settings-provider-protocol">
          接口类型
          <SelectMenu
            id="settings-provider-protocol"
            name="protocol"
            label="接口类型"
            value={draft.protocol}
            disabled={busy}
            onChange={(value) => update('protocol', value as Protocol)}
            options={[
              { value: 'openai-responses', label: 'OpenAI · Responses' },
              { value: 'openai-chat', label: 'OpenAI · Chat Completions（兼容接口）' },
              { value: 'anthropic', label: 'Anthropic · Messages' },
            ]}
          />
        </label>
        <label>
          服务地址
          <input
            name="baseUrl"
            type="url"
            required
            value={draft.baseUrl}
            onChange={(event) => update('baseUrl', event.target.value)}
            spellCheck={false}
          />
          <small>支持官方服务和对应协议的第三方服务。</small>
        </label>
        <label>
          API Key
          <span className="secret-input">
            <input
              name="apiKey"
              type={showKey ? 'text' : 'password'}
              value={draft.apiKey}
              onChange={(event) => update('apiKey', event.target.value)}
              autoComplete="new-password"
              spellCheck={false}
              required={!provider?.hasKey}
              placeholder={
                provider?.hasKey ? '已保存，留空保留现有密钥' : '输入该服务提供的 API Key'
              }
            />
            <button
              type="button"
              aria-label={showKey ? '隐藏输入的密钥' : '显示输入的密钥'}
              onClick={() => setShowKey(!showKey)}
            >
              {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </span>
        </label>
        <div className="model-field">
          <label htmlFor="settings-provider-model">模型 ID</label>
          <div className="model-field-row">
            {models.length && !manual ? (
              <SelectMenu
                id="settings-provider-model"
                name="model"
                label="模型 ID"
                value={draft.model}
                onChange={(value) => update('model', value)}
                disabled={busy}
                searchable
                options={[
                  ...(!models.some((item) => item.id === draft.model) && draft.model
                    ? [{ value: draft.model, label: draft.model }]
                    : []),
                  ...models.map((item) => ({ value: item.id, label: item.name || item.id })),
                ]}
              />
            ) : (
              <input
                id="settings-provider-model"
                name="model"
                required
                value={draft.model}
                maxLength={200}
                onChange={(event) => update('model', event.target.value)}
                placeholder="获取模型列表，或手动填写 ID"
                spellCheck={false}
              />
            )}
            <button
              type="button"
              className="secondary-button"
              disabled={
                busy || !draft.baseUrl.trim() || (!draft.apiKey?.trim() && !provider?.hasKey)
              }
              onClick={() =>
                void run('models', async () => {
                  const result = await window.dola.listModels({
                    id: provider?.id,
                    protocol: draft.protocol,
                    baseUrl: draft.baseUrl,
                    apiKey: draft.apiKey || undefined,
                  });
                  setModels(result);
                  setManual(!result.length);
                  if (result.length)
                    setDraft((previous) => ({
                      ...previous,
                      model: previous.model || result[0].id,
                    }));
                  else setStatus('服务没有返回可选模型，请手动填写模型 ID。');
                })
              }
            >
              <RefreshCw size={14} className={action === 'models' ? 'spinning' : ''} />
              {action === 'models' ? '正在获取' : '获取模型'}
            </button>
          </div>
          {models.length > 0 && (
            <div className="model-field-help">
              <span>已获取 {models.length} 个模型</span>
              <button type="button" onClick={() => setManual(!manual)}>
                {manual ? '从列表选择' : '手动输入模型 ID'}
              </button>
            </div>
          )}
        </div>
        {status && (
          <p className="settings-result model-notice" role="status">
            {status}
          </p>
        )}
        <div className="settings-editor-footer">
          <button className="secondary-button" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="secondary-button" type="submit" value="test">
            <Zap size={14} />
            {action === 'test' ? '正在测试' : '测试连接'}
          </button>
          <button className="primary-button" type="submit" value="save">
            <Check size={15} />
            {action === 'save' ? '正在保存' : '保存服务'}
          </button>
        </div>
      </fieldset>
      <p className="settings-hint">
        测试会用当前填写的参数发送一条简短模型请求，可能产生费用；保存只保存配置。已保存密钥不会回填到页面。
      </p>
    </form>
  );
}
