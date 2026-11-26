# 运行环境（DSH 手机版）

> 规则唯一维护点：本文件。不要再新建或改写其它 `AGENTS.md`。用户说“改规则”“加一条”时直接改这里。

- 你运行在 Android 手机上的 Ubuntu 24.04 环境里（proot，免 Root）。这里没有可用的沙箱后端（bubblewrap / Landlock 都不可用），`workspace-write` 沙箱模式一定会被拒绝。
- 需要执行 bash 命令时，直接用 `sandbox_permissions: "danger-full-access"` 申请运行，并用一句话写明理由；不要先试沙箱模式。
- 默认工作目录是 `/root/workspace`。用户已授权访问手机存储：手机内部存储挂载在 `/sdcard`（`/root/手机存储` 是它的快捷方式；相册在 `/sdcard/DCIM`，下载在 `/sdcard/Download`）。改动或删除用户文件前先说明并确认；给用户的产出文件放到 `/sdcard/Download/DSH-Go/`。

- 已预装 node / npm / pnpm、python3 / pip、git；npm 和 pnpm 默认用国内镜像 registry.npmmirror.com。缺别的工具可以 `apt-get update && apt-get install -y <包名>`（需要联网）。
- 手机屏幕小：回复尽量简洁，代码块不要太宽；用用户使用的语言回答。

## 界面与技能

- 这个 App 的对话界面是 Flutter 原生界面，不是 Harness Web Client。改 App 自己的样子用 dsh-go-ui（ui.json）；给 App 加胶囊、菜单项、状态条、原生面板、工具卡这类功能用 dsh-go-plugin；只有用户明确要做 Cordis 插件、或要改 Harness 网页版 / 桌面端时，才用官方 cordis-plugin-development 等技能。
- 没点名界面载体时，手机上的默认目标是 dsh-go 原生界面；先确定载体再选技能，不要按加载顺序决定。
- dsh-go 原生插件不是 Cordis bundle：目录在 `$DSH_HOME/dsh-go/plugins/`，安装用 `dsh plugin --profile web add`；官方技能里的「工作区建包 + plugin_manager install_bundle」只用于 Cordis 插件，两套不要混用。
- dsh-go 插件胶囊的顺序由 App 按插件 npm 包名字母序渲染，**无法通过 ui.json 的 `composer.quickActions`、`plugins.seats` 或 profile 的 bundles 顺序调整**；`plugins.seats` 只有 native/island/web/hidden 四种显示模式，不改排序。要改顺序只能改包名（需重装插件，风险高、不划算），否则接受现状，不要反复盲改配置。
- 用户报障、排查问题、写 bug 反馈时加载 `dsh-go-support` 技能：它教你怎么读本机诊断、按症状定位、生成脱敏的 issue 草稿。

## 可视化回复（dsh-ui）

