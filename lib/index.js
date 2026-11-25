// local-model-organizer: 从引擎读取当前主机所有模型，按五大类分组、
// 保持 dsh-go 原始顺序，支持按渠道筛选、实时增删。
// 模型编辑模式：可多选、可全选、批量删除（带确认）。
export const name = 'local-model-organizer'

// 五大分类。判定顺序：专用 > 生成 > 多模态 > 智能体 > 对话（兜底）。
const CATEGORIES = [
  { key: 'chat',        label: { zh: '对话语言模型', en: 'Chat / language' } },
  { key: 'multimodal',  label: { zh: '多模态模型',   en: 'Multimodal' } },
  { key: 'generative',  label: { zh: '生成模型',     en: 'Generative' } },
  { key: 'special',     label: { zh: '专用模型',     en: 'Specialized' } },
  { key: 'agent',       label: { zh: '智能体模型',   en: 'Agentic' } },
]

// 专用：翻译 / 向量 / 重排 / 语音识别与合成 / OCR
const SPECIAL_RE = /(embed|vector|rerank|re-rank|ocr|asr|stt|tts|translate|translation|whisper|speech)/i
// 生成：文生图 / 文生视频 / 文生音乐
const GEN_RE = /(flux|stable-?diffusion|sdxl|sd3|dall-?e|sora|kling|runway|veo|wan|hunyuan|midjourney|suno|udio|image|video|music|draw)/i
// 多模态（名称标记，静态判断补充）：视觉语言 / 全模态
const MULTIMODAL_RE = /(vision|visual|multimodal|omni|\bvl\b|vl[-_])/i
// 智能体：工具调用 / 界面操作
const AGENT_RE = /(agent|function-?call|tool-?use|computer-?use|gui-?agent|act-?)/i

// 模型厂家识别：按 id/name 前缀归类，用于把同一家的模型聚在一起显示
// 注意顺序：更具体的厂商放前面，避免被通用规则误判
const FAMILY_RULES = [
  [/deepseek/i, 'deepseek'],
  [/qwen|qwq|tongyi|通义/i, 'qwen'],
  [/glm|chatglm|zhipu|智谱/i, 'glm'],
  [/kimi|moonshot/i, 'kimi'],
  [/minimax|abab/i, 'minimax'],
  [/doubao|bytedance|豆包|火山/i, 'doubao'],
  [/step[-_ ]?\d|stepfun|阶跃/i, 'stepfun'],
  [/mimo|xiaomi|小米/i, 'xiaomi'],
  [/hunyuan|混元/i, 'hunyuan'],
  [/gpt|openai|o[134](-|$)/i, 'openai'],
  [/claude|anthropic/i, 'claude'],
  [/gemini|google|palm/i, 'gemini'],
  [/grok|xai/i, 'grok'],
  [/llama|meta/i, 'llama'],
  [/mistral|mixtral/i, 'mistral'],
  [/bailu|白鹿|yuyu/i, 'bailu'],
  [/intern|上海ai/i, 'intern'],
  [/nex[-_ ]?agi|nex[-_ ]?n/i, 'nex'],
  [/sensenova|商汤/i, 'sensenova'],
  [/flux|stable-?diffusion|sdxl|sd3/i, 'sd'],
  [/wan|hunyuanvideo/i, 'wan'],
  [/suno|udio/i, 'suno'],
  [/whisper|asr|stt/i, 'asr'],
  [/tts|speech/i, 'tts'],
  [/embed|vector/i, 'embed'],
  [/rerank|re-rank/i, 'rerank'],
]

function modelFamily(row) {
  const hay = `${row.model ?? ''} ${row.title ?? ''}`
  for (const [re, fam] of FAMILY_RULES) if (re.test(hay)) return fam
  // 没识别出来的：用模型 id 的第一段（如 vendor/model 的 vendor）兜底，否则单独一组
  const id = String(row.model ?? '')
  const head = id.includes('/') ? id.split('/')[0] : ''
  return head ? `other:${head.toLowerCase()}` : `other:${id.toLowerCase()}`
}

function categorize(model, info) {
  const name = `${model.name ?? ''} ${model.id ?? ''}`
  const hay = `${name} ${model.description ?? ''}`

  if (SPECIAL_RE.test(hay)) return 'special'
  if (GEN_RE.test(hay)) return 'generative'

  const mods = info.inputModalities ?? []
  if (mods.includes('image') || mods.includes('audio') || mods.includes('video')) return 'multimodal'
  if (MULTIMODAL_RE.test(hay)) return 'multimodal'

  if (info.toolUpdate !== undefined) return 'agent'
  if (AGENT_RE.test(hay)) return 'agent'

  return 'chat'
}