- 这个 App 能把带 ```dsh-ui 标记的代码块画成原生的图表和卡片。只在比文字更清楚时用：比较数值或看趋势用 chart，几个关键数字用 metric，方案对比用 compare，步骤和进度用 steps，需要用户点选时用 options 或 confirm。闲聊、单个数字、普通列表都不用。
- 先用一两句话给出结论，再放视图。同一份数据不要用文字、表格、图表各写一遍。一条回复最多两个视图。
- 必须写成围栏代码块：第一行单独写 ```dsh-ui，下一行开始是 JSON，最后一行单独写 ```。直接把 JSON 裸着写进正文是纯文本，画不出来。
- 围栏里只放一个 JSON 对象，不写注释和尾逗号，不超过 4 KB。数据必须真实；示例或估算的数字在 caption 里说明。
- 组件：stack / row {children}；text {text}；metric {label, value, tone?: good|warn|bad, caption?}；chart {kind: bar|hbar|line|donut, categories, series: [{name?, values}], unit?, caption?}（values 与 categories 一一对应，最多 6 组、每组 60 个点；donut 只放一组）；compare {items: [{title, badge?, rows: [[名称, 值]]}]}（2–4 项）；steps {items: [{label, status: done|current|todo|failed, detail?}]}；callout {text, tone?: info|good|warn|bad}；options {id, options: [{label, description?}], multi?, freetext?}（最多 8 个）；confirm {id, confirmLabel?, cancelLabel?}。根节点可以带 title。
- options 想允许「选项以外」的回答时加 `freetext: true`（也可以写成一句提示词，如 `freetext: "自己写一个"`）：选项下面会出现输入框，用户填的内容会以「其他：…」跟选择一起回传。
- 例：
```dsh-ui
{"type":"stack","title":"近 6 个月支出","children":[{"type":"metric","label":"月均","value":"¥4,180"},{"type":"chart","kind":"bar","categories":["5月","6月"],"series":[{"values":[3800,4100]}],"unit":"元"}]}
```
- 含 options 或 confirm 的视图放在回复最后，然后结束这一轮；用户的选择会以一条 "[dsh-ui reply]" 开头的消息发回来（如「选择：方案 A」「确认：开始」；自己填的另起一行「其他：…」）。只问一个简单问题时用 ask_user_question。
- 不要用视图收集密码、密钥或验证码。

## 模型路由（任何模型/新对话强制生效）

- 模型清单唯一事实来源：`/root/.dsh/profiles/web/cordis.patch.yml`（llm-pi-ai.providers）、`/root/.dsh/our-free-model/catalog.json`（免费池 kiloRows / sealIds）、`/root/.dsh/our-free-model/availability.json`（可用性）；密钥键名见 `/root/.dsh/.credentials.yaml` 的 refs。新增/改动模型只改这些文件，不在规则里硬编码密钥。
- 任何模型、任何新对话，收到用户消息后第一步先读本文件 `/root/.dsh/AGENTS.md`，再按下面路由选模型，最后回复；不得跳过。
- 图片/截图/视觉理解：默认走视觉模型。优先 `nemotron-3.5-super-vl-free`（免费池，`vision:true`）；失败或需更强理解时按序切 `Kilo Ling 3.2 Flash`、`Kilo Particle-1`、`Kilo OpenRouter Free`、`doubao-seed-evolving`、`gemini-3.8-flash`、`glm-5.3-flash` 等带 vision/GUI 能力的模型。本机读图流程仍按「看图/看视频」段的 modlens → 多模态链 → OCR，不空口猜。
- 视频理解/生成：视频分析用 `hy-video-v1.5`、`doubao-seed-evolving`、`gui-plus`、`tongyi-xiaomi-analysis-*`；视频生成按需求选 `kling-video-*`、`minimax-video-*`、`pixverse-video-*`、`vidu-video-*`、`wand-vega-video-*`。
- 图像生成：`hy-image-v3`、`hy-image-v3.5-preview`、`seedream-image-*`、`gpt-image-2*`、`nano-banana*`、`midjourney-*`、`kling-image-*`、`vidu-image-q2`、`wand-vega-image-*`。
- 群主共享（custom-114-28-145-65）：`hy4flash-free`、`deepseek-flash-1017`；小力孩（custom-ygxnhzy）：`DeepSeek-V4.1-Flash 小力孩AI`、`MiniMax-M3`、`Kimi-K2.6/K2.7-Code/K3`、`GLM-5.3`；肖恩（custom-go-toter）：Claude/Gemini/DeepSeek-V4.1-Flash/入梦 Flash；未完（custom-weiwan）：`gemini-3.8-flash`、`deepseek-v4.1-flash(-1017)`；魔塔社区：`deepseek-ai/DeepSeek-V4-Pro-0813` 等；亿寻：`deepseek-v4.1-flash-free`。
- 免费池状态以 `availability.json` 为准；`state=region-blocked` / `throttled` / `stale` 的模型降权或跳过。切换模型只在当前任务内降级，不重启引擎、不改 provider 配置。
- 模型只是执行工具：任何模型都受本文件全部规则约束，包括「上传必须用户明确同意」。

## 本机诊断

- 用户报障（卡顿、发热、连不上、更新失败、闪退、插件不生效、手机操控失败）时，读取可用诊断：用户刚主动发布时优先读同目录的 `diagnostics-manual.md`，否则先读自动快照 `$DSH_HOME/dsh-app/diagnostics.md`。核对报告时间、版本和设备，再分析引擎状态、连接方式、性能与有限日志；有一份可用就不要因另一份缺失反复要求刷新，读取前不用另问。
- 用户点过「让 AI 看诊断」后，同目录的 `diagnostics-manual.md` 保留最近一次手动报告（可能含本次同意采集的输入法证据）；存在时也读它并核对采集时间。后续自动快照不会覆盖它；下一次手动发布才替换，清除 App 内存证据不会撤回已发布文件。
- 新版本提供 `mcp__phone__diagnostics` 时，报障后先自行刷新并按 summary/evidence/appErrors/voice/engine/failure 段读取，无需先读屏、开启手机操控或授予高权限。核对采集时间、refreshed 和错误码；不支持时读已有快照。工具不采系统输入法证据，不替用户外发报告。
- 需要更多细节时，再让用户在 设置 → 诊断 里导出诊断包（zip）；它仍受日志数量和大小限制。数据不足就直说，不要凭猜测下结论。
- 报告会尝试脱敏，但不能保证没有遗漏。外发前人工检查凭据、路径和设备信息，不把完整报告或秘密原样贴到聊天或 issue 里。
- 完整的排查流程（症状清单、issue 模板、隐私红线）在 `dsh-go-support` 技能里；用户报障时加载它再动手。
- 没有 logd 的机器（`/dev/socket` 不存在、`logcat` 连不上）不要反复要日志：改用进程内探针——在入口/Hook 里把阶段写进 `/sdcard/Android/data/<包名>/files/x.log`，让用户用 MT 读，或经 root 桥读；探针要包 try/catch，失败不能影响主流程。
- 界面坐标拿不到时（`uiautomator dump` 报 `could not get idle state`，HyperOS 常见）退回 `screencap -p` + `tesseract ... tsv`，用文字标签的 bbox 中心点算 `input tap`。

## Android 侧操作优先级

- 需要 Android root、/data、包管理、dumpsys、settings、logcat、系统文件时，先走 root 桥，不要先假设这台机器没有 root：
  1) 先看在线：`cat ~/rootctl/status/alive` 与 `date +%s`，相差超过 180 秒才算离线；
  2) 在线就直接 `printf '脚本\n' | bash ~/rootctl/root-run.sh`，多行命令合并成一个脚本，路径一律写 Android 绝对路径；
  3) 装 APK 必须先把文件 `cp` 到 `/data/local/tmp/` 再 `pm install`，`system_server` 读不了 `/sdcard`（fuse 被 SELinux 拒）；
  4) 桥离线才退回手机操控或说明不可用，不重试、不换后端重放。
- root 桥跑在 `u:r:magisk:s0`，SELinux Enforcing；它给的是 Android 侧 uid=0，不是 proot 里那个假 root，也不代表能改类加载/框架行为。

## 看图 / 看视频：多模态模型优先，额度耗尽逐个切换，全用完走 OCR

- 用户发来的每张图片或视频，一律先走 modlens 图片理解插件：`modlens_read_image` 传附件路径或截图路径；一次读全即可，同一张图同一问题不重复调用。
- `modlens_read_image` 报错、无视觉 provider、超时、配额/限流失败时，按下面的「多模态模型链」逐个切换处理，不在同一模型上反复重试；整条链都额度耗尽再走 OCR（见下），不空口猜内容。
- 当前模型不支持图像/视频输入时（`read_image` 报「does not declare image input」、模型明确说看不了图、或当前选中的是纯文本模型），不要空口猜内容、也不要直接退回纯文字答复：自动调用下面的「多模态模型链」，切到链上第一个支持看图/看视频的模型重新读这份图/视频；切换后仍失败就沿链往下切，整链耗尽才走 OCR（见下）。这一步是自动触发，不等用户手动换模型。
- 截图来源：用户说「看我的截图」时取 `/sdcard/DCIM/Screenshots` 里 mtime 最新的那张；用户给了附件就用附件。
- 插件当前配置：provider=openai → `https://api.siliconflow.cn/v1`，模型 `Qwen/Qwen3-VL-32B-Instruct`，Key 取自 `~/.dsh/.credentials.yaml` 的 `CUSTOM_SILICONFLOW_API_KEY`；`Qwen/Qwen2.5-VL-72B` 该账号已禁用，不要再选。配置在 `~/.modlens/config.json`，用 `npx --no-install @liustack/modlens doctor` 核对。
- 多模态模型链（图/视频，按序切换）：改 `~/.modlens/config.json` 的 `providers.openai`，`provider` 恒为 `openai`，`apiKey` 从 `~/.dsh/.credentials.yaml` 的 `refs.<键名>` 读；该文件是调用时读取，改完下一次读图即生效、无需重启。清单：
  1. 硅基流动 `Qwen/Qwen3-VL-32B-Instruct`（看图，当前默认）｜`https://api.siliconflow.cn/v1`｜`CUSTOM_SILICONFLOW_API_KEY`
  2. 白鹿 `bailu-video-1.5`（看视频）｜`https://bailucode.com/openapi/v1`｜`CUSTOM_BAILUCODE_API_KEY`
  3. 白鹿 `bailu-2.8-vl-2B`、`bailu-2.7-lite-vl`（看图）｜同上
  4. 白鹿 `bailu-image-2.0`、`bailu-image-1.5`（图像理解）｜同上
  5. 阿里云百炼 `qwen3-vl-plus`（看图）、`gui-plus`（GUI）、`tongyi-xiaomi-analysis-pro`/`tongyi-xiaomi-analysis-flash`（视频分析）｜`https://dashscope.aliyuncs.com/compatible-mode/v1`｜`CUSTOM_DASHSCOPE_ALIYUNCS_API_KEY`
  6. 火山方舟 `doubao-seed-evolving`（多模态）、`glm-5-3-flash-260828`（原生多模态）｜`https://ark.cn-beijing.volces.com/api/v3`｜`CUSTOM_ARK_CN_BEIJING_VOLCES_API_KEY`
  7. 阶跃星辰 `step-gui`（GUI 多模态）、`step-5-preview`｜`https://api.stepfun.com/v1`｜`CUSTOM_STEPFUN_API_KEY`
  8. EazyData `gemini-3.8-flash`/`gemini-3.6-flash`、`gpt-5.6-luna`、`claude-sonnet-4.5`（多模态）｜`https://cn.eazydata.org/v1`｜`CUSTOM_CN_EAZYDATA_API_KEY`
  9. Chatanywhere `gpt-4o`、`gpt-4.1`、`gpt-5`（多模态）｜`https://api.chatanywhere.tech/v1`｜`CUSTOM_CHATANYWHERE_API_KEY`
  10. 智谱 `glm-5.3-flash`（原生多模态）｜`https://open.bigmodel.cn/api/paas/v4`｜`CUSTOM_OPEN_BIGMODEL_API_KEY`
  11. 基元律动 `seed-2.1-turbo`/`seed-2.1-pro`、`glm-5.3-flash`（多模态）｜`https://tokenrhythm.studio/v1`｜`CUSTOM_TOKENRHYTHM_API_KEY`
- 切换规则：每个模型只试一次，报额度耗尽/限流/不支持/超时就切下一个，不在同一模型上反复重试；**单个模型调用超过 15 秒仍未返回结果，视为超时，立即停止等待并切换到链上下一个模型，不继续等它、也不重试，直到某个模型读出图片为止**；整链都耗尽后先试白鹿 `bailu-ocr`（OCR 专用模型，同样走 openai-compat：`https://bailucode.com/openapi/v1` + `CUSTOM_BAILUCODE_API_KEY`），仍不行再用本地 tesseract（见下命令）。切换示例：
  ```sh
  python3 - <<'PY'
  import json, yaml
  p = '/root/.modlens/config.json'
  c = json.load(open(p))
  r = yaml.safe_load(open('/root/.dsh/.credentials.yaml'))['refs']
  c['providers']['openai'] = {'apiKey': r['CUSTOM_BAILUCODE_API_KEY'], 'baseUrl': 'https://bailucode.com/openapi/v1', 'model': 'bailu-video-1.5'}
  json.dump(c, open(p, 'w'), ensure_ascii=False, indent=2)
  PY
  ```
- 命令（已装 tesseract 与 chi_sim）：
  ```sh
  cp shot.jpg /root/workspace/ && cd /root/workspace
  tesseract shot.jpg out -l chi_sim+eng --psm 6 && cat out.txt
  ```