export function apply(ctx) {
  let sessionController = ctx.get('sessionController')
  let sessionRemote = ctx.get('remote.session')
  let configEditor = ctx.get('configEditor')

  ctx.inject(['sessionController'], (sc) => {
    sessionController = sc.sessionController ?? sessionController
  })
  ctx.inject(['remote.session'], (sr) => {
    sessionRemote = sr['remote.session'] ?? sessionRemote
  })
  ctx.inject(['configEditor'], (ce) => {
    configEditor = ce.configEditor ?? configEditor
  })

  ctx.inject(['dshGo'], (bridge) => {
    const dshGo = bridge.dshGo
    const llm = ctx.get('llm')

    let currentProvider = ''       // 当前渠道筛选；'' = 显示全部
    let currentSelection = null    // 当前会话选中的模型
    let deleteMode = false         // 模型编辑模式开关
    const selected = new Set()     // 编辑模式勾选的模型 key（providerId:modelId）
    const testResults = new Map()  // 通断测试结果：key -> { ok, at, error }
    let testRun = null             // 当前测试批次 { cancelled: boolean }
    let needReset = true           // 面板被重新打开时置位，下一次刷新立即回到当前模型渠道
    let rowsCache = []             // 最近一次读取的模型，供打开瞬间立即重绘
    let rowsInFlight = null        // 全量读取去重：同一时刻只跑一份，调用方共享结果
    let deleting = false           // 批量删除进行中：暂停轮询与事件刷新，避免和配置写入抢锁
    let panelOpen = false          // 是否有面板实例在线（由 data 生命周期维护）
    let moveTarget = ''            // 当前待排序渠道（点三横杠菜单后暂存，供 options 使用）
    let providerEditMode = false   // 渠道编辑开关：关闭时渠道行只作展示与筛选，不出现排序入口
    const emitters = new Map()     // scope -> emit；面板可能同时存在于多个入口，全部推送
    // 推送给所有打开的入口（某个入口不可见时也更新，保证切回来是对的）
    // 始终读取 rowsCache 保证模型列表最新；推帧做 trailing 合并：冷却期内的多次请求只发最后一帧
    let pushTimer = null
    let pushPending = null
    const flushPush = () => {
      pushTimer = null
      if (!panelOpen) { pushPending = null; return }
      const loc = pushPending
      pushPending = null
      pushAll.lastAt = Date.now()
      const data = buildData(rowsCache, loc)
      for (const e of emitters.values()) { try { e(data) } catch {} }
    }
    const pushAll = (loc) => {
      if (!panelOpen) return
      pushPending = loc
      if (pushTimer) return
      const wait = 400 - (Date.now() - (pushAll.lastAt || 0))
      if (wait <= 0) flushPush()
      else pushTimer = setTimeout(flushPush, wait)
    }

    const zhCache = new Map()   // 原文 -> 中文译文，避免重复翻译
    const MS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

    // 微软 Edge 浏览器内置翻译端点：不需要任何 token，靠 Edge 指纹头放行
    const MS_TRANSLATE_HEADERS = {
      'content-type': 'application/json',
      accept: '*/*',
      'sec-ch-ua': '"Microsoft Edge";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
      'sec-mesh-client-os': 'Windows',
      'sec-mesh-client-edge-channel': 'stable',
      'sec-mesh-client-edge-version': '123.0.0.0',
      'user-agent': MS_UA,
    }

    // 微软翻译：一次可传多条，返回数组；失败返回 null
    async function microsoftTranslate(texts, to = 'zh-Hans') {
      try {
        const url = `https://edge.microsoft.com/translate/translatetext?from=&to=${to}&isEnterpriseClient=false`
        const res = await fetch(url, {
          method: 'POST',
          headers: MS_TRANSLATE_HEADERS,
          body: JSON.stringify(texts.map((t) => t.slice(0, 1000))),
          signal: AbortSignal.timeout(12000),
        })
        if (!res.ok) return null
        const json = await res.json()
        if (!Array.isArray(json)) return null
        return json.map((it) => {
          const t = it?.translations?.[0]?.text
          return typeof t === 'string' ? t : ''
        })
      } catch { return null }
    }

    // 单条包装，保持旧调用点不变
    async function translateMicrosoft(text) {
      const out = await microsoftTranslate([text])
      return out?.[0]?.trim().slice(0, 300) ?? ''
    }

    // 把报错翻成中文：只走微软 Edge 翻译，失败保留原文（不调用任何模型，零 token）
    async function translateError(text) {
      if (!text) return ''
      if (zhCache.has(text)) return zhCache.get(text)
      const ms = await translateMicrosoft(text)
      if (ms) { zhCache.set(text, ms); return ms }
      return ''
    }

    // 账户级限流 / 配额耗尽：这类失败不代表模型不通，要退避重试而不是直接标红
    const RATE_LIMIT_RE = /(429|rate.?limit|quota|too many requests|请求.{0,4}上限|请求过于频繁|限流|额度|余额不足)/i
    function isRateLimited(text) {
      return typeof text === 'string' && RATE_LIMIT_RE.test(text)
    }

    // 单个模型通断测试：发一条极短请求，收到任意响应即算通；取消时不写结果
    async function testModel(providerId, modelId, run) {
      const key = `${providerId}:${modelId}`
      const outerSignal = run.controller.signal
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15000)
      const onOuterAbort = () => controller.abort()
      if (outerSignal.aborted) return { cancelled: true }
      outerSignal.addEventListener('abort', onOuterAbort)
      let ok = false
      let error = ''
      let stack = ''
      let failed = false      // 明确失败（error / aborted / 抛异常）
      let sawData = false     // 收到过真实数据分片
      let sawStop = false     // 收到正常终止
      let stage = 'prepare'
      try {
        if (!llm?.prepareCall) throw new Error('引擎不支持模型调用')
        const prepared = await llm.prepareCall({ provider: providerId, model: modelId, maxTokens: 8 }, controller.signal)
        const messages = [{
          id: `test-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          role: 'user',
          content: [{ type: 'text', text: 'ping' }],
          source: { kind: 'user' },
        }]
        stage = 'stream'
        for await (const chunk of prepared.stream({ ...prepared.config, messages, signal: controller.signal })) {
          if (chunk?.type === 'finish') {
            if (chunk.reason?.kind === 'error') {
              failed = true
              const f = chunk.reason.failure ?? {}
              error = String(f.message ?? f.code ?? '调用失败')
            } else if (chunk.reason?.kind === 'aborted') {
              failed = true
              error = 'aborted'
            } else {
              sawStop = true
            }
          } else if (chunk?.type !== undefined) {
            sawData = true
          }
        }
      } catch (err) {
        failed = true
        error = `[${stage}] ` + (err?.message ?? String(err))
        stack = String(err?.stack ?? '').split('\n').slice(0, 8).join('\n')
      } finally {
        clearTimeout(timer)
        outerSignal.removeEventListener('abort', onOuterAbort)
      }
      // 已取消：不写结果，避免把中断误判成红点
      if (run.cancelled || outerSignal.aborted) return { cancelled: true }
      // 只有「没明确失败」且「有数据或正常收尾」才算通
      ok = !failed && (sawData || sawStop)
      testResults.set(key, { ok, at: Date.now(), error, stack, rate: !ok && isRateLimited(error) })
      try {
        const { writeFileSync } = await import('node:fs')
        writeFileSync('/tmp/model-test-debug.json', JSON.stringify(
          [...testResults.entries()].map(([k, v]) => ({ key: k, ok: v.ok, error: v.error, stack: v.stack })), null, 2))
      } catch {}
      return { ok, error }
    }

    // 渠道顺序以配置键序为准：引擎按名排序做变更比较，纯换序不会触发重新注册，
      // listProviders() 会一直停在启动时的顺序，所以面板必须自己按配置顺序排列。
      function configProviderOrder() {
        // 优先从配置文件读（override 层每次现读，写入后立刻可见），再退回加载器里的配置
        try {
          const row = configEditor?.configuration?.()?.find((r) => r.entry?.options?.id === 'llm-pi-ai')
          const ov = row?.override?.providers
          if (ov && typeof ov === 'object' && Object.keys(ov).length > 0) return Object.keys(ov)
          const inh = row?.inherited?.providers
          if (inh && typeof inh === 'object' && Object.keys(inh).length > 0) return Object.keys(inh)
        } catch {}
        try {
          const entry = configEditor?.entries()?.find((e) => e.options?.id === 'llm-pi-ai')
          const providers = entry?.options?.config?.providers
          return providers && typeof providers === 'object' ? Object.keys(providers) : []
        } catch { return [] }
      }

    // 全量读取：provider 之间并发，模型信息解析限并发 8，最终顺序仍严格等于引擎渠道/模型原序
    async function loadModels() {
      if (!llm) return { rows: [], providerCount: 0 }
      // 轮询 / 动作 / 事件可能同时触发，全部复用同一份在途结果，避免并发轰引擎
      if (rowsInFlight) return rowsInFlight
      rowsInFlight = (async () => {
        const base = llm.listProviders()
        // 按配置键序重排；配置里没有的渠道（如内置路由）保持引擎顺序排在后面
        const order = configProviderOrder()
        const rank = new Map(order.map((id, i) => [id, i]))
        const providers = base
          .map((p, i) => ({ p, i, r: rank.has(p.id) ? rank.get(p.id) : order.length + i }))
          .sort((a, b) => a.r - b.r)
          .map((x) => x.p)
        const perProvider = await Promise.all(providers.map(async (provider) => {
          try { return await llm.listModels(provider.id) } catch { return [] }
        }))
        // 展开成一维任务表，下标即最终输出顺序
        const tasks = []
        providers.forEach((provider, pi) => {
          for (const model of perProvider[pi] ?? []) tasks.push({ provider, model })
        })
        const rows = new Array(tasks.length)
        let cursor = 0
        const LIMIT = 8
        const worker = async () => {
          while (cursor < tasks.length) {
            const i = cursor++
            const { provider, model } = tasks[i]
            let info = {}
            try { info = await llm.resolveModelInfo(provider.id, model.id) } catch {}
            rows[i] = {
              cat: categorize(model, info),
              provider: provider.name ?? provider.id,
              providerId: provider.id,
              model: model.id,
              title: model.name ?? model.id,
            }
          }
        }
        await Promise.all(Array.from({ length: Math.min(LIMIT, tasks.length || 1) }, worker))
        return { rows: rows.filter(Boolean), providerCount: providers.length }
      })().finally(() => { rowsInFlight = null })
      return rowsInFlight
    }

    async function readCurrentSelection() {
      try {
        const sc = sessionController ?? sessionRemote
        if (!sc?.modelCatalog) return null
        const catalog = await sc.modelCatalog()
        const def = catalog?.default
        if (def?.provider && def?.model) return { provider: def.provider, model: def.model }
      } catch {}
      return null
    }

    // 分类分组缓存：rows 引用 + 当前渠道不变时复用，避免每次勾选都对全表做 5 轮 filter
    // 同时缓存每条 row 的固定部分（key / action / 基础标题），勾选时只重拼标记位
    let viewBase = null
    let itemCache = new Map()

    function getViewBase(rows, prov) {
      if (viewBase && viewBase.rows === rows && viewBase.prov === prov) return viewBase
      const providerMap = new Map()
      for (const r of rows) if (!providerMap.has(r.providerId)) providerMap.set(r.providerId, r.provider)
      // 渠道已被删除：回落到全部渠道（调用方会同步修正 currentProvider）
      if (prov && !providerMap.has(prov)) return getViewBase(rows, '')
      const rows2 = prov ? rows.filter((r) => r.providerId === prov) : rows
      const groups = {}
      for (const cat of CATEGORIES) groups[cat.key] = []
      // 同一分类内按厂家聚合：先出现的厂家整组前置，组内保持引擎原序，避免 deepseek/qwen 被拆散
      for (const cat of CATEGORIES) {
        const bucket = rows2.filter((r) => r.cat === cat.key)
        if (bucket.length === 0) continue
        const famOrder = []
        const famMap = new Map()
        for (const r of bucket) {
          const fam = modelFamily(r)
          if (!famMap.has(fam)) { famMap.set(fam, []); famOrder.push(fam) }
          famMap.get(fam).push(r)
        }
        for (const fam of famOrder) groups[cat.key].push(...famMap.get(fam))
      }
      const providerList = [...providerMap.entries()].map(([id, name]) => ({ id, name: String(name).replace(/\u200b/g, '') }))
      const keys = rows2.map((r) => `${r.providerId}:${r.model}`)
      viewBase = { rows, prov, providerMap, providerList, rows2, groups, keys, total: rows2.length }
      itemCache = new Map()
      return viewBase
    }
    function buildData(rows, locale) {
      const zh = !String(locale ?? '').startsWith('en')
      const pick = (a) => (zh ? a.zh : a.en)
      // 分组 + key 数组走缓存；勾选只影响标记位，不重建结构
      const base = getViewBase(rows, currentProvider)
      currentProvider = base.prov
      const { groups, keys: keyList, total } = base

      const out = {
        summary: '', modelTitle: '', providerList: [], providerTitle: '', providerEditActions: [], sortSyncActions: [], providerTargetName: '', currentProvider,
        deleteMode, confirmDeleteLabel: '',
        editActions: [], deleteModeLabel: '',
        toolActions: [], testLabel: '', errorTitle: '', errorBlocks: [],
        chat: [], multimodal: [], generative: [], special: [], agent: [],
      }
      // 渠道列表：全部用绑定数组交给 list 渲染（已验证可用的方式，不再绑定整棵节点树）
      // 每行右侧 trailing 显示三横杠图标；点行 = 打开该渠道的排序菜单
      const rowsOut = []
      const configIds = new Set(configProviderOrder())
      const targetIdx = moveTarget ? base.providerList.findIndex((p) => p.id === moveTarget) : -1
      // 配置里的渠道按配置顺序排，其余（引擎内置 catalog 渠道）保持引擎顺序跟在后面
      const movable = base.providerList.filter((p) => configIds.has(p.id))
      const fixed = base.providerList.filter((p) => !configIds.has(p.id))
      const ordered = [...movable, ...fixed]
      for (let i = 0; i < ordered.length; i++) {
        const { id, name } = ordered[i]
        const canMove = configIds.has(id)
        // 排序菜单放在被移动渠道这一行的上面（不是列表顶部）
        if (providerEditMode && canMove && id === moveTarget) {
          const ci = movable.findIndex((p) => p.id === id)
          const canUp = ci > 0
          const canDown = ci < movable.length - 1
          if (canUp) rowsOut.push({
            title: pick({ zh: '↑ 上移', en: '↑ Move up' }),
            action: { id: 'provider-move', args: { dir: 'up' } },
            icon: 'menu',
          })
          if (canDown) rowsOut.push({
            title: pick({ zh: '↓ 下移', en: '↓ Move down' }),
            action: { id: 'provider-move', args: { dir: 'down' } },
            icon: 'menu',
          })
        }
        const shownTitle = (id === currentProvider ? '✓ ' : '') + name
        if (!providerEditMode) {
          // 未开启渠道编辑：纯展示/筛选，不显示排序入口
          rowsOut.push({
            title: shownTitle,
            ...(canMove ? {} : { subtitle: pick({ zh: '引擎内置', en: 'Built-in' }) }),
            action: { id: 'filter-provider', args: { provider: id === currentProvider ? '' : id } },
          })
          continue
        }
        rowsOut.push(canMove
          ? {
              title: shownTitle,
              trailing: '☰',
              action: { id: 'begin-provider-move', args: { provider: id } },
            }
          : {
              // 引擎内置渠道（如 DeepSeek Account）：总是最先注册，配置改序动不了
              title: shownTitle,
              subtitle: pick({ zh: '引擎内置，位置固定', en: 'Built-in, fixed position' }),
              trailing: '🔒',
            })
      }
      out.providerList = rowsOut
      // 折叠框标题带渠道数量
      out.providerTitle = pick({
        zh: `渠道（${ordered.length}）`,
        en: `Providers (${ordered.length})`,
      })
      out.providerEditActions = [{
        label: providerEditMode
          ? pick({ zh: '渠道编辑 已开启', en: 'Provider edit (on)' })
          : pick({ zh: '渠道编辑', en: 'Provider edit' }),
        action: 'toggle-provider-edit',
        icon: 'edit',
        style: 'primary',
      }]
      // 同步模型排序：放在测试通断按钮上方
      out.sortSyncActions = [{
        label: pick({ zh: '同步模型排序', en: 'Sync model order' }),
        action: 'sync-model-order',
        icon: 'refresh',
      }]
      out.providerTargetName = targetIdx >= 0 ? base.providerList[targetIdx].name : ''

      const dmFlag = deleteMode ? '1' : '0'
      const isCurrent = (r) =>
        currentSelection !== null &&
        r.providerId === currentSelection.provider &&
        r.model === currentSelection.model

      for (const cat of CATEGORIES) {
        const bucket = groups[cat.key] ?? []
        const items = new Array(bucket.length)
        for (let i = 0; i < bucket.length; i++) {
          const r = bucket[i]
          const key = `${r.providerId}:${r.model}`
          // 当前模型：✓ 放标题最前（和渠道一致）；通断点放最后，统一右对齐
          const health = testResults.get(key)
          const dot = health === undefined ? '' : (health.ok ? '🟢' : '🔴')
          const shownErr = health && !health.ok
            ? (zh ? (health.translated ? (health.errorZh || health.error) : '翻译中…') : health.error)
            : ''
          const rateTag = health?.rate ? (zh ? '限流 · ' : 'rate-limited · ') : ''
          const failNote = shownErr ? ` · ${rateTag}${shownErr}` : ''
          const title = (deleteMode
            ? (selected.has(key) ? '☑ ' : '☐ ')
            : (isCurrent(r) ? '✓ ' : '')) + r.title
          // 逐条渲染缓存：勾选某一个时，其余条目直接复用上一帧对象，省掉整表重建
          const sig = `${dmFlag}\u0000${title}\u0000${failNote}\u0000${dot}`
          const cached = itemCache.get(key)
          if (cached !== undefined && cached.sig === sig) {
            items[i] = cached.item
            continue
          }
          const item = {
            title,
            subtitle: r.provider + failNote,
            ...(dot ? { trailing: dot } : {}),
            action: deleteMode
              ? { id: 'toggle-select', args: { key } }
              : { id: 'select', args: { provider: r.providerId, model: r.model } },
          }
          itemCache.set(key, { sig, item })
          items[i] = item
        }
        out[cat.key] = items
      }

      // 编辑模式按钮组（随开关显隐）
      out.deleteModeLabel = pick({ zh: '模型编辑', en: 'Edit' })
      if (deleteMode) {
        out.deleteModeLabel += pick({ zh: ' 已开启', en: ' (on)' })
      }
      out.editActions = [
        { label: out.deleteModeLabel, action: 'toggle-delete', icon: 'edit', style: 'primary' },
      ]
      if (deleteMode) {
        // 先比数量再逐项比对：大部分场景下 O(1) 就能判定“没全选”
        const allChecked = keyList.length > 0 &&
          selected.size >= keyList.length &&
          keyList.every((k) => selected.has(k))
        out.editActions.push({
          label: pick({ zh: allChecked ? '取消全选' : '全选', en: allChecked ? 'Clear' : 'All' }),
          action: 'select-all',
          style: 'primary',
        })
      }

      if (deleteMode && selected.size > 0) {
        out.confirmDeleteLabel = pick({
          zh: `确认删除 ${selected.size} 个模型？`,
          en: `Delete ${selected.size} model(s)?`,
        })
      } else if (deleteMode) {
        out.confirmDeleteLabel = pick({ zh: '未选择模型', en: 'No model selected' })
      } else {
        out.confirmDeleteLabel = ''
      }

      // 失败详情与限流统计：一次遍历同时拿到，避免对全表重复 filter
      let rateCount = 0
      const failRows = []
      if (testResults.size > 0) {
        const rows2 = base.rows2
        for (let i = 0; i < rows2.length; i++) {
          const r = rows2[i]
          const h = testResults.get(`${r.providerId}:${r.model}`)
          if (h === undefined) continue
          if (h.rate) rateCount++
          if (!h.ok) failRows.push(r)
        }
      }
      out.errorTitle = failRows.length > 0
        ? pick({ zh: `错误详情（${failRows.length}）`, en: `Errors (${failRows.length})` })
        : pick({ zh: '错误详情', en: 'Errors' })
      out.errorBlocks = failRows.slice(0, 20).map((r) => {
        const h = testResults.get(`${r.providerId}:${r.model}`)
        const body = String((zh ? (h?.errorZh || h?.error) : h?.error) ?? '').slice(0, 600)
        return {
          type: 'text',
          text: `${r.title}（${r.provider}）\n${body}`,
          style: { size: 'caption', maxLines: 20 },
        }
      })

      // 测试按钮：测试中显示「取消测试」，再点即停
      out.testLabel = testRun
        ? pick({ zh: '取消测试', en: 'Cancel' })
        : pick({ zh: '测试通断', en: 'Test' })
      out.toolActions = [{ label: out.testLabel, action: 'test-visible', icon: testRun ? 'stop' : 'check', style: 'primary' }]

      const testingTag = testRun
        ? (zh ? '，测试中…' : ', testing…')
        : ''
      out.modelTitle = zh
        ? `模型（${total}${rateCount > 0 ? `，限流 ${rateCount}` : ''}${testingTag}）`
        : `Models (${total}${rateCount > 0 ? `, ${rateCount} limited` : ''}${testingTag})`
      return out
    }

    // 只改勾选、筛选这类本地状态时直接用缓存重绘，不再回读引擎（否则每点一次都要全量重扫）
    async function patchNow(locale) {
      let rows = rowsCache
      if (rows.length === 0) {
        rows = (await loadModels()).rows
        rowsCache = rows
      }
      return { patch: buildData(rows, locale) }
    }

    // ---- 对话里报错文本的翻译 ----
    const ERR_HINT_RE = /(error|failed|fail|exception|timeout|timed out|refused|denied|invalid|unauthorized|forbidden|not found|429|401|403|404|500|502|503|超时|失败|错误|拒绝|无效)/i
    let lastErrMsgId = null
    let lastErrMsgSession = null   // 长按那次的对话，跨对话不沿用
    let lastErrMsgAt = 0
    let lastErrShowOriginal = false
    const errZhCache = new Map()

    // 取一条消息的纯文本
    function messageText(session, messageId) {
      if (!session || !messageId) return ''
      let events = []
      try { events = session.ownEvents?.() ?? [] } catch { return '' }
      for (const e of events) {
        if (e?.type !== 'assistant/message') continue
        const msg = e?.data?.message
        if (!msg || msg.id !== messageId) continue
        const content = msg.content
        if (!Array.isArray(content)) return ''
        return content.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n').trim()
      }
      return ''
    }

    // 判定一条文本算不算「本轮报错」：必须有出错字样/错误特征，且内容确实是英文为主
    // —— 光提到 error/timeout 这类词的中文长回复不算，否则会抓到正常聊天
    const ZH_ERR_HINT_RE = /(本轮出错|本轮报错|出错|报错|错误|失败)/
    const HAS_EN_RE = /[A-Za-z]{4,}/
    function isErrorish(text) {
      if (!text || !HAS_EN_RE.test(text)) return false
      if (!ZH_ERR_HINT_RE.test(text) && !ERR_HINT_RE.test(text)) return false
      const t = text.trim()
      if (t.length > 200) return false                       // 报错通常很短，长的是正常回复
      const cjk = (t.match(/[\u4e00-\u9fff]/g) ?? []).length
      if (cjk > 25) return false                             // 中文一大片就是中文回复
      // 需要像报错的样子，不能只是顺口提了一句
      const STRONG = /(^|\n)\s*(error|exception|traceback|panic|fatal|http)[:\s]|HTTP\/?\d?(\.\d)?\s*[45]\d\d|(^|\n)\s*at\s+\S+\s*\(|(E[A-Z]{3,}|TimeoutError|ConnectionError|AuthError)/i
      return STRONG.test(t)
    }

    // 找最近一条精准错误：优先工具报错（带工具名与错误码），其次助手消息里的报错行，
    // 都没有就退回最后一条助手消息，保证不会空手
    function lastErrorText(session) {
      if (!session) return ''
      let events = []
      try { events = session.ownEvents?.() ?? [] } catch { return '' }
      const textOf = (content) => Array.isArray(content)
        ? content.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n').trim()
        : ''
      // 工具名，用于给报错加定位
      const callName = new Map()
      for (const e of events) {
        if (e?.type === 'tool/call' && e?.data?.callId) callName.set(e.data.callId, e?.data?.name ?? '')
      }
      // 第零遍：本轮以错误结束（最贴近「本轮出错」）
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i]
        if (e?.type !== 'turn/end') continue
        const r = e?.data?.reason
        if (r?.kind !== 'error' && r?.kind !== 'aborted') continue
        const f = r?.error ?? {}
        const msg = typeof f?.message === 'string' ? f.message : ''
        const code = f?.code ?? ''
        const one = [code, msg].filter(Boolean).join(' · ').trim()
        if (one && HAS_EN_RE.test(one)) return one
      }

      // 第一遍：最近的工具报错（最精准，带工具名与错误码）
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i]
        if (e?.type !== 'tool/result') continue
        const err = e?.data?.error
        if (!err) {
          const t = textOf(e?.data?.message?.content)
          if (isErrorish(t)) return t
          continue
        }
        const name = callName.get(e?.data?.message?.callId) || ''
        const head = [name, err?.code, err?.name].filter(Boolean).join(' · ')
        const body = [err?.reason, textOf(e?.data?.message?.content)].filter(Boolean).join('\n')
        const one = (head + (body ? `\n${body}` : '')).trim()
        if (one && HAS_EN_RE.test(one)) return one
      }
      // 第二遍：助手消息里的报错（没有就返回空，交给空态提示，不拿普通回复凑数）
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i]
        if (e?.type !== 'assistant/message') continue
        const text = textOf(e?.data?.message?.content)
        if (text && isErrorish(text)) return text
      }
      return ''
    }

    // 分段翻译（每块 ≤600 字），单块失败重试一次；全失败返回 '' 让调用方回落
    async function translateChunked(text) {
      const lines = text.split('\n')
      const chunks = []
      let cur = ''
      for (const line of lines) {
        if (cur && cur.length + line.length + 1 > 600) { chunks.push(cur); cur = '' }
        cur += (cur ? '\n' : '') + line
      }
      if (cur) chunks.push(cur)
      const out = []
      for (const c of chunks) {
        let t = await translateError(c)
        if (!t) { await new Promise((r) => setTimeout(r, 700)); t = await translateError(c) }
        out.push(t || '')
      }
      if (out.every((t) => !t)) return ''
      return out.map((t, i) => t || `[未译] ${chunks[i]}`).join('\n')
    }

    // 短文本整段保留（工具报错通常就几行，过滤会丢关键信息）；长文本才只挑报错行
    function errorLines(text) {
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
      if (lines.length <= 6) return lines.join('\n').slice(0, 1200)
      const hit = lines.filter((l) => ERR_HINT_RE.test(l))
      return (hit.length > 0 ? hit : lines).join('\n').slice(0, 1200)
    }

    dshGo.panel('err', {
      view: (s, caps) => {
        const zh = !String(caps?.locale ?? '').startsWith('en')
        return {
          v: 2,
          type: 'stack',
          title: zh ? '错误翻译' : 'Error text',
          children: [
            { type: 'text', text: {$: 'data.hint'}, tone: 'muted' },
            { type: 'stack', children: {$: 'data.blocks'} },
          ],
        }
      },
      data: async (s, emit, info) => {
        const zh = !String(info?.locale ?? '').startsWith('en')
        const empty = (msg) => ({ hint: msg, blocks: [] })
        if (!s.sessionId) { emit(empty(zh ? '请在有对话的页面打开' : 'Open inside a conversation')); return () => {} }
        let session = null
        try { session = ctx.get('sessions')?.get?.(s.sessionId) } catch {}
        // 长按指定的那条只生效一次，用完即清；否则一律重新扫最新
        // 只用「当前对话」的内容：长按那条若属于别的对话，一律不用
        let raw = ''
        if (lastErrMsgId && lastErrMsgSession === s.sessionId) raw = messageText(session, lastErrMsgId)
        lastErrMsgId = null
        if (!raw) raw = lastErrorText(session)
        if (!raw) { emit(empty(zh ? '无报错内容可供翻译' : 'No error text to translate')); return () => {} }

        const src = errorLines(raw)
        const emitView = (t) => emit({
          hint: zh ? '点按钮在原文与译文间切换' : 'Toggle original/translated',
          blocks: [{
            type: 'stack',
            children: [
              { type: 'text', text: t, style: { size: 'caption', maxLines: 20 } },
              { type: 'actions', items: [{
                label: lastErrShowOriginal ? (zh ? '查看译文' : 'Translated') : (zh ? '查看原文' : 'Original'),
                action: { id: 'toggle-err' },
              }] },
            ],
          }],
        })

        if (lastErrShowOriginal) { emitView(src); return () => {} }
        const cached = errZhCache.get(src)
        if (cached) { emitView(cached); return () => {} }
        emit(empty(zh ? '翻译中…' : 'Translating…'))
        const zhText = await translateChunked(src)
        if (zhText) errZhCache.set(src, zhText)
        lastErrShowOriginal = zhText ? false : true
        if (!zhText) {
          emit({
            hint: zh ? '翻译失败，已显示原文（可点重试）' : 'Translation failed; showing original',
            blocks: [{
              type: 'stack',
              children: [
                { type: 'text', text: src, style: { size: 'caption', maxLines: 20 } },
                { type: 'actions', items: [{ label: zh ? '重试翻译' : 'Retry', action: { id: 'retry-err' } }] },
              ],
            }],
          })
          return () => {}
        }
        emitView(zhText)
        return () => {}
      },
      actions: {
        'retry-err': () => ({ refresh: true }),
        'toggle-err': (s, event) => {
          const zh = !String(event.locale ?? '').startsWith('en')
          lastErrShowOriginal = !lastErrShowOriginal
          let session = null
          try { session = ctx.get('sessions')?.get?.(s.sessionId) } catch {}
          let rawT = (lastErrMsgId && lastErrMsgSession === s.sessionId) ? messageText(session, lastErrMsgId) : ''
          if (!rawT) rawT = lastErrorText(session)
          const src = errorLines(rawT)
          const shown = lastErrShowOriginal ? src : (errZhCache.get(src) || src)
          return {
            patch: {
              hint: zh ? '点按钮在原文与译文间切换' : 'Toggle original/translated',
              blocks: [{
                type: 'stack',
                children: [
                  { type: 'text', text: shown, style: { size: 'caption', maxLines: 20 } },
                  { type: 'actions', items: [{
                    label: lastErrShowOriginal ? (zh ? '查看译文' : 'Translated') : (zh ? '查看原文' : 'Original'),
                    action: { id: 'toggle-err' },
                  }] },
                ],
              }],
            },
          }
        },
      },
    })

    // 长按助手消息「翻译报错」→ 记下这条消息并打开面板
    dshGo.on('translate-error', (scope) => {
      lastErrMsgId = scope?.messageId ?? null
      lastErrMsgSession = scope?.sessionId ?? null
      lastErrMsgAt = Date.now()
      lastErrShowOriginal = false
      return { open: 'panel:err' }
    })

    dshGo.panel('models', {
      view: (s, caps) => {
        // 拉取视图 = 面板被打开：同步复位到当前模型所在渠道，并立即重绘（不等下一次刷新）
        needReset = true
        currentProvider = currentSelection?.provider ?? ''
        moveTarget = ''
        if (rowsCache.length > 0) {
          const loc = caps?.locale ?? ''
          const data = buildData(rowsCache, loc)
          for (const e of emitters.values()) { try { e(data) } catch {} }
        }
        const zh = !String(caps?.locale ?? '').startsWith('en')
        const label = (c) => (zh ? c.label.zh : c.label.en)
        const children = [
          {
            type: 'actions',
            items: [
              { label: zh ? '模型入口' : 'Model settings', action: 'open-models', icon: 'settings' },
              { label: zh ? '翻译报错' : 'Err zh', action: 'goto-err', icon: 'translate' },
            ],
          },
          // 渠道单独一个框（每行右侧 ☰，点行打开排序菜单）
          {
            type: 'collapsible',
            label: { $: 'data.providerTitle' },
            expanded: true,
            children: [
              { type: 'actions', items: { $: 'data.providerEditActions' } },
              { type: 'list', items: { $: 'data.providerList' } },
            ],
          },
          // 模型框：与「渠道」并列同款折叠框，标题字体一致
          {
            type: 'collapsible',
            label: { $: 'data.modelTitle' },
            expanded: true,
            children: [
              // 同步模型排序（放在测试通断上方）
              { type: 'actions', items: { $: 'data.sortSyncActions' } },
              // 测试通断按钮（走数据绑定，提示测试中状态）
              { type: 'actions', items: { $: 'data.toolActions' } },
              // 编辑模式按钮组（全选 / 删除选中随开关显隐，走数据绑定）
              { type: 'actions', items: { $: 'data.editActions' } },
              { type: 'confirm', id: 'confirm-delete', confirmLabel: { $: 'data.confirmDeleteLabel' }, cancelLabel: zh ? '取消' : 'Cancel' },
            ],
          },
        ]
        // 每个分类单独一个框
        for (const cat of CATEGORIES) {
          children.push({
            type: 'collapsible',
            label: label(cat),
            expanded: true,
            children: [{ type: 'list', items: { $: `data.${cat.key}` } }],
          })
        }
        // 错误详情区：固定标题，数量随绑定；默认收起
        children.push({
          type: 'collapsible',
          label: { $: 'data.errorTitle' },
          expanded: false,
          children: [{ type: 'stack', children: { $: 'data.errorBlocks' } }],
        })
        return { v: 2, type: 'stack', title: label({ label: { zh: '模型分类', en: 'Model organizer' } }), children }
      },

      data: async (s, emit, info) => {
        let stopped = false
        const scopeKey = JSON.stringify(s ?? {})
        emitters.set(scopeKey, emit)
        panelOpen = true
        const locale = info?.locale ?? ''
        const refresh = async () => {
          if (stopped) return
          try {
            const { rows } = await loadModels()
            if (stopped) return
            rowsCache = rows
            // 面板每次重新打开（view 被重拉）都回到当前模型所在渠道；面板内点选不覆盖
            if (needReset) {
              needReset = false
              const sel = await readCurrentSelection()
              if (stopped) return
              currentSelection = sel ?? null
              currentProvider = sel?.provider ?? ''
            } else if (currentSelection === null) {
              const sel = await readCurrentSelection()
              if (!stopped && sel) {
                currentSelection = sel
                if (!currentProvider) currentProvider = sel.provider
              }
            }
            emit(buildData(rows, locale))
          } catch (err) {
            if (!stopped) emit({
              summary: '读取模型失败：' + (err?.message ?? String(err)),
              modelTitle: '', providerList: [], providerTitle: '', providerEditActions: [], sortSyncActions: [], providerTargetName: '', currentProvider, deleteMode, confirmDeleteLabel: '',
              editActions: [], deleteModeLabel: '',
              toolActions: [], testLabel: '', errorTitle: '', errorBlocks: [],
              chat: [], multimodal: [], generative: [], special: [], agent: [],
            })
          }
        }
        await refresh()

        // 实时更新：引擎里插件/渠道配置变化时立刻重读（增删模型、改配置都触发）
        // 删除进行中 / 通断测试进行中不刷新：前者会和配置写入抢锁，后者自己会推结果
        const bump = () => { if (!stopped && !deleting && !testRun) refresh() }
        const disposers = []
        // 注意：绝不监听 llm/stream —— 它是 cordis waterfall 事件，任何不返回值的监听器
        // 都会把 stream() 的返回值吞成 undefined，导致所有模型调用失败。
        for (const ev of ['internal/plugin', 'internal/status']) {
          try { disposers.push(ctx.on(ev, bump)) } catch {}
        }
        // 兜底：短周期轮询（10 秒），保证外部改动也能反映；勾选/删除走本地缓存，不依赖它
        const timer = setInterval(bump, 10000)
        return () => {
          stopped = true
          clearInterval(timer)
          emitters.delete(scopeKey)
          panelOpen = emitters.size > 0
          for (const d of disposers) { try { d?.() } catch {} }
        }
      },

      actions: {
        'open-models': () => ({ open: 'models' }),
        'goto-err': () => ({ open: 'panel:err' }),


        // 测试当前视图内所有模型的通断（并发 4，逐个回写结果）
        'test-visible': async (s, event) => {
          const zh = !String(event.locale ?? '').startsWith('en')
          // 正在测试 → 再点即取消：标记 + 中断在途请求
          if (testRun) {
            testRun.cancelled = true
            try { testRun.controller?.abort() } catch {}
            testRun = null
            testResults.clear()
            const { rows: r0 } = await loadModels()
            rowsCache = r0
            pushAll(event.locale)
            const out0 = buildData(r0, event.locale)
            return { toast: zh ? '已取消测试' : 'Test cancelled', patch: out0 }
          }

          const { rows } = await loadModels()
          rowsCache = rows
          const rows2 = currentProvider ? rows.filter((r) => r.providerId === currentProvider) : rows
          if (rows2.length === 0) return { toast: zh ? '当前没有可测试的模型' : 'Nothing to test' }

          const run = { cancelled: false, controller: new AbortController() }
          testRun = run
          const targets = rows2.map((r) => [r.providerId, r.model])
          const locale = event.locale

          // 后台并发跑（并发 2 + 请求间隔），遇到账户限流整体退避，避免整批全红
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
          const worker = async (queue, counter) => {
            while (queue.length > 0 && !run.cancelled) {
              // 全批暂停中：等它过去
              while (Date.now() < run.pauseUntil && !run.cancelled) await sleep(200)
              const next = queue.shift()
              if (!next) break
              let t0 = Date.now()
              let res = await testModel(next[0], next[1], run)
              let dur = Date.now() - t0
              // 限流：退避重试 2 次；仍限流则整批暂停 10 秒，暂停后补试 1 次
              if (!res.cancelled && !res.ok && isRateLimited(res.error)) {
                for (let attempt = 0; attempt < 2 && !run.cancelled; attempt++) {
                  await sleep(1500 * (attempt + 1))
                  t0 = Date.now()
                  res = await testModel(next[0], next[1], run)
                  dur = Date.now() - t0
                  if (res.ok || res.cancelled || !isRateLimited(res.error)) break
                }
                if (!res.ok && !res.cancelled && isRateLimited(res.error)) {
                  run.rateLimited = (run.rateLimited ?? 0) + 1
                  run.pauseUntil = Date.now() + 10000
                  await sleep(10000)
                  if (!run.cancelled) {
                    t0 = Date.now()
                    res = await testModel(next[0], next[1], run)
                    dur = Date.now() - t0
                  }
                }
              }
              if (res.cancelled || run.cancelled) break
              if (res.ok) counter.ok++
              counter.done++
              pushAll(locale)
              // 间隔按上一轮耗时自适应：慢模型已经把接口压住了，不再额外空等拖长整批
              await sleep(dur > 600 ? 0 : Math.min(200, 600 - dur))
              // 失败项自动翻译，译好再推一次
              if (!res.ok && res.error) {
                const rec = testResults.get(`${next[0]}:${next[1]}`)
                const zhText = await translateError(res.error)
                if (rec) {
                  rec.errorZh = zhText || ''
                  rec.translated = true
                  pushAll(locale)
                }
              }
            }
          }
          const queue = [...targets]
          const counter = { ok: 0, done: 0 }
          Promise.all([worker(queue, counter), worker(queue, counter)])
            .then(() => {
              if (testRun === run) testRun = null
              pushAll(locale)
            })
            .catch(() => { if (testRun === run) testRun = null; pushAll(locale) })

          const out = buildData(rows, locale)
          return {
            toast: zh ? `开始测试 ${targets.length} 个模型，再点一次可取消` : `Testing ${targets.length} model(s); tap again to cancel`,
            patch: out,
          }
        },

        'toggle-delete': (s, event) => {
          deleteMode = !deleteMode
          selected.clear()
          const zh = !String(event.locale ?? '').startsWith('en')
          if (rowsCache.length === 0) loadModels().then((r) => { rowsCache = r.rows }).catch(() => {})
          return {
            toast: zh
              ? (deleteMode ? '已开启模型编辑，可勾选多个模型' : '已退出模型编辑')
              : (deleteMode ? 'Edit mode on' : 'Edit mode off'),
            patch: buildData(rowsCache, event.locale),
          }
        },

        'filter-provider': (s, event) => {
          const args = event.value?.args ?? event.value ?? {}
          const provider = args.provider ?? ''
          currentProvider = typeof provider === 'string' ? provider : ''
          moveTarget = ''
          if (rowsCache.length === 0) loadModels().then((r) => { rowsCache = r.rows }).catch(() => {})
          return { patch: buildData(rowsCache, event.locale) }
        },

        // 勾选 / 取消勾选单个模型（同步返回 patch，点击即刻上屏，不再等引擎重扫）
        'toggle-select': (s, event) => {
          const args = event.value?.args ?? event.value ?? {}
          const key = args.key
          if (!key) return {}
          if (selected.has(key)) selected.delete(key)
          else selected.add(key)
          if (rowsCache.length === 0) loadModels().then((r) => { rowsCache = r.rows }).catch(() => {})
          return { patch: buildData(rowsCache, event.locale) }
        },

        // 全选 / 取消全选（当前筛选范围内，同步返回，key 数组复用缓存）
        'select-all': (s, event) => {
          const rows = rowsCache
          const base = getViewBase(rows, currentProvider)
          const allKeys = base.keys
          const allChecked = allKeys.length > 0 &&
            selected.size >= allKeys.length &&
            allKeys.every((k) => selected.has(k))
          selected.clear()
          if (!allChecked) for (const k of allKeys) selected.add(k)
          if (rowsCache.length === 0) loadModels().then((r) => { rowsCache = r.rows }).catch(() => {})
          return { patch: buildData(rows, event.locale) }
        },

        // 点渠道右侧三横杠：暂存该渠道，渲染出上移/下移菜单
        // 把按厂家聚合后的模型顺序写回配置，dsh-go 模型列表即时同步
        'sync-model-order': async (s, event) => {
          const zh = !String(event.locale ?? '').startsWith('en')
          const pick = (a) => (zh ? a.zh : a.en)
          const res = await regroupModelsByFamily()
          if (!res.ok) return { toast: pick({ zh: '写入模型顺序失败', en: 'Failed to write model order' }) }
          try {
            const { rows } = await loadModels()
            rowsCache = rows
          } catch {}
          return {
            toast: res.changed > 0
              ? pick({ zh: `已同步 ${res.changed} 个渠道的模型顺序`, en: `Synced ${res.changed} provider(s)` })
              : pick({ zh: '模型顺序已是最新', en: 'Model order already up to date' }),
            patch: buildData(rowsCache, event.locale),
          }
        },

        // 渠道编辑开关：关闭时渠道行只用于筛选，开启后才出现 ☰ 排序入口
        'toggle-provider-edit': (s, event) => {
          providerEditMode = !providerEditMode
          if (!providerEditMode) moveTarget = ''
          const zh = !String(event.locale ?? '').startsWith('en')
          return {
            toast: zh
              ? (providerEditMode ? '已开启渠道编辑，可调顺序' : '已关闭渠道编辑')
              : (providerEditMode ? 'Provider edit on' : 'Provider edit off'),
            patch: buildData(rowsCache, event.locale),
          }
        },

        'begin-provider-move': (s, event) => {
          const args = event.value?.args ?? event.value ?? {}
          const target = args.provider
          if (!target) return {}
          moveTarget = moveTarget === target ? '' : target
          return { patch: buildData(rowsCache, event.locale) }
        },

        // 渠道排序：上移/下移后重写 llm-pi-ai providers 键序（引擎渠道顺序即配置键序）
        // 不调整时顺序自动跟随 dsh-go 当前配置；调整后反过来让 dsh-go 一起变
        'provider-move': async (s, event) => {
          const zh = !String(event.locale ?? '').startsWith('en')
          const pick = (a) => (zh ? a.zh : a.en)
          // 列表行 action 的 args 就是 event.value；options 才是 { value }。两处都兼容
          const raw = event.value ?? {}
          const val = raw.dir ?? raw.value ?? raw.args?.dir ?? raw.args?.value
          const dir = val === 'up' ? -1 : val === 'down' ? 1 : 0
          const target = moveTarget
          if (!target || dir === 0) {
            moveTarget = ''
            return { patch: buildData(rowsCache, event.locale) }
          }
          // 以配置键序为准（引擎不因纯换序重新注册，listProviders 顺序不可信）
          const ids = configProviderOrder()
          if (ids.length === 0) return { toast: pick({ zh: '读取渠道失败', en: 'Cannot read providers' }) }
          const from = ids.indexOf(target)
          const to = from + dir
          if (from < 0 || to < 0 || to >= ids.length) {
            moveTarget = ''
            return { patch: buildData(rowsCache, event.locale) }
          }
          ;[ids[from], ids[to]] = [ids[to], ids[from]]
          const ok = await reorderProviders(ids)
          // 菜单保持展开：位置不合适可以继续点上移/下移，不用再点一次三条杠
          if (!ok) return { toast: pick({ zh: '保存渠道顺序失败', en: 'Failed to save order' }) }
          // 配置写入后引擎要重载注册表，稍等再读，否则可能读到旧顺序
          await new Promise((r) => setTimeout(r, 300))
          const { rows } = await loadModels()
          rowsCache = rows
          return {
            toast: pick({ zh: '渠道顺序已调整', en: 'Provider order updated' }),
            patch: buildData(rows, event.locale),
          }
        },
        // 删除是慢活（写配置 + 引擎热重载），放进 pending.result，避开 3 秒响应窗口
        'confirm-delete': async (s, event) => {
          const zh = !String(event.locale ?? '').startsWith('en')
          const pick = (a) => (zh ? a.zh : a.en)
          if (!event.value?.confirmed) {
            selected.clear()
            return patchNow(event.locale)
          }
          if (selected.size === 0) return { toast: zh ? '请先勾选要删除的模型' : 'Select models first' }
          // 快照勾选并立即清空，等待期间再点也不会重复删
          const keys = [...selected]
          selected.clear()
          return {
            pending: { label: zh ? '正在删除模型' : 'Deleting', timeoutMs: 60_000 },
            result: async (signal) => {
              // 删除期间暂停轮询 / 事件刷新：它们会和配置写入抢 profile 锁，进而报“插件未激活”
              deleting = true
              let ok = 0
              let errMsg = ''
              try {
                if (!signal?.aborted) {
                  const res = await deleteModels(keys)
                  ok = res.ok
                  if (res.ok === 0) errMsg = res.reason
                }
              } catch (err) {
                errMsg = (err?.message ?? String(err)).slice(0, 40)
              } finally {
                deleting = false
              }
              // 删后只读一次：既判定当前模型是否还在，也用于刷新面板
              const { rows } = await loadModels()
              rowsCache = rows
              if (currentSelection) {
                const alive = rows.some((r) => r.providerId === currentSelection.provider && r.model === currentSelection.model)
                if (!alive) currentSelection = null
              }
              return {
                toast: signal?.aborted
                  ? pick({ zh: '删除已中止', en: 'Deletion stopped' })
                  : errMsg
                    ? pick({ zh: `已删除 ${ok} 个，失败：${errMsg}`, en: `Deleted ${ok}, failed: ${errMsg}` })
                    : pick({ zh: `已删除 ${ok} 个模型`, en: `Deleted ${ok} model(s)` }),
                patch: buildData(rows, event.locale),
              }
            },
          }
        },

        select: async (s, event) => {
          const args = event.value?.args ?? event.value ?? {}
          const provider = args.provider
          const model = args.model
          if (!provider || !model) return { toast: '缺少模型信息' }
          const zh = !String(event.locale ?? '').startsWith('en')
          const pick = (a) => (zh ? a.zh : a.en)
          try {
            // 新对话还没有会话：改设默认模型，新建的对话就用它
            if (!s.sessionId) {
              const defaults = ctx.get('agentDefaultModel')
              if (!defaults?.saveSelection) {
                return { toast: pick({ zh: '切换模型服务不可用', en: 'Model switch unavailable' }) }
              }
              await defaults.saveSelection({ provider, model })
              currentSelection = { provider, model }
              if (!currentProvider) currentProvider = provider
              const out0 = await patchNow(event.locale)
              return {
                toast: pick({ zh: `已设为默认模型 ${model}`, en: `Default model set to ${model}` }),
                patch: out0.patch,
              }
            }
            if (sessionController?.selectModel) {
              await sessionController.selectModel({ sessionId: s.sessionId, provider, model })
            } else if (sessionRemote?.selectModel) {
              await sessionRemote.selectModel({ sessionId: s.sessionId, provider, model })
            } else {
              return { toast: pick({ zh: '切换模型服务不可用', en: 'Model switch unavailable' }) }
            }
            currentSelection = { provider, model }
            if (!currentProvider) currentProvider = provider
            const out1 = await patchNow(event.locale)
            return {
              toast: pick({ zh: `已切换到 ${model}`, en: `Switched to ${model}` }),
              patch: out1.patch,
            }
          } catch (err) {
            const msg = (err?.message ?? String(err)).slice(0, 40)
            return { toast: pick({ zh: `切换失败：${msg}`, en: `Switch failed: ${msg}` }) }
          }
        },
      },
    })

    // 通过引擎配置服务批量删除模型：整批只写一次配置
    // 逐条删除时每次 edit 都要走「文件锁 + 写盘 + Loader 全量热重载」，27 条就是 27 次重载，
    // 期间 fiber 反复重建，edit 会抛“配置插件已不活跃”，表现就是卡死 + 部分失败。
    async function deleteModels(keys) {
      if (!configEditor?.edit) throw new Error('配置服务不可用')
      const entry = configEditor.entries()?.find((e) => e.options?.id === 'llm-pi-ai')
      if (!entry) throw new Error('找不到模型渠道配置')
      const byProvider = new Map()
      for (const key of keys) {
        const sep = key.indexOf(':')
        if (sep <= 0) continue
        const providerId = key.slice(0, sep)
        const modelId = key.slice(sep + 1)
        if (!byProvider.has(providerId)) byProvider.set(providerId, new Set())
        byProvider.get(providerId).add(modelId)
      }
      if (byProvider.size === 0) return { ok: 0, reason: '勾选内容无效' }
      let removed = 0
      let firstErr = ''
      await configEditor.edit(entry, (current, inherited) => {
        const curProviders = (current?.providers) ? { ...current.providers } : {}
        const inhProviders = (inherited?.providers) ? { ...inherited.providers } : {}
        for (const [providerId, want] of byProvider) {
          // 1. 当前配置里没有，看继承配置里有没有（常见于系统内置渠道）
          if (!curProviders[providerId]) {
            const inh = inhProviders[providerId]
            if (inh && Array.isArray(inh.models)) {
              // 把继承模型提升到本地覆盖层，再过滤掉要删的
              const baseModels = inh.models.map(m => (typeof m === 'string' ? { id: m } : m ? { ...m } : null)).filter(Boolean)
              const kept = []
              for (const m of baseModels) {
                if (want.has(m.id)) { removed++; continue }
                kept.push(m)
              }
              curProviders[providerId] = { ...inh, models: kept }
            } else {
              // 两边都没有，说明该模型可能来自引擎硬编码或其他配置项，跳过不报错
              if (!firstErr) firstErr = `渠道 ${providerId} 无本地配置`
            }
            continue
          }
          // 2. 当前配置里有，直接过滤
          const provider = curProviders[providerId]
          if (!Array.isArray(provider.models)) {
            if (!firstErr) firstErr = `渠道 ${providerId} 模型列表无效`
            continue
          }
          const kept = []
          for (const m of provider.models) {
            const id = typeof m === 'string' ? m : m?.id
            if (want.has(id)) { removed++; continue }
            kept.push(m)
          }
          curProviders[providerId] = { ...provider, models: kept }
        }
        return { ...current, providers: curProviders }
      })
      if (removed === 0 && firstErr) return { ok: 0, reason: firstErr }
      return { ok: removed } // 哪怕有部分渠道跳过，只要删了模型就报成功
    }

    // 把每个渠道的 models 数组按厂家聚合重排并写回配置。
    // dsh-go 的模型列表读的就是这份数组，所以写完即时同步，不用重启。
    async function regroupModelsByFamily() {
      if (!configEditor?.edit) throw new Error('配置服务不可用')
      const entry = configEditor.entries()?.find((e) => e.options?.id === 'llm-pi-ai')
      if (!entry) return { ok: false, changed: 0 }
      let changed = 0
      try {
        await configEditor.edit(entry, (current, inherited) => {
          const cur = current?.providers ? { ...current.providers } : {}
          const inh = inherited?.providers ? { ...inherited.providers } : {}
          const allIds = new Set([...Object.keys(inh), ...Object.keys(cur)])
          const out = { ...cur }
          changed = 0
          for (const pid of allIds) {
            const prof = cur[pid] ?? inh[pid]
            if (!prof || !Array.isArray(prof.models) || prof.models.length < 2) continue
            const raw = prof.models
            const before = raw.map((m) => (typeof m === 'string' ? m : m?.id)).join('\u0000')
            const famOrder = []
            const famMap = new Map()
            for (const m of raw) {
              const id = typeof m === 'string' ? m : m?.id
              const fam = modelFamily({ model: id, title: (typeof m === 'object' && m?.name) || id })
              if (!famMap.has(fam)) { famMap.set(fam, []); famOrder.push(fam) }
              famMap.get(fam).push(m)
            }
            const sorted = []
            for (const fam of famOrder) sorted.push(...famMap.get(fam))
            const after = sorted.map((m) => (typeof m === 'string' ? m : m?.id)).join('\u0000')
            if (after === before) continue
            out[pid] = { ...prof, models: sorted }
            changed++
          }
          return { ...current, providers: out }
        })
      } catch { return { ok: false, changed: 0 } }
      return { ok: true, changed }
    }

    // 重排渠道顺序：按传入的 provider id 顺序重建 providers 对象（键序 = 引擎渠道顺序）
    async function reorderProviders(order) {
      if (!configEditor?.edit) throw new Error('配置服务不可用')
      const entry = configEditor.entries()?.find((e) => e.options?.id === 'llm-pi-ai')
      if (!entry) return false
      try {
        await configEditor.edit(entry, (current, inherited) => {
          const cur = (current?.providers) ? { ...current.providers } : {}
          const inh = (inherited?.providers) ? { ...inherited.providers } : {}
          // 合并本地+继承渠道，保证顺序里每个 id 都能找到配置（删除逻辑同款提升处理）
          const merged = { ...inh, ...cur }
          const next = {}
          const seen = new Set()
          for (const id of order) {
            if (seen.has(id) || merged[id] === undefined) continue
            next[id] = merged[id]
            seen.add(id)
          }
          // 补漏：顺序里没提到但配置里实际存在的渠道，追加在末尾，避免丢渠道
          for (const id of Object.keys(cur)) {
            if (!seen.has(id)) { next[id] = cur[id]; seen.add(id) }
          }
          // 免重启关键：引擎判断"是否需要重新注册渠道"用的字段是按名字排序后比较的，
          // 纯换序会被判成没变化、不重新注册，dsh-go 界面就一直停在旧顺序。
          // 这里给第一个渠道的 displayName 交替增减一个零宽字符，让它判定有变化从而重新注册；
          // 零宽字符不可见，界面名称看起来不变。
          const firstId = Object.keys(next)[0]
          if (firstId) {
            const prof = { ...(next[firstId] ?? {}) }
            const cur2 = typeof prof.displayName === 'string' ? prof.displayName : firstId
            prof.displayName = cur2.endsWith('\u200b') ? cur2.slice(0, -1) : cur2 + '\u200b'
            next[firstId] = prof
          }
          return { ...current, providers: next }
        })
        return true
      } catch {
        return false
      }
    }
  })
}