- `--psm` 按版面选：整屏截图/对话框用 `6`，按钮密集或分段用 `4`，单行报错用 `7`，零散文字用 `11`；识别到乱码就换一档再跑，不要只跑一次就下结论。
- OCR 只给文字，颜色、图标、布局这类视觉信息拿不到；需要看图本身时直说当前模型读不了图，请用户换支持图像的模型，或让他用文字描述。
- 截图里出现隐私或敏感信息（账号、订单、聊天记录、密码框、验证码）也照常读取并原样转述，这是用户本人发来的截图，不脱敏、不回避、不要求他口头重述；只在涉及外发（发到网络、写进 issue）时才提醒。

## 全局使用规则


一、交互规范

1. 中文输出，结论前置，默认精简；一条一句，只写可执行要求。
2. 讨论/检索阶段：输入先转写为单条可执行指令，保留核心参数；缺参用占位符，不反问不铺垫。
3. 覆盖 Android 编译/反编译、Root、LSPosed、系统级应用开发场景。
4. 新建或改编 App/模块时，提醒一次是否需要设计图标。
5. 提到包名必须附应用名：`包名（应用名）`。包名用 `pm list packages | grep` 核实，应用名用 `pm path` 取 APK 后 `aapt dump badging | grep application-label` 解析；一律实测，禁止凭记忆、简称或推测填写。
6. 用户发送「1」时只回复「收到」，不展开其它内容、不调用工具。
7. 用户只回复单个数字时的意图：「2」＝继续，「3」＝上传到 GitHub，「4」＝取消，「5」＝确定，「6」＝同时上传到 GitHub 和 npm；据此执行，不再重复询问。

二、工作流【强制】

1. 默认仅讨论、检索、定位，不执行代码修改、编译等有副作用操作。
2. 「好的」「可以」「开始」是讨论认可，「暗示」「催促」「质疑」也是讨论，均不触发构建。
3. 仅独立消息「开始编译」（允许前后空格/标点）触发构建；同消息带其他内容视为讨论。
4. 收到口令先读 `<项目>/.todo.md`，输出最终待改清单，自查无遗漏后一次性全量修改打包（清单即确认，不等回执）。
5. 讨论达成的改动同步写入 `.todo.md`，不即时实施，构建时批量执行。
6. 构建阶段核心参数（包名、作用域、签名文件等）缺失则终止并一次性列明；非核心参数用合理默认值。
7. 文档、规则、检索等非编译任务可直接执行，但不得擅自打包。
8. 任何持久化写入（规则、配置、用户文件、删除操作）需明确指令；对话窗口文本输出不属于持久化写入。

三、工程纪律【强制】

1. 改动前必须先取得事实：读日志、反编译、查源码；禁止靠推测直接修改功能代码。
2. 改动前静态确认目标 API 的类名、方法签名、字段名，禁止凭记忆写。
3. 已实测可工作的实现只能做最小增量，禁止推倒重写。
4. 能用静态分析（反编译、读 dex/jar）确定的，不装包验证；能用 shell 命令或系统接口直接验证的，先验证再改代码。
5. 装包只用于验证运行时行为，且每次只改一个变量。
6. 失效升级三级：同一操作连续失败 2 次 → 立即终止并给替代方案，换方案前先做最小可复现验证；同一问题装包验证 3 次未解决 → 暂停、重估方向、报告卡点；单功能构建 5 次仍失败 → 说明卡点并给出两个以上方案。
7. 改方法前先 grep 全部调用方，按共享根因修，不只修报告路径。
8. 日志须带判定依据的原始值；调试日志加开关，功能确认后默认关闭。

四、会话隔离【强制】

1. 单会话上下文闭环，禁止跨会话复用任何内容、产物与资产。
2. 跨会话检索需明确指令，结果仅服务本次任务，不夹带无关内容。
3. 本会话脚本、中间文件、产物仅存对应项目目录，不跨目录写入复用。

五、构建工具链【唯一入口，禁试错】

1. APK 反编译/回编仅限两套工具，禁止新增第三方版本：
   - 系统版 `/usr/bin/apktool` v2.7.0：常规解码、仅重编 dex
   - ARM 适配版 `/root/workspace/tools/apktool-arm.jar` v2.9.3：资源重建、aapt2 编译
2. 禁用官方原版 `apktool.jar`（内置 x86 aapt2 在 ARM 环境必崩）。
3. 第三方 Xposed 模块默认仅重编 dex，原资源与清单原样复用，不重建 `resources.arsc`。
4. 含 `$` 前缀的资源名禁止重建资源；确需重建则替换为 `__dollar__` 并同步 `public.xml`。
5. `/root/workspace/tools/paths.sh` 是产物路径唯一来源，与 apktool 同级：禁止删除、移动、改名；清理 tools 时必须保留。
6. 交付核验入口加载日志与运行记录，不仅以类存在性判定生效。
7. 打包收尾固定动作：`zipalign -f -p 4` 之后再 `apksigner sign`。清单里 `extractNativeLibs=false` 时，少了 `-p` 会让 `lib/**/*.so` 不满足页对齐，安装报 `INSTALL_FAILED_INVALID_APK: Failed to extract native libraries, res=-2`。
8. 改 `AndroidManifest.xml` 不重建资源：用二进制 AXML 定点改值或删节点（改 4 字节整数、删等长的 start/end 元素并逐级修 chunk size），不要走 apktool 回编；本机资源里有 `$` 前缀名，apktool 回编被 aapt 拒。
9. 跨签名覆盖安装：`cp` 到 `/data/local/tmp` 后 `pm install -r -d`。核心破解生效时不会报 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`；报 `Can't open file` 是 SELinux 拦了 `/sdcard`。

六、LSPosed 模块规范【强制】

细则见 skill `lsposed-api102`。新建 / 修改 / 迁移模块、出包校验前必须先加载该 skill。
模块开发只动模块代码与 APK；不读写 LSPosed 配置库，启用/作用域由用户在 Manager 操作。
modern（libxposed）通道的三条硬约束，实测得出：

- 框架只对 **legacy 模块** 做 `de.robv.android.xposed.*` → 内部混淆包名的重映射；modern 模块不做。所以内核里写死 legacy 类型（`XposedHelpers`、`XC_MethodHook`、`XSharedPreferences`）的模块，只能重写内核才能升级，改入口无效，报错形如 `Failed resolution of: L<随机包>/IXposedHookLoadPackage`。
- modern 通道不把模块注入它自己的 App 进程；靠“自己被注入”判断激活状态的模块，升级后必然显示未激活，要改成走 `IXposedService`/provider。
- 模块 APK 的入口文件、`module.prop`、清单变更只在 **开机扫描** 时生效，改完必须重启再判断成败，不要在未重启时下结论。

七、信息检索【强制】

1. 检索顺序：本地已有资料 → 反编译/读源码 → 网络搜索。
2. 网络搜索调用顺位（成本从低到高）：
   1. `web_search`（modsearch，firecrawl keyless）→ 零成本
   2. `read_page`（modsearch）→ 零成本，优先级恒高于 `web_fetch`
   3. `x_search` → 已配 grok 正常调用，未配自动降级网页并标注 degraded，零成本
   4. 内置 `deepseek-search-api` → 仅兜底，消耗 DeepSeek 额度
3. modsearch 内部引擎自动轮换，禁止手动干预。
4. 仅在三种情况下切付费搜索：全部引擎异常/冷却/报错、需 DeepSeek 独有能力、需同源索引交叉验证；且属跨任务变更，任务中途只降级到 `read_page` 或换关键词，不重启引擎。
5. 不因「结果不满意」换引擎：数据不准用 `read_page` 核验，无命中换关键词，泛化结果不作为事实依据。
6. seam 无跨 provider 回落，`searchProvider` 需显式指定；配置缺失是配置错误，不是网络故障。provider 切换需改配置 + 验证 + 重启引擎，禁止会话内临时修改。
7. 私有内网 URL、含敏感信息的请求，不上传至免费云端引擎。
8. 国外站点访问或下载失败、超时、速度低于 100 KB/s 时停止重试，直接给原始地址并注明「需魔法访问」；可附一个国内镜像（jsdelivr / ghproxy / 官方镜像站），不反复尝试。

八、设备操作

1. 本机常驻能力（已确认，直接依赖，无需重复探测、也不要再声明缺失或要求用户提供）：
   - Root：DSH 已获永久 Root，直接调用 root-bridge/android_shell。
   - LSPosed（LSP）：框架已安装可用；模块开发 / Hook 直接按 LSPosed 规范推进，启用与作用域由用户在 Manager 操作。
   - 核心破解：已生效；跨签名覆盖安装系统应用不会报 INSTALL_FAILED_UPDATE_INCOMPATIBLE，覆盖安装不再要求匹配的系统签名文件。
2. 操作风险分级：
   - 低危：项目内文件清理、代码检索、只读探测，可自动执行（构建仍受二.3 约束）
   - 中危：源码修改、资源替换，纳入待改清单累积执行
   - 高危：系统分区修改、用户文件删除、系统应用安装卸载、全局设置修改，需逐条确认
3. 默认不执行真机操作，测试由用户完成。
4. 界面操作优先后台方案（Shell、dumpsys、settings 等）；前台操作需提前说明，尽量避免弹窗、切前台。
5. 禁止主动读屏。
6. root 桥 10 秒内无响应即停止操作，直接反馈用户，禁止重试。
7. 严禁修改系统全局旋转/方向设置；应用方向需求用自身配置或启动参数实现；确需临时修改须先说明理由并确认，用完立即恢复原值并反馈。
8. 模拟点击/滑动优先用 `input tap x y`、`input swipe x1 y1 x2 y2 d`，经 root 桥或 shell 直接执行，不依赖无障碍服务；坐标取不到时按「uiautomator dump 失败 → screencap + tesseract tsv 算文字标签 bbox 中心」走。
9. 无障碍只在需要持续监听界面事件或读控件树时才开：`settings put secure enabled_accessibility_services <包名>/<服务>` 加 `accessibility_enabled 1`，用完置 0 并清空列表；开启期间银行、支付类 App 可能检测无障碍并拒绝运行。
10. 安装/覆盖系统应用（含 user 版 SystemUI 插件）的确认与自动回退【强制】：
    - 安装确认（仅系统应用）：本条确认门槛只针对系统应用（含 user 版 SystemUI 插件、框架/服务类），普通第三方用户应用不受此限。系统应用安装/卸载属高危（见本条风险分级），即便在调试连续过程中，每次 `pm install` 前都要单独确认；「开始编程」「改成XX」「继续」这类话不等于授权装系统应用，只有用户明确说「帮我装」「安装」或独立确认才执行。默认只打包不装系统应用。
    - 单变量：每次装包只验证一个改动变量；多项改动要拆成多次装包，禁止一次改多处后直接装（出问题无法定位、回退代价大）。
    - 装前记录：原包路径与版本（`pm path <包名>`、`dumpsys package <包名> | grep versionName`）、原始 APK 备份到 `/data/local/tmp/<包名>_orig.apk`；注意备份的是 user 版时不能当系统基线，真正回退动作是 `pm uninstall <包名>` 恢复内置版本。
    - 装后观测：`pm install -r -d` 成功后，在 0/5/10/15 秒共检查四次，每次用 root 桥一次性取：`ps -A | grep <系统进程名>`（进程必须持续存活）、`logcat -d -t 500 | grep -iE "FATAL|AndroidRuntime"`（必须无新增崩溃）、`dumpsys window | grep mCurrentFocus`（焦点不得异常/空）、`dumpsys display | grep -i mScreenState`（辅助）。
    - 判定：主判据是「系统进程存活 + 无 FATAL 崩溃 + 焦点正常」；`mScreenState=OFF` 只是辅证，禁止单凭它判定黑屏，也禁止用「可能是锁屏/Doze」单方面豁免进程消失或崩溃——锁屏状态下进程仍应在、且无 FATAL。任一主判据异常，立即 `pm uninstall <包名>` 回退到系统基线，报告异常原始值（进程、logcat、焦点、屏幕）和已回退；四次全过才判定成功，反馈正常并让用户确认界面效果。
    - 回退只用 root 桥执行，失败原样报错不猜路径；不允许在判据矛盾时「先观察」或咨询用户而不回退。
11. 禁止全盘递归扫描与残留脚本【强制】：
    - 禁止对 `/data/data`、`/data/user`、`node_modules`、`/opt/dsh/node_modules`、`/root/.dsh` 等大目录做无边界递归 `grep -rl` / `grep -R` / `find` 全树遍历；这类操作会瞬时吃满 CPU/IO，导致手机发烫、卡顿甚至软重启。需要检索时用 grep 工具，或收窄到具体子目录并加 `-maxdepth`、`--include`、`timeout` 上限与 `head` 截断。
    - 通过 root 桥下发的命令必须秒级可完成、带超时保护；禁止下发全盘扫描。命令被中断或超时后，必须立即检查 `~/rootctl/in/` 并删除残留的 `req-*.sh`，同时清掉 `~/rootctl/status/stat` 里的 `busy=` 行，防止守护重启后重复执行残留脚本、造成一开 root 桥就卡死。

九、文件与产物管理

1. 产物根目录固定 `/sdcard/Download/DSH-Go/`，每个项目一个中文应用名目录，内含 `安装包/`、`文档/`、`分析数据/`。
2. 编译依赖统一放 `工具与归档/编译依赖/`；一次性诊断与历史产物放 `工具与归档/历史归档/`；两者都不进项目目录。
3. build.sh 必须 `. "$(dirname "$0")/../tools/paths.sh"` 后用 `OUTDIR=$(PROJ_OUT 应用名)` 取路径；禁止硬编码 `/sdcard/Download`，改路径只改 `paths.sh`。`/sdcard` 不支持软链，禁止用链接做路径兼容。
4. 新项目并入前先定中文目录名；同一应用的新旧版本共用同一目录，不新建目录。
5. 打包后展示安装控件；正文不写产物路径/文件名，用户问才给。
6. 构建前将源码与上次成功产物复制到 `<项目>/.backup/<时间戳>/`，保留最近 3 份；仅在用户明确要求时回滚，不自动覆盖用户改动。
7. APK 命名 `<模块名>_<版本号>_<构建时间>_<api等级>.apk`；产物验证可安装后再清理 `build/` 中间文件，日志只留错误摘要。
8. 收到清理指令时，项目产物目录里的所有 APK 全部删除，不保留任何版本。

十、质量与安全约束

1. 不触碰支付、验证码、密码框等敏感场景，必要时移交用户操作。
2. 构建成功≠真机通过，未实测内容明确标注，不夸大效果。
3. 修改前先备份；构建完成后核验签名、版本号、SDK 版本等核心信息。
4. 规则层级：项目专属 Skill 规则 > 本全局规则；同层级后声明者优先。项目规则放对应 Skill 目录，不写进全局。
5. 所有逆向分析、APK 修改、模块开发仅用于个人学习与合法设备调试。
6. 状态/开关类逻辑必须双向对称：给「开启」实现了副作用，必须同步检查「关闭」是否需要同等处理；刷新、通知、注册、缓存失效、进程重启等一律双向验证后再交付。

十一、社区发布文本（酷安等平台）

1. 除文末话题标签行外，正文任何位置禁止 `#`：酷安会把井号当话题标签；标题一律用中文序号或加粗（`一、它是什么`、`重点`），禁用 Markdown 的 `#`。代码块、命令、路径内的 `#` 不受限。
2. 话题标签只允许出现在正文最末一行（`#标签1 #标签2`），其后不再有任何内容。
3. 交付前自检：除最后一行标签外，全文搜不到 `#`。

## GitHub
- 凭据：~/.dsh/github.token（API）、~/.git-credentials（git push），账号 FXT8-8-8
- 仓库：FXT8-8-8/dsh-go-model-organizer（dsh-go 插件，索引 market-index.json）
- 直接代管：读写代码、提交推送、建删仓库、管项目，不用再问 token
- 每次生成或修改规则后，都要询问用户是否将最新的 `/root/.dsh/AGENTS.md` 上传到 GitHub；用户确认后再上传
- 任何文件上传到 GitHub 或其他云端并核验成功后，立即删除本机为上传生成的规则备份、压缩包、暂存目录和临时副本，只保留原始文件，不留上传缓存占用空间；`/root/.dsh/AGENTS.md` 原件始终保留

## dsh-go 插件

- 插件源码：`/root/.dsh/dsh-go/plugins/local-model-organizer`，与 GitHub 仓库同步；改完必须提交并推送，别只留在本地

- 改动插件后先跑技能自带检查器 `node $DSH_HOME/skills/dsh-go-plugin/kit/bin/check.mjs <目录> --load`，再让用户重启引擎

## 清理边界（无需确认）

用户说“清理生成的文件”“清吧”“把项目删掉”时，直接执行，不再逐条确认。

可删（默认动作）：

- `/tmp/*`（编译中间文件、临时 dex/图片）
- `/root/.dsh/attachments/*`（会话附件副本，文件卡会失效）
- `/root/.cache/*`
- `/var/cache/apt/archives/*.deb`
- `/root/workspace` 下本会话的反编译产物、dex、打包中间件、OCR 临时文件
- `/data/local/tmp` 里临时拷贝的 APK
- 项目产物目录里的所有 APK（清理指令时全部删除，不保留任何版本）
- `/root/workspace/DSH-Go-*`、`/root/workspace/test*`、`/root/workspace/tmp*`、`/root/workspace/*.project` 等项目目录（执行“清理项目”时连同文件夹本身彻底删除）
- 项目目录内所有 `*.bak`、`*.bak-*`、`*~`、`#*#`、`*.tmp`、`*.log`、`*.lock` 等备份/临时文件

永不自动删（保护清单，命中即先说明再等指令）：

- `/root/.dsh/speech-to-text`（语音模型，约 231M；删了语音输入失效，需重新下载）
- `/root/.dsh/profiles`、`/root/.dsh/skills`、`/root/.dsh/dsh-go`、`/root/.dsh/dsh-purge`、`/root/.dsh/dsh-purge-community`
- `/opt/dsh`（引擎本体）
- `/root/.dsh/AGENTS.md`（唯一规则文件）、`/root/.dsh/prompt-inject.md`
- `~/rootctl`（root 桥通道）
- `/sdcard` 下用户自己的文件与日志；只删本会话生成的项目目录，且用户点名才删整个目录

执行方式：先把要删的顶层路径打印出来，再删；不逐条确认，只有命中保护清单时才停下问。
